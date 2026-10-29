# API 명세

> 상태(2단계): 아래 초안 중 인증·업체·매장·테이블·QR·메뉴·고객 주문·업체 주문·결제 요청/확정은 구현되었습니다(`apps/api/src/*/*.controller.ts`).
> 실제 경로·요청 형식은 컨트롤러와 API 테스트(`apps/api/test/api/`)가 기준이며, 초안과 다른 점은 아래에 정리합니다.
> OpenAPI 자동 문서(`/api/docs`)는 아직 만들지 않았습니다(⬜).
>
> 초안과 달라진 점
> - CSRF: 변경 요청에 `X-Requested-With: qr-order` 헤더 + 허용된 Origin 이 필요합니다.
> - 고객 주문 컨텍스트: `GET /api/qr/:token` 이 서명된 쿠키(`qr_ctx`)를 심고, 이후 `GET /api/menus`, `POST /api/orders/quote`, `POST /api/orders` 는 그 쿠키로 매장·테이블을 정합니다(본문에 매장 ID 를 받지 않음).
> - 주문 생성: `clientRequestId`(중복 방지 키) + `expectedTotal`(견적 금액)을 보내며, 서버 재계산 금액이 다르면 `409 PRICE_CHANGED` 와 새 견적을 돌려줍니다.
> - 결제: `POST /api/payments {orderId}` → PG 결제창 → `POST /api/payments/:id/confirm`. PG 미설정이면 `503 PAYMENT_NOT_CONFIGURED`. 웹훅(`/api/webhooks/...`)은 3단계.
> - 업체 주문 상태 변경: `PATCH /api/merchant/orders/:id/status {to, expectedVersion, reason}`. 버전이 다르면 `409 VERSION_CONFLICT`.
> - 실시간 SSE(`/api/merchant/stream` 등)는 4단계. 지금은 화면이 5초마다 조회합니다.

(이하 1단계 초안)

## 공통 규칙

| 항목 | 규칙 |
|---|---|
| 기본 URL | `https://api.example.kr/api` |
| 형식 | JSON, UTF-8, 시간은 ISO 8601(UTC), 금액은 원 단위 정수 |
| 인증 | `qr_sid` 세션 쿠키 (HttpOnly, Secure, SameSite=Lax, Domain 미지정). 직원 세션 12시간, 고객 세션 30일(유휴 7일) |
| CSRF | 상태 변경 요청은 `X-CSRF-Token` 헤더(더블 서밋) + `Origin` 허용 목록 확인 |
| 업체 컨텍스트 | 직원: 세션의 선택 업체. 고객: QR 검증으로 세션에 저장된 업체·매장·테이블. **경로·본문의 업체 ID 는 신뢰하지 않음** |
| 멱등성 | 생성·결제·환불 요청은 `Idempotency-Key` 헤더 필수. 같은 키+같은 본문 → 저장된 응답 재반환, 같은 키+다른 본문 → 409 |
| 동시성 | 상태 변경은 `expectedVersion` 필수, 불일치 시 409 `VERSION_CONFLICT` + 최신 상태 |
| 속도 제한 | IP·사용자별 (로그인 10회/분, 주문 생성 20회/분, 일반 120회/분) → 429 |
| 오류 형식 | `{ "error": { "code": "ORDER_NOT_FOUND", "message": "사용자용 메시지", "requestId": "..." } }` 내부 스택·SQL 은 노출하지 않음 |
| 타 업체 자원 | 존재 여부를 숨기기 위해 403 대신 **404** 반환 |

## 공통 오류 코드

`UNAUTHENTICATED`(401), `FORBIDDEN`(403), `NOT_FOUND`(404), `VALIDATION_FAILED`(422), `VERSION_CONFLICT`(409), `IDEMPOTENCY_CONFLICT`(409), `RATE_LIMITED`(429), `TENANT_NOT_ACTIVE`(403), `TENANT_NOT_ACCEPTING_ORDERS`(409), `QR_INVALID`(404), `MENU_UNAVAILABLE`(409), `PRICE_CHANGED`(409), `INVALID_ORDER_TRANSITION`(409), `PAYMENT_AMOUNT_MISMATCH`(409), `REFUND_EXCEEDS_PAYMENT`(409), `INTERNAL`(500)

## 엔드포인트

권한 표기: P=최고 관리자, TA=업체 관리자, OS=주문 처리, MS=메뉴 관리, V=조회 전용, C=고객, – =인증 불필요, SIG=PG 서명

### 인증 `/api/auth`
| 메서드·경로 | 인증 | 설명 | 소유권·중복 처리 |
|---|---|---|---|
| GET `/auth/kakao/start?returnTo=` | – | state·PKCE 생성(Redis 10분), 카카오로 302 | `returnTo` 는 고객 오리진 상대경로만 허용 |
| GET `/auth/kakao/callback?code&state` | – | state 1회용 검증, 코드 교환, 계정 연결, 세션 발급, 복귀 | 취소(`error=access_denied`)·실패 시 안내 화면 |
| POST `/auth/staff/login` | – | 직원 이메일 로그인 | 실패 횟수 제한·잠금 |
| POST `/auth/staff/select-tenant` | 직원 | 소속 업체 선택 | 멤버십·업체 상태 검증 |
| POST `/auth/logout` | 로그인 | 세션 폐기 | |
| GET `/auth/me` | 로그인 | 사용자·역할·선택 업체 | |
| POST `/auth/consents` | C | 약관 동의 기록 | |
| DELETE `/auth/me` | C | 회원 탈퇴(비식별화) | 진행 중 주문 있으면 409 |

### QR·고객 주문
| 메서드·경로 | 인증 | 설명 | 소유권·중복 처리 |
|---|---|---|---|
| GET `/qr/{token}` | – | 토큰 검증 → 매장·테이블 정보, 세션에 주문 컨텍스트 저장 | 무효·폐기 토큰 404 |
| GET `/menus` | C | 컨텍스트 매장의 판매 메뉴(카테고리·옵션·품절·판매시간) | 세션 컨텍스트만 사용 |
| GET `/menus/{id}` | C | 메뉴 상세 | 다른 업체 메뉴 404 |
| POST `/orders/quote` | C | 장바구니 금액 서버 계산(표시용) | |
| POST `/orders` | C | 주문 생성 `{items[{menuId, quantity, optionIds[]}], request, clientRequestId, expectedTotal}` | 서버 재계산, `expectedTotal` 다르면 409 `PRICE_CHANGED` + 새 견적. `(user, clientRequestId)` 중복 시 기존 주문 반환 |
| GET `/orders/me` | C | 본인 주문 내역 | 본인 것만 |
| GET `/orders/{id}` | C | 주문 상세(주문·결제·환불 상태) | 본인 것만 |
| GET `/orders/{id}/stream` | C | SSE 상태 스트림 | 본인 것만 |
| POST `/orders/{id}/cancel-request` | C | 접수 전 취소 요청 | `placed` 일 때만 |
| PUT `/me/contact` | C | 알림톡 번호·수신 동의 | 암호화 저장 |

### 결제·웹훅·환불
| 메서드·경로 | 인증 | 설명 | 소유권·중복 처리 |
|---|---|---|---|
| POST `/payments` | C | `{orderId, method}` → 결제창 파라미터 | 본인 `pending_payment` 주문만, Idempotency-Key |
| POST `/payments/{id}/confirm` | C | 복귀 후 승인 확인(PG 재조회) | 이미 확정이면 현재 상태 반환 |
| POST `/webhooks/payments/{provider}` | SIG | PG 웹훅 | 서명 검증, 이벤트 ID 중복 무시 |
| POST `/merchant/orders/{id}/refunds` | TA, OS(can_refund) | `{amount, reason}` 부분·전체 환불 | Idempotency-Key, 한도 초과 409 |
| GET `/merchant/refunds` | TA, V | 환불 내역 | 자기 업체 |

### 업체 관리자 `/api/merchant`
| 메서드·경로 | 권한 | 설명 |
|---|---|---|
| POST `/tenants/apply` (공개) | 로그인 직원 | 업체 가입 신청 → `pending` |
| GET/PATCH `/merchant/tenant` | TA (조회는 전 직원) | 업체 정보 |
| GET/PATCH `/merchant/settings` | TA | 주문 접수 중지, 자동 접수, 알림 설정 |
| CRUD `/merchant/members` | TA | 직원 초대·역할·비활성화 |
| CRUD `/merchant/stores` | TA | 매장·영업시간 |
| CRUD `/merchant/tables` | TA | 테이블 추가·삭제·번호 변경·활성화 |
| POST `/merchant/tables/{id}/qr-codes` | TA | QR 발급/재발급(기존 폐기) |
| DELETE `/merchant/qr-codes/{id}` | TA | QR 폐기 |
| GET `/merchant/qr-codes/{id}.png`, POST `/merchant/qr-codes/print` | TA | 이미지, 일괄 인쇄 PDF |
| CRUD `/merchant/categories`, `/merchant/menus`, `/merchant/menus/{id}/option-groups` | TA, MS | 메뉴 관리 |
| POST `/merchant/menus/{id}/duplicate`, PATCH `/merchant/menus/reorder` | TA, MS | 복제, 정렬 |
| PATCH `/merchant/menus/{id}/status` | TA, MS, OS | 품절·판매 중지 |
| POST `/merchant/media` | TA, MS | 이미지 업로드(5MB, jpeg/png/webp, 매직바이트 확인, 재인코딩) |
| GET `/merchant/orders?status&from&to&tableId&q` | 전 직원 | 대시보드·검색·기간 조회 |
| PATCH `/merchant/orders/{id}/status` | TA, OS | `{to, expectedVersion, reason}` |
| GET `/merchant/stream` | 전 직원 | SSE 신규 주문·상태 변경 |
| GET `/merchant/stats/sales` | TA, V | 기간별 매출 |
| GET `/merchant/audit-logs` | TA | 자기 업체 감사 로그 |
| CRUD `/merchant/payment-accounts` | TA | PG 가맹점 정보(비밀 값은 쓰기 전용) |

### 최고 관리자 `/api/admin` (모두 P, 모든 변경은 감사 로그)
| 메서드·경로 | 설명 |
|---|---|
| GET `/admin/tenants?status` | 업체 목록·이용 현황 |
| POST `/admin/tenants/{id}/approve` · `/reject` · `/suspend` · `/resume` | 상태 변경(사유 필수) |
| CRUD `/admin/tenants/{id}/admins` | 업체 관리자 계정 |
| GET `/admin/orders`, `/admin/payments`, `/admin/refunds` | 현황(고객 개인정보 제외) |
| GET `/admin/errors/payments` · `/webhooks` · `/notifications` | 오류 확인·재처리 |
| CRUD `/admin/announcements` | 공지 |
| GET `/admin/audit-logs`, `/admin/stats` | 운영 로그, 서비스 통계 |
| PATCH `/admin/tenants/{id}/features` | 기능 플래그 |

### 운영
| 메서드·경로 | 설명 |
|---|---|
| GET `/healthz` | 프로세스 생존 |
| GET `/readyz` | DB·Redis 연결 확인 |

## SSE 이벤트 형식

```
id: 12345
event: order.status_changed
data: {"orderId":"…","orderNo":"261029-7K3QH2","displayNo":12,"tableId":"…","from":"placed","to":"accepted","version":3}
```
