import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { createApp } from './bootstrap.js';
import { loadEnv } from './config/env.js';

const env = loadEnv();
const app = await createApp(env);
await app.listen(env.PORT);
Logger.log(`API 서버 시작: ${env.API_PUBLIC_URL} (APP_ENV=${env.APP_ENV}, 결제=${env.PAYMENT_PROVIDER}, 카카오=${env.kakaoConfigured ? '설정됨' : '설정 대기'})`, 'Bootstrap');
