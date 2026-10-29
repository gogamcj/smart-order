import { z } from 'zod';

// 자리표시자(.env.example 의 REPLACE_WITH_...)나 빈 값은 '설정 안 됨'으로 취급한다
const optionalSecret = z
  .string()
  .optional()
  .transform((v) => (!v || v.startsWith('REPLACE_WITH') ? undefined : v));

const bool = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === 'true'));

const base64Key = z
  .string()
  .refine((v) => Buffer.from(v, 'base64').length === 32, '32바이트 base64 값이어야 합니다');

const schema = z
  .object({
    APP_ENV: z.enum(['local', 'staging', 'production']).default('local'),
    PORT: z.coerce.number().int().default(3000),
    DATABASE_URL: z.string().min(1),
    DATABASE_SYSTEM_URL: z.string().min(1),
    API_PUBLIC_URL: z.string().url(),
    // 고객 주문 웹 주소. Cafe24 처럼 서브도메인 대신 경로로 나누면 경로까지 적는다(예: https://www.example.kr/order)
    ORDER_WEB_ORIGIN: z.string().url(),
    // .htaccess 로 SPA 주소를 index.html 로 돌릴 수 없는 호스팅이면 hash (주소가 /#/q/... 형태)
    ORDER_WEB_ROUTING: z.enum(['path', 'hash']).default('path'),
    MERCHANT_WEB_ORIGIN: z.string().url(),
    ADMIN_WEB_ORIGIN: z.string().url(),
    // QR 에 인쇄되는 주소. {token} 자리에 토큰이 들어간다. .htaccess 를 못 쓰는 호스팅이면 해시 주소 사용
    ORDER_QR_URL_TEMPLATE: z.string().optional(),
    SESSION_SECRET: z.string().min(32),
    DATA_ENCRYPTION_KEY: base64Key,
    DATA_HMAC_KEY: base64Key,
    COOKIE_SECURE: bool,
    KAKAO_REST_API_KEY: optionalSecret,
    KAKAO_CLIENT_SECRET: optionalSecret,
    KAKAO_REDIRECT_URI: z.string().url().optional(),
    DEV_LOGIN_ENABLED: bool,
    PAYMENT_PROVIDER: z.enum(['disabled', 'fake', 'portone', 'tosspayments']).default('disabled'),
    MEDIA_STORAGE: z.enum(['local', 's3']).default('local'),
    MEDIA_LOCAL_DIR: z.string().default('var/media'),
    MEDIA_PUBLIC_BASE_URL: z.string().url().optional(),
    TRUST_PROXY: bool,
  })
  .superRefine((env, ctx) => {
    if (env.APP_ENV === 'production') {
      if (env.DEV_LOGIN_ENABLED) ctx.addIssue({ code: 'custom', path: ['DEV_LOGIN_ENABLED'], message: '운영 환경에서는 개발용 로그인을 켤 수 없습니다' });
      if (env.PAYMENT_PROVIDER === 'fake') ctx.addIssue({ code: 'custom', path: ['PAYMENT_PROVIDER'], message: '운영 환경에서는 가짜 결제를 쓸 수 없습니다' });
      if (env.COOKIE_SECURE === false) ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: '운영 환경 쿠키는 Secure 여야 합니다' });
    }
    if (env.PAYMENT_PROVIDER === 'portone' || env.PAYMENT_PROVIDER === 'tosspayments') {
      ctx.addIssue({ code: 'custom', path: ['PAYMENT_PROVIDER'], message: `${env.PAYMENT_PROVIDER} 연동은 아직 구현되지 않았습니다 (3단계, PG 계약 후)` });
    }
    if (env.MEDIA_STORAGE === 's3') {
      ctx.addIssue({ code: 'custom', path: ['MEDIA_STORAGE'], message: 'S3 저장소 연동은 아직 구현되지 않았습니다' });
    }
  });

export type Env = z.infer<typeof schema> & {
  cookieSecure: boolean;
  orderQrUrlTemplate: string;
  /** 고객 주문 웹의 화면 주소 (라우팅 방식 반영). path 는 '/' 로 시작하는 앱 내부 경로 */
  orderWebUrl: (path: string) => string;
  mediaPublicBaseUrl: string;
  kakaoConfigured: boolean;
};

export const ENV = Symbol('ENV');

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  // .env 의 'KEY=' 처럼 빈 값은 설정하지 않은 것으로 본다
  const parsed = schema.safeParse(Object.fromEntries(Object.entries(source).filter(([, v]) => v !== '')));
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`환경변수 설정 오류:\n${lines.join('\n')}`);
  }
  const env = parsed.data;
  const orderBase = env.ORDER_WEB_ORIGIN.replace(/\/+$/, '');
  const orderWebUrl = (p: string) => `${orderBase}${env.ORDER_WEB_ROUTING === 'hash' ? '/#' : ''}${p}`;
  return {
    ...env,
    cookieSecure: env.COOKIE_SECURE ?? env.APP_ENV !== 'local',
    orderQrUrlTemplate: env.ORDER_QR_URL_TEMPLATE ?? orderWebUrl('/q/{token}'),
    orderWebUrl,
    mediaPublicBaseUrl: env.MEDIA_PUBLIC_BASE_URL ?? `${env.API_PUBLIC_URL}/media`,
    kakaoConfigured: Boolean(env.KAKAO_REST_API_KEY && env.KAKAO_CLIENT_SECRET && env.KAKAO_REDIRECT_URI),
  };
}
