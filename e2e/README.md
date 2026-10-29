# 브라우저 실동작 점검 (수동)

`smoke.mjs` 는 실제 API 서버와 세 화면(고객·업체·관리자)을 띄운 상태에서 Playwright 로 주요 흐름을 따라가며 확인합니다.
CI 에 포함되어 있지 않으며, 개발용 로그인과 **가짜 PG(테스트 결제)** 를 사용합니다. 실제 카카오 로그인·실제 결제는 확인하지 않습니다.

## 순서

1. 빈 DB 를 만들고 마이그레이션, 로그인 계정 연결
   ```bash
   createdb qr_e2e
   DATABASE_MIGRATION_URL=postgres://postgres:postgres@localhost:5432/qr_e2e pnpm --filter @qr/api db:migrate
   # qr_api_login / qr_worker_login 로그인 역할을 만들고 GRANT qr_app / qr_system (docs/06-deployment.md)
   ```
2. API 실행: `APP_ENV=local`, `PAYMENT_PROVIDER=fake`, `DEV_LOGIN_ENABLED=true`, `ORDER_WEB_ROUTING=hash`
3. 최고 관리자 만들기: `DATABASE_MIGRATION_URL=... pnpm --filter @qr/api admin:create admin@e2e.test`
4. 화면 빌드·실행
   ```bash
   (cd apps/order && VITE_ROUTER=hash VITE_DEV_LOGIN=true pnpm build && pnpm preview --port 5173)
   (cd apps/merchant && pnpm build && pnpm preview --port 5174)
   (cd apps/admin && pnpm build && pnpm preview --port 5175)
   ```
5. `ADMIN_EMAIL=... ADMIN_PASSWORD=... node e2e/smoke.mjs`

결과 기록: `docs/test-results/stage2-e2e-smoke.txt`, 화면 캡처: `docs/screenshots/stage2/`
