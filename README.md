# Multi-Tenant QR Table Order Platform

여러 업체가 가입해 각자 QR 코드·메뉴·주문을 관리하고, 고객은 앱 설치 없이 카카오 로그인 → 결제 → 실시간 주문 상태·알림톡을 받는 SaaS 형 QR 테이블 오더 플랫폼입니다.

**현재 단계: 1단계(아키텍처·설계) 완료.** 화면과 API 서버는 아직 없습니다. 구현 현황은 [docs/STATUS.md](docs/STATUS.md) 에 정확히 기록합니다.

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
| [docs/STATUS.md](docs/STATUS.md) | 구현·외부 설정·미구현 구분, 테스트 결과 |

## 로컬 실행 (1단계 범위)

요구사항: Node.js 22, pnpm 10, Docker(또는 로컬 PostgreSQL 16)

```bash
pnpm install
docker compose up -d postgres          # 로컬 PostgreSQL 16 (postgres/postgres)
cp .env.example .env                   # 값 확인

# 마이그레이션 적용·상태 확인
export DATABASE_MIGRATION_URL=postgres://postgres:postgres@localhost:5432/qr_order
pnpm db:migrate
pnpm db:status

# DB 통합 테스트 (테스트마다 임시 DB 를 만들고 지움)
export TEST_DATABASE_ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres
pnpm test
pnpm typecheck
```

## 디렉터리

```
apps/api/db/migrations/   SQL 마이그레이션 (0001~0006)
apps/api/src/db/          마이그레이션 실행기 (up / status)
apps/api/test/            DB 통합 테스트 (RLS 격리, 상태 전이, 결제·환불 무결성, QR, 감사 로그)
docs/                     설계 문서, 테스트 결과
```
