import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness.js';
import { createPlatformAdmin, customerAt, kimchiItem, type MerchantSetup, setupMerchant } from './scenario.js';

// 결제 확정 공통 로직 검증. 가짜 PG(테스트 전용)를 사용하며 실제 PG 연동 테스트는 3단계에서 PG 테스트 키로 수행한다.
describe('결제 요청·확정 공통 로직 (가짜 PG, API)', () => {
  let h: Harness;
  let m: MerchantSetup;

  beforeAll(async () => {
    h = await createHarness();
    m = await setupMerchant(h, await createPlatformAdmin(h));
  });
  afterAll(async () => h.close());

  const newOrder = async (c: Awaited<ReturnType<typeof customerAt>>, key: string) =>
    (await c.post('/api/orders').send({ items: [kimchiItem(m, 1)], clientRequestId: key, expectedTotal: 9500 }).expect(201)).body.id as string;

  it('브라우저 복귀만으로는 주문이 확정되지 않는다: PG 승인 전 confirm 은 pending', async () => {
    const c = await customerAt(h, m.qrToken);
    const orderId = await newOrder(c, 'req-pay-pending-1');
    const pay = await c.post('/api/payments').send({ orderId }).expect(201);
    expect(pay.body).toMatchObject({ amount: 9500, provider: 'fake', environment: 'test' });
    const r = await c.post(`/api/payments/${pay.body.paymentId}/confirm`).expect(200);
    expect(r.body).toMatchObject({ paymentStatus: 'pending', orderStatus: 'pending_payment' });
  });

  it('PG 승인 후 확정하면 결제 완료 + 주문 접수 대기(placed), 여러 번 호출해도 같다', async () => {
    const c = await customerAt(h, m.qrToken);
    const orderId = await newOrder(c, 'req-pay-ok-1');
    const pay = await c.post('/api/payments').send({ orderId }).expect(201);
    // 중복 클릭: 같은 결제 요청을 재사용
    const again = await c.post('/api/payments').send({ orderId }).expect(201);
    expect(again.body.paymentId).toBe(pay.body.paymentId);
    h.payments.simulate(pay.body.paymentRequestId, 'approve');
    const results = await Promise.all([1, 2, 3].map(() => c.post(`/api/payments/${pay.body.paymentId}/confirm`)));
    for (const r of results) expect(r.body).toMatchObject({ paymentStatus: 'paid', orderStatus: 'placed' });
    const history = await h.db.owner.query(`SELECT to_status FROM order_status_history WHERE order_id = $1 ORDER BY id`, [orderId]);
    expect(history.rows.map((r) => r.to_status)).toEqual(['pending_payment', 'placed']);
    await c.post('/api/payments').send({ orderId }).expect(409);
  });

  it('PG 승인 금액이 주문 금액과 다르면 결제 실패로 기록하고 주문을 확정하지 않는다', async () => {
    const c = await customerAt(h, m.qrToken);
    const orderId = await newOrder(c, 'req-pay-mismatch-1');
    const pay = await c.post('/api/payments').send({ orderId }).expect(201);
    h.payments.simulate(pay.body.paymentRequestId, 'approve', 100);
    const r = await c.post(`/api/payments/${pay.body.paymentId}/confirm`).expect(200);
    expect(r.body).toMatchObject({ paymentStatus: 'failed', orderStatus: 'pending_payment' });
    const p = await h.db.owner.query(`SELECT failure_code FROM payments WHERE id = $1`, [pay.body.paymentId]);
    expect(p.rows[0].failure_code).toBe('AMOUNT_MISMATCH');
  });

  it('결제 실패 후 다시 결제할 수 있다', async () => {
    const c = await customerAt(h, m.qrToken);
    const orderId = await newOrder(c, 'req-pay-retry-1');
    const p1 = await c.post('/api/payments').send({ orderId }).expect(201);
    h.payments.simulate(p1.body.paymentRequestId, 'fail');
    expect((await c.post(`/api/payments/${p1.body.paymentId}/confirm`)).body.paymentStatus).toBe('failed');
    const p2 = await c.post('/api/payments').send({ orderId }).expect(201);
    expect(p2.body.paymentId).not.toBe(p1.body.paymentId);
    h.payments.simulate(p2.body.paymentRequestId, 'approve');
    expect((await c.post(`/api/payments/${p2.body.paymentId}/confirm`)).body.orderStatus).toBe('placed');
  });

  it('다른 고객의 결제는 확정 요청할 수 없다', async () => {
    const c = await customerAt(h, m.qrToken);
    const other = await customerAt(h, m.qrToken);
    const orderId = await newOrder(c, 'req-pay-other-1');
    const pay = await c.post('/api/payments').send({ orderId }).expect(201);
    await other.post(`/api/payments/${pay.body.paymentId}/confirm`).expect(404);
    await other.post('/api/payments').send({ orderId }).expect(404);
  });

  it('자동 접수를 켠 업체는 결제 확인과 동시에 접수 상태가 된다', async () => {
    await m.staff.patch('/api/merchant/settings').send({ autoAcceptOrders: true }).expect(200);
    const c = await customerAt(h, m.qrToken);
    const orderId = await newOrder(c, 'req-pay-auto-1');
    const pay = await c.post('/api/payments').send({ orderId }).expect(201);
    h.payments.simulate(pay.body.paymentRequestId, 'approve');
    expect((await c.post(`/api/payments/${pay.body.paymentId}/confirm`)).body.orderStatus).toBe('accepted');
    await m.staff.patch('/api/merchant/settings').send({ autoAcceptOrders: false }).expect(200);
  });
});

describe('결제 미설정 상태', () => {
  let h: Harness;
  let m: MerchantSetup;
  beforeAll(async () => {
    h = await createHarness({ paymentProvider: 'none' });
    m = await setupMerchant(h, await createPlatformAdmin(h));
  });
  afterAll(async () => h.close());

  it('PG 가 설정되지 않으면 결제 요청은 503 PAYMENT_NOT_CONFIGURED (가짜 성공 없음)', async () => {
    const c = await customerAt(h, m.qrToken);
    const order = await c.post('/api/orders').send({ items: [kimchiItem(m, 1)], clientRequestId: 'req-nopg-0001', expectedTotal: 9500 }).expect(201);
    const res = await c.post('/api/payments').send({ orderId: order.body.id }).expect(503);
    expect(res.body.error.code).toBe('PAYMENT_NOT_CONFIGURED');
    const ready = await h.browser().get('/readyz').expect(200);
    expect(ready.body.integrations).toMatchObject({ payment: 'not_configured', kakaoLogin: 'configured', alimtalk: 'not_implemented' });
  });
});
