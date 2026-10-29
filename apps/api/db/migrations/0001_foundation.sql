-- 0001 기반: 확장, DB 역할, 요청 컨텍스트 헬퍼 함수
--
-- DB 역할 모델 (docs/03-tenancy-and-permissions.md 참고)
--   qr_app    : 일반 API 요청용. RLS가 강제되며 요청마다 app.tenant_id / app.user_id / app.actor_kind 를 SET LOCAL 한다.
--   qr_system : 웹훅, 결제 확정, 대사, 작업 큐, 최고 관리자 모듈 전용. 정책상 전체 행 접근 (BYPASSRLS 속성 없이 정책으로 허용).
-- 두 역할 모두 NOLOGIN 그룹 역할이며, 실제 로그인 계정은 운영자가 만들어 GRANT qr_app TO <login> 으로 연결한다.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qr_app') THEN
    CREATE ROLE qr_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qr_system') THEN
    CREATE ROLE qr_system NOLOGIN;
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS app;
GRANT USAGE ON SCHEMA app TO qr_app, qr_system;
GRANT USAGE ON SCHEMA public TO qr_app, qr_system;

-- 요청 컨텍스트. SET LOCAL 이 끝난 뒤 current_setting 은 '' 를 돌려주므로 nullif 로 NULL 처리한다.
CREATE FUNCTION app.current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE FUNCTION app.current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;

-- 'customer' | 'staff' | '' . 업체 직원 세부 권한(주문/메뉴/조회 전용)은 API 계층에서 강제한다.
CREATE FUNCTION app.current_actor_kind() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.actor_kind', true), '')
$$;

CREATE FUNCTION app.is_staff() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.current_actor_kind() = 'staff'
$$;

CREATE FUNCTION app.set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

-- 배포 환경 표시 (local / staging / production). 테스트 결제가 운영 DB에 들어가지 않도록 결제 트리거에서 확인한다.
CREATE TABLE deployment_info (
  singleton   boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  environment text NOT NULL CHECK (environment IN ('local', 'staging', 'production')),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO deployment_info (environment) VALUES ('local');
