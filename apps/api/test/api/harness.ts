import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';
import type { KakaoClient } from '../../src/auth/kakao.client.js';
import { createApp } from '../../src/bootstrap.js';
import { loadEnv } from '../../src/config/env.js';
import { FakePaymentProvider } from '../../src/payments/fake-payment.provider.js';
import { createTestDb, type TestDb } from '../helpers/db.js';

export const ORDER_ORIGIN = 'http://order.test';
export const MERCHANT_ORIGIN = 'http://partner.test';
export const ADMIN_ORIGIN = 'http://admin.test';

/** 카카오 대신 쓰는 가짜 클라이언트. code 가 'ok:<카카오ID>:<닉네임>' 이면 성공, 그 외는 실패 */
export class FakeKakao implements KakaoClient {
  authorizeUrl(state: string) {
    return `https://kauth.kakao.com/oauth/authorize?fake=1&state=${state}`;
  }
  async exchangeCodeForProfile(code: string) {
    const [ok, id, nickname] = code.split(':');
    if (ok !== 'ok' || !id) throw new Error('kakao rejected');
    return { kakaoId: id, nickname: nickname ?? null };
  }
}

export interface Harness {
  db: TestDb;
  app: INestApplication;
  payments: FakePaymentProvider;
  /** 쿠키를 유지하는 브라우저 하나. origin 은 요청 Origin 헤더 */
  browser: (origin?: string) => TestAgent;
  close: () => Promise<void>;
}

export async function createHarness(opts: { paymentProvider?: 'fake' | 'none'; throttle?: boolean } = {}): Promise<Harness> {
  const db = await createTestDb();
  const url = new URL(process.env.TEST_DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres');
  url.pathname = `/${db.name}`;
  const env = loadEnv({
    APP_ENV: 'local',
    DATABASE_URL: url.toString(),
    DATABASE_SYSTEM_URL: url.toString(),
    API_PUBLIC_URL: 'http://api.test',
    ORDER_WEB_ORIGIN: ORDER_ORIGIN,
    MERCHANT_WEB_ORIGIN: MERCHANT_ORIGIN,
    ADMIN_WEB_ORIGIN: ADMIN_ORIGIN,
    SESSION_SECRET: randomBytes(32).toString('hex'),
    DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    DATA_HMAC_KEY: randomBytes(32).toString('base64'),
    KAKAO_REST_API_KEY: 'test-rest-key',
    KAKAO_CLIENT_SECRET: 'test-secret',
    KAKAO_REDIRECT_URI: 'http://api.test/api/auth/kakao/callback',
    DEV_LOGIN_ENABLED: 'true',
    PAYMENT_PROVIDER: 'disabled',
    MEDIA_LOCAL_DIR: mkdtempSync(path.join(tmpdir(), 'qr-media-')),
  });
  const payments = new FakePaymentProvider();
  const app = await createApp(env, {
    kakaoClient: new FakeKakao(),
    paymentProvider: opts.paymentProvider === 'none' ? null : payments,
    throttle: opts.throttle ?? false,
  });
  await app.init();
  const server = app.getHttpServer();
  return {
    db,
    app,
    payments,
    browser: (origin = ORDER_ORIGIN) => request.agent(server).set('Origin', origin).set('X-Requested-With', 'qr-order'),
    close: async () => {
      await app.close();
      await db.drop();
    },
  };
}
