import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness.js';
import { createPlatformAdmin, customerAt, kimchiItem, type MerchantSetup, placeOrder, setupMerchant } from './scenario.js';

describe('고객 주문과 업체 주문 처리 (API)', () => {
  let h: Harness;
  let m: MerchantSetup;

  beforeAll(async () => {
    h = await createHarness();
    m = await setupMerchant(h, await createPlatformAdmin(h));
  });
  afterAll(async () => h.close());

  it('[18-7] 할인가·옵션 추가금·수량으로 서버가 금액을 계산한다', async () => {
    const c = await customerAt(h, m.qrToken);
    // (할인가 8000 + 매운맛 500 + 공기밥 1000 + 계란 1500) × 2 = 22000
    const q = await c.post('/api/orders/quote').send({ items: [{ menuId: m.menuId, quantity: 2, optionIds: [m.options.hot, m.options.rice, m.options.egg] }] }).expect(201);
    expect(q.body).toMatchObject({ subtotal: 22000, discount: 0, total: 22000 });
    expect(q.body.lines[0]).toMatchObject({ listPrice: 9000, unitPrice: 8000, optionsTotal: 3000, quantity: 2, lineTotal: 22000 });
  });

  it('[18-7] 옵션 규칙 위반(필수 미선택, 최대 초과, 다른 메뉴 옵션, 중복)은 거부된다', async () => {
    const c = await customerAt(h, m.qrToken);
    const cases = [
      { optionIds: [] }, // 맵기 필수
      { optionIds: [m.options.mild, m.options.hot] }, // 맵기 최대 1
      { optionIds: [m.options.mild, m.options.rice, m.options.rice] }, // 중복
      { optionIds: [m.options.mild, '00000000-0000-4000-8000-000000000000'] },
    ];
    for (const x of cases) {
      const res = await c.post('/api/orders/quote').send({ items: [{ menuId: m.menuId, quantity: 1, ...x }] }).expect(409);
      expect(res.body.error.code).toBe('CART_INVALID');
    }
  });

  it('[18-8] 품절 메뉴·품절 옵션은 견적과 주문 모두 차단된다', async () => {
    const c = await customerAt(h, m.qrToken);
    await m.staff.patch(`/api/merchant/menus/${m.menuId}/status`).send({ status: 'sold_out' }).expect(200);
    const res = await c.post('/api/orders').send({ items: [kimchiItem(m)], clientRequestId: 'req-soldout-0001', expectedTotal: 19000 }).expect(409);
    expect(res.body.error.details[0].code).toBe('MENU_SOLD_OUT');
    const menus = await c.get('/api/menus').expect(200);
    expect(menus.body.menus[0].soldOut).toBe(true);
    await m.staff.patch(`/api/merchant/menus/${m.menuId}/status`).send({ status: 'on_sale' }).expect(200);
  });

  it('[18-9] 견적 후 가격이 바뀌면 주문 시 PRICE_CHANGED 와 새 견적을 돌려준다', async () => {
    const c = await customerAt(h, m.qrToken);
    const items = [kimchiItem(m, 1)];
    const q = await c.post('/api/orders/quote').send({ items }).expect(201);
    expect(q.body.total).toBe(9500);
    await m.staff.patch(`/api/merchant/menus/${m.menuId}`).send({ salePrice: 8500 }).expect(200);
    const res = await c.post('/api/orders').send({ items, clientRequestId: 'req-price-0001', expectedTotal: q.body.total }).expect(409);
    expect(res.body.error.code).toBe('PRICE_CHANGED');
    expect(res.body.error.details.quote.total).toBe(10000);
    await m.staff.patch(`/api/merchant/menus/${m.menuId}`).send({ salePrice: 8000 }).expect(200);
  });

  it('[18-9] 브라우저가 보낸 가격 필드는 무시된다', async () => {
    const c = await customerAt(h, m.qrToken);
    const items = [{ ...kimchiItem(m, 1), price: 1, unitPrice: 1 }];
    const res = await c.post('/api/orders').send({ items, clientRequestId: 'req-tamper-0001', expectedTotal: 9500 }).expect(201);
    expect(res.body.totalAmount).toBe(9500);
  });

  it('[18-10] 같은 clientRequestId 로 다시 보내면 주문이 하나만 생긴다', async () => {
    const c = await customerAt(h, m.qrToken);
    const body = { items: [kimchiItem(m, 1)], clientRequestId: 'req-dup-000001', expectedTotal: 9500 };
    const [r1, r2] = await Promise.all([c.post('/api/orders').send(body), c.post('/api/orders').send(body)]);
    const ok = [r1, r2].filter((r) => r.status === 201);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    const ids = new Set(ok.map((r) => r.body.id));
    expect(ids.size).toBe(1);
    const r3 = await c.post('/api/orders').send(body).expect(201);
    expect(r3.body.duplicate).toBe(true);
    expect(ids.has(r3.body.id)).toBe(true);
    const count = await h.db.owner.query(`SELECT count(*)::int AS n FROM orders WHERE client_request_id = 'req-dup-000001'`);
    expect(count.rows[0].n).toBe(1);
  });

  it('결제 전 주문은 업체 화면에 보이지 않고, 결제 확인 후 신규 주문으로 보인다', async () => {
    const c = await customerAt(h, m.qrToken);
    const pending = await c.post('/api/orders').send({ items: [kimchiItem(m, 1)], clientRequestId: 'req-hidden-0001', expectedTotal: 9500 }).expect(201);
    expect(pending.body.status).toBe('pending_payment');
    let board = await m.staff.get('/api/merchant/orders').expect(200);
    expect(board.body.some((o: { id: string }) => o.id === pending.body.id)).toBe(false);
    const placed = await placeOrder(h, c, m);
    board = await m.staff.get('/api/merchant/orders?status=placed').expect(200);
    const row = board.body.find((o: { id: string }) => o.id === placed.orderId);
    expect(row).toMatchObject({ status: 'placed', tableLabel: '1', totalAmount: 9500, payment: { status: 'paid' } });
    expect(row.items[0]).toMatchObject({ name: '김치찌개', quantity: 1, options: [{ name: '매운맛' }, { name: '공기밥' }] });
    const summary = await m.staff.get('/api/merchant/orders/summary').expect(200);
    expect(summary.body.placed).toBeGreaterThanOrEqual(1);
  });

  it('[18-11] 허용된 상태 전이만 가능하고, 고객 화면에 서버 상태가 반영된다', async () => {
    const c = await customerAt(h, m.qrToken);
    const { orderId } = await placeOrder(h, c, m);
    const step = async (to: string, version: number, status = 200) => m.staff.patch(`/api/merchant/orders/${orderId}/status`).send({ to, expectedVersion: version }).expect(status);
    const bad = await step('ready', 2, 409);
    expect(bad.body.error.code).toBe('INVALID_ORDER_TRANSITION');
    await step('accepted', 2);
    await step('preparing', 3);
    await step('ready', 4);
    expect((await c.get(`/api/orders/${orderId}`).expect(200)).body).toMatchObject({ status: 'ready' });
    await step('completed', 5);
    const after = await step('accepted', 6, 409);
    expect(after.body.error.code).toBe('INVALID_ORDER_TRANSITION');
  });

  it('[18-11] 두 직원이 같은 버전으로 동시에 처리하면 한 명은 VERSION_CONFLICT', async () => {
    const c = await customerAt(h, m.qrToken);
    const { orderId } = await placeOrder(h, c, m);
    const [r1, r2] = await Promise.all([
      m.staff.patch(`/api/merchant/orders/${orderId}/status`).send({ to: 'accepted', expectedVersion: 2 }),
      m.staff.patch(`/api/merchant/orders/${orderId}/status`).send({ to: 'rejected', expectedVersion: 2, reason: '재료 소진' }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    const loser = r1.status === 409 ? r1 : r2;
    expect(loser.body.error.code).toBe('VERSION_CONFLICT');
    expect(loser.body.error.details.version).toBe(3);
  });

  it('[18-12] 상태 변경 이력에 처리 직원·변경 전후·사유가 남는다', async () => {
    const c = await customerAt(h, m.qrToken);
    const { orderId } = await placeOrder(h, c, m);
    await m.staff.patch(`/api/merchant/orders/${orderId}/status`).send({ to: 'rejected', expectedVersion: 2, reason: '재료 소진' }).expect(200);
    const detail = await m.staff.get(`/api/merchant/orders/${orderId}`).expect(200);
    expect(detail.body.history.map((x: { from: string | null; to: string }) => `${x.from ?? '-'}>${x.to}`)).toEqual(['->pending_payment', 'pending_payment>placed', 'placed>rejected']);
    expect(detail.body.history[2]).toMatchObject({ actorKind: 'staff', actorName: '사장님', reason: '재료 소진' });
  });

  it('결제된 주문을 거절하면 전액 환불 요청이 기록된다 (PG 환불 실행은 3단계)', async () => {
    const c = await customerAt(h, m.qrToken);
    const { orderId, total } = await placeOrder(h, c, m);
    const res = await m.staff.patch(`/api/merchant/orders/${orderId}/status`).send({ to: 'rejected', expectedVersion: 2, reason: '영업 종료' }).expect(200);
    expect(res.body.refundRequested).toBe(true);
    const mine = await c.get(`/api/orders/${orderId}`).expect(200);
    expect(mine.body.refunds).toEqual([expect.objectContaining({ amount: total, status: 'requested' })]);
  });

  it('주문 스냅샷: 메뉴 이름·가격을 바꿔도 지난 주문 내용은 그대로', async () => {
    const c = await customerAt(h, m.qrToken);
    const { orderId } = await placeOrder(h, c, m);
    await m.staff.patch(`/api/merchant/menus/${m.menuId}`).send({ name: '묵은지찌개', price: 12000, salePrice: null }).expect(200);
    const o = await c.get(`/api/orders/${orderId}`).expect(200);
    expect(o.body.items[0]).toMatchObject({ name: '김치찌개', unitPrice: 8000 });
    await m.staff.patch(`/api/merchant/menus/${m.menuId}`).send({ name: '김치찌개', price: 9000, salePrice: 8000 }).expect(200);
  });

  it('업체가 주문 접수를 멈추면 주문이 차단되고, 판매 시간 밖 메뉴는 주문할 수 없다', async () => {
    const c = await customerAt(h, m.qrToken);
    await m.staff.patch('/api/merchant/settings').send({ acceptingOrders: false }).expect(200);
    const stopped = await c.post('/api/orders').send({ items: [kimchiItem(m, 1)], clientRequestId: 'req-stopped-001', expectedTotal: 9500 }).expect(409);
    expect(stopped.body.error.code).toBe('TENANT_NOT_ACCEPTING_ORDERS');
    await m.staff.patch('/api/merchant/settings').send({ acceptingOrders: true }).expect(200);

    // 판매 시간을 '지금이 아닌' 시간대로 설정 (요일 전체 00:00~00:01)
    const windows = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, start: '00:00', end: '00:01' }));
    await m.staff.put(`/api/merchant/menus/${m.menuId}/availability`).send({ windows }).expect(200);
    const nowKst = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
    if (nowKst !== '00:00') {
      const res = await c.post('/api/orders/quote').send({ items: [kimchiItem(m, 1)] }).expect(409);
      expect(res.body.error.details[0].code).toBe('MENU_NOT_IN_HOURS');
    }
    await m.staff.put(`/api/merchant/menus/${m.menuId}/availability`).send({ windows: [] }).expect(200);
  });

  it('고객 주문 내역에는 본인 주문만 있다', async () => {
    const c1 = await customerAt(h, m.qrToken);
    const c2 = await customerAt(h, m.qrToken);
    const { orderId } = await placeOrder(h, c1, m);
    expect((await c1.get('/api/orders/me')).body.some((o: { id: string }) => o.id === orderId)).toBe(true);
    expect((await c2.get('/api/orders/me')).body.some((o: { id: string }) => o.id === orderId)).toBe(false);
  });
});
