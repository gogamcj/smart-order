# 카드·간편결제·카카오페이 연동 전략

> 수수료·정산 주기·간편결제 제공 범위는 계약 조건과 시점에 따라 달라서 이 문서에 숫자로 확정하지 않았습니다. 아래 “확인 필요” 항목은 PG 영업 담당자에게 서면으로 받아야 합니다.

## 0. 결정 사항 (2026-10-29, 사용자 결정)

- **정산 모델: B (플랫폼 대표 가맹점이 받아 업체에 나눠 줌).**
- **PG: 아직 정하지 않음.** 코드는 `PaymentProvider` 인터페이스와 설정만 두고, 실제 PG 어댑터는 계약 후 3단계에서 구현합니다.

모델 B 로 진행하기 위해 반드시 필요한 것(외부):
1. PG 의 **지급대행(정산 분배) 또는 하위몰 상품** 계약. 플랫폼 계좌로 받은 돈을 플랫폼이 직접 이체해 나눠 주는 방식은 전자금융거래법상 등록(전자지급결제대행업 등) 문제가 생길 수 있어, PG 지급대행을 쓰는 것을 전제로 합니다.
2. 정산 구조에 대한 **법률 검토** (07 문서 #16).
3. 업체 정산 계좌 확인 절차(예금주 확인)를 PG 지급대행 상품의 계좌 검증 기능으로 할지 결정.

2단계에서 만든 것(코드):
- `tenant_settlement_accounts`: 업체 정산 계좌. 계좌번호는 AES-256-GCM 으로 암호화, 화면·API 에는 끝 4자리만. 상태 `pending → verified/rejected` (확인 절차는 PG 결정 후).
- `settlements`: 기간별 정산 내역(총액·환불·PG 수수료·플랫폼 수수료·지급액). 무료 운영이므로 플랫폼 수수료는 DB 제약으로 0 만 허용.
- 업체 관리 화면의 정산 계좌 등록. **정산 금액 계산·지급 실행은 미구현**(PG 지급대행 API 필요).
- `tenant_payment_accounts`(업체별 가맹점)는 나중에 업체 직가맹(모델 A)을 허용할 때를 위해 그대로 둡니다.

2단계 결제 공통 로직(PG 와 무관한 부분, 테스트 완료):
- 결제 요청 → (PG 결제창) → `POST /api/payments/:id/confirm` 에서 **서버가 PG 에 결과를 다시 조회**하고, 승인 금액이 주문 금액과 같을 때만 결제 완료 + 주문 확정.
- 같은 confirm 을 여러 번 동시에 호출해도 결과가 같음(행 잠금 + 상태 확인). 승인 금액이 다르면 `AMOUNT_MISMATCH` 로 실패 처리하고 주문은 확정하지 않음.
- 결제 수단이 설정되지 않으면 `503 PAYMENT_NOT_CONFIGURED`. 가짜 성공을 돌려주지 않습니다.
- `PAYMENT_PROVIDER=fake` 는 자동화 테스트·로컬 개발 전용 가짜 PG 입니다. 화면에 "테스트 결제 (실제 결제 아님)"으로 표시되며, 운영 환경에서는 환경변수 검사와 DB 트리거 두 곳에서 거부됩니다. `portone`, `tosspayments` 를 고르면 "아직 구현되지 않았습니다"로 서버가 시작하지 않습니다.
- 업체가 결제된 주문을 거절·취소하면 전액 환불 **요청** 행이 생깁니다. PG 환불 실행은 3단계.

## 1. 먼저 정해야 할 것: 대금이 누구에게 들어가는가

다중 업체 플랫폼은 결제 기술보다 **정산 구조**가 먼저입니다.

| 모델 | 구조 | 장점 | 단점·리스크 |
|---|---|---|---|
| **A. 업체별 가맹점 (권장 시작안)** | 각 업체가 PG 와 직접(또는 PortOne 경유) 가맹 계약. 플랫폼은 업체의 상점 키로 결제를 호출만 함 | 대금이 업체 계좌로 직접 정산 → 플랫폼이 고객 돈을 보관하지 않음. 무료 운영 단계와 잘 맞음 | 업체마다 PG 심사·계약 필요(가입 마찰). 업체별 키를 안전하게 보관해야 함 |
| B. 플랫폼 대표 가맹점 + 하위몰/지급대행 | 플랫폼이 하나의 가맹점으로 결제를 받고 PG 의 지급대행(정산 분배) 상품으로 업체에 지급 | 업체 가입이 쉬움. 향후 주문 수수료 과금에 유리 | PG 의 플랫폼·지급대행 심사 필요. 지급대행 없이 플랫폼이 직접 받아 나눠주면 전자금융거래법상 등록 문제가 생길 수 있어 **법률 검토 필수** |

DB(`tenant_payment_accounts`)와 결제 모듈은 두 모델을 모두 수용하도록 설계했습니다. 1단계에서는 A 를 권장했으나, **사용자 결정으로 B 를 채택**했습니다(§0).

## 2. PG 비교 (2026-10 기준 공개 정보 + 확인 필요 항목)

| 항목 | PortOne V2 (결제 연동 플랫폼) | 토스페이먼츠 직접 | KG이니시스 / NHN KCP / 나이스페이 직접 | 카카오페이 직접 |
|---|---|---|---|---|
| 성격 | 여러 PG 를 하나의 API 로 묶는 연동 계층. 실제 결제·정산은 연결된 PG 가 수행 | PG | PG | 간편결제사 |
| 카드 결제 | 연결 PG 통해 O | O | O | 카카오페이 카드 결제 |
| 간편결제 | 연결 PG·간편결제 채널에 따라 | 결제위젯으로 토스페이·네이버페이·카카오페이 등 노출 가능, **수단별 추가 심사·계약 여부 확인 필요** | PG 별 상이, 확인 필요 | – |
| 카카오페이 | ① PG 의 간편결제로 ② 카카오페이 직연동 채널로, 두 경로 모두 지원 | 결제위젯 간편결제로 제공 가능(별도 심사 여부 확인 필요) | PG 별 상이 | 카카오페이 가맹 계약 + 자체 API |
| 모바일 웹 | O | O | O | O (리다이렉트) |
| 웹훅 | O, 서명 검증(웹훅 시크릿) 공식 SDK 제공 | O | O (노티 URL 방식) | 웹훅 대신 승인 API 호출 구조 |
| 부분 취소 | O(PG 지원 시) | O | O | O |
| 다중 업체 | 상점·채널 단위 관리, 파트너 정산 상품 별도 | 지급대행 상품 별도 계약 | 하위몰·오픈마켓 상품 별도 | 업체별 가맹 |
| 테스트 환경 | 테스트 채널 제공 | 테스트 키 즉시 발급 | 테스트 상점 ID | 테스트 CID |
| PG 교체 | 코드 변경 최소 | 어댑터 재작성 | 어댑터 재작성 | – |
| 수수료·정산 주기 | PortOne 이용료 + PG 수수료 **확인 필요** | **확인 필요** | **확인 필요** | **확인 필요** |

### 추천

1. **연동 계층: PortOne V2** — 카카오페이를 PG 간편결제로 받을지, 카카오페이 직연동으로 받을지 계약 결과에 따라 고를 수 있고, 업체마다 다른 PG 를 써도 한 코드로 처리합니다(모델 A 에 유리).
2. **기본 PG: 토스페이먼츠 또는 KG이니시스 중 견적이 좋은 쪽** — 둘 다 카드·주요 간편결제·부분 취소·웹훅을 지원합니다.
3. **카카오페이 경로**: (1순위) 선택한 PG 계약에 카카오페이 간편결제 포함 여부 확인 → 포함되면 PG 경유. (2순위) 미포함이면 카카오페이와 별도 가맹 후 PortOne 카카오페이 채널 추가. 어느 쪽이든 승인 전에는 결제창에 노출하지 않습니다.
4. **결제 모듈은 `PaymentProvider` 인터페이스**로 감싸서 PortOne 을 쓰지 않기로 해도 토스페이먼츠 직접 어댑터로 교체할 수 있게 합니다.

```ts
interface PaymentProvider {
  createCheckout(input: { paymentRequestId: string; amount: number; orderName: string; methods: PayMethod[] }): Promise<CheckoutParams>;
  getPayment(providerPaymentIdOrRequestId: string): Promise<ProviderPayment>;   // 승인 결과 재조회 (항상 이 값을 기준으로 판단)
  verifyWebhook(rawBody: Buffer, headers: Record<string, string>): Promise<VerifiedWebhook>;
  cancel(input: { providerPaymentId: string; amount: number; reason: string; idempotencyKey: string }): Promise<ProviderCancel>;
}
```

계약 전 개발·테스트는 PG 의 **테스트 환경**으로 합니다. 테스트 키도 없을 때는 자동화 테스트에만 `FakeProvider`(`provider='fake'`)를 쓰며, 운영 DB 에서는 `fake` 결제가 DB 트리거로 거부됩니다. 화면·문서에서 가짜 결제를 실제 연동으로 표시하지 않습니다.

## 3. 결제 처리 흐름

```mermaid
sequenceDiagram
  autonumber
  participant C as 고객 브라우저
  participant API as 백엔드
  participant DB as PostgreSQL
  participant PG as PG / PortOne

  C->>API: POST /api/orders (장바구니, client_request_id)
  API->>DB: 메뉴·옵션·품절·판매시간 재조회, 금액 재계산
  API->>DB: orders(pending_payment) + 스냅샷 INSERT
  API-->>C: orderId, 서버 계산 금액
  C->>API: POST /api/payments {orderId} + Idempotency-Key
  API->>DB: 주문 상태·금액·업체 상태 확인, payments(ready, payment_request_id) INSERT
  API-->>C: 결제창 파라미터 (금액은 서버 값)
  C->>PG: 결제창에서 카드/간편결제/카카오페이 인증
  par 브라우저 복귀
    PG-->>C: redirect (성공/실패 표시만, 신뢰하지 않음)
    C->>API: POST /api/payments/{id}/confirm
  and 웹훅
    PG->>API: POST /api/webhooks/payments/portone (서명)
    API->>DB: payment_events INSERT ON CONFLICT DO NOTHING
  end
  API->>PG: getPayment() 재조회
  API->>DB: BEGIN; SELECT payments FOR UPDATE
  alt 승인 + 금액 일치
    API->>DB: payments=paid, orders=placed (트리거: 이력+outbox) COMMIT
  else 금액 불일치
    API->>DB: payments=failed(AMOUNT_MISMATCH) COMMIT
    API->>PG: 전액 취소
  else 실패/취소
    API->>DB: payments=failed, 주문은 pending_payment 유지(재결제 가능)
  end
  API-->>C: 최종 상태 (DB 기준)
```

### 실패 상황별 처리

| 상황 | 처리 |
|---|---|
| 고객이 결제창을 닫음 | `payments` 는 `ready/pending` 유지 → 주문 화면에서 재시도. 30분 뒤 대사 작업이 `expired` 처리, 주문은 `expired` |
| 승인 직후 서버 중단 | 웹훅 재전송 또는 5분 주기 대사 작업이 PG 재조회 → 같은 확정 함수로 주문 복구 |
| 웹훅 중복 도착 | `payment_events` UNIQUE 로 두 번째부터 무시. 확정 함수도 이미 `paid` 면 아무것도 하지 않음 |
| 결제 후 품절·업체 거절 | 주문 `rejected` → 같은 트랜잭션에서 `refunds(requested)` 생성 → 워커가 PG 취소 |
| 결제 성공했는데 주문이 이미 만료 | 상태 전이 표상 `expired → placed` 불가 → 자동 전액 취소 + 운영자 오류 화면 기록 |
| 금액 불일치 | DB CHECK 로 `paid` 불가, 자동 취소, 결제 오류 모니터링 알림 |
| 환불 요청 중복 클릭 | `(payment_id, idempotency_key)` UNIQUE, 누적 환불 한도 트리거 |
| PG 취소 API 실패 | `refunds.failed` + 사유 기록, 운영자 재시도 |

### 상태 정의

- **주문 상태** `orders.status`: `pending_payment → placed → accepted → preparing → ready → completed`, 분기 `rejected`, `cancelled`, `expired` (`accepted → ready` 바로 가기 허용)
- **결제 상태** `payments.status`: `ready → pending → paid → partial_refunded → refunded`, 분기 `failed`, `cancelled`, `expired`
- **환불 상태** `refunds.status`: `requested → processing → succeeded | failed`

## 4. 웹훅 보안

- 경로 `/api/webhooks/payments/{provider}` 는 세션·CSRF 를 적용하지 않고 **서명 검증**만 사용(원문 바이트로 검증하므로 JSON 파서 전에 raw body 보관).
- 서명·타임스탬프(5분 이내) 검증 실패 → 401, `payment_events` 에 `signature_verified=false` 로 기록하지 않고 로그만.
- 웹훅 본문 금액·상태는 참고만 하고 **항상 PG API 재조회 결과로 판단**.
- 응답은 빠르게 200 을 돌려주고 무거운 처리는 큐로 넘깁니다(PG 재전송 폭주 방지).
- 가능하면 PG 의 발신 IP 허용 목록도 함께 적용(제공 여부 확인 필요).

## 5. 대사(Reconciliation)

- 5분마다: `ready/pending` 이고 10분 지난 결제 → PG 재조회 → 확정 또는 만료.
- 매일 새벽: 전날 PG 거래 내역과 `payments` 비교 → 불일치 목록을 운영자 오류 화면에 표시(금액 차이, PG 에만 있는 거래, DB 에만 `paid` 인 거래).
