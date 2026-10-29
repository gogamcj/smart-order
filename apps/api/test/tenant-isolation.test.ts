import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asActor, createTestDb, expectDbError, type TestDb } from './helpers/db.js';
import { createPendingOrder, payAndPlace, seedCustomer, seedTenant, type SeededTenant } from './helpers/seed.js';

// 요구사항 5장 업체별 데이터 격리. API 테스트(2단계)와 별도로, API 에 버그가 있어도 DB 가 막는지 검증한다.
describe('업체 간 데이터 격리 (PostgreSQL RLS)', () => {
  let db: TestDb;
  let a: SeededTenant;
  let b: SeededTenant;
  let customerA: string;
  let customerB: string;
  let orderB: string;

  beforeAll(async () => {
    db = await createTestDb();
    a = await seedTenant(db.owner, { name: '업체A' });
    b = await seedTenant(db.owner, { name: '업체B' });
    customerA = await seedCustomer(db.owner);
    customerB = await seedCustomer(db.owner);
    await createPendingOrder(db.owner, a, customerA);
    const ob = await createPendingOrder(db.owner, b, customerB);
    await payAndPlace(db.owner, b, ob);
    orderB = ob.orderId;
  });
  afterAll(async () => db.drop());

  const staffA = () => ({ role: 'qr_app' as const, actor: 'staff' as const, tenantId: a.tenantId, userId: a.adminUserId });

  it('[18-4] 업체 A 직원은 업체 B 의 주문을 조회할 수 없다', async () => {
    const rows = await asActor(db.owner, staffA(), async (q) => (await q.query(`SELECT id, tenant_id FROM orders`)).rows);
    expect(rows.length).toBe(1);
    expect(rows.every((r) => r.tenant_id === a.tenantId)).toBe(true);
    const direct = await asActor(db.owner, staffA(), async (q) => (await q.query(`SELECT 1 FROM orders WHERE id = $1`, [orderB])).rowCount);
    expect(direct).toBe(0);
  });

  it('[18-4] 업체 B 의 주문 상품·결제·상태 이력도 보이지 않는다', async () => {
    const counts = await asActor(db.owner, staffA(), async (q) => {
      const r = await q.query(`
        SELECT (SELECT count(*) FROM order_items WHERE order_id = $1)::int AS items,
               (SELECT count(*) FROM payments WHERE order_id = $1)::int AS payments,
               (SELECT count(*) FROM order_status_history WHERE order_id = $1)::int AS history`, [orderB]);
      return r.rows[0];
    });
    expect(counts).toEqual({ items: 0, payments: 0, history: 0 });
  });

  it('[18-5] 업체 A 직원은 업체 B 의 메뉴를 수정·삭제할 수 없다 (0행 반영)', async () => {
    await asActor(db.owner, staffA(), async (q) => {
      expect((await q.query(`UPDATE menus SET price = 1 WHERE id = $1`, [b.menuId])).rowCount).toBe(0);
      expect((await q.query(`DELETE FROM menu_options WHERE id = $1`, [b.optionId])).rowCount).toBe(0);
    });
    const price = (await db.owner.query(`SELECT price FROM menus WHERE id = $1`, [b.menuId])).rows[0].price;
    expect(price).toBe(9000);
  });

  it('[18-5] 업체 A 직원이 tenant_id 를 B 로 바꿔 메뉴를 넣으면 거부된다 (파라미터 변조)', async () => {
    await asActor(db.owner, staffA(), async (q) => {
      const msg = await expectDbError(q, () =>
        q.query(`INSERT INTO menus (tenant_id, store_id, category_id, name, price) VALUES ($1, $2, $3, 'x', 1)`, [
          b.tenantId, b.storeId, b.categoryId,
        ]),
      );
      expect(msg).toMatch(/row-level security/);
    });
  });

  it('[18-5] 자기 업체 메뉴를 다른 업체 소유로 옮길 수 없다', async () => {
    await asActor(db.owner, staffA(), async (q) => {
      const msg = await expectDbError(q, () => q.query(`UPDATE menus SET tenant_id = $1 WHERE id = $2`, [b.tenantId, a.menuId]));
      expect(msg).toMatch(/row-level security/);
    });
  });

  it('업체 A 직원은 업체 B 의 주문 상태를 바꾸거나 환불을 넣을 수 없다', async () => {
    const payB = (await db.owner.query(`SELECT id FROM payments WHERE order_id = $1`, [orderB])).rows[0].id;
    await asActor(db.owner, staffA(), async (q) => {
      expect((await q.query(`UPDATE orders SET status = 'accepted' WHERE id = $1`, [orderB])).rowCount).toBe(0);
      const msg = await expectDbError(q, () =>
        q.query(`INSERT INTO refunds (tenant_id, payment_id, order_id, amount, reason, idempotency_key) VALUES ($1, $2, $3, 1000, 'x', 'idem-attack-1')`, [
          b.tenantId, payB, orderB,
        ]),
      );
      expect(msg).toMatch(/row-level security/);
    });
  });

  it('업체 A 직원은 업체 B 의 직원 계정·QR·결제 계정을 볼 수 없다', async () => {
    const r = await asActor(db.owner, staffA(), async (q) => ({
      members: (await q.query(`SELECT tenant_id FROM tenant_members`)).rows,
      qr: (await q.query(`SELECT tenant_id FROM qr_codes`)).rows,
      users: (await q.query(`SELECT id FROM users WHERE id = $1`, [b.adminUserId])).rowCount,
    }));
    expect(r.members.every((m) => m.tenant_id === a.tenantId)).toBe(true);
    expect(r.qr.every((m) => m.tenant_id === a.tenantId)).toBe(true);
    expect(r.users).toBe(0);
  });

  it('업체 컨텍스트가 없으면 아무 데이터도 보이지 않는다 (fail closed)', async () => {
    const r = await asActor(db.owner, { role: 'qr_app', actor: 'staff' }, async (q) => ({
      orders: (await q.query(`SELECT count(*)::int AS n FROM orders`)).rows[0].n,
      menus: (await q.query(`SELECT count(*)::int AS n FROM menus`)).rows[0].n,
      tenants: (await q.query(`SELECT count(*)::int AS n FROM tenants`)).rows[0].n,
    }));
    expect(r).toEqual({ orders: 0, menus: 0, tenants: 0 });
  });

  it('업체 A 의 메뉴가 업체 B 의 카테고리를 참조하면 복합 외래 키가 거부한다 (소유자 권한이라도)', async () => {
    await db.owner.query('BEGIN');
    const msg = await expectDbError(db.owner, () =>
      db.owner.query(`INSERT INTO menus (tenant_id, store_id, category_id, name, price) VALUES ($1, $2, $3, 'x', 1)`, [
        a.tenantId, a.storeId, b.categoryId,
      ]),
    );
    await db.owner.query('ROLLBACK');
    expect(msg).toMatch(/foreign key/);
  });

  it('고객은 같은 매장이라도 다른 고객의 주문을 볼 수 없다', async () => {
    const other = await seedCustomer(db.owner);
    await createPendingOrder(db.owner, a, other);
    const rows = await asActor(
      db.owner,
      { role: 'qr_app', actor: 'customer', tenantId: a.tenantId, userId: customerA },
      async (q) => (await q.query(`SELECT user_id FROM orders`)).rows,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.user_id === customerA)).toBe(true);
  });

  it('[18-6 일부] 고객은 메뉴를 읽을 수만 있고 수정·주문 상태 변경은 할 수 없다', async () => {
    await asActor(db.owner, { role: 'qr_app', actor: 'customer', tenantId: a.tenantId, userId: customerA }, async (q) => {
      expect((await q.query(`SELECT 1 FROM menus`)).rowCount).toBe(1);
      expect((await q.query(`UPDATE menus SET price = 1`)).rowCount).toBe(0);
      expect((await q.query(`UPDATE orders SET status = 'cancelled'`)).rowCount).toBe(0);
    });
  });

  it('고객은 다른 업체 컨텍스트로 주문을 만들 수 없다', async () => {
    await asActor(db.owner, { role: 'qr_app', actor: 'customer', tenantId: a.tenantId, userId: customerA }, async (q) => {
      const msg = await expectDbError(q, () =>
        q.query(
          `INSERT INTO orders (tenant_id, store_id, table_id, user_id, order_no, business_date, display_no,
             store_name_snapshot, table_label_snapshot, subtotal_amount, total_amount, client_request_id)
           VALUES ($1, $2, $3, $4, 'O-attack', current_date, 99, 's', 't', 100, 100, 'req-attack-1')`,
          [b.tenantId, b.storeId, b.tableId, customerA],
        ),
      );
      expect(msg).toMatch(/row-level security/);
    });
  });

  it('직원은 업체 승인 상태를 스스로 바꿀 수 없다 (컬럼 권한)', async () => {
    await asActor(db.owner, staffA(), async (q) => {
      const msg = await expectDbError(q, () => q.query(`UPDATE tenants SET status = 'active' WHERE id = $1`, [a.tenantId]));
      expect(msg).toMatch(/permission denied/);
      expect((await q.query(`UPDATE tenants SET name = '업체A-수정' WHERE id = $1`, [a.tenantId])).rowCount).toBe(1);
    });
  });

  it('qr_app 은 결제 웹훅 원문·세션·멱등성 키 테이블에 접근할 수 없다', async () => {
    for (const table of ['payment_events', 'auth_sessions', 'idempotency_keys']) {
      await asActor(db.owner, staffA(), async (q) => {
        const msg = await expectDbError(q, () => q.query(`SELECT * FROM ${table}`));
        expect(msg).toMatch(/permission denied/);
      });
    }
  });

  it('다른 업체 매장으로 주문 번호 발급 함수를 호출할 수 없다', async () => {
    await asActor(db.owner, { role: 'qr_app', actor: 'customer', tenantId: a.tenantId, userId: customerA }, async (q) => {
      const msg = await expectDbError(q, () => q.query(`SELECT app.next_display_no($1, current_date)`, [b.storeId]));
      expect(msg).toMatch(/STORE_NOT_IN_TENANT/);
    });
  });
});
