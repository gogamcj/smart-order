-- 0002 업체(테넌트), 사용자, 외부 로그인, 세션, 업체 직원, 요금제·기능 플래그, 약관 동의

CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           citext UNIQUE,                 -- 업체 직원 이메일 로그인용. 고객(카카오)은 NULL 가능
  password_hash   text,                          -- argon2id. 고객은 NULL
  display_name    text CHECK (length(display_name) <= 50),
  platform_role   text NOT NULL DEFAULT 'none' CHECK (platform_role IN ('none', 'super_admin')),
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'locked', 'withdrawn')),
  withdrawn_at    timestamptz,                   -- 탈퇴 시 개인정보 컬럼을 비우고 행은 주문 이력 보존용으로 유지
  last_login_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'withdrawn' OR (email IS NULL AND password_hash IS NULL AND withdrawn_at IS NOT NULL))
);
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TABLE user_identities (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider          text NOT NULL CHECK (provider IN ('kakao')),
  provider_user_id  text NOT NULL,               -- 카카오 회원번호
  linked_at         timestamptz NOT NULL DEFAULT now(),
  last_login_at     timestamptz,
  UNIQUE (provider, provider_user_id),
  UNIQUE (user_id, provider)
);

-- 서버 측 세션. 쿠키에는 무작위 토큰만, DB에는 SHA-256 해시만 저장한다.
CREATE TABLE auth_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash    bytea NOT NULL UNIQUE,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  actor_kind    text NOT NULL CHECK (actor_kind IN ('customer', 'staff', 'platform_admin')),
  tenant_id     uuid,                            -- 직원 세션이 선택한 업체
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  ip            inet,
  user_agent    text
);
CREATE INDEX auth_sessions_user_idx ON auth_sessions (user_id) WHERE revoked_at IS NULL;

CREATE TABLE tenants (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                     citext NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  name                     text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  business_registration_no text CHECK (business_registration_no ~ '^[0-9]{10}$'),
  representative_name      text,
  contact_email            citext,
  contact_phone            text,
  status                   text NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'active', 'rejected', 'suspended', 'closed')),
  status_reason            text,
  approved_at              timestamptz,
  approved_by              uuid REFERENCES users (id),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER tenants_updated_at BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

ALTER TABLE auth_sessions ADD FOREIGN KEY (tenant_id) REFERENCES tenants (id);

-- 업체 직원과 권한. 'tenant_admin' = 업체 관리자
CREATE TABLE tenant_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants (id),
  user_id     uuid NOT NULL REFERENCES users (id),
  role        text NOT NULL CHECK (role IN ('tenant_admin', 'order_staff', 'menu_staff', 'viewer')),
  can_refund  boolean NOT NULL DEFAULT false,    -- 주문 처리 직원에게 환불 권한을 별도로 부여할 때
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  invited_by  uuid REFERENCES users (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);
CREATE INDEX tenant_members_user_idx ON tenant_members (user_id);
CREATE TRIGGER tenant_members_updated_at BEFORE UPDATE ON tenant_members FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- 요금제와 기능 플래그. 초기에는 'free' 하나만 존재하며 플랫폼 과금은 구현하지 않는다.
CREATE TABLE plans (
  code         text PRIMARY KEY CHECK (code ~ '^[a-z0-9_]+$'),
  name         text NOT NULL,
  description  text,
  is_public    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);
INSERT INTO plans (code, name, description) VALUES ('free', '무료', '초기 무료 운영 요금제. 이용료·주문 수수료 없음');

CREATE TABLE tenant_plans (
  tenant_id        uuid PRIMARY KEY REFERENCES tenants (id),
  plan_code        text NOT NULL REFERENCES plans (code) DEFAULT 'free',
  billing_enabled  boolean NOT NULL DEFAULT false,  -- 플랫폼 과금 미구현: 항상 false
  started_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (billing_enabled = false)
);

CREATE TABLE tenant_features (
  tenant_id    uuid NOT NULL REFERENCES tenants (id),
  feature_key  text NOT NULL CHECK (feature_key ~ '^[a-z0-9_.]+$'),
  enabled      boolean NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, feature_key)
);

CREATE TABLE tenant_settings (
  tenant_id            uuid PRIMARY KEY REFERENCES tenants (id),
  accepting_orders     boolean NOT NULL DEFAULT true,   -- 업체 스스로 주문 접수를 일시 중지
  auto_accept_orders   boolean NOT NULL DEFAULT false,
  order_sound_enabled  boolean NOT NULL DEFAULT true,
  alimtalk_enabled     boolean NOT NULL DEFAULT false,
  alimtalk_events      text[] NOT NULL DEFAULT ARRAY['order_accepted', 'order_ready', 'order_cancelled', 'refund_completed'],
  extra                jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER tenant_settings_updated_at BEFORE UPDATE ON tenant_settings FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- 약관·개인정보 처리방침 버전과 동의 이력
CREATE TABLE terms_documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL CHECK (kind IN ('terms', 'privacy', 'refund_policy', 'alimtalk_consent', 'marketing')),
  version       text NOT NULL,
  title         text NOT NULL,
  body_url      text,
  required      boolean NOT NULL,
  effective_at  timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, version)
);

CREATE TABLE user_consents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  terms_id      uuid NOT NULL REFERENCES terms_documents (id),
  agreed        boolean NOT NULL,
  agreed_at     timestamptz NOT NULL DEFAULT now(),
  withdrawn_at  timestamptz,
  ip            inet
);
CREATE INDEX user_consents_user_idx ON user_consents (user_id);

-- 알림톡 수신 연락처. 카카오 로그인만으로는 확보되지 않으므로 고객이 직접 입력·동의한 경우에만 존재한다.
-- 전화번호는 애플리케이션에서 AES-256-GCM 으로 암호화(phone_enc)하고, 조회용으로 HMAC(phone_hmac)만 저장한다.
CREATE TABLE customer_contacts (
  user_id            uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  phone_enc          bytea NOT NULL,
  phone_hmac         bytea NOT NULL,
  alimtalk_consent   boolean NOT NULL DEFAULT false,
  consented_at       timestamptz,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (alimtalk_consent = false OR consented_at IS NOT NULL)
);
