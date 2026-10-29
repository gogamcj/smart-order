import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env.js';

const base = {
  DATABASE_URL: 'postgres://x',
  DATABASE_SYSTEM_URL: 'postgres://x',
  API_PUBLIC_URL: 'https://api.example.kr',
  ORDER_WEB_ORIGIN: 'https://order.example.kr',
  MERCHANT_WEB_ORIGIN: 'https://partner.example.kr',
  ADMIN_WEB_ORIGIN: 'https://admin.example.kr',
  SESSION_SECRET: 'x'.repeat(40),
  DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  DATA_HMAC_KEY: randomBytes(32).toString('base64'),
};

describe('환경변수 검증', () => {
  it('운영 환경에서는 개발용 로그인·가짜 결제·비보안 쿠키를 켤 수 없다', () => {
    expect(() => loadEnv({ ...base, APP_ENV: 'production', DEV_LOGIN_ENABLED: 'true' })).toThrow(/DEV_LOGIN_ENABLED/);
    expect(() => loadEnv({ ...base, APP_ENV: 'production', PAYMENT_PROVIDER: 'fake' })).toThrow(/PAYMENT_PROVIDER/);
    expect(() => loadEnv({ ...base, APP_ENV: 'production', COOKIE_SECURE: 'false' })).toThrow(/COOKIE_SECURE/);
    expect(loadEnv({ ...base, APP_ENV: 'production' }).cookieSecure).toBe(true);
  });

  it('구현되지 않은 PG·S3 를 고르면 시작하지 않는다 (가짜로 동작하지 않음)', () => {
    expect(() => loadEnv({ ...base, PAYMENT_PROVIDER: 'portone' })).toThrow(/아직 구현되지 않았습니다/);
    expect(() => loadEnv({ ...base, PAYMENT_PROVIDER: 'tosspayments' })).toThrow(/아직 구현되지 않았습니다/);
    expect(() => loadEnv({ ...base, MEDIA_STORAGE: 's3' })).toThrow(/아직 구현되지 않았습니다/);
  });

  it('자리표시자 값은 설정되지 않은 것으로 본다', () => {
    const env = loadEnv({ ...base, KAKAO_REST_API_KEY: 'REPLACE_WITH_KAKAO_REST_API_KEY', KAKAO_CLIENT_SECRET: 'REPLACE_WITH_X', KAKAO_REDIRECT_URI: 'https://api.example.kr/api/auth/kakao/callback' });
    expect(env.KAKAO_REST_API_KEY).toBeUndefined();
    expect(env.kakaoConfigured).toBe(false);
  });

  it('.env.example 그대로(빈 값·자리표시자 포함) 읽으면 기본값으로 시작할 수 있다', async () => {
    const { readFileSync } = await import('node:fs');
    const example = Object.fromEntries(
      readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8')
        .split('\n')
        .filter((l) => /^[A-Z_]+=/.test(l))
        .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
    );
    const env = loadEnv({ ...example, SESSION_SECRET: base.SESSION_SECRET, DATA_ENCRYPTION_KEY: base.DATA_ENCRYPTION_KEY, DATA_HMAC_KEY: base.DATA_HMAC_KEY });
    expect(env).toMatchObject({ PAYMENT_PROVIDER: 'disabled', DEV_LOGIN_ENABLED: false, cookieSecure: false, kakaoConfigured: false, orderQrUrlTemplate: 'http://localhost:5173/q/{token}', mediaPublicBaseUrl: 'http://localhost:3000/media' });
    // 자리표시자 비밀 값으로는 시작하지 않는다
    expect(() => loadEnv(example)).toThrow(/DATA_ENCRYPTION_KEY/);
  });

  it('QR 주소: 서브도메인 + 일반 주소, 경로 분리 + 해시 주소', () => {
    expect(loadEnv(base).orderQrUrlTemplate).toBe('https://order.example.kr/q/{token}');
    const cafe24 = loadEnv({ ...base, ORDER_WEB_ORIGIN: 'https://www.example.kr/order/', ORDER_WEB_ROUTING: 'hash' });
    expect(cafe24.orderQrUrlTemplate).toBe('https://www.example.kr/order/#/q/{token}');
    expect(cafe24.orderWebUrl('/login?error=cancelled')).toBe('https://www.example.kr/order/#/login?error=cancelled');
  });
});
