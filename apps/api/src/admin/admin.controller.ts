import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { PlatformAdmin } from '../auth/access.js';
import { audit } from '../common/audit.js';
import { conflict, notFound } from '../common/errors.js';
import { type AppRequest, clientIp } from '../common/request.js';
import { parse } from '../common/zod.js';
import { Database } from '../db/database.js';

const actionSchema = z.object({ reason: z.string().trim().max(500).optional() });
const reasonRequired = z.object({ reason: z.string().trim().min(1, '사유를 입력해 주세요').max(500) });

// 상태 변경 규칙: [허용되는 현재 상태, 바뀔 상태, 사유 필수]
const TRANSITIONS = {
  approve: [['pending', 'rejected'], 'active', false],
  reject: [['pending'], 'rejected', true],
  suspend: [['active'], 'suspended', true],
  resume: [['suspended'], 'active', false],
} as const;

@Controller('api/admin')
export class AdminController {
  constructor(private readonly db: Database) {}

  /** 업체 목록. 최고 관리자에게도 고객 개인정보는 반환하지 않는다 */
  @Get('tenants')
  @PlatformAdmin()
  async tenants(@Query('status') status?: string) {
    const filter = parse(z.enum(['pending', 'active', 'rejected', 'suspended', 'closed']).optional(), status || undefined);
    return this.db.asSystem({ actorKind: 'platform_admin' }, (tx) => {
      let q = tx
        .selectFrom('tenants as t')
        .select((eb) => [
          't.id',
          't.slug',
          't.name',
          't.status',
          't.status_reason as statusReason',
          't.business_registration_no as businessRegistrationNo',
          't.representative_name as representativeName',
          't.contact_email as contactEmail',
          't.contact_phone as contactPhone',
          't.created_at as createdAt',
          't.approved_at as approvedAt',
          eb.selectFrom('stores').whereRef('stores.tenant_id', '=', 't.id').select(eb.fn.countAll<string>().as('n')).as('storeCount'),
          eb
            .selectFrom('orders')
            .whereRef('orders.tenant_id', '=', 't.id')
            .where('orders.status', '<>', 'pending_payment')
            .select(eb.fn.countAll<string>().as('n'))
            .as('orderCount'),
        ])
        .orderBy('t.created_at', 'desc');
      if (filter) q = q.where('t.status', '=', filter);
      return q.execute();
    });
  }

  @Post('tenants/:id/:action')
  @PlatformAdmin()
  @HttpCode(200)
  async changeStatus(@Param('id') id: string, @Param('action') action: string, @Body() body: unknown, @Req() req: AppRequest) {
    const tenantId = parse(z.string().uuid(), id);
    const act = parse(z.enum(['approve', 'reject', 'suspend', 'resume']), action);
    const [from, to, needsReason] = TRANSITIONS[act];
    const { reason } = parse(needsReason ? reasonRequired : actionSchema, body ?? {});
    const adminId = req.auth!.userId;
    return this.db.asSystem({ userId: adminId, actorKind: 'platform_admin' }, async (tx) => {
      const t = await tx.selectFrom('tenants').select(['status']).where('id', '=', tenantId).forUpdate().executeTakeFirst();
      if (!t) throw notFound('업체');
      if (!(from as readonly string[]).includes(t.status)) throw conflict('INVALID_TENANT_TRANSITION', `현재 상태(${t.status})에서는 할 수 없는 작업입니다`);
      await tx
        .updateTable('tenants')
        .set({
          status: to,
          status_reason: reason ?? null,
          ...(act === 'approve' ? { approved_at: new Date(), approved_by: adminId } : {}),
        })
        .where('id', '=', tenantId)
        .execute();
      await audit(tx, { actorUserId: adminId, actorKind: 'platform_admin', tenantId, action: `tenant.${act}`, targetType: 'tenant', targetId: tenantId, ip: clientIp(req), requestId: req.id, details: { from: t.status, to, reason } });
      return { tenantId, status: to };
    });
  }

  @Get('audit-logs')
  @PlatformAdmin()
  async auditLogs(@Query('tenantId') tenantId?: string) {
    const tid = parse(z.string().uuid().optional(), tenantId || undefined);
    return this.db.asSystem({ actorKind: 'platform_admin' }, (tx) => {
      let q = tx
        .selectFrom('audit_logs')
        .select(['id', 'occurred_at as occurredAt', 'actor_user_id as actorUserId', 'actor_kind as actorKind', 'tenant_id as tenantId', 'action', 'target_type as targetType', 'target_id as targetId'])
        .orderBy('id', 'desc')
        .limit(200);
      if (tid) q = q.where('tenant_id', '=', tid);
      return q.execute();
    });
  }
}
