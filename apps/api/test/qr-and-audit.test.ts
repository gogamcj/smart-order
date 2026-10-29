import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asActor, createTestDb, expectDbError, newToken, type TestDb } from './helpers/db.js';
import { seedTenant, type SeededTenant } from './helpers/seed.js';

describe('QR 토큰 검증과 감사 로그', () => {
  let db: TestDb;
  let t: SeededTenant;

  beforeAll(async () => {
    db = await createTestDb();
    t = await seedTenant(db.owner);
  });
  afterAll(async () => db.drop());

  const resolve = (token: string) =>
    asActor(db.owner, { role: 'qr_app', actor: '' }, async (q) => (await q.query(`SELECT * FROM app.resolve_qr_token($1)`, [token])).rows);

  it('유효한 토큰은 업체·매장·테이블로 해석된다', async () => {
    const rows = await resolve(t.qrToken);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenant_id: t.tenantId, store_id: t.storeId, table_id: t.tableId, table_label: '1' });
  });

  it('존재하지 않는 토큰은 아무것도 돌려주지 않는다', async () => {
    expect(await resolve(newToken())).toHaveLength(0);
  });

  it('재발급하면 이전 토큰은 더 이상 쓸 수 없고, 테이블당 유효 QR 은 하나다', async () => {
    const staff = { role: 'qr_app' as const, actor: 'staff' as const, tenantId: t.tenantId, userId: t.adminUserId };
    const fresh = newToken();
    await asActor(db.owner, staff, async (q) => {
      const dup = await expectDbError(q, () => q.query(`INSERT INTO qr_codes (tenant_id, table_id, token) VALUES ($1, $2, $3)`, [t.tenantId, t.tableId, newToken()]));
      expect(dup).toMatch(/qr_codes_one_active_per_table/);
      await q.query(`UPDATE qr_codes SET status = 'revoked', revoked_at = now(), revoked_by = $2 WHERE table_id = $1 AND status = 'active'`, [t.tableId, t.adminUserId]);
      await q.query(`INSERT INTO qr_codes (tenant_id, table_id, token, created_by) VALUES ($1, $2, $3, $4)`, [t.tenantId, t.tableId, fresh, t.adminUserId]);
    }, { commit: true });
    expect(await resolve(t.qrToken)).toHaveLength(0);
    expect(await resolve(fresh)).toHaveLength(1);
    t.qrToken = fresh;
  });

  it('비활성 테이블, 정지된 업체의 QR 은 해석되지 않는다', async () => {
    await db.owner.query(`UPDATE store_tables SET is_active = false WHERE id = $1`, [t.tableId]);
    expect(await resolve(t.qrToken)).toHaveLength(0);
    await db.owner.query(`UPDATE store_tables SET is_active = true WHERE id = $1`, [t.tableId]);
    await db.owner.query(`UPDATE tenants SET status = 'suspended' WHERE id = $1`, [t.tenantId]);
    expect(await resolve(t.qrToken)).toHaveLength(0);
    await db.owner.query(`UPDATE tenants SET status = 'active' WHERE id = $1`, [t.tenantId]);
    expect(await resolve(t.qrToken)).toHaveLength(1);
  });

  it('추측하기 쉬운 짧은 토큰은 저장할 수 없다', async () => {
    await db.owner.query('BEGIN');
    const msg = await expectDbError(db.owner, () =>
      db.owner.query(`INSERT INTO qr_codes (tenant_id, table_id, token) VALUES ($1, $2, 'table-1')`, [t.tenantId, t.tableId]),
    );
    await db.owner.query('ROLLBACK');
    expect(msg).toMatch(/qr_codes_token_check/);
  });

  it('감사 로그는 추가만 가능하고 수정·삭제할 수 없다', async () => {
    await asActor(db.owner, { role: 'qr_system' }, async (q) => {
      const id = (await q.query(`INSERT INTO audit_logs (actor_kind, action) VALUES ('platform_admin', 'tenant.approve') RETURNING id`)).rows[0].id;
      expect(await expectDbError(q, () => q.query(`UPDATE audit_logs SET action = 'x' WHERE id = $1`, [id]))).toMatch(/permission denied|APPEND_ONLY/);
      expect(await expectDbError(q, () => q.query(`DELETE FROM audit_logs WHERE id = $1`, [id]))).toMatch(/permission denied|APPEND_ONLY/);
    });
    await db.owner.query('BEGIN');
    const id = (await db.owner.query(`INSERT INTO audit_logs (actor_kind, action) VALUES ('system', 'x') RETURNING id`)).rows[0].id;
    expect(await expectDbError(db.owner, () => db.owner.query(`DELETE FROM audit_logs WHERE id = $1`, [id]))).toMatch(/APPEND_ONLY/);
    await db.owner.query('ROLLBACK');
  });

  it('플랫폼 과금은 비활성 상태로만 존재한다', async () => {
    await db.owner.query('BEGIN');
    const msg = await expectDbError(db.owner, () => db.owner.query(`UPDATE tenant_plans SET billing_enabled = true WHERE tenant_id = $1`, [t.tenantId]));
    await db.owner.query('ROLLBACK');
    expect(msg).toMatch(/tenant_plans_billing_enabled_check/);
  });
});
