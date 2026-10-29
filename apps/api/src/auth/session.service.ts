import { Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CryptoService } from '../common/crypto.service.js';
import type { AuthInfo } from '../common/request.js';
import { ENV, type Env } from '../config/env.js';
import { Database, type Tx } from '../db/database.js';

/**
 * 손님 세션과 업체·관리자 세션은 쿠키를 따로 쓴다. 화면 세 개가 같은 API 주소를 부르므로
 * 쿠키 하나를 같이 쓰면 한 브라우저에서 손님 로그인이 업체 로그인을 덮어쓴다(반대도 마찬가지).
 */
export const SESSION_COOKIES = { customer: 'qr_csid', staff: 'qr_sid' } as const;
export type SessionKind = keyof typeof SESSION_COOKIES;
/** 화면이 어느 세션 쿠키를 쓸지 알려주는 헤더 (고객 화면 'customer', 업체·관리자 화면 'staff') */
export const SESSION_KIND_HEADER = 'x-qr-session';

export const sessionKindOf = (actorKind: AuthInfo['actorKind']): SessionKind => (actorKind === 'customer' ? 'customer' : 'staff');

/** 요청이 어느 세션 쿠키를 쓰는지. 헤더가 없으면(카카오 로그인 복귀 등 주소 이동) 경로와 가진 쿠키로 정한다 */
export function sessionKindFor(req: Request): SessionKind {
  const header = req.get(SESSION_KIND_HEADER);
  if (header === 'customer' || header === 'staff') return header;
  if (/^\/api\/(merchant|admin)(\/|$)/.test(req.path)) return 'staff';
  return req.cookies?.[SESSION_COOKIES.customer] ? 'customer' : 'staff';
}
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
    res.cookie(SESSION_COOKIES[sessionKindOf(actorKind)], token, {
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

  clearCookie(res: Response, kind: SessionKind) {
    res.clearCookie(SESSION_COOKIES[kind], { path: '/', httpOnly: true, secure: this.env.cookieSecure, sameSite: 'lax' });
  }
}
