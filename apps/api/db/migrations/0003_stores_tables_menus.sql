-- 0003 매장, 테이블, QR 코드, 미디어 파일, 메뉴
--
-- 업체 간 참조 차단: 자식 테이블은 (부모_id, tenant_id) 복합 외래 키로 부모를 참조한다.
-- 그래서 업체 A의 메뉴가 업체 B의 카테고리·이미지를 가리키는 행은 DB가 거부한다.

CREATE TABLE stores (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants (id),
  name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  address         text,
  phone           text,
  timezone        text NOT NULL DEFAULT 'Asia/Seoul',
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paused', 'inactive')),
  business_hours  jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ "dow": 0-6, "open": "HH:MM", "close": "HH:MM" }]
  logo_media_id   uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id)
);
CREATE INDEX stores_tenant_idx ON stores (tenant_id);
CREATE TRIGGER stores_updated_at BEFORE UPDATE ON stores FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- 요구사항의 'tables'. SQL 예약어와 혼동을 피하려고 store_tables 로 명명한다.
CREATE TABLE store_tables (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  store_id    uuid NOT NULL,
  label       text NOT NULL CHECK (length(label) BETWEEN 1 AND 30),   -- 화면에 보이는 테이블 번호/이름
  sort_order  integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  deleted_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (store_id, tenant_id) REFERENCES stores (id, tenant_id),
  UNIQUE (id, tenant_id)
);
CREATE UNIQUE INDEX store_tables_label_uniq ON store_tables (store_id, label) WHERE deleted_at IS NULL;
CREATE TRIGGER store_tables_updated_at BEFORE UPDATE ON store_tables FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- QR 토큰은 32바이트 이상 무작위 값(base64url 43자 이상). 테이블에 인쇄되어 공개되는 값이므로 평문 저장하되
-- 업체·테이블 ID 를 담지 않아 추측·변조로 다른 매장에 접근할 수 없다.
CREATE TABLE qr_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  table_id    uuid NOT NULL,
  token       text NOT NULL UNIQUE CHECK (token ~ '^[A-Za-z0-9_-]{43,}$'),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_by  uuid REFERENCES users (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz,
  revoked_by  uuid REFERENCES users (id),
  FOREIGN KEY (table_id, tenant_id) REFERENCES store_tables (id, tenant_id),
  CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);
-- 테이블당 유효한 QR 은 하나. 재발급 = 기존 행 revoke + 새 행 insert (같은 트랜잭션)
CREATE UNIQUE INDEX qr_codes_one_active_per_table ON qr_codes (table_id) WHERE status = 'active';

CREATE TABLE media_files (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants (id),
  kind         text NOT NULL CHECK (kind IN ('menu_image', 'store_logo')),
  storage_key  text NOT NULL UNIQUE,              -- tenants/{tenant_id}/{kind}/{random}.webp
  mime_type    text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  byte_size    integer NOT NULL CHECK (byte_size > 0 AND byte_size <= 10485760),
  sha256       bytea NOT NULL,
  width        integer CHECK (width > 0),
  height       integer CHECK (height > 0),
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'deleted')),
  uploaded_by  uuid REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id)
);

ALTER TABLE stores
  ADD FOREIGN KEY (logo_media_id, tenant_id) REFERENCES media_files (id, tenant_id);

CREATE TABLE menu_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  store_id    uuid NOT NULL,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 50),
  sort_order  integer NOT NULL DEFAULT 0,
  is_visible  boolean NOT NULL DEFAULT true,
  deleted_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (store_id, tenant_id) REFERENCES stores (id, tenant_id),
  UNIQUE (id, tenant_id),
  UNIQUE (id, store_id, tenant_id)
);
CREATE TRIGGER menu_categories_updated_at BEFORE UPDATE ON menu_categories FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TABLE menus (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  store_id        uuid NOT NULL,
  category_id     uuid NOT NULL,
  name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  description     text CHECK (length(description) <= 1000),
  price           integer NOT NULL CHECK (price >= 0),          -- 원 단위 정수
  sale_price      integer CHECK (sale_price >= 0),              -- 할인 판매가
  status          text NOT NULL DEFAULT 'on_sale'
                  CHECK (status IN ('on_sale', 'sold_out', 'paused', 'inactive')),  -- 판매 / 품절 / 판매 중지 / 비활성
  is_popular      boolean NOT NULL DEFAULT false,
  sort_order      integer NOT NULL DEFAULT 0,
  image_media_id  uuid,
  deleted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (sale_price IS NULL OR sale_price < price),
  FOREIGN KEY (store_id, tenant_id) REFERENCES stores (id, tenant_id),
  FOREIGN KEY (category_id, store_id, tenant_id) REFERENCES menu_categories (id, store_id, tenant_id),
  FOREIGN KEY (image_media_id, tenant_id) REFERENCES media_files (id, tenant_id),
  UNIQUE (id, tenant_id)
);
CREATE INDEX menus_store_idx ON menus (store_id, category_id, sort_order) WHERE deleted_at IS NULL;
CREATE TRIGGER menus_updated_at BEFORE UPDATE ON menus FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- 메뉴별 판매 가능 시간. 행이 없으면 매장 영업시간 내내 판매 가능
CREATE TABLE menu_availability (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  menu_id      uuid NOT NULL,
  day_of_week  smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time   time NOT NULL,
  end_time     time NOT NULL,
  CHECK (start_time < end_time),
  FOREIGN KEY (menu_id, tenant_id) REFERENCES menus (id, tenant_id) ON DELETE CASCADE
);

CREATE TABLE menu_option_groups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  menu_id     uuid NOT NULL,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 50),
  min_select  integer NOT NULL DEFAULT 0 CHECK (min_select >= 0),
  max_select  integer NOT NULL DEFAULT 1,
  sort_order  integer NOT NULL DEFAULT 0,
  CHECK (max_select >= 1 AND max_select >= min_select),
  FOREIGN KEY (menu_id, tenant_id) REFERENCES menus (id, tenant_id) ON DELETE CASCADE,
  UNIQUE (id, tenant_id)
);

CREATE TABLE menu_options (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  group_id     uuid NOT NULL,
  name         text NOT NULL CHECK (length(name) BETWEEN 1 AND 50),
  extra_price  integer NOT NULL DEFAULT 0 CHECK (extra_price >= 0),
  status       text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'sold_out', 'inactive')),
  sort_order   integer NOT NULL DEFAULT 0,
  FOREIGN KEY (group_id, tenant_id) REFERENCES menu_option_groups (id, tenant_id) ON DELETE CASCADE,
  UNIQUE (id, tenant_id)
);

-- QR 토큰 검증. 고객은 아직 업체 컨텍스트가 없으므로 SECURITY DEFINER 로 토큰 → 업체/매장/테이블만 돌려준다.
-- 업체가 승인·운영 중이고 매장·테이블·QR 이 모두 유효할 때만 행을 반환한다.
CREATE FUNCTION app.resolve_qr_token(p_token text)
RETURNS TABLE (tenant_id uuid, store_id uuid, table_id uuid, table_label text, store_name text, tenant_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT t.id, s.id, st.id, st.label, s.name, t.name
  FROM qr_codes q
  JOIN store_tables st ON st.id = q.table_id AND st.tenant_id = q.tenant_id
  JOIN stores s ON s.id = st.store_id AND s.tenant_id = st.tenant_id
  JOIN tenants t ON t.id = q.tenant_id
  WHERE q.token = p_token
    AND q.status = 'active'
    AND st.is_active AND st.deleted_at IS NULL
    AND s.status <> 'inactive'
    AND t.status = 'active'
$$;
REVOKE ALL ON FUNCTION app.resolve_qr_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_qr_token(text) TO qr_app, qr_system;
