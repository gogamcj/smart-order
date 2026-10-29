import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { Merchant, StaffOnly } from '../auth/access.js';
import { audit } from '../common/audit.js';
import { CryptoService } from '../common/crypto.service.js';
import { AppError, conflict, notFound } from '../common/errors.js';
import { type AppRequest, clientIp } from '../common/request.js';
import { parse } from '../common/zod.js';
import { Database } from '../db/database.js';

const applySchema = z.object({
  name: z.string().trim().min(1).max(100),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, '영문 소문자·숫자·하이픈 3~40자'),
  businessRegistrationNo: z.string().regex(/^[0-9]{10}$/, '사업자등록번호 10자리 숫자'),
  representativeName: z.string().trim().min(1).max(50),
  contactPhone: z.string().trim().regex(/^[0-9-]{9,15}$/),
  contactEmail: z.string().trim().email().max(200),
  storeName: z.string().trim().min(1).max(100),
});

const tenantUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    representativeName: z.string().trim().min(1).max(50),
    contactPhone: z.string().trim().regex(/^[0-9-]{9,15}$/),
    contactEmail: z.string().trim().email().max(200),
  })
  .partial();

const settingsSchema = z
  .object({
    acceptingOrders: z.boolean(),
    autoAcceptOrders: z.boolean(),
    orderSoundEnabled: z.boolean(),
  })
  .partial();

const memberRole = z.enum(['tenant_admin', 'order_staff', 'menu_staff', 'viewer']);
const addMemberSchema = z.object({ email: z.string().trim().toLowerCase().email(), role: memberRole, canRefund: z.boolean().default(false) });
const updateMemberSchema = z.object({ role: memberRole, canRefund: z.boolean(), status: z.enum(['active', 'disabled']) }).partial();

const settlementAccountSchema = z.object({
  bankCode: z.string().regex(/^[0-9]{3}$/),
  accountHolder: z.string().trim().min(1).max(50),
  accountNumber: z.string().regex(/^[0-9-]{8,20}$/),
});

@Controller('api')
export class TenantsController {
  constructor(
    private readonly db: Database,
    private readonly crypto: CryptoService,
  ) {}

  /** 업체 가입 신청: 승인 전(pending) 업체와 첫 매장을 만들고 신청자를 업체 관리자로 등록 */
  @Post('tenants/apply')
  @StaffOnly()
  async apply(@Body() body: unknown, @Req() req: AppRequest) {
    const input = parse(applySchema, body);
    const userId = req.auth!.userId;
    return this.db.asSystem({ userId, actorKind: 'staff' }, async (tx) => {
      const taken = await tx.selectFrom('tenants').select('id').where('slug', '=', input.slug).executeTakeFirst();
      if (taken) throw conflict('SLUG_TAKEN', '이미 사용 중인 업체 주소입니다');
      const tenant = await tx
        .insertInto('tenants')
        .values({
          slug: input.slug,
          name: input.name,
          business_registration_no: input.businessRegistrationNo,
          representative_name: input.representativeName,
          contact_phone: input.contactPhone,
          contact_email: input.contactEmail,
        })
        .returning(['id', 'status'])
        .executeTakeFirstOrThrow();
      await tx.insertInto('tenant_settings').values({ tenant_id: tenant.id }).execute();
      await tx.insertInto('tenant_plans').values({ tenant_id: tenant.id }).execute();
      await tx.insertInto('tenant_members').values({ tenant_id: tenant.id, user_id: userId, role: 'tenant_admin', can_refund: true }).execute();
      const store = await tx.insertInto('stores').values({ tenant_id: tenant.id, name: input.storeName }).returning('id').executeTakeFirstOrThrow();
      await audit(tx, { actorUserId: userId, actorKind: 'staff', tenantId: tenant.id, action: 'tenant.apply', targetType: 'tenant', targetId: tenant.id, ip: clientIp(req), requestId: req.id });
      return { tenantId: tenant.id, status: tenant.status, storeId: store.id };
    });
  }

  @Get('merchant/tenant')
  @Merchant()
  async getTenant(@Req() req: AppRequest) {
    const m = req.merchant!;
    return this.db.asActor({ actor: 'staff', tenantId: m.tenantId, userId: req.auth!.userId }, async (tx) => {
      const t = await tx
        .selectFrom('tenants')
        .select(['id', 'slug', 'name', 'status', 'status_reason', 'representative_name', 'contact_email', 'contact_phone', 'business_registration_no', 'approved_at'])
        .executeTakeFirstOrThrow();
      const settings = await tx.selectFrom('tenant_settings').selectAll().executeTakeFirstOrThrow();
      const plan = await tx.selectFrom('tenant_plans').select(['plan_code', 'billing_enabled']).executeTakeFirst();
      return {
        id: t.id,
        slug: t.slug,
        name: t.name,
        status: t.status,
        statusReason: t.status_reason,
        representativeName: t.representative_name,
        contactEmail: t.contact_email,
        contactPhone: t.contact_phone,
        businessRegistrationNo: t.business_registration_no,
        approvedAt: t.approved_at,
        myRole: m.role,
        plan: plan ? { code: plan.plan_code, billingEnabled: plan.billing_enabled } : null,
        settings: {
          acceptingOrders: settings.accepting_orders,
          autoAcceptOrders: settings.auto_accept_orders,
          orderSoundEnabled: settings.order_sound_enabled,
        },
      };
    });
  }

  @Patch('merchant/tenant')
  @Merchant('tenant_admin')
  async updateTenant(@Body() body: unknown, @Req() req: AppRequest) {
    const input = parse(tenantUpdateSchema, body);
    const m = req.merchant!;
    await this.db.asActor({ actor: 'staff', tenantId: m.tenantId, userId: req.auth!.userId }, async (tx) => {
      await tx
        .updateTable('tenants')
        .set({
          name: input.name,
          representative_name: input.representativeName,
          contact_phone: input.contactPhone,
          contact_email: input.contactEmail,
        })
        .where('id', '=', m.tenantId)
        .execute();
      await audit(tx, { actorUserId: req.auth!.userId, actorKind: 'staff', tenantId: m.tenantId, action: 'tenant.update', details: { fields: Object.keys(input) }, requestId: req.id });
    });
    return { ok: true };
  }

  @Patch('merchant/settings')
  @Merchant('tenant_admin')
  async updateSettings(@Body() body: unknown, @Req() req: AppRequest) {
    const input = parse(settingsSchema, body);
    const m = req.merchant!;
    await this.db.asActor({ actor: 'staff', tenantId: m.tenantId, userId: req.auth!.userId }, async (tx) => {
      await tx
        .updateTable('tenant_settings')
        .set({
          accepting_orders: input.acceptingOrders,
          auto_accept_orders: input.autoAcceptOrders,
          order_sound_enabled: input.orderSoundEnabled,
        })
        .where('tenant_id', '=', m.tenantId)
        .execute();
      await audit(tx, { actorUserId: req.auth!.userId, actorKind: 'staff', tenantId: m.tenantId, action: 'tenant.settings_update', details: input, requestId: req.id });
    });
    return { ok: true };
  }

  // ── 직원 관리 ─────────────────────────────────────────────────────────

  @Get('merchant/members')
  @Merchant('tenant_admin')
  async members(@Req() req: AppRequest) {
    const m = req.merchant!;
    return this.db.asActor({ actor: 'staff', tenantId: m.tenantId, userId: req.auth!.userId }, (tx) =>
      tx
        .selectFrom('tenant_members as tm')
        .innerJoin('users as u', 'u.id', 'tm.user_id')
        .select(['tm.id', 'tm.user_id as userId', 'u.display_name as displayName', 'u.email', 'tm.role', 'tm.can_refund as canRefund', 'tm.status', 'tm.created_at as createdAt'])
        .orderBy('tm.created_at')
        .execute(),
    );
  }

  /** 직원은 먼저 이메일로 가입한 뒤 업체 관리자가 이메일로 추가한다 */
  @Post('merchant/members')
  @Merchant('tenant_admin')
  async addMember(@Body() body: unknown, @Req() req: AppRequest) {
    const input = parse(addMemberSchema, body);
    const m = req.merchant!;
    // 다른 업체 소속 여부와 무관하게 가입한 사용자를 찾아야 하므로 이메일 조회만 시스템 권한으로 한다
    const user = await this.db.asSystem({}, (tx) =>
      tx.selectFrom('users').select('id').where('email', '=', input.email).where('status', '=', 'active').executeTakeFirst(),
    );
    if (!user) throw new AppError('USER_NOT_FOUND', 404, '해당 이메일로 가입한 직원 계정이 없습니다. 직원이 먼저 가입해야 합니다');
    return this.db.asActor({ actor: 'staff', tenantId: m.tenantId, userId: req.auth!.userId }, async (tx) => {
      const exists = await tx.selectFrom('tenant_members').select('id').where('user_id', '=', user.id).executeTakeFirst();
      if (exists) throw conflict('ALREADY_MEMBER', '이미 등록된 직원입니다');
      const row = await tx
        .insertInto('tenant_members')
        .values({ tenant_id: m.tenantId, user_id: user.id, role: input.role, can_refund: input.canRefund, invited_by: req.auth!.userId })
        .returning('id')
        .executeTakeFirstOrThrow();
      await audit(tx, { actorUserId: req.auth!.userId, actorKind: 'staff', tenantId: m.tenantId, action: 'member.add', targetType: 'tenant_member', targetId: row.id, details: { role: input.role }, requestId: req.id });
      return { id: row.id };
    });
  }

  @Patch('merchant/members/:id')
  @Merchant('tenant_admin')
  async updateMember(@Param('id') id: string, @Body() body: unknown, @Req() req: AppRequest) {
    const input = parse(updateMemberSchema, body);
    const memberId = parse(z.string().uuid(), id);
    const m = req.merchant!;
    await this.db.asActor({ actor: 'staff', tenantId: m.tenantId, userId: req.auth!.userId }, async (tx) => {
      const target = await tx.selectFrom('tenant_members').select(['id', 'user_id', 'role', 'status']).where('id', '=', memberId).executeTakeFirst();
      if (!target) throw notFound('직원');
      const losingAdmin = target.role === 'tenant_admin' && ((input.role && input.role !== 'tenant_admin') || input.status === 'disabled');
      if (losingAdmin) {
        const admins = await tx
          .selectFrom('tenant_members')
          .select((eb) => eb.fn.countAll<string>().as('n'))
          .where('role', '=', 'tenant_admin')
          .where('status', '=', 'active')
          .executeTakeFirstOrThrow();
        if (Number(admins.n) <= 1) throw conflict('LAST_ADMIN', '업체 관리자는 최소 한 명 있어야 합니다');
      }
      await tx
        .updateTable('tenant_members')
        .set({ role: input.role, can_refund: input.canRefund, status: input.status })
        .where('id', '=', memberId)
        .execute();
      if (input.status === 'disabled') {
        await this.db.asSystem({}, (sys) =>
          sys.updateTable('auth_sessions').set({ tenant_id: null }).where('user_id', '=', target.user_id).where('tenant_id', '=', m.tenantId).execute(),
        );
      }
      await audit(tx, { actorUserId: req.auth!.userId, actorKind: 'staff', tenantId: m.tenantId, action: 'member.update', targetType: 'tenant_member', targetId: memberId, details: input, requestId: req.id });
    });
    return { ok: true };
  }

  // ── 정산 계좌 (정산 실행은 PG 지급대행 계약 후 구현) ─────────────────────────

  @Get('merchant/settlement-account')
  @Merchant('tenant_admin')
  async getSettlementAccount(@Req() req: AppRequest) {
    const m = req.merchant!;
    const row = await this.db.asActor({ actor: 'staff', tenantId: m.tenantId, userId: req.auth!.userId }, (tx) =>
      tx.selectFrom('tenant_settlement_accounts').select(['bank_code', 'account_holder', 'account_last4', 'status', 'verified_at']).executeTakeFirst(),
    );
    return row
      ? { bankCode: row.bank_code, accountHolder: row.account_holder, accountLast4: row.account_last4, status: row.status, verifiedAt: row.verified_at }
      : null;
  }

  @Post('merchant/settlement-account')
  @Merchant('tenant_admin')
  async setSettlementAccount(@Body() body: unknown, @Req() req: AppRequest) {
    const input = parse(settlementAccountSchema, body);
    const digits = input.accountNumber.replace(/-/g, '');
    const m = req.merchant!;
    await this.db.asActor({ actor: 'staff', tenantId: m.tenantId, userId: req.auth!.userId }, async (tx) => {
      const values = {
        bank_code: input.bankCode,
        account_holder: input.accountHolder,
        account_number_enc: this.crypto.encrypt(digits),
        account_last4: digits.slice(-4),
        status: 'pending',
        verified_at: null,
      };
      await tx
        .insertInto('tenant_settlement_accounts')
        .values({ tenant_id: m.tenantId, ...values })
        .onConflict((oc) => oc.column('tenant_id').doUpdateSet(values))
        .execute();
      await audit(tx, { actorUserId: req.auth!.userId, actorKind: 'staff', tenantId: m.tenantId, action: 'settlement_account.set', details: { bankCode: input.bankCode, last4: digits.slice(-4) }, requestId: req.id });
    });
    return { ok: true, status: 'pending' };
  }

  @Delete('merchant/members/:id')
  @Merchant('tenant_admin')
  async removeMember(@Param('id') id: string, @Req() req: AppRequest) {
    return this.updateMember(id, { status: 'disabled' }, req);
  }
}
