import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Client } from 'pg';

export const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../db/migrations');

export interface Migration {
  version: string;
  name: string;
  sql: string;
  checksum: string;
}

export interface MigrationStatus {
  version: string;
  name: string;
  appliedAt: Date | null;
}

const FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export async function loadMigrations(dir = MIGRATIONS_DIR): Promise<Migration[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const migrations: Migration[] = [];
  for (const file of files) {
    const match = FILE_PATTERN.exec(file);
    if (!match) throw new Error(`마이그레이션 파일명 규칙 위반: ${file} (예: 0007_add_column.sql)`);
    const sql = await readFile(path.join(dir, file), 'utf8');
    migrations.push({
      version: match[1]!,
      name: match[2]!,
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
    });
  }
  const versions = new Set(migrations.map((m) => m.version));
  if (versions.size !== migrations.length) throw new Error('중복된 마이그레이션 버전이 있습니다');
  return migrations;
}

async function ensureTable(client: Client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    text PRIMARY KEY,
      name       text NOT NULL,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
}

/**
 * 적용되지 않은 마이그레이션을 버전 순서대로 각각 하나의 트랜잭션에서 실행한다.
 * 이미 적용된 파일의 내용이 바뀌었으면(체크섬 불일치) 아무것도 실행하지 않고 중단한다.
 * 동시에 두 서버가 배포되어도 advisory lock 으로 한 번만 실행된다.
 */
export async function migrateUp(client: Client, dir = MIGRATIONS_DIR): Promise<string[]> {
  const migrations = await loadMigrations(dir);
  await client.query('SELECT pg_advisory_lock(hashtext($1))', ['qr_order_schema_migrations']);
  try {
    await ensureTable(client);
    const { rows } = await client.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM schema_migrations',
    );
    const applied = new Map(rows.map((r) => [r.version, r.checksum]));
    for (const m of migrations) {
      const checksum = applied.get(m.version);
      if (checksum && checksum !== m.checksum) {
        throw new Error(`이미 적용된 마이그레이션 ${m.version}_${m.name} 의 내용이 변경되었습니다. 새 마이그레이션 파일로 변경하세요.`);
      }
    }
    const done: string[] = [];
    for (const m of migrations) {
      if (applied.has(m.version)) continue;
      await client.query('BEGIN');
      try {
        await client.query(m.sql);
        await client.query('INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)', [
          m.version,
          m.name,
          m.checksum,
        ]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`마이그레이션 ${m.version}_${m.name} 실패: ${(err as Error).message}`);
      }
      done.push(`${m.version}_${m.name}`);
    }
    return done;
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', ['qr_order_schema_migrations']);
  }
}

export async function migrationStatus(client: Client, dir = MIGRATIONS_DIR): Promise<MigrationStatus[]> {
  const migrations = await loadMigrations(dir);
  await ensureTable(client);
  const { rows } = await client.query<{ version: string; applied_at: Date }>(
    'SELECT version, applied_at FROM schema_migrations',
  );
  const applied = new Map(rows.map((r) => [r.version, r.applied_at]));
  return migrations.map((m) => ({ version: m.version, name: m.name, appliedAt: applied.get(m.version) ?? null }));
}
