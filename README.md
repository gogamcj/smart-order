# Multi-Tenant QR Table Order Platform

여러 업체가 가입해 각자 QR 코드·메뉴·주문을 관리하고, 고객은 앱 설치 없이 카카오 로그인 → 결제 → 실시간 주문 상태·알림톡을 받는 SaaS 형 QR 테이블 오더 플랫폼입니다.

**현재 단계: 2단계(고객 주문·업체 관리) 완료.** 실제 PG 결제·실시간 연결·알림톡은 아직 없습니다. 구현·외부 설정·미구현 구분은 [docs/STATUS.md](docs/STATUS.md) 가 기준입니다.

## 문서

| 문서 | 내용 |
|---|---|
| [docs/01-design-proposal.md](docs/01-design-proposal.md) | 기술 스택, Cafe24/백엔드 역할 분리, 아키텍처·데이터 흐름, 실시간·알림톡, 단계별 작업, 위험 |
| [docs/02-erd.md](docs/02-erd.md) | ERD, 테이블별 소유권, 데이터 원칙, 개인정보 보유, 마이그레이션 절차 |
| [docs/03-tenancy-and-permissions.md](docs/03-tenancy-and-permissions.md) | 업체 격리 3중 방어, 권한 매트릭스 |
| [docs/04-payments.md](docs/04-payments.md) | 정산 모델, PG 비교·추천, 카카오페이 경로, 결제 흐름도, 웹훅·대사 |
| [docs/05-api-spec.md](docs/05-api-spec.md) | API 명세 초안 |
| [docs/06-deployment.md](docs/06-deployment.md) | Cafe24 제약, 배포 구조, 환경 분리, 배포 체크리스트 |
| [docs/07-external-accounts.md](docs/07-external-accounts.md) | 외부 계정·계약 목록 |
| [docs/STATUS.md](docs/STATUS.md) | 구현·외부 설정·미구현 구분, 테스트 결과 (2단계 기준) |

## 로컬 실행

요구사항: Node.js 22, pnpm 10, Docker(또는 로컬 PostgreSQL 16)

```bash
pnpm install
docker compose up -d postgres            # 로컬 PostgreSQL 16 (postgres/postgres)
cp .env.example .env                     # SESSION_SECRET, DATA_* 키를 채움 (openssl rand ...)

# DB 마이그레이션
export DATABASE_MIGRATION_URL=postgres://postgres:postgres@localhost:5432/qr_order
pnpm db:migrate
# API 로그인 계정 연결 (로컬 예시, 비밀번호는 .env 의 DATABASE_URL 과 맞춤)
psql "$DATABASE_MIGRATION_URL" -c "CREATE ROLE qr_api_login LOGIN PASSWORD '...'; GRANT qr_app TO qr_api_login;" \
  -c "CREATE ROLE qr_worker_login LOGIN PASSWORD '...'; GRANT qr_system TO qr_worker_login;"
# 최고 관리자 계정
pnpm --filter @qr/api admin:create admin@example.kr

# 실행 (각각 다른 터미널)
pnpm --filter @qr/api dev                # API  http://localhost:3000
pnpm --filter @qr/order dev              # 고객 http://localhost:5173  (QR 주소: /q/<토큰>)
pnpm --filter @qr/merchant dev           # 업체 http://localhost:5174
pnpm --filter @qr/admin dev              # 관리자 http://localhost:5175

# 테스트 (테스트마다 임시 DB 를 만들고 지움)
export TEST_DATABASE_ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres
pnpm test && pnpm typecheck && pnpm build
```

카카오 키 없이 주문 흐름을 보려면 `.env` 에 `DEV_LOGIN_ENABLED=true`, `PAYMENT_PROVIDER=fake` 를 두고, `apps/order/.env` 에 `VITE_DEV_LOGIN=true` 를 둡니다. 화면에 "개발용 로그인", "테스트 결제 (실제 결제 아님)"으로 표시되며 운영 설정에서는 서버가 거부합니다.

## 디렉터리

```
apps/api/            NestJS API 서버, SQL 마이그레이션(db/migrations), 테스트(test/, test/api/)
apps/order/          고객 주문 화면 (모바일)
apps/merchant/       업체 관리 화면
apps/admin/          최고 관리자 화면 (업체 승인)
packages/web/        화면 공용 코드 (API 호출, UI 요소)
e2e/                 브라우저 실동작 점검 스크립트 (수동 실행)
docs/                설계 문서, 구현 현황, 테스트 결과, 화면 캡처
```
