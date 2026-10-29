# 데이터베이스 ERD

> 기준: `apps/api/db/migrations/0001~0006` (PostgreSQL 16). 실제 컬럼·제약은 마이그레이션 파일이 원본입니다.

## 1. 관계도

```mermaid
erDiagram
  tenants ||--|| tenant_settings : "설정"
  tenants ||--|| tenant_plans : "요금제(free)"
  tenants ||--o{ tenant_features : "기능 플래그"
  tenants ||--o{ tenant_members : "직원"
  users ||--o{ tenant_members : "소속"
  users ||--o{ user_identities : "카카오 연결"
  users ||--o{ auth_sessions : "세션"
  users ||--o{ user_consents : "약관 동의"
  terms_documents ||--o{ user_consents : ""
  users ||--o| customer_contacts : "알림톡 연락처(암호화)"
  tenants ||--o{ stores : "매장"
  stores ||--o{ store_tables : "테이블"
  store_tables ||--o{ qr_codes : "QR (유효 1개)"
  tenants ||--o{ media_files : "이미지"
  stores ||--o{ menu_categories : ""
  menu_categories ||--o{ menus : ""
  menus ||--o{ menu_availability : "판매 시간"
  menus ||--o{ menu_option_groups : ""
  menu_option_groups ||--o{ menu_options : ""
  media_files |o--o{ menus : "이미지"
  stores ||--o{ orders : ""
  store_tables ||--o{ orders : ""
  users |o--o{ orders : "주문 고객"
  orders ||--|{ order_items : "상품 스냅샷"
  order_items ||--o{ order_item_options : "옵션 스냅샷"
  orders ||--o{ order_status_history : "상태 이력"
  orders ||--o{ payments : "결제 시도"
  payments ||--o{ payment_events : "웹훅·조회 기록"
  payments ||--o{ refunds : "환불"
  tenants ||--o{ tenant_payment_accounts : "PG 가맹점"
  orders ||--o{ notifications : "알림 발송"
  notification_templates |o--o{ notifications : ""
  tenants ||--o{ outbox_events : "실시간 이벤트"
  tenants |o--o{ audit_logs : ""
```

## 2. 테이블 목록과 업체 소유권

의뢰서 14장의 테이블은 모두 포함했고, 필요한 테이블을 추가했습니다(★).

| 테이블 | 용도 | 소유권 | RLS(qr_app) |
|---|---|---|---|
| tenants | 업체 | 자기 자신 | 자기 업체 행만 조회, 기본 정보만 수정(승인 상태 변경 불가) |
| tenant_settings | 업체별 설정(주문 접수 중지, 알림톡 사용 등) | tenant_id | 같은 업체 읽기, 직원 쓰기 |
| ★ plans / tenant_plans | 요금제(초기 `free` 하나), 과금 비활성 CHECK | tenant_id | 직원 조회만 |
| ★ tenant_features | 업체별 기능 플래그 | tenant_id | 직원 |
| users | 사용자(고객·직원·최고 관리자 공통) | 전역 | 본인, 같은 업체 동료(직원) |
| user_identities | 카카오 회원번호 연결 | user_id | 본인 |
| ★ auth_sessions | 서버 세션(토큰 해시) | user_id | 접근 불가(시스템 전용) |
| tenant_members | 업체 직원과 역할 | tenant_id | 직원 |
| ★ terms_documents / user_consents | 약관 버전, 동의 이력 | user_id | 본인 |
| ★ customer_contacts | 알림톡 연락처(암호문 + HMAC), 수신 동의 | user_id | 본인 |
| stores | 매장 | tenant_id | 같은 업체 읽기, 직원 쓰기 |
| store_tables (= 의뢰서 `tables`) | 테이블 | tenant_id | 같은 업체 읽기, 직원 쓰기 |
| qr_codes | QR 토큰, 테이블당 유효 1개 | tenant_id | 직원(고객은 `resolve_qr_token` 함수로만) |
| ★ media_files | 업로드 이미지 메타데이터 | tenant_id | 같은 업체 읽기, 직원 쓰기 |
| menu_categories / menus | 카테고리, 메뉴(정가·할인가·상태·인기) | tenant_id | 같은 업체 읽기, 직원 쓰기 |
| ★ menu_availability | 메뉴별 판매 가능 시간 | tenant_id | 〃 |
| ★ menu_option_groups / menu_options | 옵션 그룹(최소·최대 선택), 옵션(추가 금액) | tenant_id | 〃 |
| orders | 주문(주문 상태, 금액, 멱등 키, 버전) | tenant_id | 직원: 자기 업체 전체 / 고객: 본인 주문만 |
| order_items / order_item_options | 주문 당시 상품·옵션 스냅샷 | tenant_id | 부모 주문이 보일 때만 |
| order_status_history | 상태 변경 이력(처리자·전후 상태·사유) | tenant_id | 부모 주문이 보일 때만, 쓰기는 트리거만 |
| ★ store_order_counters | 매장·영업일별 표시 번호 | store | 함수로만 |
| payments | 결제(결제 상태, 청구/승인/환불 금액) | tenant_id | 부모 주문이 보일 때 조회만. 쓰기는 시스템 |
| payment_events | 웹훅·승인 조회·대사 원본 | tenant_id(매칭 후) | 접근 불가(시스템 전용) |
| refunds | 환불(멱등 키, 상태) | tenant_id | 조회: 부모 주문, 요청 생성: 직원 |
| ★ tenant_payment_accounts | 업체별 PG 가맹점 정보(비밀키 암호문) | tenant_id | 직원(API 에서 업체 관리자만) |
| ★ idempotency_keys | API 멱등성 응답 저장 | principal | 접근 불가(시스템 전용) |
| ★ outbox_events | 실시간 이벤트(SSE ID) | tenant_id | 직원 |
| notifications | 알림 발송 기록(상태·시도·실패 사유) | tenant_id | 직원 |
| notification_templates | 템플릿 버전(공통/업체) | tenant_id 또는 NULL | 공통 템플릿 읽기, 자기 업체 템플릿 |
| audit_logs | 감사 로그(추가만 가능) | tenant_id 또는 NULL | 추가 가능, 직원은 자기 업체 조회 |
| ★ announcements | 서비스 공지 | 플랫폼 | 게시된 공지 조회 |
| ★ deployment_info | 현재 DB 의 배포 환경 | 플랫폼 | 조회 |

## 3. 데이터 관리 원칙과 구현 위치

| 원칙 | 구현 |
|---|---|
| 금액은 원 단위 정수 | 모든 금액 컬럼 `integer` + `CHECK (>= 0)`, `currency = 'KRW'` |
| 주문 금액 일관성 | `orders.total_amount = subtotal - discount`, `order_items.line_total = (unit_price + options_total) × quantity` CHECK |
| 주문 당시 정보 보존 | `order_items.menu_name_snapshot / list_price_snapshot / unit_price`, `order_item_options.*_snapshot` |
| 주문 생성 후 금액 변경 금지 | `orders_guard` 트리거(`ORDER_IMMUTABLE_FIELDS`) |
| 고유 제약 | `orders.order_no`, `(user_id, client_request_id)`, `(store_id, business_date, display_no)`, `payments.payment_request_id`, `(provider, provider_payment_id)`, `(provider, provider_event_id)`, `(payment_id, idempotency_key)`, `notifications.dedupe_key` |
| 이중 결제 차단 | 부분 유니크 인덱스 `payments_one_captured_per_order` |
| 승인 금액 검증 | `payments` CHECK: 완료 상태면 `approved_amount = amount` |
| 환불 한도 | `refunds_guard` 트리거가 결제 행을 잠그고 누적 환불 ≤ 승인 금액 확인 |
| 상태 전이 | `app.allowed_order_transitions` + `orders_guard`, 이력·이벤트는 `orders_record_change` 트리거 |
| 업체 간 참조 차단 | `(id, tenant_id)` 복합 외래 키 |
| 이벤트 이력 보존 | `payment_events`, `order_status_history`, `audit_logs`(수정·삭제 금지 트리거) |

## 4. 개인정보 보유·삭제 정책 (초안, 법률 검토 필요)

| 데이터 | 보유 기간 | 삭제 방식 |
|---|---|---|
| 카카오 회원번호, 닉네임 | 회원 탈퇴 시까지 | 탈퇴 즉시 `user_identities` 삭제, `users` 는 비식별화(`status='withdrawn'`, 이메일·이름 삭제)하고 주문 이력 연결만 유지 |
| 알림톡 연락처 | 동의 철회·탈퇴 시까지 | `customer_contacts` 행 삭제 |
| 주문·결제·환불 기록 | 5년 (전자상거래법상 대금결제·재화공급 기록) | 기간 경과 후 배치로 고객 식별 연결 제거 |
| 세션 | 만료 후 30일 | 배치 삭제 |
| 웹훅 원본 | 1년 | 배치 삭제(카드번호 등은 처음부터 저장하지 않음) |
| 감사 로그 | 3년 | 운영 절차로 파티션 단위 삭제 |

## 5. 신규 설치와 업데이트 절차

```bash
# 신규 설치: 빈 DB 에 전체 적용
DATABASE_MIGRATION_URL=postgres://owner:****@host:5432/qr_order pnpm db:migrate
# 상태 확인
DATABASE_MIGRATION_URL=... pnpm db:status
```

- 업데이트: 새 파일 `NNNN_설명.sql` 을 추가하고 같은 명령을 실행하면 미적용 파일만 순서대로 적용됩니다.
- 이미 적용된 파일을 수정하면 체크섬 불일치로 중단됩니다. 변경은 항상 새 파일로 합니다.
- 각 파일은 하나의 트랜잭션에서 실행되어 실패하면 통째로 롤백됩니다. 여러 서버가 동시에 실행해도 advisory lock 으로 한 번만 실행됩니다.
- 운영 적용 전에는 백업(스냅샷) → staging 적용 → 테스트 → production 적용 순서로 진행합니다.
- 로그인 계정 연결(운영자가 한 번 실행):
  ```sql
  CREATE ROLE qr_api_login LOGIN PASSWORD '...';    GRANT qr_app TO qr_api_login;
  CREATE ROLE qr_worker_login LOGIN PASSWORD '...'; GRANT qr_system TO qr_worker_login;
  -- API 서버는 두 계정을 모두 쓰되, qr_system 연결은 결제·웹훅·관리자 모듈에서만 사용
  ```
