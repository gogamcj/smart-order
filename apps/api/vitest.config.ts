import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // NestJS 의존성 주입은 데코레이터 메타데이터가 필요해 esbuild 대신 swc 로 변환한다
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    // DB 역할(qr_app, qr_system)은 클러스터 전역이라 첫 마이그레이션이 겹치지 않게 파일을 순차 실행한다
    fileParallelism: false,
    hookTimeout: 60_000,
  },
});
