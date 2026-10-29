import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { migrateUp } from '../../src/db/migrator.js';

const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';

export interface TestDb {
  name: string;
  owner: pg.Client;          // 마이그레이션·시드용 소유자 연결 (RLS 우회)
  drop: () => Promise<void>;
}

/** 테스트 파일마다 빈 데이터베이스를 만들고 전체 마이그레이션을 적용한다. */
export async function createTestDb(options: { migrate?: boolean } = {}): Promise<TestDb> {
  const name = `qr_test_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();

  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  const owner = new pg.Client({ connectionString: url.toString() });
  await owner.connect();
  if (options.migrate !== false) await migrateUp(owner);

  return {
    name,
    owner,
    drop: async () => {
      await owner.end();
      const a = new pg.Client({ connectionString: ADMIN_URL });
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await a.end();
    },
  };
}

export type ActorContext =
  | { role: 'qr_app'; actor: 'customer' | 'staff' | ''; tenantId?: string; userId?: string }
  | { role: 'qr_system'; tenantId?: string; userId?: string };

/**
 * API 서버가 요청마다 하는 일과 동일하게 트랜잭션 안에서 DB 역할과 요청 컨텍스트를 설정한 뒤 fn 을 실행한다.
 * 기본은 ROLLBACK 이며, commit: true 이면 커밋한다.
 */
export async function asActor<T>(
  client: pg.Client,
  ctx: ActorContext,
  fn: (q: pg.Client) => Promise<T>,
  options: { commit?: boolean } = {},
): Promise<T> {
  await client.query('BEGIN');
  try {
    await client.query(`SET LOCAL ROLE ${ctx.role}`);
    await client.query(
      `SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true), set_config('app.actor_kind', $3, true)`,
      [ctx.tenantId ?? '', ctx.userId ?? '', ctx.role === 'qr_app' ? ctx.actor : 'system'],
    );
    const result = await fn(client);
    await client.query(options.commit ? 'COMMIT' : 'ROLLBACK');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

/** 트랜잭션 안에서 SAVEPOINT 를 두고 실행해 실패를 기대하는 쿼리의 오류 메시지를 돌려준다. */
export async function expectDbError(client: pg.Client, fn: () => Promise<unknown>): Promise<string> {
  await client.query('SAVEPOINT expect_error');
  try {
    await fn();
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT expect_error');
    return (err as Error).message;
  }
  await client.query('RELEASE SAVEPOINT expect_error');
  throw new Error('DB 오류가 발생해야 하지만 성공했습니다');
}

export const newToken = () => randomBytes(32).toString('base64url');
export const newId = () => randomUUID();
