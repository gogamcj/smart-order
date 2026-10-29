import { mkdtemp, writeFile, copyFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, migrateUp, migrationStatus } from '../src/db/migrator.js';
import { createTestDb, type TestDb } from './helpers/db.js';

describe('DB 마이그레이션', () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await createTestDb({ migrate: false });
  });
  afterAll(async () => db.drop());

  it('빈 데이터베이스에 전체 마이그레이션을 순서대로 적용한다 (신규 설치)', async () => {
    const applied = await migrateUp(db.owner);
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql'));
    expect(applied).toHaveLength(files.length);
    const status = await migrationStatus(db.owner);
    expect(status.every((s) => s.appliedAt !== null)).toBe(true);
  });

  it('다시 실행하면 아무것도 적용하지 않는다 (멱등)', async () => {
    expect(await migrateUp(db.owner)).toEqual([]);
  });

  it('새 마이그레이션 파일만 추가로 적용한다 (기존 버전 업데이트)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mig-'));
    for (const f of await readdir(MIGRATIONS_DIR)) await copyFile(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
    await writeFile(path.join(dir, '9999_test_add_column.sql'), 'ALTER TABLE stores ADD COLUMN test_note text;');
    expect(await migrateUp(db.owner, dir)).toEqual(['9999_test_add_column']);
  });

  it('이미 적용된 파일 내용이 바뀌면 실행을 거부한다', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mig-'));
    for (const f of await readdir(MIGRATIONS_DIR)) await copyFile(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
    await writeFile(path.join(dir, '9999_test_add_column.sql'), 'ALTER TABLE stores ADD COLUMN changed text;');
    await expect(migrateUp(db.owner, dir)).rejects.toThrow(/내용이 변경되었습니다/);
  });

  it('실패한 마이그레이션은 롤백되고 기록되지 않는다', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mig-'));
    for (const f of await readdir(MIGRATIONS_DIR)) await copyFile(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
    await writeFile(path.join(dir, '9999_test_add_column.sql'), 'ALTER TABLE stores ADD COLUMN test_note text;');
    await writeFile(path.join(dir, '9998_broken.sql'), 'CREATE TABLE half_done (id int); SELECT * FROM no_such_table;');
    await expect(migrateUp(db.owner, dir)).rejects.toThrow(/9998_broken/);
    const { rows } = await db.owner.query(`SELECT to_regclass('half_done') AS t`);
    expect(rows[0].t).toBeNull();
  });

  it('모든 업체 소유 테이블에 RLS 가 켜져 있다', async () => {
    const { rows } = await db.owner.query(`
      SELECT c.relname FROM pg_class c
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
      WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND NOT c.relrowsecurity`);
    expect(rows.map((r) => r.relname)).toEqual([]);
  });
});
