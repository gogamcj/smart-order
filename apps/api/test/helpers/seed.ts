import type pg from 'pg';
import { asActor, newId, newToken } from './db.js';

export interface SeededTenant {
  tenantId: string;
  storeId: string;
  tableId: string;
  categoryId: string;
  menuId: string;
  optionGroupId: string;
  optionId: string;
  adminUserId: string;
  qrToken: string;
}

let seq = 0;

/** 소유자 연결로 업체 한 곳의 기본 데이터를 만든다 (승인 완료 상태가 기본값). */
export async function seedTenant(db: pg.Client, opts: { status?: string; name?: string } = {}): Promise<SeededTenant> {
  seq += 1;
  const q = async (sql: string, params: unknown[]) => (await db.query(sql, params)).rows[0];
  const admin = await q(`INSERT INTO users (email, display_name) VALUES ($1, $2) RETURNING id`, [
    `owner${seq}-${newId().slice(0, 8)}@example.test`,
    `관리자${seq}`,
  ]);
  const tenant = await q(
    `INSERT INTO tenants (slug, name, status, approved_at) VALUES ($1, $2, $3, CASE WHEN $3 = 'active' THEN now() END) RETURNING id`,
    [`shop-${seq}-${newId().slice(0, 6)}`, opts.name ?? `가게${seq}`, opts.status ?? 'active'],
  );
  await db.query(`INSERT INTO tenant_settings (tenant_id) VALUES ($1)`, [tenant.id]);
  await db.query(`INSERT INTO tenant_plans (tenant_id) VALUES ($1)`, [tenant.id]);
  await db.query(`INSERT INTO tenant_members (tenant_id, user_id, role) VALUES ($1, $2, 'tenant_admin')`, [tenant.id, admin.id]);
  const store = await q(`INSERT INTO stores (tenant_id, name) VALUES ($1, $2) RETURNING id`, [tenant.id, `본점${seq}`]);
  const table = await q(`INSERT INTO store_tables (tenant_id, store_id, label) VALUES ($1, $2, '1') RETURNING id`, [tenant.id, store.id]);
  const qrToken = newToken();
  await db.query(`INSERT INTO qr_codes (tenant_id, table_id, token) VALUES ($1, $2, $3)`, [tenant.id, table.id, qrToken]);
  const cat = await q(`INSERT INTO menu_categories (tenant_id, store_id, name) VALUES ($1, $2, '메인') RETURNING id`, [tenant.id, store.id]);
  const menu = await q(
    `INSERT INTO menus (tenant_id, store_id, category_id, name, price, sale_price) VALUES ($1, $2, $3, '김치찌개', 9000, 8000) RETURNING id`,
    [tenant.id, store.id, cat.id],
  );
  const group = await q(
    `INSERT INTO menu_option_groups (tenant_id, menu_id, name, min_select, max_select) VALUES ($1, $2, '추가', 0, 2) RETURNING id`,
    [tenant.id, menu.id],
  );
  const option = await q(
    `INSERT INTO menu_options (tenant_id, group_id, name, extra_price) VALUES ($1, $2, '공기밥', 1000) RETURNING id`,
    [tenant.id, group.id],
  );
  return {
    tenantId: tenant.id,
    storeId: store.id,
    tableId: table.id,
    categoryId: cat.id,
    menuId: menu.id,
    optionGroupId: group.id,
    optionId: option.id,
    adminUserId: admin.id,
    qrToken,
  };
}

export async function seedCustomer(db: pg.Client): Promise<string> {
  const user = await db.query(`INSERT INTO users (display_name) VALUES ('고객') RETURNING id`);
  const id = user.rows[0].id as string;
  await db.query(`INSERT INTO user_identities (user_id, provider, provider_user_id) VALUES ($1, 'kakao', $2)`, [id, `k-${newId()}`]);
  return id;
}

export interface CreatedOrder {
  orderId: string;
  total: number;
}

/**
 * 고객 권한(qr_app/customer)으로 pending_payment 주문을 만든다.
 * 김치찌개(할인가 8000) + 공기밥(1000) × 2 = 18000원
 */
export async function createPendingOrder(db: pg.Client, t: SeededTenant, customerId: string): Promise<CreatedOrder> {
  return asActor(
    db,
    { role: 'qr_app', actor: 'customer', tenantId: t.tenantId, userId: customerId },
    async (q) => {
      const no = (await q.query(`SELECT app.next_display_no($1, current_date) AS n`, [t.storeId])).rows[0].n;
      const order = await q.query(
        `INSERT INTO orders (tenant_id, store_id, table_id, user_id, order_no, business_date, display_no,
                             store_name_snapshot, table_label_snapshot, subtotal_amount, total_amount, client_request_id)
         VALUES ($1, $2, $3, $4, $5, current_date, $6, '본점', '1', 18000, 18000, $7) RETURNING id`,
        [t.tenantId, t.storeId, t.tableId, customerId, `O-${newId()}`, no, `req-${newId()}`],
      );
      const orderId = order.rows[0].id as string;
      const item = await q.query(
        `INSERT INTO order_items (tenant_id, order_id, menu_id, menu_name_snapshot, list_price_snapshot, unit_price, options_total, quantity, line_total)
         VALUES ($1, $2, $3, '김치찌개', 9000, 8000, 1000, 2, 18000) RETURNING id`,
        [t.tenantId, orderId, t.menuId],
      );
      await q.query(
        `INSERT INTO order_item_options (tenant_id, order_item_id, option_id, group_name_snapshot, option_name_snapshot, extra_price)
         VALUES ($1, $2, $3, '추가', '공기밥', 1000)`,
        [t.tenantId, item.rows[0].id, t.optionId],
      );
      return { orderId, total: 18000 };
    },
    { commit: true },
  );
}

/** 결제 모듈(qr_system)이 하는 일: 결제 요청 생성 → PG 승인 확인 → 결제 완료 → 주문 확정 */
export async function payAndPlace(db: pg.Client, t: SeededTenant, order: CreatedOrder): Promise<string> {
  return asActor(
    db,
    { role: 'qr_system', tenantId: t.tenantId },
    async (q) => {
      const p = await q.query(
        `INSERT INTO payments (tenant_id, order_id, payment_request_id, provider, environment, amount, status)
         VALUES ($1, $2, $3, 'fake', 'test', $4, 'pending') RETURNING id`,
        [t.tenantId, order.orderId, `pay_${newId().replaceAll('-', '')}`, order.total],
      );
      await q.query(
        `UPDATE payments SET status = 'paid', approved_amount = amount, provider_payment_id = $2, approved_at = now(), method = 'card'
         WHERE id = $1`,
        [p.rows[0].id, `fake-${newId()}`],
      );
      await q.query(`UPDATE orders SET status = 'placed' WHERE id = $1`, [order.orderId]);
      return p.rows[0].id as string;
    },
    { commit: true },
  );
}
