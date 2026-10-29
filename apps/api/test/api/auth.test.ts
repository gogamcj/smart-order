import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness, MERCHANT_ORIGIN } from './harness.js';
import { createPlatformAdmin, customerAt, type MerchantSetup, setupMerchant, staffSignup } from './scenario.js';

describe('인증·세션 (API)', () => {
  let h: Harness;
  let m: MerchantSetup;

  beforeAll(async () => {
    h = await createHarness();
    m = await setupMerchant(h, await createPlatformAdmin(h));
  });
  afterAll(async () => h.close());

  it('[18-1] 카카오 로그인 성공: 회원 연결 후 세션이 생기고 같은 카카오 ID 는 같은 사용자로 로그인된다', async () => {
    const c1 = await customerAt(h, m.qrToken, 'kakao-111');
    const me1 = await c1.get('/api/auth/me').expect(200);
    expect(me1.body).toMatchObject({ authenticated: true, actorKind: 'customer', displayName: '손님' });
    const c2 = await customerAt(h, m.qrToken, 'kakao-111');
    const me2 = await c2.get('/api/auth/me').expect(200);
    expect(me2.body.userId).toBe(me1.body.userId);
  });

  it('[18-1] 카카오 로그인 취소·실패·state 위조는 로그인 실패 화면으로 보내고 세션을 만들지 않는다', async () => {
    const c = h.browser();
    const start = await c.get('/api/auth/kakao/start?returnTo=/menu').expect(302);
    const state = new URL(start.headers.location!).searchParams.get('state');

    const cancelled = await c.get(`/api/auth/kakao/callback?error=access_denied&state=${state}`).expect(302);
    expect(cancelled.headers.location).toBe('http://order.test/login?error=cancelled');
    // 한 번 쓴 state 는 다시 쓸 수 없다
    const reused = await c.get(`/api/auth/kakao/callback?code=ok:x&state=${state}`).expect(302);
    expect(reused.headers.location).toContain('error=invalid_state');

    const start2 = await c.get('/api/auth/kakao/start').expect(302);
    const state2 = new URL(start2.headers.location!).searchParams.get('state');
    const kakaoFail = await c.get(`/api/auth/kakao/callback?code=bad&state=${state2}`).expect(302);
    expect(kakaoFail.headers.location).toContain('error=kakao_error');

    // 다른 브라우저(쿠키 없음)에서 남의 state 로 콜백 → 거부 (로그인 CSRF 방지)
    const attacker = h.browser();
    const start3 = await c.get('/api/auth/kakao/start').expect(302);
    const state3 = new URL(start3.headers.location!).searchParams.get('state');
    const forged = await attacker.get(`/api/auth/kakao/callback?code=ok:evil&state=${state3}`).expect(302);
    expect(forged.headers.location).toContain('error=invalid_state');

    expect((await c.get('/api/auth/me').expect(200)).body.authenticated).toBe(false);
    expect((await attacker.get('/api/auth/me').expect(200)).body.authenticated).toBe(false);
  });

  it('[18-2] 외부 사이트로의 복귀 주소는 허용하지 않는다 (open redirect 차단)', async () => {
    for (const bad of ['//evil.example', 'https://evil.example', '/\\evil.example']) {
      const c = h.browser();
      const start = await c.get(`/api/auth/kakao/start?returnTo=${encodeURIComponent(bad)}`).expect(302);
      const state = new URL(start.headers.location!).searchParams.get('state');
      const cb = await c.get(`/api/auth/kakao/callback?code=ok:redirect-test&state=${state}`).expect(302);
      expect(cb.headers.location).toBe('http://order.test/');
    }
  });

  it('[18-2] 로그인 후에도 QR 주문 컨텍스트(매장·테이블)가 유지된다', async () => {
    const c = await customerAt(h, m.qrToken);
    const ctx = await c.get('/api/order-context').expect(200);
    expect(ctx.body).toMatchObject({ storeName: '본점', tableLabel: '1', acceptingOrders: true });
    const menus = await c.get('/api/menus').expect(200);
    expect(menus.body.menus.map((x: { name: string }) => x.name)).toEqual(['김치찌개']);
  });

  it('[18-3] 만료된 세션과 로그아웃한 세션은 차단된다', async () => {
    const c = await customerAt(h, m.qrToken);
    await c.get('/api/orders/me').expect(200);
    const me = await c.get('/api/auth/me');
    await h.db.owner.query(`UPDATE auth_sessions SET expires_at = now() - interval '1 second' WHERE user_id = $1`, [me.body.userId]);
    const res = await c.get('/api/orders/me').expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');

    const c2 = await customerAt(h, m.qrToken);
    await c2.post('/api/auth/logout').expect(200);
    await c2.get('/api/orders/me').expect(401);
  });

  it('직원 로그인: 비밀번호가 틀리면 계정 존재 여부와 무관하게 같은 오류', async () => {
    const { email } = await staffSignup(h);
    const a = h.browser(MERCHANT_ORIGIN);
    const wrong = await a.post('/api/auth/staff/login').send({ email, password: 'wrong-password' }).expect(401);
    const unknown = await a.post('/api/auth/staff/login').send({ email: 'nobody@example.test', password: 'wrong-password' }).expect(401);
    expect(wrong.body.error).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(unknown.body.error.message).toBe(wrong.body.error.message);
    await a.post('/api/auth/staff/login').send({ email, password: 'staff-password-1' }).expect(200);
    expect((await a.get('/api/auth/me')).body.actorKind).toBe('staff');
  });

  it('한 브라우저에서 손님 로그인과 업체 로그인이 서로를 로그아웃시키지 않는다', async () => {
    const { email } = await staffSignup(h);
    const b = h.browser();
    const asStaff = { 'X-Qr-Session': 'staff' };
    const asCustomer = { 'X-Qr-Session': 'customer' };
    await b.post('/api/auth/staff/login').set(asStaff).send({ email, password: 'staff-password-1' }).expect(200);
    await b.post('/api/auth/dev-login').set(asCustomer).send({ nickname: '손님' }).expect(200);
    expect((await b.get('/api/auth/me').set(asStaff)).body).toMatchObject({ authenticated: true, actorKind: 'staff' });
    expect((await b.get('/api/auth/me').set(asCustomer)).body).toMatchObject({ authenticated: true, actorKind: 'customer' });
    // 다시 직원으로 로그인해도 손님 세션은 그대로
    await b.post('/api/auth/staff/login').set(asStaff).send({ email, password: 'staff-password-1' }).expect(200);
    expect((await b.get('/api/auth/me').set(asCustomer)).body.actorKind).toBe('customer');
    // 업체 화면에서 로그아웃하면 업체 세션만 끝난다
    await b.post('/api/auth/logout').set(asStaff).expect(200);
    expect((await b.get('/api/auth/me').set(asStaff)).body.authenticated).toBe(false);
    expect((await b.get('/api/auth/me').set(asCustomer)).body.actorKind).toBe('customer');
  });

  it('필수 약관에 동의하지 않으면 주문할 수 없다', async () => {
    const c = h.browser();
    await c.get(`/api/qr/${m.qrToken}`).expect(200);
    const start = await c.get('/api/auth/kakao/start').expect(302);
    const state = new URL(start.headers.location!).searchParams.get('state');
    await c.get(`/api/auth/kakao/callback?code=ok:no-consent&state=${state}`).expect(302);
    const items = [{ menuId: m.menuId, quantity: 1, optionIds: [m.options.mild] }];
    const res = await c.post('/api/orders').send({ items, clientRequestId: 'req-consent-0001', expectedTotal: 8000 }).expect(403);
    expect(res.body.error.code).toBe('CONSENT_REQUIRED');
  });

  it('회원 탈퇴: 카카오 연결과 세션을 지우고, 같은 카카오 계정은 새 사용자로 가입된다', async () => {
    const c = await customerAt(h, m.qrToken, 'kakao-withdraw');
    const before = (await c.get('/api/auth/me')).body.userId;
    await c.delete('/api/auth/me').expect(200);
    await c.get('/api/orders/me').expect(401);
    const user = await h.db.owner.query(`SELECT status, display_name FROM users WHERE id = $1`, [before]);
    expect(user.rows[0]).toEqual({ status: 'withdrawn', display_name: null });
    const again = await customerAt(h, m.qrToken, 'kakao-withdraw');
    expect((await again.get('/api/auth/me')).body.userId).not.toBe(before);
  });

  it('개발용 로그인은 설정이 켜진 local 환경에서만 동작한다 (이 테스트 환경은 켜져 있음)', async () => {
    const c = h.browser();
    const res = await c.post('/api/auth/dev-login').send({ nickname: '테스터' }).expect(200);
    expect(res.body.devLogin).toBe(true);
  });
});
