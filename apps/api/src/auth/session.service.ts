import { Inject, Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { CryptoService } from '../common/crypto.service.js';
import type { AuthInfo } from '../common/request.js';
import { ENV, type Env } from '../config/env.js';
import { Database, type Tx } from '../db/database.js';

export const SESSION_COOKIE = 'qr_sid';
const TTL_HOURS = { customer: 24 * 30, staff: 12, platform_admin: 12 } as const;

@Injectable()
export class SessionService {
  constructor(
    private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** 세션을 만들고 쿠키를 심는다. 토큰 원문은 쿠키에만, DB 에는 해시만 저장 */
  async create(tx: Tx, res: Response, userId: string, actorKind: AuthInfo['actorKind'], meta: { ip?: string | null; userAgent?: string }) {
    const token = CryptoService.randomToken();
    const hours = TTL_HOURS[actorKind];
    await tx
      .insertInto('auth_sessions')
      .values({
        token_hash: CryptoService.sha256(token),
        user_id: userId,
        actor_kind: actorKind,
        expires_at: new Date(Date.now() + hours * 3600_000),
        ip: meta.ip ?? null,
        user_agent: meta.userAgent?.slice(0, 300) ?? null,
      })
      .execute();
    await tx.updateTable('users').set({ last_login_at: new Date() }).where('id', '=', userId).execute();
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: this.env.cookieSecure,
      sameSite: 'lax',
      path: '/',
      maxAge: hours * 3600_000,
    });
  }

  async resolve(token: string | undefined): Promise<AuthInfo | null> {
    if (!token || token.length > 100) return null;
    return this.db.asSystem({}, async (tx) => {
      const row = await tx
        .selectFrom('auth_sessions as s')
        .innerJoin('users as u', 'u.id', 's.user_id')
        .select(['s.id', 's.user_id', 's.actor_kind', 's.tenant_id', 's.last_seen_at', 'u.platform_role', 'u.display_name'])
        .where('s.token_hash', '=', CryptoService.sha256(token))
        .where('s.revoked_at', 'is', null)
        .where('s.expires_at', '>', new Date())
        .where('u.status', '=', 'active')
        .executeTakeFirst();
      if (!row) return null;
      if (Date.now() - row.last_seen_at.getTime() > 5 * 60_000) {
        await tx.updateTable('auth_sessions').set({ last_seen_at: new Date() }).where('id', '=', row.id).execute();
      }
      return {
        sessionId: row.id,
        userId: row.user_id,
        actorKind: row.actor_kind as AuthInfo['actorKind'],
        tenantId: row.tenant_id,
        platformRole: row.platform_role as AuthInfo['platformRole'],
        displayName: row.display_name,
      };
    });
  }

  async revoke(sessionId: string) {
    await this.db.asSystem({}, (tx) =>
      tx.updateTable('auth_sessions').set({ revoked_at: new Date() }).where('id', '=', sessionId).execute(),
    );
  }

  clearCookie(res: Response) {
    res.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, secure: this.env.cookieSecure, sameSite: 'lax' });
  }
}
