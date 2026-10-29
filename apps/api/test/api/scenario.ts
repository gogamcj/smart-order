import { expect } from 'vitest';
import type TestAgent from 'supertest/lib/agent.js';
import { ADMIN_ORIGIN, type Harness, MERCHANT_ORIGIN } from './harness.js';

let seq = 0;
const uniq = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;

export interface MerchantSetup {
  staff: TestAgent;
  tenantId: string;
  storeId: string;
  categoryId: string;
  menuId: string; // 김치찌개 9000 → 할인 8000, 옵션: 맵기(필수 1) 순한맛 0 / 매운맛 500, 추가(0~2) 공기밥 1000 / 계란 1500
  options: { mild: string; hot: string; rice: string; egg: string };
  tableId: string;
  qrToken: string;
  email: string;
}

export async function createPlatformAdmin(h: Harness): Promise<TestAgent> {
  const admin = h.browser(ADMIN_ORIGIN);
  const email = `admin-${uniq()}@example.test`;
  await admin.post('/api/auth/staff/signup').send({ email, password: 'admin-password-1', displayName: '관리자' }).expect(201);
  await h.db.owner.query(`UPDATE users SET platform_role = 'super_admin' WHERE email = $1`, [email]);
  return admin;
}

export async function staffSignup(h: Harness, name = '사장님') {
  const staff = h.browser(MERCHANT_ORIGIN);
  const email = `staff-${uniq()}@example.test`;
  await staff.post('/api/auth/staff/signup').send({ email, password: 'staff-password-1', displayName: name }).expect(201);
  return { staff, email };
}

/** 가입 신청 → 최고 관리자 승인 → 업체 선택 → 메뉴·테이블 준비까지 API 로 수행 */
export async function setupMerchant(h: Harness, admin: TestAgent, opts: { approve?: boolean } = {}): Promise<MerchantSetup> {
  const { staff, email } = await staffSignup(h);
  const slug = `shop-${uniq()}`;
  const applied = await staff
    .post('/api/tenants/apply')
    .send({ name: `가게 ${slug}`, slug, businessRegistrationNo: '1234567890', representativeName: '홍길동', contactPhone: '010-1234-5678', contactEmail: email, storeName: '본점' })
    .expect(201);
  const { tenantId, storeId } = applied.body;
  if (opts.approve !== false) await admin.post(`/api/admin/tenants/${tenantId}/approve`).send({}).expect(200);
  await staff.post('/api/auth/staff/select-tenant').send({ tenantId }).expect(200);

  const cat = await staff.post('/api/merchant/categories').send({ storeId, name: '찌개' }).expect(201);
  const menu = await staff.post('/api/merchant/menus').send({ storeId, categoryId: cat.body.id, name: '김치찌개', price: 9000, salePrice: 8000 }).expect(201);
  await staff
    .put(`/api/merchant/menus/${menu.body.id}/option-groups`)
    .send({
      groups: [
        { name: '맵기', minSelect: 1, maxSelect: 1, options: [{ name: '순한맛', extraPrice: 0 }, { name: '매운맛', extraPrice: 500 }] },
        { name: '추가', minSelect: 0, maxSelect: 2, options: [{ name: '공기밥', extraPrice: 1000 }, { name: '계란', extraPrice: 1500 }] },
      ],
    })
    .expect(200);
  const menus = await staff.get(`/api/merchant/menus?storeId=${storeId}`).expect(200);
  const groups = menus.body[0].optionGroups;
  const table = await staff.post('/api/merchant/tables').send({ storeId, label: '1' }).expect(201);
  const tables = await staff.get(`/api/merchant/tables?storeId=${storeId}`).expect(200);
  const qrCodeId = tables.body.find((t: { id: string }) => t.id === table.body.id).qrCodeId;
  const qr = await staff.get(`/api/merchant/qr-codes/${qrCodeId}`).expect(200);
  const qrToken = decodeURIComponent(String(qr.body.url).split('/q/')[1] ?? '');
  expect(qrToken.length).toBeGreaterThanOrEqual(43);
  return {
    staff,
    tenantId,
    storeId,
    categoryId: cat.body.id,
    menuId: menu.body.id,
    options: { mild: groups[0].options[0].id, hot: groups[0].options[1].id, rice: groups[1].options[0].id, egg: groups[1].options[1].id },
    tableId: table.body.id,
    qrToken,
    email,
  };
}

/** 고객: QR 스캔 → 카카오 로그인(가짜) → 필수 약관 동의 */
export async function customerAt(h: Harness, qrToken: string, kakaoId = uniq()): Promise<TestAgent> {
  const c = h.browser();
  await c.get(`/api/qr/${qrToken}`).expect(200);
  const start = await c.get(`/api/auth/kakao/start?returnTo=/q/${qrToken}`).expect(302);
  const state = new URL(start.headers.location!).searchParams.get('state');
  const cb = await c.get(`/api/auth/kakao/callback?code=ok:${kakaoId}:손님&state=${state}`).expect(302);
  expect(cb.headers.location).toBe(`http://order.test/q/${qrToken}`);
  const terms = await c.get('/api/auth/terms').expect(200);
  await c.post('/api/auth/consents').send({ termsIds: terms.body.filter((t: { required: boolean }) => t.required).map((t: { id: string }) => t.id) }).expect(200);
  return c;
}

export const kimchiItem = (m: MerchantSetup, quantity = 2) => ({ menuId: m.menuId, quantity, optionIds: [m.options.hot, m.options.rice] });

/** 주문 생성 + 가짜 PG 승인 + 결제 확정 → placed */
export async function placeOrder(h: Harness, c: TestAgent, m: MerchantSetup, quantity = 1) {
  const items = [kimchiItem(m, quantity)];
  const quote = await c.post('/api/orders/quote').send({ items }).expect(201);
  const order = await c.post('/api/orders').send({ items, clientRequestId: `req-${uniq()}`, expectedTotal: quote.body.total }).expect(201);
  const pay = await c.post('/api/payments').send({ orderId: order.body.id }).expect(201);
  h.payments.simulate(pay.body.paymentRequestId, 'approve');
  const confirmed = await c.post(`/api/payments/${pay.body.paymentId}/confirm`).expect(200);
  expect(confirmed.body.orderStatus).toBe('placed');
  return { orderId: order.body.id as string, paymentId: pay.body.paymentId as string, total: quote.body.total as number };
}
