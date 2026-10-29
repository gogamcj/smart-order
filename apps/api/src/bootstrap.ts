import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { AppModule, type AppOverrides } from './app.module.js';
import { SESSION_KIND_HEADER } from './auth/session.service.js';
import { CSRF_HEADER } from './common/csrf.guard.js';
import type { Env } from './config/env.js';

/** 서버와 테스트가 같은 설정으로 앱을 만든다 */
export async function createApp(env: Env, overrides: AppOverrides = {}): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(env, overrides), {
    logger: env.APP_ENV === 'production' ? ['error', 'warn', 'log'] : ['error', 'warn', 'log', 'debug'],
    bodyParser: false,
  });
  if (env.TRUST_PROXY) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.enableCors({
    origin: [env.ORDER_WEB_ORIGIN, env.MERCHANT_WEB_ORIGIN, env.ADMIN_WEB_ORIGIN].map((o) => new URL(o).origin),
    credentials: true,
    allowedHeaders: ['Content-Type', CSRF_HEADER, SESSION_KIND_HEADER, 'Idempotency-Key'],
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    maxAge: 600,
  });
  if (env.MEDIA_STORAGE === 'local') {
    // 메뉴 이미지는 고객 화면에 공개되는 자원이다. 파일명이 무작위라 목록 조회·추측이 불가능하다
    app.use('/media', express.static(path.resolve(env.MEDIA_LOCAL_DIR), { index: false, dotfiles: 'deny', maxAge: '7d', immutable: true }));
  }
  app.enableShutdownHooks();
  return app;
}
