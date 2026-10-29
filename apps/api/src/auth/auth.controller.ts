import { Body, Controller, Delete, Get, HttpCode, Inject, Post, Query, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { hash, verify } from '@node-rs/argon2';
import type { Response } from 'express';
import { z } from 'zod';
import { audit } from '../common/audit.js';
import { CryptoService } from '../common/crypto.service.js';
import { AppError, conflict, forbidden } from '../common/errors.js';
import { type AppRequest, clientIp } from '../common/request.js';
import { parse } from '../common/zod.js';
import { ENV, type Env } from '../config/env.js';
import { Database } from '../db/database.js';
import { Access, CustomerOnly, Public, StaffOnly } from './access.js';
import { KAKAO_CLIENT, type KakaoClient } from './kakao.client.js';
import { SessionService } from './session.service.js';

const OAUTH_COOKIE = 'qr_oauth';

const signupSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(10, '비밀번호는 10자 이상이어야 합니다').max(200),
  displayName: z.string().trim().min(1).max(50),
});
const loginSchema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) });
const selectTenantSchema = z.object({ tenantId: z.string().uuid() });
const consentSchema = z.object({ termsIds: z.array(z.string().uuid()).min(1).max(10) });
const returnToSchema = z
  .string()
  .max(500)
  .regex(/^\/(?![/\\])[\w\-./?=&%#~]*$/, '허용되지 않은 복귀 경로')
  .catch('/');

@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly db: Database,
    private readonly sessions: SessionService,
    @Inject(ENV) private readonly env: Env,
    @Inject(KAKAO_CLIENT) private readonly kakao: KakaoClient,
  ) {}

  // ── 업체 직원: 이메일 계정 ─────────────────────────────────────────────

  @Post('staff/signup')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async staffSignup(@Body() body: unknown, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const input = parse(signupSchema, body);
    const passwordHash = await hash(input.password);
    return this.db.asSystem({}, async (tx) => {
      const exists = await tx.selectFrom('users').select('id').where('email', '=', input.email).executeTakeFirst();
      if (exists) throw conflict('EMAIL_TAKEN', '이미 가입된 이메일입니다');
      const user = await tx
        .insertInto('users')
        .values({ email: input.email, password_hash: passwordHash, display_name: input.displayName })
        .returning('id')
        .executeTakeFirstOrThrow();
      await this.sessions.create(tx, res, user.id, 'staff', { ip: clientIp(req), userAgent: req.get('user-agent') });
      return { userId: user.id };
    });
  }

  @Post('staff/login')
  @Public()
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async staffLogin(@Body() body: unknown, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const input = parse(loginSchema, body);
    const user = await this.db.asSystem({}, (tx) =>
      tx.selectFrom('users').select(['id', 'password_hash', 'status']).where('email', '=', input.email).executeTakeFirst(),
    );
    // 계정 존재 여부를 알려주지 않도록 실패 응답을 하나로 통일
    const ok = user?.password_hash && user.status === 'active' && (await verify(user.password_hash, input.password));
    if (!ok || !user) throw new AppError('INVALID_CREDENTIALS', 401, '이메일 또는 비밀번호가 올바르지 않습니다');
    await this.db.asSystem({ userId: user.id }, async (tx) => {
      await this.sessions.create(tx, res, user.id, 'staff', { ip: clientIp(req), userAgent: req.get('user-agent') });
      await audit(tx, { actorUserId: user.id, actorKind: 'staff', action: 'auth.staff_login', ip: clientIp(req), requestId: req.id });
    });
    return { userId: user.id };
  }

  @Post('staff/select-tenant')
  @StaffOnly()
  @HttpCode(200)
  async selectTenant(@Body() body: unknown, @Req() req: AppRequest) {
    const { tenantId } = parse(selectTenantSchema, body);
    const auth = req.auth!;
    return this.db.asSystem({}, async (tx) => {
      const m = await tx
        .selectFrom('tenant_members as m')
        .innerJoin('tenants as t', 't.id', 'm.tenant_id')
        .select(['m.role', 'm.status', 't.status as tenant_status', 't.name'])
        .where('m.tenant_id', '=', tenantId)
        .where('m.user_id', '=', auth.userId)
        .executeTakeFirst();
      if (!m || m.status !== 'active') throw forbidden('이 업체의 직원이 아닙니다');
      if (m.tenant_status === 'rejected' || m.tenant_status === 'closed') throw new AppError('TENANT_NOT_ACTIVE', 403, '이용할 수 없는 업체입니다');
      await tx.updateTable('auth_sessions').set({ tenant_id: tenantId }).where('id', '=', auth.sessionId).execute();
      return { tenantId, role: m.role, tenantStatus: m.tenant_status, tenantName: m.name };
    });
  }

  // ── 공통 ─────────────────────────────────────────────────────────────

  @Get('me')
  @Public()
  async me(@Req() req: AppRequest) {
    const auth = req.auth;
    if (!auth) return { authenticated: false };
    const memberships =
      auth.actorKind === 'staff'
        ? await this.db.asSystem({}, (tx) =>
            tx
              .selectFrom('tenant_members as m')
              .innerJoin('tenants as t', 't.id', 'm.tenant_id')
              .select(['t.id as tenantId', 't.name as tenantName', 't.status as tenantStatus', 'm.role', 'm.status'])
              .where('m.user_id', '=', auth.userId)
              .orderBy('t.created_at')
              .execute(),
          )
        : [];
    return {
      authenticated: true,
      userId: auth.userId,
      actorKind: auth.actorKind,
      displayName: auth.displayName,
      platformRole: auth.platformRole,
      tenantId: auth.tenantId,
      memberships,
    };
  }

  @Post('logout')
  @Public()
  @HttpCode(200)
  async logout(@Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    if (req.auth) await this.sessions.revoke(req.auth.sessionId);
    this.sessions.clearCookie(res);
    return { ok: true };
  }

  // ── 고객: 카카오 로그인 ───────────────────────────────────────────────

  @Get('kakao/start')
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async kakaoStart(@Query('returnTo') returnTo: unknown, @Res() res: Response) {
    if (!this.env.kakaoConfigured) {
      return res.redirect(302, this.env.orderWebUrl('/login?error=kakao_not_configured'));
    }
    const state = CryptoService.randomToken();
    await this.db.asSystem({}, (tx) =>
      tx
        .insertInto('oauth_states')
        .values({ state_hash: CryptoService.sha256(state), provider: 'kakao', return_to: returnToSchema.parse(returnTo ?? '/') })
        .execute(),
    );
    // state 를 이 브라우저에도 묶어 두어, 남이 시작한 로그인 결과를 받아들이지 않는다(로그인 CSRF 방지)
    res.cookie(OAUTH_COOKIE, state, { httpOnly: true, secure: this.env.cookieSecure, sameSite: 'lax', path: '/api/auth/kakao', maxAge: 10 * 60_000 });
    return res.redirect(302, this.kakao.authorizeUrl(state));
  }

  @Get('kakao/callback')
  @Public()
  async kakaoCallback(@Query() query: Record<string, string>, @Req() req: AppRequest, @Res() res: Response) {
    const fail = (reason: string) => {
      res.clearCookie(OAUTH_COOKIE, { path: '/api/auth/kakao' });
      return res.redirect(302, this.env.orderWebUrl(`/login?error=${reason}`));
    };
    const cookieState = req.cookies?.[OAUTH_COOKIE] as string | undefined;
    if (!query.state || !cookieState || query.state !== cookieState) return fail('invalid_state');

    const stateRow = await this.db.asSystem({}, (tx) =>
      tx
        .updateTable('oauth_states')
        .set({ consumed_at: new Date() })
        .where('state_hash', '=', CryptoService.sha256(query.state!))
        .where('consumed_at', 'is', null)
        .where('expires_at', '>', new Date())
        .returning('return_to')
        .executeTakeFirst(),
    );
    if (!stateRow) return fail('invalid_state');
    if (query.error) return fail(query.error === 'access_denied' ? 'cancelled' : 'kakao_error');
    if (!query.code) return fail('kakao_error');

    let profile;
    try {
      profile = await this.kakao.exchangeCodeForProfile(query.code);
    } catch {
      return fail('kakao_error');
    }

    const result = await this.db.asSystem({}, async (tx) => {
      const identity = await tx
        .selectFrom('user_identities as i')
        .innerJoin('users as u', 'u.id', 'i.user_id')
        .select(['u.id', 'u.status'])
        .where('i.provider', '=', 'kakao')
        .where('i.provider_user_id', '=', profile.kakaoId)
        .executeTakeFirst();
      let userId = identity?.id;
      if (identity && identity.status !== 'active') return null;
      if (!userId) {
        const user = await tx.insertInto('users').values({ display_name: profile.nickname }).returning('id').executeTakeFirstOrThrow();
        await tx.insertInto('user_identities').values({ user_id: user.id, provider: 'kakao', provider_user_id: profile.kakaoId }).execute();
        userId = user.id;
      }
      await tx
        .updateTable('user_identities')
        .set({ last_login_at: new Date() })
        .where('provider', '=', 'kakao')
        .where('provider_user_id', '=', profile.kakaoId)
        .execute();
      await this.sessions.create(tx, res, userId, 'customer', { ip: clientIp(req), userAgent: req.get('user-agent') });
      return userId;
    });
    if (!result) return fail('account_unavailable');
    res.clearCookie(OAUTH_COOKIE, { path: '/api/auth/kakao' });
    return res.redirect(302, this.env.orderWebUrl(stateRow.return_to));
  }

  /**
   * 개발용 고객 로그인. APP_ENV=local 이고 DEV_LOGIN_ENABLED=true 일 때만 동작하며 운영 설정에서는 켤 수 없다.
   * 카카오 키가 없는 동안 주문 흐름을 확인하기 위한 것으로, 실제 카카오 로그인을 대신하지 않는다.
   */
  @Post('dev-login')
  @Public()
  @HttpCode(200)
  async devLogin(@Body() body: unknown, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    if (this.env.APP_ENV !== 'local' || !this.env.DEV_LOGIN_ENABLED) throw new AppError('NOT_FOUND', 404, '요청한 경로를 찾을 수 없습니다');
    const { nickname } = parse(z.object({ nickname: z.string().trim().min(1).max(30) }), body);
    return this.db.asSystem({}, async (tx) => {
      const devId = `dev:${nickname}`;
      let user = await tx
        .selectFrom('user_identities')
        .select('user_id as id')
        .where('provider', '=', 'kakao')
        .where('provider_user_id', '=', devId)
        .executeTakeFirst();
      if (!user) {
        user = await tx.insertInto('users').values({ display_name: `[개발] ${nickname}` }).returning('id').executeTakeFirstOrThrow();
        await tx.insertInto('user_identities').values({ user_id: user.id, provider: 'kakao', provider_user_id: devId }).execute();
      }
      await this.sessions.create(tx, res, user.id, 'customer', { ip: clientIp(req) });
      return { userId: user.id, devLogin: true };
    });
  }

  // ── 고객: 약관 동의, 탈퇴 ─────────────────────────────────────────────

  @Get('terms')
  @Public()
  async terms(@Req() req: AppRequest) {
    return this.db.asSystem({}, async (tx) => {
      const docs = await tx
        .selectFrom('terms_documents')
        .select(['id', 'kind', 'version', 'title', 'body_url', 'required'])
        .where('effective_at', '<=', new Date())
        .orderBy('kind')
        .execute();
      const agreed = req.auth
        ? new Set(
            (
              await tx
                .selectFrom('user_consents')
                .select('terms_id')
                .where('user_id', '=', req.auth.userId)
                .where('agreed', '=', true)
                .where('withdrawn_at', 'is', null)
                .execute()
            ).map((r) => r.terms_id),
          )
        : new Set<string>();
      return docs.map((d) => ({ ...d, agreed: agreed.has(d.id) }));
    });
  }

  @Post('consents')
  @CustomerOnly()
  @HttpCode(200)
  async consent(@Body() body: unknown, @Req() req: AppRequest) {
    const { termsIds } = parse(consentSchema, body);
    const auth = req.auth!;
    await this.db.asActor({ actor: 'customer', userId: auth.userId }, async (tx) => {
      for (const termsId of termsIds) {
        await tx.insertInto('user_consents').values({ user_id: auth.userId, terms_id: termsId, agreed: true, ip: clientIp(req) }).execute();
      }
    });
    return { ok: true };
  }

  @Delete('me')
  @Access({ kind: 'customer' })
  async withdraw(@Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const auth = req.auth!;
    await this.db.asSystem({ userId: auth.userId, actorKind: 'customer' }, async (tx) => {
      const active = await tx
        .selectFrom('orders')
        .select('id')
        .where('user_id', '=', auth.userId)
        .where('status', 'in', ['placed', 'accepted', 'preparing', 'ready'])
        .executeTakeFirst();
      if (active) throw conflict('ACTIVE_ORDER_EXISTS', '진행 중인 주문이 있어 탈퇴할 수 없습니다. 주문이 끝난 뒤 다시 시도해 주세요');
      // 주문·결제 기록은 법정 보존 기간 동안 남기되 개인 식별 정보는 지운다
      await tx.deleteFrom('user_identities').where('user_id', '=', auth.userId).execute();
      await tx.deleteFrom('customer_contacts').where('user_id', '=', auth.userId).execute();
      await tx.updateTable('auth_sessions').set({ revoked_at: new Date() }).where('user_id', '=', auth.userId).where('revoked_at', 'is', null).execute();
      await tx
        .updateTable('users')
        .set({ status: 'withdrawn', display_name: null, email: null, password_hash: null, withdrawn_at: new Date() })
        .where('id', '=', auth.userId)
        .execute();
      await audit(tx, { actorUserId: auth.userId, actorKind: 'customer', action: 'user.withdraw', ip: clientIp(req), requestId: req.id });
    });
    this.sessions.clearCookie(res);
    return { ok: true };
  }
}
