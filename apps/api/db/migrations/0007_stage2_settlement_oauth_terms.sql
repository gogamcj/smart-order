-- 0007 2단계: 정산 모델 B(플랫폼 대표 수납 후 업체 지급), OAuth state, 약관 초안
--
-- 정산 모델 결정(2026-10-29): 플랫폼이 대표 가맹점으로 결제를 받고 PG 지급대행으로 업체에 정산한다.
-- PG 가 정해지지 않아 지급 실행은 구현하지 않고, 업체 정산 계좌와 정산 내역을 담을 구조만 만든다.
-- tenant_payment_accounts(업체별 가맹점)는 향후 업체 직가맹을 허용할 때를 위해 그대로 둔다.

-- 업체 정산 계좌. 계좌번호는 애플리케이션에서 AES-256-GCM 으로 암호화하고 끝 4자리만 평문 보관
CREATE TABLE tenant_settlement_accounts (
  tenant_id           uuid PRIMARY KEY REFERENCES tenants (id),
  bank_code           text NOT NULL CHECK (bank_code ~ '^[0-9]{3}$'),
  account_holder      text NOT NULL CHECK (length(account_holder) BETWEEN 1 AND 50),
  account_number_enc  bytea NOT NULL,
  account_last4       text NOT NULL CHECK (account_last4 ~ '^[0-9]{4}$'),
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected')),
  verified_at         timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'verified' OR verified_at IS NOT NULL)
);
CREATE TRIGGER tenant_settlement_accounts_updated_at BEFORE UPDATE ON tenant_settlement_accounts
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- 정산 내역(기간별). 초기 무료 운영이라 platform_fee_amount 는 0 으로만 둔다.
CREATE TABLE settlements (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants (id),
  period_start         date NOT NULL,
  period_end           date NOT NULL,
  gross_amount         integer NOT NULL CHECK (gross_amount >= 0),
  refund_amount        integer NOT NULL DEFAULT 0 CHECK (refund_amount >= 0),
  pg_fee_amount        integer NOT NULL DEFAULT 0 CHECK (pg_fee_amount >= 0),
  platform_fee_amount  integer NOT NULL DEFAULT 0 CHECK (platform_fee_amount = 0),
  net_amount           integer NOT NULL,
  status               text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'paid', 'held')),
  provider_payout_id   text,
  paid_at              timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (period_start <= period_end),
  CHECK (net_amount = gross_amount - refund_amount - pg_fee_amount - platform_fee_amount),
  UNIQUE (tenant_id, period_start, period_end)
);

-- 카카오 로그인 state. 브라우저 쿠키의 state 와 DB 의 해시가 모두 맞고 한 번만 사용할 수 있다.
CREATE TABLE oauth_states (
  state_hash   bytea PRIMARY KEY,
  provider     text NOT NULL CHECK (provider IN ('kakao')),
  return_to    text NOT NULL CHECK (return_to ~ '^/[^/\\]'  OR return_to = '/'),
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
  consumed_at  timestamptz
);

ALTER TABLE tenant_settlement_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_states ENABLE ROW LEVEL SECURITY;
CREATE POLICY system_all ON tenant_settlement_accounts TO qr_system USING (true) WITH CHECK (true);
CREATE POLICY system_all ON settlements TO qr_system USING (true) WITH CHECK (true);
CREATE POLICY system_all ON oauth_states TO qr_system USING (true) WITH CHECK (true);
CREATE POLICY staff_all ON tenant_settlement_accounts TO qr_app
  USING (tenant_id = app.current_tenant_id() AND app.is_staff())
  WITH CHECK (tenant_id = app.current_tenant_id() AND app.is_staff());
CREATE POLICY staff_read ON settlements FOR SELECT TO qr_app
  USING (tenant_id = app.current_tenant_id() AND app.is_staff());

GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_settlement_accounts, settlements, oauth_states TO qr_system;
GRANT SELECT, INSERT, UPDATE ON tenant_settlement_accounts TO qr_app;
GRANT SELECT ON settlements TO qr_app;

-- 약관 초안. 법률 검토 전이며 정식 문서로 교체할 때 새 버전 행을 추가한다.
INSERT INTO terms_documents (kind, version, title, body_url, required, effective_at) VALUES
  ('terms', '0.1-draft', '서비스 이용약관 (초안)', '/legal/terms', true, '2026-10-29'),
  ('privacy', '0.1-draft', '개인정보 처리방침 (초안)', '/legal/privacy', true, '2026-10-29');

-- 옵션 구성을 바꿀 때 기존 옵션을 지울 수 있도록, 주문 스냅샷의 참조만 끊는다(스냅샷 이름·가격은 그대로)
ALTER TABLE order_item_options DROP CONSTRAINT order_item_options_option_id_tenant_id_fkey;
ALTER TABLE order_item_options
  ADD CONSTRAINT order_item_options_option_id_tenant_id_fkey
  FOREIGN KEY (option_id, tenant_id) REFERENCES menu_options (id, tenant_id) ON DELETE SET NULL (option_id);
