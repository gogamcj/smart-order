import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import pg from 'pg';
import { ENV, type Env } from '../config/env.js';
import type { DB } from './schema.js';

// bigint(int8)·numeric 은 문자열로 받고, date 는 'YYYY-MM-DD' 문자열 그대로 둔다
pg.types.setTypeParser(1082, (v) => v);

export type Tx = Transaction<DB>;

export interface ActorContext {
  actor: 'customer' | 'staff' | '';
  tenantId?: string | null;
  userId?: string | null;
}

export interface SystemContext {
  tenantId?: string | null;
  userId?: string | null;
  // 주문 상태 이력의 actor_kind 로 기록된다
  actorKind?: 'system' | 'customer' | 'staff' | 'platform_admin';
  statusReason?: string | null;
}

/**
 * 모든 DB 접근은 트랜잭션 안에서 DB 역할과 요청 컨텍스트를 설정한 뒤 실행한다.
 *  - asActor: qr_app 역할, RLS 적용 (일반 API)
 *  - asSystem: qr_system 역할 (로그인 처리, 결제 확정, 업체 가입, 최고 관리자 등 서버 내부 작업)
 */
@Injectable()
export class Database implements OnModuleDestroy {
  private readonly app: Kysely<DB>;
  private readonly system: Kysely<DB>;

  constructor(@Inject(ENV) env: Env) {
    this.app = new Kysely<DB>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: env.DATABASE_URL, max: 10 }) }) });
    this.system = new Kysely<DB>({
      dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: env.DATABASE_SYSTEM_URL, max: 5 }) }),
    });
  }

  asActor<T>(ctx: ActorContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.app.transaction().execute(async (tx) => {
      await sql`SET LOCAL ROLE qr_app`.execute(tx);
      await sql`SELECT set_config('app.tenant_id', ${ctx.tenantId ?? ''}, true),
                       set_config('app.user_id', ${ctx.userId ?? ''}, true),
                       set_config('app.actor_kind', ${ctx.actor}, true)`.execute(tx);
      return fn(tx);
    });
  }

  asSystem<T>(ctx: SystemContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.system.transaction().execute(async (tx) => {
      await sql`SET LOCAL ROLE qr_system`.execute(tx);
      await sql`SELECT set_config('app.tenant_id', ${ctx.tenantId ?? ''}, true),
                       set_config('app.user_id', ${ctx.userId ?? ''}, true),
                       set_config('app.actor_kind', ${ctx.actorKind ?? 'system'}, true),
                       set_config('app.status_reason', ${ctx.statusReason ?? ''}, true)`.execute(tx);
      return fn(tx);
    });
  }

  async ping(): Promise<void> {
    await sql`SELECT 1`.execute(this.system);
  }

  async onModuleDestroy() {
    await Promise.all([this.app.destroy(), this.system.destroy()]);
  }
}
