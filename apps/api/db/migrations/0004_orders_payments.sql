-- 0004 주문, 주문 스냅샷, 상태 이력, 결제, 결제 이벤트, 환불, 업체 결제 계정, 멱등성 키
--
-- 원칙
--  * 주문 상태(orders.status)와 결제 상태(payments.status)는 분리한다.
--  * 'pending_payment' 주문은 업체 화면에 보이지 않는다. 승인 금액이 확인된 결제가 있어야만 'placed' 로 바뀐다(트리거로 강제).
--  * 금액은 원 단위 integer. 주문 당시 메뉴명·단가·옵션은 스냅샷으로 보관한다.

CREATE TABLE outbox_events (
  id           bigserial PRIMARY KEY,           -- SSE 이벤트 ID 로도 사용 (Last-Event-ID 재전송)
  tenant_id    uuid NOT NULL REFERENCES tenants (id),
  store_id     uuid,
  order_id     uuid,
  event_type   text NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
CREATE INDEX outbox_events_unpublished_idx ON outbox_events (id) WHERE published_at IS NULL;
CREATE INDEX outbox_events_tenant_idx ON outbox_events (tenant_id, id);
CREATE INDEX outbox_events_order_idx ON outbox_events (order_id, id);

-- 매장·영업일별 화면 표시 번호(1, 2, 3 ...) 발급용 카운터
CREATE TABLE store_order_counters (
  store_id       uuid NOT NULL REFERENCES stores (id),
  business_date  date NOT NULL,
  last_no        integer NOT NULL,
  PRIMARY KEY (store_id, business_date)
);

CREATE TABLE orders (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL,
  store_id              uuid NOT NULL,
  table_id              uuid NOT NULL,
  user_id               uuid REFERENCES users (id),          -- 주문 고객
  order_no              text NOT NULL UNIQUE,                -- 외부 노출용 주문 번호 (예: 261029-7K3QH2)
  business_date         date NOT NULL,
  display_no            integer NOT NULL CHECK (display_no > 0),
  store_name_snapshot   text NOT NULL,
  table_label_snapshot  text NOT NULL,
  status                text NOT NULL DEFAULT 'pending_payment'
                        CHECK (status IN ('pending_payment', 'placed', 'accepted', 'preparing', 'ready',
                                          'completed', 'rejected', 'cancelled', 'expired')),
  subtotal_amount       integer NOT NULL CHECK (subtotal_amount >= 0),
  discount_amount       integer NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  total_amount          integer NOT NULL CHECK (total_amount > 0),
  customer_request      text CHECK (length(customer_request) <= 500),
  client_request_id     text NOT NULL CHECK (length(client_request_id) BETWEEN 8 AND 100),  -- 중복 주문 방지 키
  version               integer NOT NULL DEFAULT 1,          -- 낙관적 잠금
  expires_at            timestamptz NOT NULL DEFAULT now() + interval '30 minutes',
  placed_at             timestamptz,
  accepted_at           timestamptz,
  ready_at              timestamptz,
  completed_at          timestamptz,
  cancelled_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (total_amount = subtotal_amount - discount_amount),
  FOREIGN KEY (store_id, tenant_id) REFERENCES stores (id, tenant_id),
  FOREIGN KEY (table_id, tenant_id) REFERENCES store_tables (id, tenant_id),
  UNIQUE (store_id, business_date, display_no),
  UNIQUE (user_id, client_request_id),
  UNIQUE (id, tenant_id)
);
CREATE INDEX orders_board_idx ON orders (tenant_id, store_id, status, placed_at) WHERE status <> 'pending_payment';
CREATE INDEX orders_user_idx ON orders (user_id, created_at DESC);
CREATE INDEX orders_period_idx ON orders (tenant_id, business_date);
CREATE INDEX orders_pending_expiry_idx ON orders (expires_at) WHERE status = 'pending_payment';

CREATE TABLE order_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL,
  order_id              uuid NOT NULL,
  menu_id               uuid,                       -- 참조용. 메뉴가 바뀌어도 아래 스냅샷이 기준
  menu_name_snapshot    text NOT NULL,
  list_price_snapshot   integer NOT NULL CHECK (list_price_snapshot >= 0),
  unit_price            integer NOT NULL CHECK (unit_price >= 0),     -- 실제 적용 단가 (할인가 반영)
  options_total         integer NOT NULL DEFAULT 0 CHECK (options_total >= 0),  -- 1개당 옵션 추가금 합
  quantity              integer NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  line_total            integer NOT NULL,
  CHECK (line_total = (unit_price + options_total) * quantity),
  FOREIGN KEY (order_id, tenant_id) REFERENCES orders (id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (menu_id, tenant_id) REFERENCES menus (id, tenant_id),
  UNIQUE (id, tenant_id)
);
CREATE INDEX order_items_order_idx ON order_items (order_id);

CREATE TABLE order_item_options (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL,
  order_item_id         uuid NOT NULL,
  option_id             uuid,
  group_name_snapshot   text NOT NULL,
  option_name_snapshot  text NOT NULL,
  extra_price           integer NOT NULL CHECK (extra_price >= 0),
  FOREIGN KEY (order_item_id, tenant_id) REFERENCES order_items (id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (option_id, tenant_id) REFERENCES menu_options (id, tenant_id)
);
CREATE INDEX order_item_options_item_idx ON order_item_options (order_item_id);

CREATE TABLE order_status_history (
  id             bigserial PRIMARY KEY,
  tenant_id      uuid NOT NULL,
  order_id       uuid NOT NULL,
  from_status    text,
  to_status      text NOT NULL,
  actor_user_id  uuid,
  actor_kind     text NOT NULL,          -- customer / staff / system / platform_admin
  reason         text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (order_id, tenant_id) REFERENCES orders (id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX order_status_history_order_idx ON order_status_history (order_id, id);

-- 업체별 PG 가맹점 정보. 비밀 키는 평문으로 두지 않고 암호화 값 또는 비밀 저장소 참조만 둔다.
CREATE TABLE tenant_payment_accounts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants (id),
  provider          text NOT NULL CHECK (provider IN ('portone', 'tosspayments', 'kakaopay')),
  environment       text NOT NULL CHECK (environment IN ('test', 'live')),
  merchant_ref      text NOT NULL,      -- 상점 ID / 채널 키 등 비밀이 아닌 식별값
  secret_enc        bytea,              -- AES-256-GCM 암호문 (키는 서버 환경변수/KMS)
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'disabled')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider, environment)
);

CREATE TABLE payments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  order_id             uuid NOT NULL,
  payment_request_id   text NOT NULL UNIQUE CHECK (length(payment_request_id) BETWEEN 16 AND 64),  -- 우리가 발급, PG 에 전달
  provider             text NOT NULL CHECK (provider IN ('portone', 'tosspayments', 'kakaopay', 'fake')),
  environment          text NOT NULL CHECK (environment IN ('test', 'live')),
  provider_payment_id  text,                    -- PG 거래 ID
  method               text CHECK (method IN ('card', 'easy_pay', 'kakaopay', 'transfer', 'virtual_account')),
  easy_pay_provider    text,
  amount               integer NOT NULL CHECK (amount > 0),   -- 서버가 계산한 청구 금액
  approved_amount      integer CHECK (approved_amount >= 0),  -- PG 가 승인했다고 확인된 금액
  refunded_amount      integer NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0),
  currency             text NOT NULL DEFAULT 'KRW' CHECK (currency = 'KRW'),
  status               text NOT NULL DEFAULT 'ready'
                       CHECK (status IN ('ready', 'pending', 'paid', 'failed', 'cancelled',
                                         'partial_refunded', 'refunded', 'expired')),
  failure_code         text,
  failure_message      text,
  version              integer NOT NULL DEFAULT 1,
  requested_at         timestamptz NOT NULL DEFAULT now(),
  approved_at          timestamptz,
  failed_at            timestamptz,
  last_synced_at       timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  -- 승인 금액이 주문 청구 금액과 다르면 '결제 완료' 상태가 될 수 없다
  CHECK (status NOT IN ('paid', 'partial_refunded', 'refunded')
         OR (approved_amount = amount AND provider_payment_id IS NOT NULL AND approved_at IS NOT NULL)),
  CHECK (refunded_amount <= coalesce(approved_amount, 0)),
  FOREIGN KEY (order_id, tenant_id) REFERENCES orders (id, tenant_id),
  UNIQUE (provider, provider_payment_id),
  UNIQUE (id, tenant_id)
);
-- 주문 하나에 결제 완료 건은 하나뿐 (이중 결제 차단)
CREATE UNIQUE INDEX payments_one_captured_per_order ON payments (order_id)
  WHERE status IN ('paid', 'partial_refunded', 'refunded');
CREATE INDEX payments_reconcile_idx ON payments (status, requested_at) WHERE status IN ('ready', 'pending');
CREATE TRIGGER payments_updated_at BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- PG 웹훅·승인 조회·대사 결과를 원본 그대로(민감정보 제거 후) 쌓는다. 같은 웹훅 재수신은 UNIQUE 로 걸러진다.
CREATE TABLE payment_events (
  id                  bigserial PRIMARY KEY,
  tenant_id           uuid REFERENCES tenants (id),   -- 매칭 전 웹훅은 NULL
  payment_id          uuid REFERENCES payments (id),
  provider            text NOT NULL,
  source              text NOT NULL CHECK (source IN ('webhook', 'confirm', 'reconcile', 'client_return', 'admin')),
  provider_event_id   text,                            -- 웹훅 고유 ID (webhook-id 헤더 등)
  event_type          text NOT NULL,
  signature_verified  boolean NOT NULL DEFAULT false,
  payload             jsonb NOT NULL,
  processing_status   text NOT NULL DEFAULT 'received'
                      CHECK (processing_status IN ('received', 'processed', 'ignored', 'failed')),
  attempts            integer NOT NULL DEFAULT 0,
  error               text,
  received_at         timestamptz NOT NULL DEFAULT now(),
  processed_at        timestamptz,
  UNIQUE (provider, provider_event_id)
);
CREATE INDEX payment_events_retry_idx ON payment_events (received_at) WHERE processing_status IN ('received', 'failed');

CREATE TABLE refunds (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  payment_id          uuid NOT NULL,
  order_id            uuid NOT NULL,
  amount              integer NOT NULL CHECK (amount > 0),
  reason              text NOT NULL CHECK (length(reason) BETWEEN 1 AND 200),
  status              text NOT NULL DEFAULT 'requested'
                      CHECK (status IN ('requested', 'processing', 'succeeded', 'failed')),
  idempotency_key     text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 100),
  provider_refund_id  text,
  requested_by        uuid REFERENCES users (id),
  requested_kind      text NOT NULL DEFAULT 'staff' CHECK (requested_kind IN ('staff', 'system', 'platform_admin')),
  failure_message     text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz,
  FOREIGN KEY (payment_id, tenant_id) REFERENCES payments (id, tenant_id),
  FOREIGN KEY (order_id, tenant_id) REFERENCES orders (id, tenant_id),
  UNIQUE (payment_id, idempotency_key)
);
CREATE INDEX refunds_payment_idx ON refunds (payment_id);

-- API 수준 멱등성 키 (결제 요청, 환불 요청 등). 시스템 역할만 접근
CREATE TABLE idempotency_keys (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope          text NOT NULL,          -- 예: 'POST /api/payments'
  principal      text NOT NULL,          -- 예: 'user:<uuid>'
  key            text NOT NULL CHECK (length(key) BETWEEN 8 AND 100),
  request_hash   bytea NOT NULL,         -- 같은 키로 다른 본문을 보내면 409
  status         text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
  response_code  integer,
  response_body  jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  UNIQUE (scope, principal, key)
);

----------------------------------------------------------------------------------------------------
-- 함수와 트리거
----------------------------------------------------------------------------------------------------

-- 매장 화면 표시 번호 발급. 현재 업체 컨텍스트의 매장만 허용
CREATE FUNCTION app.next_display_no(p_store_id uuid, p_business_date date) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_no integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM stores WHERE id = p_store_id AND tenant_id = app.current_tenant_id()) THEN
    RAISE EXCEPTION 'STORE_NOT_IN_TENANT' USING ERRCODE = '42501';
  END IF;
  INSERT INTO store_order_counters AS c (store_id, business_date, last_no)
  VALUES (p_store_id, p_business_date, 1)
  ON CONFLICT (store_id, business_date) DO UPDATE SET last_no = c.last_no + 1
  RETURNING last_no INTO v_no;
  RETURN v_no;
END
$$;
REVOKE ALL ON FUNCTION app.next_display_no(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.next_display_no(uuid, date) TO qr_app, qr_system;

-- 주문 상태 전이 규칙. 이 표 밖의 전이는 모두 거부된다.
CREATE FUNCTION app.allowed_order_transitions(p_from text) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_from
    WHEN 'pending_payment' THEN ARRAY['placed', 'expired', 'cancelled']
    WHEN 'placed'          THEN ARRAY['accepted', 'rejected', 'cancelled']
    WHEN 'accepted'        THEN ARRAY['preparing', 'ready', 'cancelled']
    WHEN 'preparing'       THEN ARRAY['ready', 'cancelled']
    WHEN 'ready'           THEN ARRAY['completed', 'cancelled']
    ELSE ARRAY[]::text[]   -- completed, rejected, cancelled, expired 는 종료 상태
  END
$$;

CREATE FUNCTION app.orders_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending_payment' THEN
      RAISE EXCEPTION 'ORDER_MUST_START_PENDING_PAYMENT' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM tenants t
      JOIN tenant_settings ts ON ts.tenant_id = t.id
      JOIN stores s ON s.tenant_id = t.id AND s.id = NEW.store_id
      WHERE t.id = NEW.tenant_id AND t.status = 'active' AND ts.accepting_orders AND s.status = 'open'
    ) THEN
      RAISE EXCEPTION 'TENANT_NOT_ACCEPTING_ORDERS' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  -- 주문 생성 후 금액·소유 관계는 바꿀 수 없다
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.store_id <> OLD.store_id OR NEW.table_id <> OLD.table_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.total_amount <> OLD.total_amount
     OR NEW.subtotal_amount <> OLD.subtotal_amount OR NEW.discount_amount <> OLD.discount_amount
     OR NEW.order_no <> OLD.order_no THEN
    RAISE EXCEPTION 'ORDER_IMMUTABLE_FIELDS' USING ERRCODE = '23514';
  END IF;

  IF NEW.status <> OLD.status THEN
    IF NOT (NEW.status = ANY (app.allowed_order_transitions(OLD.status))) THEN
      RAISE EXCEPTION 'INVALID_ORDER_TRANSITION %->%', OLD.status, NEW.status USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'placed' AND NOT EXISTS (
      SELECT 1 FROM payments p
      WHERE p.order_id = NEW.id AND p.status = 'paid' AND p.approved_amount = NEW.total_amount
    ) THEN
      RAISE EXCEPTION 'ORDER_NOT_PAID' USING ERRCODE = '23514';
    END IF;
    CASE NEW.status
      WHEN 'placed'    THEN NEW.placed_at := now();
      WHEN 'accepted'  THEN NEW.accepted_at := now();
      WHEN 'ready'     THEN NEW.ready_at := now();
      WHEN 'completed' THEN NEW.completed_at := now();
      WHEN 'cancelled', 'rejected', 'expired' THEN NEW.cancelled_at := now();
      ELSE NULL;
    END CASE;
  END IF;

  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

CREATE TRIGGER orders_guard BEFORE INSERT OR UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION app.orders_guard();

-- 상태 이력과 실시간 이벤트를 주문 변경과 같은 트랜잭션에서 기록한다 (아웃박스 패턴)
CREATE FUNCTION app.orders_record_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_from text := CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END;
  v_actor_kind text := coalesce(nullif(app.current_actor_kind(), ''), 'system');
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status = OLD.status THEN
    RETURN NULL;
  END IF;
  INSERT INTO order_status_history (tenant_id, order_id, from_status, to_status, actor_user_id, actor_kind, reason)
  VALUES (NEW.tenant_id, NEW.id, v_from, NEW.status, app.current_user_id(), v_actor_kind,
          nullif(current_setting('app.status_reason', true), ''));
  INSERT INTO outbox_events (tenant_id, store_id, order_id, event_type, payload)
  VALUES (NEW.tenant_id, NEW.store_id, NEW.id, 'order.status_changed',
          jsonb_build_object('orderId', NEW.id, 'orderNo', NEW.order_no, 'displayNo', NEW.display_no,
                             'tableId', NEW.table_id, 'from', v_from, 'to', NEW.status, 'version', NEW.version));
  RETURN NULL;
END
$$;

CREATE TRIGGER orders_record_change AFTER INSERT OR UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION app.orders_record_change();

-- 테스트 결제가 운영 DB 로, 실결제가 테스트 DB 로 들어가지 않도록 차단
CREATE FUNCTION app.payments_environment_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_env text := (SELECT environment FROM deployment_info);
BEGIN
  IF (v_env = 'production') <> (NEW.environment = 'live') THEN
    RAISE EXCEPTION 'PAYMENT_ENVIRONMENT_MISMATCH db=% payment=%', v_env, NEW.environment USING ERRCODE = '23514';
  END IF;
  IF NEW.provider = 'fake' AND v_env = 'production' THEN
    RAISE EXCEPTION 'FAKE_PROVIDER_NOT_ALLOWED' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.amount <> OLD.amount OR NEW.order_id <> OLD.order_id OR NEW.tenant_id <> OLD.tenant_id
       OR NEW.payment_request_id <> OLD.payment_request_id THEN
      RAISE EXCEPTION 'PAYMENT_IMMUTABLE_FIELDS' USING ERRCODE = '23514';
    END IF;
    NEW.version := OLD.version + 1;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER payments_environment_guard BEFORE INSERT OR UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION app.payments_environment_guard();

-- 환불 한도 검사. 결제 행을 FOR UPDATE 로 잠가 동시 환불 요청을 직렬화한다.
CREATE FUNCTION app.refunds_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_payment payments%ROWTYPE;
  v_reserved integer;
BEGIN
  SELECT * INTO v_payment FROM payments WHERE id = NEW.payment_id FOR UPDATE;
  IF v_payment.tenant_id <> NEW.tenant_id OR v_payment.order_id <> NEW.order_id THEN
    RAISE EXCEPTION 'REFUND_PAYMENT_MISMATCH' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- 같은 멱등성 키로 재시도한 요청은 한도 검사를 건너뛰고 UNIQUE 제약(ON CONFLICT)이 처리하게 둔다
    IF EXISTS (SELECT 1 FROM refunds WHERE payment_id = NEW.payment_id AND idempotency_key = NEW.idempotency_key) THEN
      RETURN NEW;
    END IF;
    IF v_payment.status NOT IN ('paid', 'partial_refunded') THEN
      RAISE EXCEPTION 'PAYMENT_NOT_REFUNDABLE status=%', v_payment.status USING ERRCODE = '23514';
    END IF;
    SELECT coalesce(sum(amount), 0) INTO v_reserved
    FROM refunds WHERE payment_id = NEW.payment_id AND status IN ('requested', 'processing', 'succeeded');
    IF v_reserved + NEW.amount > v_payment.approved_amount THEN
      RAISE EXCEPTION 'REFUND_EXCEEDS_PAYMENT requested=% available=%',
        NEW.amount, v_payment.approved_amount - v_reserved USING ERRCODE = '23514';
    END IF;
    IF NEW.status <> 'requested' THEN
      RAISE EXCEPTION 'REFUND_MUST_START_REQUESTED' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.amount <> OLD.amount OR NEW.payment_id <> OLD.payment_id THEN
    RAISE EXCEPTION 'REFUND_IMMUTABLE_FIELDS' USING ERRCODE = '23514';
  END IF;
  IF OLD.status IN ('succeeded', 'failed') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'REFUND_ALREADY_FINAL' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'succeeded' AND OLD.status <> 'succeeded' THEN
    NEW.completed_at := now();
    UPDATE payments
       SET refunded_amount = refunded_amount + NEW.amount,
           status = CASE WHEN refunded_amount + NEW.amount = approved_amount THEN 'refunded' ELSE 'partial_refunded' END
     WHERE id = NEW.payment_id;
  ELSIF NEW.status = 'failed' AND OLD.status <> 'failed' THEN
    NEW.completed_at := now();
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER refunds_guard BEFORE INSERT OR UPDATE ON refunds
  FOR EACH ROW EXECUTE FUNCTION app.refunds_guard();
