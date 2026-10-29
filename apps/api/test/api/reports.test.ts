import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type TestAgent from 'supertest/lib/agent.js';
import { createHarness, type Harness } from './harness.js';
import { createPlatformAdmin, customerAt, kimchiItem, type MerchantSetup, placeOrder, setupMerchant } from './scenario.js';

describe('판매현황·상품 판매통계 (API)', () => {
  let h: Harness;
  let admin: TestAgent;
  let m: MerchantSetup;
  let date: string;
  let paid: { orderId: string; total: number }[];

  beforeAll(async () => {
    h = await createHarness();
    admin = await createPlatformAdmin(h);
    m = await setupMerchant(h, admin);
    const c = await customerAt(h, m.qrToken);
    paid = [await placeOrder(h, c, m, 1), await placeOrder(h, c, m, 2)];
    // 결제 안 된 주문은 매출에 넣지 않는다
    await c.post('/api/orders').send({ items: [kimchiItem(m, 1)], clientRequestId: 'req-report-unpaid', expectedTotal: 9500 }).expect(201);
    const r = await h.db.owner.query(`SELECT business_date::text AS d FROM orders WHERE id = $1`, [paid[0]!.orderId]);
    date = r.rows[0].d;
  });
  afterAll(async () => h.close());

  it('결제 승인된 주문만 매출로 집계하고, 환불은 따로 뺀다', async () => {
    // 두 번째 주문 취소 → 환불 요청 → 환불 완료(PG 연동 전이라 DB 로 완료 처리)
    const o = await m.staff.get(`/api/merchant/orders/${paid[1]!.orderId}`).expect(200);
    await m.staff.patch(`/api/merchant/orders/${paid[1]!.orderId}/status`).send({ to: 'cancelled', expectedVersion: o.body.version, reason: '재료 소진' }).expect(200);
    await h.db.owner.query(`UPDATE refunds SET status = 'succeeded' WHERE payment_id = (SELECT id FROM payments WHERE order_id = $1)`, [paid[1]!.orderId]);

    const res = await m.staff.get(`/api/merchant/reports/sales?from=${date}&to=${date}`).expect(200);
    const sales = paid[0]!.total + paid[1]!.total;
    expect(res.body.summary).toEqual({ orderCount: 2, refundCount: 1, salesAmount: sales, refundAmount: paid[1]!.total, netAmount: paid[0]!.total });
    expect(res.body.daily).toEqual([{ date, orderCount: 2, refundCount: 1, salesAmount: sales, refundAmount: paid[1]!.total }]);
    expect(res.body.orders).toHaveLength(2);
    expect(res.body.orders[0].items[0]).toMatchObject({ name: '김치찌개', options: '공기밥, 매운맛' });
  });

  it('상품·옵션별 판매 순위와 비중을 돌려준다', async () => {
    const res = await m.staff.get(`/api/merchant/reports/products?from=${date}&to=${date}`).expect(200);
    expect(res.body.totals).toEqual({ quantity: 3, amount: paid[0]!.total + paid[1]!.total, kinds: 1 });
    expect(res.body.ranking).toEqual([{ name: '김치찌개', options: '공기밥, 매운맛', quantity: 3, amount: paid[0]!.total + paid[1]!.total, share: 100 }]);
    expect(res.body.trend).toEqual([{ period: date, quantity: 3, amount: paid[0]!.total + paid[1]!.total }]);
    const monthly = await m.staff.get(`/api/merchant/reports/products?from=${date}&to=${date}&unit=month`).expect(200);
    expect(monthly.body.trend[0].period).toBe(date.slice(0, 7));
  });

  it('다른 업체의 매출은 보이지 않는다', async () => {
    const other = await setupMerchant(h, admin);
    const res = await other.staff.get(`/api/merchant/reports/sales?from=${date}&to=${date}`).expect(200);
    expect(res.body.summary.orderCount).toBe(0);
    expect(res.body.orders).toEqual([]);
  });

  it('기간이 잘못되면 거부한다', async () => {
    await m.staff.get(`/api/merchant/reports/sales?from=2026-10-02&to=2026-10-01`).expect(422);
    await m.staff.get(`/api/merchant/reports/sales?from=2025-01-01&to=2026-10-01`).expect(422);
    await m.staff.get(`/api/merchant/reports/sales?from=2026-10-01`).expect(422);
  });
});
