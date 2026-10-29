import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asActor, createTestDb, expectDbError, type TestDb } from './helpers/db.js';
import { createPendingOrder, payAndPlace, seedCustomer, seedTenant, type SeededTenant } from './helpers/seed.js';

describe('주문 상태 전이와 이력 (DB 규칙)', () => {
  let db: TestDb;
  let t: SeededTenant;
  let customer: string;

  beforeAll(async () => {
    db = await createTestDb();
    t = await seedTenant(db.owner);
    customer = await seedCustomer(db.owner);
  });
  afterAll(async () => db.drop());

  const staff = () => ({ role: 'qr_app' as const, actor: 'staff' as const, tenantId: t.tenantId, userId: t.adminUserId });

  it('결제 확인 없이 주문을 확정(placed)할 수 없다', async () => {
    const o = await createPendingOrder(db.owner, t, customer);
    await asActor(db.owner, { role: 'qr_system', tenantId: t.tenantId }, async (q) => {
      const msg = await expectDbError(q, () => q.query(`UPDATE orders SET status = 'placed' WHERE id = $1`, [o.orderId]));
      expect(msg).toMatch(/ORDER_NOT_PAID/);
    });
  });

  it('[18-11] 허용된 전이만 가능하다: placed → accepted → preparing → ready → completed', async () => {
    const o = await createPendingOrder(db.owner, t, customer);
    await payAndPlace(db.owner, t, o);
    await asActor(db.owner, staff(), async (q) => {
      const bad = await expectDbError(q, () => q.query(`UPDATE orders SET status = 'ready' WHERE id = $1`, [o.orderId]));
      expect(bad).toMatch(/INVALID_ORDER_TRANSITION placed->ready/);
      for (const s of ['accepted', 'preparing', 'ready', 'completed']) {
        expect((await q.query(`UPDATE orders SET status = $2 WHERE id = $1`, [o.orderId, s])).rowCount).toBe(1);
      }
      const final = await expectDbError(q, () => q.query(`UPDATE orders SET status = 'cancelled' WHERE id = $1`, [o.orderId]));
      expect(final).toMatch(/INVALID_ORDER_TRANSITION completed->cancelled/);
    }, { commit: true });
  });

  it('[18-12] 상태 변경마다 이력(처리자·변경 전후)과 실시간 이벤트가 같은 트랜잭션에 기록된다', async () => {
    const o = await createPendingOrder(db.owner, t, customer);
    await payAndPlace(db.owner, t, o);
    await asActor(db.owner, staff(), async (q) => {
      await q.query(`SELECT set_config('app.status_reason', '재료 소진', true)`);
      await q.query(`UPDATE orders SET status = 'rejected' WHERE id = $1`, [o.orderId]);
    }, { commit: true });
    const hist = (await db.owner.query(
      `SELECT from_status, to_status, actor_kind, actor_user_id, reason FROM order_status_history WHERE order_id = $1 ORDER BY id`,
      [o.orderId],
    )).rows;
    expect(hist.map((h) => `${h.from_status ?? '-'}>${h.to_status}`)).toEqual(['->pending_payment', 'pending_payment>placed', 'placed>rejected']);
    expect(hist[2]).toMatchObject({ actor_kind: 'staff', actor_user_id: t.adminUserId, reason: '재료 소진' });
    const events = (await db.owner.query(`SELECT payload->>'to' AS to FROM outbox_events WHERE order_id = $1 ORDER BY id`, [o.orderId])).rows;
    expect(events.map((e) => e.to)).toEqual(['pending_payment', 'placed', 'rejected']);
  });

  it('동시에 두 직원이 같은 버전으로 처리하면 한 명만 성공한다 (낙관적 잠금)', async () => {
    const o = await createPendingOrder(db.owner, t, customer);
    await payAndPlace(db.owner, t, o);
    const { version } = (await db.owner.query(`SELECT version FROM orders WHERE id = $1`, [o.orderId])).rows[0];
    const results = [];
    for (const target of ['accepted', 'rejected']) {
      results.push(await asActor(db.owner, staff(), async (q) =>
        (await q.query(`UPDATE orders SET status = $3 WHERE id = $1 AND version = $2`, [o.orderId, version, target])).rowCount,
      { commit: true }));
    }
    expect(results).toEqual([1, 0]);
  });

  it('주문 생성 후 금액·업체·테이블은 바꿀 수 없다', async () => {
    const o = await createPendingOrder(db.owner, t, customer);
    await asActor(db.owner, { role: 'qr_system' }, async (q) => {
      const msg = await expectDbError(q, () => q.query(`UPDATE orders SET total_amount = 100, subtotal_amount = 100 WHERE id = $1`, [o.orderId]));
      expect(msg).toMatch(/ORDER_IMMUTABLE_FIELDS/);
    });
  });

  it('[18-10 일부] 같은 고객의 같은 client_request_id 주문은 한 번만 생성된다', async () => {
    await asActor(db.owner, { role: 'qr_app', actor: 'customer', tenantId: t.tenantId, userId: customer }, async (q) => {
      const insert = async (displayNo: number, orderNo: string) =>
        q.query(
          `INSERT INTO orders (tenant_id, store_id, table_id, user_id, order_no, business_date, display_no,
             store_name_snapshot, table_label_snapshot, subtotal_amount, total_amount, client_request_id)
           VALUES ($1, $2, $3, $4, $5, current_date, $6, 's', 't', 1000, 1000, 'same-request-key')`,
          [t.tenantId, t.storeId, t.tableId, customer, orderNo, displayNo],
        );
      await insert(901, 'O-dup-1');
      const msg = await expectDbError(q, () => insert(902, 'O-dup-2'));
      expect(msg).toMatch(/orders_user_id_client_request_id_key/);
    });
  });

  it('주문 상품 금액은 (단가 + 옵션) × 수량과 일치해야 한다', async () => {
    const o = await createPendingOrder(db.owner, t, customer);
    await asActor(db.owner, { role: 'qr_app', actor: 'customer', tenantId: t.tenantId, userId: customer }, async (q) => {
      const msg = await expectDbError(q, () =>
        q.query(
          `INSERT INTO order_items (tenant_id, order_id, menu_name_snapshot, list_price_snapshot, unit_price, options_total, quantity, line_total)
           VALUES ($1, $2, 'x', 1000, 1000, 0, 2, 1000)`,
          [t.tenantId, o.orderId],
        ),
      );
      expect(msg).toMatch(/order_items_check/);
    });
  });

  it('메뉴 가격이 바뀌어도 기존 주문 스냅샷은 그대로다', async () => {
    const o = await createPendingOrder(db.owner, t, customer);
    await db.owner.query(`UPDATE menus SET name = '부대찌개', price = 12000, sale_price = NULL WHERE id = $1`, [t.menuId]);
    const item = (await db.owner.query(`SELECT menu_name_snapshot, unit_price FROM order_items WHERE order_id = $1`, [o.orderId])).rows[0];
    expect(item).toEqual({ menu_name_snapshot: '김치찌개', unit_price: 8000 });
    await db.owner.query(`UPDATE menus SET name = '김치찌개', price = 9000, sale_price = 8000 WHERE id = $1`, [t.menuId]);
  });

  it('승인 대기·정지된 업체와 주문 접수를 멈춘 업체는 주문을 받을 수 없다', async () => {
    for (const status of ['pending', 'suspended']) {
      const s = await seedTenant(db.owner, { status });
      const c = await seedCustomer(db.owner);
      await expect(createPendingOrder(db.owner, s, c)).rejects.toThrow(/TENANT_NOT_ACCEPTING_ORDERS/);
    }
    const paused = await seedTenant(db.owner);
    await db.owner.query(`UPDATE tenant_settings SET accepting_orders = false WHERE tenant_id = $1`, [paused.tenantId]);
    await expect(createPendingOrder(db.owner, paused, customer)).rejects.toThrow(/TENANT_NOT_ACCEPTING_ORDERS/);
  });

  it('매장 화면 표시 번호는 영업일별로 1부터 증가한다', async () => {
    const s = await seedTenant(db.owner);
    const nums = await asActor(db.owner, { role: 'qr_app', actor: 'customer', tenantId: s.tenantId, userId: customer }, async (q) => {
      const out = [];
      for (let i = 0; i < 3; i++) out.push((await q.query(`SELECT app.next_display_no($1, '2026-10-29') AS n`, [s.storeId])).rows[0].n);
      out.push((await q.query(`SELECT app.next_display_no($1, '2026-10-30') AS n`, [s.storeId])).rows[0].n);
      return out;
    });
    expect(nums).toEqual([1, 2, 3, 1]);
  });

  it('할인가는 정가보다 낮아야 한다', async () => {
    await db.owner.query('BEGIN');
    const msg = await expectDbError(db.owner, () => db.owner.query(`UPDATE menus SET sale_price = 9000 WHERE id = $1`, [t.menuId]));
    await db.owner.query('ROLLBACK');
    expect(msg).toMatch(/menus_check/);
  });
});
