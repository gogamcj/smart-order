-- 0006 행 수준 보안(RLS)과 권한 부여
--
-- qr_app 역할(일반 API) 기본 규칙: tenant_id = app.current_tenant_id()
--   * 컨텍스트가 없으면 아무 행도 보이지 않는다(fail closed).
--   * 고객(actor_kind='customer')은 카탈로그를 읽기만 하고, 주문·결제는 본인 것만 본다.
--   * 직원(actor_kind='staff')은 자기 업체 데이터만 읽고 쓴다. 역할별 세부 권한은 API 가드에서 강제한다.
-- qr_system 역할: 모든 RLS 테이블에 USING (true) 정책. 웹훅·작업 큐·최고 관리자 모듈 전용.

----------------------------------------------------------------------------------------------------
-- 1) 모든 테넌트 관련 테이블에 RLS 활성화 + qr_system 전체 허용 정책
----------------------------------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users', 'user_identities', 'auth_sessions', 'tenants', 'tenant_members', 'tenant_plans', 'tenant_features',
    'tenant_settings', 'user_consents', 'customer_contacts', 'stores', 'store_tables', 'qr_codes', 'media_files',
    'menu_categories', 'menus', 'menu_availability', 'menu_option_groups', 'menu_options', 'outbox_events',
    'store_order_counters', 'orders', 'order_items', 'order_item_options', 'order_status_history',
    'tenant_payment_accounts', 'payments', 'payment_events', 'refunds', 'idempotency_keys',
    'notification_templates', 'notifications', 'audit_logs', 'announcements'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY system_all ON %I TO qr_system USING (true) WITH CHECK (true)', t);
  END LOOP;
END
$$;

----------------------------------------------------------------------------------------------------
-- 2) 카탈로그: 같은 업체의 고객·직원은 읽기, 직원만 쓰기
----------------------------------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'stores', 'store_tables', 'media_files', 'menu_categories', 'menus', 'menu_availability',
    'menu_option_groups', 'menu_options', 'tenant_settings'
  ] LOOP
    EXECUTE format($f$CREATE POLICY tenant_read ON %I FOR SELECT TO qr_app
                      USING (tenant_id = app.current_tenant_id())$f$, t);
    EXECUTE format($f$CREATE POLICY staff_insert ON %I FOR INSERT TO qr_app
                      WITH CHECK (tenant_id = app.current_tenant_id() AND app.is_staff())$f$, t);
    EXECUTE format($f$CREATE POLICY staff_update ON %I FOR UPDATE TO qr_app
                      USING (tenant_id = app.current_tenant_id() AND app.is_staff())
                      WITH CHECK (tenant_id = app.current_tenant_id() AND app.is_staff())$f$, t);
    EXECUTE format($f$CREATE POLICY staff_delete ON %I FOR DELETE TO qr_app
                      USING (tenant_id = app.current_tenant_id() AND app.is_staff())$f$, t);
  END LOOP;
END
$$;

----------------------------------------------------------------------------------------------------
-- 3) 직원 전용: 고객에게는 보이지 않는 업체 데이터
----------------------------------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'qr_codes', 'tenant_features', 'tenant_plans', 'tenant_payment_accounts', 'tenant_members',
    'outbox_events', 'notifications'
  ] LOOP
    EXECUTE format($f$CREATE POLICY staff_all ON %I TO qr_app
                      USING (tenant_id = app.current_tenant_id() AND app.is_staff())
                      WITH CHECK (tenant_id = app.current_tenant_id() AND app.is_staff())$f$, t);
  END LOOP;
END
$$;

----------------------------------------------------------------------------------------------------
-- 4) 개별 정책
----------------------------------------------------------------------------------------------------

-- 업체: 자기 업체 행만. 승인 상태 등은 컬럼 권한으로 qr_app 이 바꿀 수 없다(아래 GRANT 참고).
CREATE POLICY tenant_self_read ON tenants FOR SELECT TO qr_app
  USING (id = app.current_tenant_id());
CREATE POLICY tenant_self_update ON tenants FOR UPDATE TO qr_app
  USING (id = app.current_tenant_id() AND app.is_staff())
  WITH CHECK (id = app.current_tenant_id() AND app.is_staff());

-- 사용자: 본인, 또는 직원이 같은 업체 동료를 조회
CREATE POLICY users_read ON users FOR SELECT TO qr_app
  USING (
    id = app.current_user_id()
    OR (app.is_staff() AND EXISTS (
          SELECT 1 FROM tenant_members m WHERE m.user_id = users.id AND m.tenant_id = app.current_tenant_id()))
  );
CREATE POLICY users_self_update ON users FOR UPDATE TO qr_app
  USING (id = app.current_user_id()) WITH CHECK (id = app.current_user_id());

CREATE POLICY self_all ON user_identities TO qr_app
  USING (user_id = app.current_user_id()) WITH CHECK (user_id = app.current_user_id());
CREATE POLICY self_all ON user_consents TO qr_app
  USING (user_id = app.current_user_id()) WITH CHECK (user_id = app.current_user_id());
CREATE POLICY self_all ON customer_contacts TO qr_app
  USING (user_id = app.current_user_id()) WITH CHECK (user_id = app.current_user_id());

-- 주문: 직원은 자기 업체 주문 전체, 고객은 본인 주문만(업체 무관 본인 주문 내역 조회 포함)
CREATE POLICY orders_read ON orders FOR SELECT TO qr_app
  USING (
    (app.is_staff() AND tenant_id = app.current_tenant_id())
    OR (app.current_actor_kind() = 'customer' AND user_id = app.current_user_id())
  );
CREATE POLICY orders_customer_insert ON orders FOR INSERT TO qr_app
  WITH CHECK (
    app.current_actor_kind() = 'customer'
    AND tenant_id = app.current_tenant_id()
    AND user_id = app.current_user_id()
  );
-- 고객은 주문 상태를 직접 바꿀 수 없다. 결제 확정(pending_payment→placed)은 qr_system 결제 모듈이 수행
CREATE POLICY orders_staff_update ON orders FOR UPDATE TO qr_app
  USING (app.is_staff() AND tenant_id = app.current_tenant_id())
  WITH CHECK (app.is_staff() AND tenant_id = app.current_tenant_id());

-- 주문 하위 데이터: 부모 주문이 보이면 보인다 (orders 의 RLS 가 하위 쿼리에도 적용됨)
CREATE POLICY via_order_read ON order_items FOR SELECT TO qr_app
  USING (EXISTS (SELECT 1 FROM orders o WHERE o.id = order_items.order_id AND o.tenant_id = order_items.tenant_id));
CREATE POLICY customer_insert ON order_items FOR INSERT TO qr_app
  WITH CHECK (
    tenant_id = app.current_tenant_id()
    AND EXISTS (SELECT 1 FROM orders o
                WHERE o.id = order_items.order_id AND o.tenant_id = order_items.tenant_id
                  AND o.user_id = app.current_user_id() AND o.status = 'pending_payment')
  );

CREATE POLICY via_order_read ON order_item_options FOR SELECT TO qr_app
  USING (EXISTS (SELECT 1 FROM order_items oi WHERE oi.id = order_item_options.order_item_id));
CREATE POLICY customer_insert ON order_item_options FOR INSERT TO qr_app
  WITH CHECK (
    tenant_id = app.current_tenant_id()
    AND EXISTS (SELECT 1 FROM order_items oi JOIN orders o ON o.id = oi.order_id
                WHERE oi.id = order_item_options.order_item_id
                  AND o.user_id = app.current_user_id() AND o.status = 'pending_payment')
  );

CREATE POLICY via_order_read ON order_status_history FOR SELECT TO qr_app
  USING (EXISTS (SELECT 1 FROM orders o WHERE o.id = order_status_history.order_id));

CREATE POLICY via_order_read ON payments FOR SELECT TO qr_app
  USING (EXISTS (SELECT 1 FROM orders o WHERE o.id = payments.order_id AND o.tenant_id = payments.tenant_id));

CREATE POLICY via_order_read ON refunds FOR SELECT TO qr_app
  USING (EXISTS (SELECT 1 FROM orders o WHERE o.id = refunds.order_id));
CREATE POLICY staff_insert ON refunds FOR INSERT TO qr_app
  WITH CHECK (app.is_staff() AND tenant_id = app.current_tenant_id() AND requested_kind = 'staff');

CREATE POLICY templates_read ON notification_templates FOR SELECT TO qr_app
  USING (tenant_id IS NULL OR (app.is_staff() AND tenant_id = app.current_tenant_id()));
CREATE POLICY templates_staff_write ON notification_templates FOR INSERT TO qr_app
  WITH CHECK (app.is_staff() AND tenant_id = app.current_tenant_id());

CREATE POLICY audit_insert ON audit_logs FOR INSERT TO qr_app
  WITH CHECK (tenant_id IS NULL OR tenant_id = app.current_tenant_id());
CREATE POLICY audit_staff_read ON audit_logs FOR SELECT TO qr_app
  USING (app.is_staff() AND tenant_id = app.current_tenant_id());

CREATE POLICY published_read ON announcements FOR SELECT TO qr_app
  USING (published_at IS NOT NULL AND published_at <= now());

-- auth_sessions, payment_events, idempotency_keys, store_order_counters: qr_app 정책 없음 → 접근 불가

----------------------------------------------------------------------------------------------------
-- 5) 테이블 권한
----------------------------------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO qr_system;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO qr_system;
REVOKE UPDATE, DELETE ON audit_logs FROM qr_system;

GRANT SELECT ON deployment_info, plans, terms_documents TO qr_app, qr_system;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  stores, store_tables, qr_codes, media_files, menu_categories, menus, menu_availability,
  menu_option_groups, menu_options, tenant_settings, tenant_features, tenant_payment_accounts,
  tenant_members, user_identities, user_consents, customer_contacts
TO qr_app;

GRANT SELECT ON tenants, tenant_plans, outbox_events, order_status_history, payments, announcements TO qr_app;
GRANT UPDATE (name, representative_name, contact_email, contact_phone) ON tenants TO qr_app;
GRANT SELECT ON users TO qr_app;
GRANT UPDATE (display_name) ON users TO qr_app;
GRANT SELECT, INSERT, UPDATE ON orders TO qr_app;
GRANT SELECT, INSERT ON order_items, order_item_options, refunds, notification_templates, audit_logs TO qr_app;
GRANT SELECT, UPDATE ON notifications TO qr_app;
GRANT USAGE, SELECT ON SEQUENCE audit_logs_id_seq TO qr_app;
