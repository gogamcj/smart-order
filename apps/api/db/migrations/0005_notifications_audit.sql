-- 0005 알림 템플릿, 알림 발송 기록, 감사 로그, 서비스 공지

CREATE TABLE notification_templates (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid REFERENCES tenants (id),   -- NULL = 플랫폼 공통 템플릿
  code                    text NOT NULL CHECK (code IN ('order_accepted', 'order_ready', 'order_cancelled', 'refund_completed')),
  channel                 text NOT NULL CHECK (channel IN ('alimtalk', 'sms')),
  version                 integer NOT NULL CHECK (version > 0),
  provider_template_code  text,                 -- 비즈메시지 제공업체에 등록·승인된 템플릿 코드
  body                    text NOT NULL,
  buttons                 jsonb NOT NULL DEFAULT '[]'::jsonb,
  status                  text NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'retired')),
  approved_at             timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (tenant_id, code, channel, version),
  CHECK (status <> 'approved' OR (approved_at IS NOT NULL AND (channel <> 'alimtalk' OR provider_template_code IS NOT NULL)))
);

CREATE TABLE notifications (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  order_id             uuid,
  user_id              uuid REFERENCES users (id),
  template_id          uuid REFERENCES notification_templates (id),
  channel              text NOT NULL CHECK (channel IN ('alimtalk', 'sms')),
  event_code           text NOT NULL,
  dedupe_key           text NOT NULL UNIQUE,     -- 예: '<order_id>:order_ready:alimtalk' → 같은 알림 중복 발송 차단
  recipient_hmac       bytea,                    -- 연락처 원문은 저장하지 않음. 발송 시점에 customer_contacts 에서 복호화
  status               text NOT NULL DEFAULT 'queued'
                       CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'skipped')),
  skip_reason          text,                     -- no_contact / no_consent / template_not_approved / disabled ...
  attempts             integer NOT NULL DEFAULT 0,
  max_attempts         integer NOT NULL DEFAULT 5,
  next_attempt_at      timestamptz NOT NULL DEFAULT now(),
  provider_message_id  text,
  error_code           text,
  error_message        text,
  fallback_of          uuid REFERENCES notifications (id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  sent_at              timestamptz,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (order_id, tenant_id) REFERENCES orders (id, tenant_id)
);
CREATE INDEX notifications_due_idx ON notifications (next_attempt_at) WHERE status IN ('queued', 'failed');
CREATE INDEX notifications_order_idx ON notifications (order_id);
CREATE TRIGGER notifications_updated_at BEFORE UPDATE ON notifications FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- 감사 로그: 추가만 가능. 수정·삭제는 트리거로 거부 (보존 기간 만료 삭제는 별도 운영 절차)
CREATE TABLE audit_logs (
  id             bigserial PRIMARY KEY,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  actor_user_id  uuid,
  actor_kind     text NOT NULL CHECK (actor_kind IN ('customer', 'staff', 'platform_admin', 'system')),
  tenant_id      uuid REFERENCES tenants (id),
  action         text NOT NULL,          -- 예: 'tenant.approve', 'order.refund', 'menu.update'
  target_type    text,
  target_id      text,
  ip             inet,
  request_id     text,
  details        jsonb NOT NULL DEFAULT '{}'::jsonb    -- 민감정보(카드번호, 토큰, 전화번호 원문) 금지
);
CREATE INDEX audit_logs_tenant_idx ON audit_logs (tenant_id, occurred_at DESC);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_user_id, occurred_at DESC);

CREATE FUNCTION app.audit_logs_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AUDIT_LOG_IS_APPEND_ONLY' USING ERRCODE = '42501';
END
$$;
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION app.audit_logs_append_only();

CREATE TABLE announcements (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audience      text NOT NULL CHECK (audience IN ('tenants', 'customers', 'all')),
  title         text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body          text NOT NULL,
  published_at  timestamptz,
  created_by    uuid REFERENCES users (id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
