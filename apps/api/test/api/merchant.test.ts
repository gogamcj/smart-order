import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness.js';
import { createPlatformAdmin, customerAt, kimchiItem, type MerchantSetup, setupMerchant, staffSignup } from './scenario.js';
import type TestAgent from 'supertest/lib/agent.js';

describe('업체 가입·승인·매장·QR·메뉴 관리 (API)', () => {
  let h: Harness;
  let admin: TestAgent;
  let m: MerchantSetup;

  beforeAll(async () => {
    h = await createHarness();
    admin = await createPlatformAdmin(h);
    m = await setupMerchant(h, admin);
  });
  afterAll(async () => h.close());

  it('업체 가입 신청은 승인 대기 상태이며, 승인 전에는 QR 로 주문할 수 없다', async () => {
    const pending = await setupMerchant(h, admin, { approve: false });
    const t = await pending.staff.get('/api/merchant/tenant').expect(200);
    expect(t.body).toMatchObject({ status: 'pending', myRole: 'tenant_admin', plan: { code: 'free', billingEnabled: false } });
    const qr = await h.browser().get(`/api/qr/${pending.qrToken}`).expect(404);
    expect(qr.body.error.code).toBe('QR_INVALID');

    const list = await admin.get('/api/admin/tenants?status=pending').expect(200);
    expect(list.body.some((x: { id: string }) => x.id === pending.tenantId)).toBe(true);
    await admin.post(`/api/admin/tenants/${pending.tenantId}/approve`).send({}).expect(200);
    await h.browser().get(`/api/qr/${pending.qrToken}`).expect(200);
  });

  it('정지된 업체는 조회만 가능하고 고객 주문이 막히며, 해제하면 다시 동작한다', async () => {
    const s = await setupMerchant(h, admin);
    const c = await customerAt(h, s.qrToken);
    const noReason = await admin.post(`/api/admin/tenants/${s.tenantId}/suspend`).send({}).expect(422);
    expect(noReason.body.error.code).toBe('VALIDATION_FAILED');
    await admin.post(`/api/admin/tenants/${s.tenantId}/suspend`).send({ reason: '약관 위반 조사' }).expect(200);

    await s.staff.get('/api/merchant/orders').expect(200);
    const write = await s.staff.post('/api/merchant/categories').send({ storeId: s.storeId, name: '정지 중' }).expect(403);
    expect(write.body.error.code).toBe('TENANT_SUSPENDED');
    const order = await c.post('/api/orders').send({ items: [kimchiItem(s, 1)], clientRequestId: 'req-suspended-01', expectedTotal: 9500 }).expect(403);
    expect(order.body.error.code).toBe('QR_INVALID');

    await admin.post(`/api/admin/tenants/${s.tenantId}/resume`).send({}).expect(200);
    await s.staff.post('/api/merchant/categories').send({ storeId: s.storeId, name: '재개' }).expect(201);
    const logs = await admin.get(`/api/admin/audit-logs?tenantId=${s.tenantId}`).expect(200);
    expect(logs.body.map((l: { action: string }) => l.action)).toEqual(expect.arrayContaining(['tenant.apply', 'tenant.approve', 'tenant.suspend', 'tenant.resume']));
  });

  it('잘못된 상태 전이(승인된 업체를 다시 거절 등)는 거부된다', async () => {
    const res = await admin.post(`/api/admin/tenants/${m.tenantId}/reject`).send({ reason: 'x' }).expect(409);
    expect(res.body.error.code).toBe('INVALID_TENANT_TRANSITION');
  });

  it('QR 재발급 시 이전 QR 과 그 QR 로 들어온 주문 화면이 즉시 막힌다', async () => {
    const t = await setupMerchant(h, admin);
    const c = await customerAt(h, t.qrToken);
    await c.get('/api/menus').expect(200);
    await t.staff.post(`/api/merchant/tables/${t.tableId}/qr-codes`).expect(201);
    await h.browser().get(`/api/qr/${t.qrToken}`).expect(404);
    const res = await c.get('/api/menus').expect(403);
    expect(res.body.error.code).toBe('QR_INVALID');
  });

  it('테이블 비활성화·삭제, 일괄 생성, QR 이미지·인쇄 PDF', async () => {
    const bulk = await m.staff.post('/api/merchant/tables/bulk').send({ storeId: m.storeId, from: 1, to: 5 }).expect(201);
    expect(bulk.body.created).toBe(4); // 1번은 이미 있음
    const tables = await m.staff.get(`/api/merchant/tables?storeId=${m.storeId}`).expect(200);
    expect(tables.body.map((x: { label: string }) => x.label)).toEqual(['1', '2', '3', '4', '5']);
    expect(tables.body.every((x: { qrCodeId: string | null }) => x.qrCodeId)).toBe(true);

    const png = await m.staff.get(`/api/merchant/qr-codes/${tables.body[1].qrCodeId}/image.png`).buffer(true).expect(200);
    expect(png.headers['content-type']).toBe('image/png');
    expect((await sharp(png.body).metadata()).width).toBe(600);

    const pdf = await m.staff.post('/api/merchant/qr-codes/print').send({ tableIds: tables.body.map((x: { id: string }) => x.id) }).buffer(true).expect(201);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');

    await m.staff.patch(`/api/merchant/tables/${tables.body[4].id}`).send({ isActive: false }).expect(200);
    const qr5 = await h.db.owner.query(`SELECT token FROM qr_codes WHERE table_id = $1 AND status = 'active'`, [tables.body[4].id]);
    await h.browser().get(`/api/qr/${qr5.rows[0].token}`).expect(404);
    await m.staff.delete(`/api/merchant/tables/${tables.body[3].id}`).expect(200);
    const after = await m.staff.get(`/api/merchant/tables?storeId=${m.storeId}`).expect(200);
    expect(after.body.map((x: { label: string }) => x.label)).toEqual(['1', '2', '3', '5']);
  });

  it('이미지 업로드: 실제 이미지는 WebP 로 재인코딩되고, 위장 파일·큰 파일은 거부된다', async () => {
    const png = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: '#c33' } }).png().toBuffer();
    const ok = await m.staff.post('/api/merchant/media').field('kind', 'menu_image').attach('file', png, { filename: 'kimchi.png', contentType: 'image/png' }).expect(201);
    expect(ok.body).toMatchObject({ width: 1600, height: 800 });
    expect(ok.body.url).toMatch(/^http:\/\/api\.test\/media\/tenants\/[0-9a-f-]+\/menu_image\/[\w-]+\.webp$/);
    await m.staff.patch(`/api/merchant/menus/${m.menuId}`).send({ imageMediaId: ok.body.id }).expect(200);
    const served = await h.browser().get(new URL(ok.body.url).pathname).buffer(true).expect(200);
    expect((await sharp(served.body).metadata()).format).toBe('webp');

    const fake = Buffer.from('<?php system($_GET["c"]); ?>');
    const bad = await m.staff.post('/api/merchant/media').attach('file', fake, { filename: 'shell.png', contentType: 'image/png' }).expect(422);
    expect(bad.body.error.code).toBe('INVALID_FILE');
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    await m.staff.post('/api/merchant/media').attach('file', svg, { filename: 'x.svg', contentType: 'image/svg+xml' }).expect(422);
    const huge = Buffer.alloc(6 * 1024 * 1024, 1);
    const big = await m.staff.post('/api/merchant/media').attach('file', huge, { filename: 'big.jpg', contentType: 'image/jpeg' });
    expect([413, 422]).toContain(big.status);
  });

  it('다른 업체의 이미지는 메뉴에 연결할 수 없다', async () => {
    const other = await setupMerchant(h, admin);
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } }).png().toBuffer();
    const up = await other.staff.post('/api/merchant/media').attach('file', png, { filename: 'a.png', contentType: 'image/png' }).expect(201);
    const res = await m.staff.patch(`/api/merchant/menus/${m.menuId}`).send({ imageMediaId: up.body.id });
    expect(res.status).toBe(422);
  });

  it('메뉴 복제는 옵션까지 복사하고 판매 중지 상태로 만든다', async () => {
    const dup = await m.staff.post(`/api/merchant/menus/${m.menuId}/duplicate`).expect(201);
    const menus = await m.staff.get(`/api/merchant/menus?storeId=${m.storeId}`).expect(200);
    const copy = menus.body.find((x: { id: string }) => x.id === dup.body.id);
    expect(copy).toMatchObject({ name: '김치찌개 (복사본)', status: 'paused' });
    expect(copy.optionGroups.map((g: { name: string }) => g.name)).toEqual(['맵기', '추가']);
    // 판매 중지 메뉴는 고객 메뉴판에 없다
    const c = await customerAt(h, m.qrToken);
    expect((await c.get('/api/menus')).body.menus.some((x: { id: string }) => x.id === dup.body.id)).toBe(false);
  });

  it('주문 기록이 있는 옵션도 옵션 구성을 바꿀 수 있고, 지난 주문의 옵션 스냅샷은 남는다', async () => {
    const c = await customerAt(h, m.qrToken);
    const items = [kimchiItem(m, 1)];
    const order = await c.post('/api/orders').send({ items, clientRequestId: 'req-optchange-01', expectedTotal: 9500 }).expect(201);
    await m.staff
      .put(`/api/merchant/menus/${m.menuId}/option-groups`)
      .send({ groups: [{ name: '맵기', minSelect: 1, maxSelect: 1, options: [{ name: '보통', extraPrice: 0 }] }] })
      .expect(200);
    const o = await c.get(`/api/orders/${order.body.id}`).expect(200);
    expect(o.body.items[0].options.map((x: { name: string }) => x.name)).toEqual(['매운맛', '공기밥']);
  });

  it('정산 계좌는 암호화되어 저장되고 끝 4자리만 조회된다', async () => {
    await m.staff.post('/api/merchant/settlement-account').send({ bankCode: '004', accountHolder: '홍길동', accountNumber: '123-456-789012' }).expect(201);
    const got = await m.staff.get('/api/merchant/settlement-account').expect(200);
    expect(got.body).toMatchObject({ bankCode: '004', accountLast4: '9012', status: 'pending' });
    expect(JSON.stringify(got.body)).not.toContain('456789');
    const raw = await h.db.owner.query(`SELECT account_number_enc FROM tenant_settlement_accounts WHERE tenant_id = $1`, [m.tenantId]);
    expect(raw.rows[0].account_number_enc.toString('utf8')).not.toContain('123456789012');
  });

  it('직원 추가: 가입하지 않은 이메일은 안내 오류, 가입한 직원은 추가된다', async () => {
    const res = await m.staff.post('/api/merchant/members').send({ email: 'ghost@example.test', role: 'viewer' }).expect(404);
    expect(res.body.error.code).toBe('USER_NOT_FOUND');
    const s = await staffSignup(h);
    await m.staff.post('/api/merchant/members').send({ email: s.email, role: 'viewer' }).expect(201);
    const me = await s.staff.get('/api/auth/me').expect(200);
    expect(me.body.memberships).toEqual([expect.objectContaining({ tenantId: m.tenantId, role: 'viewer' })]);
  });
});
