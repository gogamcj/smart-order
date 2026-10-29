import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness, MERCHANT_ORIGIN } from './harness.js';
import { createPlatformAdmin, customerAt, type MerchantSetup, placeOrder, setupMerchant, staffSignup } from './scenario.js';

describe('업체 간 격리·권한·요청 보안 (API)', () => {
  let h: Harness;
  let a: MerchantSetup;
  let b: MerchantSetup;
  let orderB: string;

  beforeAll(async () => {
    h = await createHarness();
    const admin = await createPlatformAdmin(h);
    a = await setupMerchant(h, admin);
    b = await setupMerchant(h, admin);
    const cb = await customerAt(h, b.qrToken);
    orderB = (await placeOrder(h, cb, b)).orderId;
  });
  afterAll(async () => h.close());

  it('[18-4] 업체 A 직원은 업체 B 주문을 목록·상세 어디서도 볼 수 없다 (404)', async () => {
    const list = await a.staff.get('/api/merchant/orders').expect(200);
    expect(list.body.find((o: { id: string }) => o.id === orderB)).toBeUndefined();
    const res = await a.staff.get(`/api/merchant/orders/${orderB}`).expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    // B 는 자기 주문을 본다
    await b.staff.get(`/api/merchant/orders/${orderB}`).expect(200);
  });

  it('[18-4] 업체 A 직원은 업체 B 주문 상태를 바꿀 수 없다', async () => {
    const res = await a.staff.patch(`/api/merchant/orders/${orderB}/status`).send({ to: 'accepted', expectedVersion: 2 }).expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('[18-5] 업체 A 직원은 업체 B 메뉴를 수정·품절·삭제·복제할 수 없다', async () => {
    await a.staff.patch(`/api/merchant/menus/${b.menuId}`).send({ price: 1 }).expect(404);
    await a.staff.patch(`/api/merchant/menus/${b.menuId}/status`).send({ status: 'sold_out' }).expect(404);
    await a.staff.delete(`/api/merchant/menus/${b.menuId}`).expect(404);
    await a.staff.post(`/api/merchant/menus/${b.menuId}/duplicate`).expect(404);
    await a.staff.put(`/api/merchant/menus/${b.menuId}/option-groups`).send({ groups: [] }).expect(404);
    const menu = await h.db.owner.query(`SELECT price, status, deleted_at FROM menus WHERE id = $1`, [b.menuId]);
    expect(menu.rows[0]).toEqual({ price: 9000, status: 'on_sale', deleted_at: null });
  });

  it('[18-5] 본문에 업체 B 의 매장·카테고리 ID 를 넣어 메뉴를 만들 수 없다 (파라미터 변조)', async () => {
    const res = await a.staff.post('/api/merchant/menus').send({ storeId: b.storeId, categoryId: b.categoryId, name: '침투', price: 100 });
    expect([404, 422]).toContain(res.status);
    const count = await h.db.owner.query(`SELECT count(*)::int AS n FROM menus WHERE name = '침투'`);
    expect(count.rows[0].n).toBe(0);
  });

  it('업체 A 직원은 업체 B 의 테이블·QR·직원을 다룰 수 없다', async () => {
    await a.staff.delete(`/api/merchant/tables/${b.tableId}`).expect(404);
    await a.staff.post(`/api/merchant/tables/${b.tableId}/qr-codes`).expect(404);
    const members = await a.staff.get('/api/merchant/members').expect(200);
    expect(members.body.every((x: { email: string }) => x.email !== b.email)).toBe(true);
  });

  it('업체를 선택할 때 소속되지 않은 업체 ID 는 거부된다', async () => {
    const res = await a.staff.post('/api/auth/staff/select-tenant').send({ tenantId: b.tenantId }).expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    await a.staff.post('/api/auth/staff/select-tenant').send({ tenantId: a.tenantId }).expect(200);
  });

  it('[18-6] 직원 역할별 권한: 조회 전용·메뉴 관리·주문 처리 직원의 허용·거부', async () => {
    const roles = {} as Record<string, Awaited<ReturnType<typeof staffSignup>>>;
    for (const role of ['viewer', 'menu_staff', 'order_staff'] as const) {
      roles[role] = await staffSignup(h, role);
      await a.staff.post('/api/merchant/members').send({ email: roles[role].email, role }).expect(201);
      await roles[role].staff.post('/api/auth/staff/select-tenant').send({ tenantId: a.tenantId }).expect(200);
    }
    const ca = await customerAt(h, a.qrToken);
    const order = await placeOrder(h, ca, a);
    const viewer = roles.viewer!.staff;
    const menuStaff = roles.menu_staff!.staff;
    const orderStaff = roles.order_staff!.staff;

    // 조회 전용: 볼 수는 있지만 바꿀 수 없다
    await viewer.get('/api/merchant/orders').expect(200);
    await viewer.patch(`/api/merchant/orders/${order.orderId}/status`).send({ to: 'accepted', expectedVersion: 2 }).expect(403);
    await viewer.post('/api/merchant/menus').send({ storeId: a.storeId, categoryId: a.categoryId, name: 'x', price: 1 }).expect(403);
    await viewer.patch(`/api/merchant/menus/${a.menuId}/status`).send({ status: 'sold_out' }).expect(403);

    // 메뉴 관리: 메뉴는 되지만 주문 처리·직원 관리·테이블은 안 된다
    await menuStaff.patch(`/api/merchant/menus/${a.menuId}`).send({ description: '얼큰한 맛' }).expect(200);
    await menuStaff.patch(`/api/merchant/orders/${order.orderId}/status`).send({ to: 'accepted', expectedVersion: 2 }).expect(403);
    await menuStaff.get('/api/merchant/members').expect(403);
    await menuStaff.post('/api/merchant/tables').send({ storeId: a.storeId, label: '99' }).expect(403);

    // 주문 처리: 주문 상태·품절은 되지만 가격 수정은 안 되고, 환불 권한이 없으면 취소 불가
    await orderStaff.patch(`/api/merchant/menus/${a.menuId}`).send({ price: 1 }).expect(403);
    await orderStaff.patch(`/api/merchant/menus/${a.menuId}/status`).send({ status: 'on_sale' }).expect(200);
    await orderStaff.patch(`/api/merchant/orders/${order.orderId}/status`).send({ to: 'accepted', expectedVersion: 2 }).expect(200);
    const cancel = await orderStaff.patch(`/api/merchant/orders/${order.orderId}/status`).send({ to: 'cancelled', expectedVersion: 3, reason: '고객 요청' }).expect(403);
    expect(cancel.body.error.message).toContain('취소·환불 권한');

    // 비활성화된 직원은 즉시 막힌다
    const list = await a.staff.get('/api/merchant/members').expect(200);
    const target = list.body.find((x: { email: string }) => x.email === roles.order_staff!.email);
    await a.staff.delete(`/api/merchant/members/${target.id}`).expect(200);
    await orderStaff.get('/api/merchant/orders').expect(403);
  });

  it('마지막 업체 관리자는 권한을 잃을 수 없다', async () => {
    const list = await a.staff.get('/api/merchant/members').expect(200);
    const me = list.body.find((x: { role: string }) => x.role === 'tenant_admin');
    const res = await a.staff.patch(`/api/merchant/members/${me.id}`).send({ role: 'viewer' }).expect(409);
    expect(res.body.error.code).toBe('LAST_ADMIN');
  });

  it('[18-34] 로그인 없이·잘못된 계정 종류로 보호된 API 를 호출하면 401/403', async () => {
    const anon = h.browser(MERCHANT_ORIGIN);
    expect((await anon.get('/api/merchant/orders').expect(401)).body.error.code).toBe('UNAUTHENTICATED');
    await anon.get('/api/admin/tenants').expect(401);
    await anon.post('/api/orders').send({}).expect(401);

    const customer = await customerAt(h, a.qrToken);
    await customer.get('/api/merchant/orders').expect(403);
    await customer.get('/api/admin/tenants').expect(403);
    await a.staff.get('/api/admin/tenants').expect(403);
    await a.staff.post('/api/orders').send({}).expect(403);
  });

  it('[18-34] 다른 고객의 주문은 ID 를 알아도 볼 수 없다', async () => {
    const other = await customerAt(h, b.qrToken);
    await other.get(`/api/orders/${orderB}`).expect(404);
  });

  it('[18-34] CSRF: 사용자 정의 헤더가 없거나 허용되지 않은 Origin 의 변경 요청은 거부된다', async () => {
    const server = h.app.getHttpServer();
    const noHeader = await request(server).post('/api/auth/staff/login').set('Origin', MERCHANT_ORIGIN).send({ email: a.email, password: 'staff-password-1' }).expect(403);
    expect(noHeader.body.error.code).toBe('CSRF_REJECTED');
    const evil = await request(server).post('/api/auth/staff/login').set('Origin', 'https://evil.example').set('X-Requested-With', 'qr-order').send({ email: a.email, password: 'staff-password-1' }).expect(403);
    expect(evil.body.error.code).toBe('CSRF_REJECTED');
  });

  it('[18-34] 오류 응답에 내부 정보(SQL, 스택)가 없고 잘못된 입력은 422', async () => {
    const res = await a.staff.post('/api/merchant/menus').send({ storeId: 'not-a-uuid', price: -1 }).expect(422);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(res.body)).not.toMatch(/select|insert|stack|at \w+ \(/i);
    const bad = await a.staff.get('/api/merchant/orders/not-a-uuid').expect(422);
    expect(bad.body.error.requestId).toBeTruthy();
  });

  it('보안 헤더가 설정되고 X-Powered-By 는 노출되지 않는다', async () => {
    const res = await request(h.app.getHttpServer()).get('/healthz').expect(200);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeTruthy();
  });
});

describe('속도 제한 (운영 설정 그대로)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness({ throttle: true });
  });
  afterAll(async () => h.close());

  it('같은 IP 에서 로그인 시도를 반복하면 429 로 막힌다', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const r = await h.browser(MERCHANT_ORIGIN).post('/api/auth/staff/login').send({ email: 'nobody@example.test', password: 'wrong-password-123' });
      statuses.push(r.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
    const last = await h.browser(MERCHANT_ORIGIN).post('/api/auth/staff/login').send({ email: 'nobody@example.test', password: 'x' });
    expect(last.body.error.code).toBe('RATE_LIMITED');
  });
});
