import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asActor, createTestDb, expectDbError, newId, type TestDb } from './helpers/db.js';
import { createPendingOrder, payAndPlace, seedCustomer, seedTenant, type SeededTenant } from './helpers/seed.js';

// 결제 데이터 무결성의 DB 계층 검증. PG 연동·웹훅 처리 로직 테스트는 3단계에서 작성한다.
describe('결제·환불 데이터 무결성 (DB 규칙)', () => {
  let db: TestDb;
  let t: SeededTenant;
  let customer: string;

  beforeAll(async () => {
    db = await createTestDb();
    t = await seedTenant(db.owner);
    customer = await seedCustomer(db.owner);
  });
  afterAll(async () => db.drop());

  const system = () => ({ role: 'qr_system' as const, tenantId: t.tenantId });
  const insertPayment = (q: { query: Function }, orderId: string, amount: number, requestId = `pay_${newId().replaceAll('-', '')}`) =>
    q.query(
      `INSERT INTO payments (tenant_id, order_id, payment_request_id, provider, environment, amount, status)
       VALUES ($1, $2, $3, 'fake', 'test', $4, 'pending') RETURNING id`,
      [t.tenantId, orderId, requestId, amount],
    );

  it('같은 결제 요청 ID 는 두 번 만들 수 없다', async () => {
    const o = await createPendingOrder(db.owner, t, customer);
    await asActor(db.owner, system(), async (q) => {
      await insertPayment(q, o.orderId, o.total, 'pay_duplicate_request_0001');
      const msg = await expectDbError(q, () => insertPayment(q, o.orderId, o.total, 'pay_duplicate_request_0001'));
      expect(msg).toMatch(/payments_payment_request_id_key/);
    });
  });

  it('[18-15 DB] 승인 금액이 청구 금액과 다르면 결제 완료로 기록할 수 없다', async () => {
    const o = await createPendingOrder(db.owner, t, customer);
    await asActor(db.owner, system(), async (q) => {
      const p = (await insertPayment(q, o.orderId, o.total)).rows[0].id;
      const msg = await expectDbError(q, () =>
        q.query(`UPDATE payments SET status = 'paid', approved_amount = $2, provider_payment_id = 'x1', approved_at = now() WHERE id = $1`, [p, o.total - 1000]),
      );
      expect(msg).toMatch(/payments_check/);
    });
  });

  it('한 주문에 결제 완료 건은 하나만 존재할 수 있다 (이중 결제 차단)', async () => {
    const o = await createPendingOrder(db.owner, t, customer);
    await asActor(db.owner, system(), async (q) => {
      const mark = (id: string) =>
        q.query(`UPDATE payments SET status = 'paid', approved_amount = amount, provider_payment_id = $2, approved_at = now() WHERE id = $1`, [id, `tx-${newId()}`]);
      const p1 = (await insertPayment(q, o.orderId, o.total)).rows[0].id;
      const p2 = (await insertPayment(q, o.orderId, o.total)).rows[0].id;
      await mark(p1);
      const msg = await expectDbError(q, () => mark(p2));
      expect(msg).toMatch(/payments_one_captured_per_order/);
    });
  });

  it('[18-16 DB] 같은 웹훅 이벤트 ID 는 한 번만 저장된다', async () => {
    await asActor(db.owner, system(), async (q) => {
      const save = () =>
        q.query(
          `INSERT INTO payment_events (provider, source, provider_event_id, event_type, payload, signature_verified)
           VALUES ('portone', 'webhook', 'whk_same_event_1', 'Transaction.Paid', '{}', true)
           ON CONFLICT (provider, provider_event_id) DO NOTHING RETURNING id`,
        );
      expect((await save()).rowCount).toBe(1);
      expect((await save()).rowCount).toBe(0);
    });
  });

  it('[18-19, 18-20 DB] 부분 환불 후 잔액 전체 환불 시 결제 상태가 갱신된다', async () => {
    const o = await createPendingOrder(db.owner, t, customer);
    const paymentId = await payAndPlace(db.owner, t, o);
    const staff = { role: 'qr_app' as const, actor: 'staff' as const, tenantId: t.tenantId, userId: t.adminUserId };
    const r1 = await asActor(db.owner, staff, async (q) =>
      (await q.query(
        `INSERT INTO refunds (tenant_id, payment_id, order_id, amount, reason, idempotency_key, requested_by)
         VALUES ($1, $2, $3, 5000, '부분 취소', 'refund-key-0001', $4) RETURNING id`,
        [t.tenantId, paymentId, o.orderId, t.adminUserId],
      )).rows[0].id, { commit: true });
    await asActor(db.owner, system(), async (q) => q.query(`UPDATE refunds SET status = 'succeeded', provider_refund_id = 'r1' WHERE id = $1`, [r1]), { commit: true });
    let pay = (await db.owner.query(`SELECT status, refunded_amount FROM payments WHERE id = $1`, [paymentId])).rows[0];
    expect(pay).toEqual({ status: 'partial_refunded', refunded_amount: 5000 });

    const r2 = await asActor(db.owner, system(), async (q) =>
      (await q.query(
        `INSERT INTO refunds (tenant_id, payment_id, order_id, amount, reason, idempotency_key, requested_kind)
         VALUES ($1, $2, $3, 13000, '전체 취소', 'refund-key-0002', 'system') RETURNING id`,
        [t.tenantId, paymentId, o.orderId],
      )).rows[0].id, { commit: true });
    await asActor(db.owner, system(), async (q) => q.query(`UPDATE refunds SET status = 'succeeded' WHERE id = $1`, [r2]), { commit: true });
    pay = (await db.owner.query(`SELECT status, refunded_amount FROM payments WHERE id = $1`, [paymentId])).rows[0];
    expect(pay).toEqual({ status: 'refunded', refunded_amount: 18000 });
  });

  it('[18-21 DB] 결제 금액을 넘는 환불과 같은 키의 중복 환불은 거부된다', async () => {
    const o = await createPendingOrder(db.owner, t, customer);
    const paymentId = await payAndPlace(db.owner, t, o);
    await asActor(db.owner, system(), async (q) => {
      const refund = (amount: number, key: string) =>
        q.query(
          `INSERT INTO refunds (tenant_id, payment_id, order_id, amount, reason, idempotency_key, requested_kind)
           VALUES ($1, $2, $3, $4, '취소', $5, 'system')`,
          [t.tenantId, paymentId, o.orderId, amount, key],
        );
      await refund(10000, 'refund-key-a');
      expect(await expectDbError(q, () => refund(10000, 'refund-key-a'))).toMatch(/refunds_payment_id_idempotency_key_key/);
      // API 는 같은 키 재시도를 ON CONFLICT 로 받아 기존 환불을 돌려준다
      const retry = await q.query(
        `INSERT INTO refunds (tenant_id, payment_id, order_id, amount, reason, idempotency_key, requested_kind)
         VALUES ($1, $2, $3, 10000, '취소', 'refund-key-a', 'system')
         ON CONFLICT (payment_id, idempotency_key) DO NOTHING RETURNING id`,
        [t.tenantId, paymentId, o.orderId],
      );
      expect(retry.rowCount).toBe(0);
      expect(await expectDbError(q, () => refund(9000, 'refund-key-b'))).toMatch(/REFUND_EXCEEDS_PAYMENT/);
      await refund(8000, 'refund-key-c');
    });
  });

  it('완료된 환불은 다시 처리 상태를 바꿀 수 없다', async () => {
    const o = await createPendingOrder(db.owner, t, customer);
    const paymentId = await payAndPlace(db.owner, t, o);
    await asActor(db.owner, system(), async (q) => {
      const r = (await q.query(
        `INSERT INTO refunds (tenant_id, payment_id, order_id, amount, reason, idempotency_key, requested_kind)
         VALUES ($1, $2, $3, 18000, '취소', 'refund-final-1', 'system') RETURNING id`,
        [t.tenantId, paymentId, o.orderId],
      )).rows[0].id;
      await q.query(`UPDATE refunds SET status = 'succeeded' WHERE id = $1`, [r]);
      expect(await expectDbError(q, () => q.query(`UPDATE refunds SET status = 'failed' WHERE id = $1`, [r]))).toMatch(/REFUND_ALREADY_FINAL/);
    });
  });

  it('미결제 주문에는 환불을 만들 수 없다', async () => {
    const o = await createPendingOrder(db.owner, t, customer);
    await asActor(db.owner, system(), async (q) => {
      const p = (await insertPayment(q, o.orderId, o.total)).rows[0].id;
      const msg = await expectDbError(q, () =>
        q.query(
          `INSERT INTO refunds (tenant_id, payment_id, order_id, amount, reason, idempotency_key, requested_kind)
           VALUES ($1, $2, $3, 1000, '취소', 'refund-unpaid-1', 'system')`,
          [t.tenantId, p, o.orderId],
        ),
      );
      expect(msg).toMatch(/PAYMENT_NOT_REFUNDABLE/);
    });
  });

  it('로컬/스테이징 DB 에는 실결제(live), 운영 DB 에는 테스트·가짜 결제가 들어갈 수 없다', async () => {
    const o = await createPendingOrder(db.owner, t, customer);
    await asActor(db.owner, system(), async (q) => {
      const msg = await expectDbError(q, () =>
        q.query(
          `INSERT INTO payments (tenant_id, order_id, payment_request_id, provider, environment, amount)
           VALUES ($1, $2, 'pay_live_in_local_000001', 'portone', 'live', 1000)`,
          [t.tenantId, o.orderId],
        ),
      );
      expect(msg).toMatch(/PAYMENT_ENVIRONMENT_MISMATCH/);
    });
    await db.owner.query('BEGIN');
    await db.owner.query(`UPDATE deployment_info SET environment = 'production'`);
    const msg = await expectDbError(db.owner, () => insertPayment(db.owner, o.orderId, o.total));
    await db.owner.query('ROLLBACK');
    expect(msg).toMatch(/PAYMENT_ENVIRONMENT_MISMATCH/);
  });

  it('결제 청구 금액과 결제 요청 ID 는 생성 후 바꿀 수 없다', async () => {
    const o = await createPendingOrder(db.owner, t, customer);
    await asActor(db.owner, system(), async (q) => {
      const p = (await insertPayment(q, o.orderId, o.total)).rows[0].id;
      expect(await expectDbError(q, () => q.query(`UPDATE payments SET amount = 1 WHERE id = $1`, [p]))).toMatch(/PAYMENT_IMMUTABLE_FIELDS/);
    });
  });
});
