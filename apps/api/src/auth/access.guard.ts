import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError, forbidden } from '../common/errors.js';
import type { AppRequest } from '../common/request.js';
import { Database } from '../db/database.js';
import { ACCESS_KEY, type AccessRule } from './access.js';

const unauthenticated = () => new AppError('UNAUTHENTICATED', 401, '로그인이 필요합니다');

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: Database,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rule = this.reflector.getAllAndOverride<AccessRule | undefined>(ACCESS_KEY, [context.getHandler(), context.getClass()]);
    if (!rule) throw forbidden('접근 규칙이 선언되지 않은 경로입니다');
    if (rule.kind === 'public') return true;

    const req = context.switchToHttp().getRequest<AppRequest>();
    const auth = req.auth;
    if (!auth) throw unauthenticated();

    switch (rule.kind) {
      case 'customer':
        if (auth.actorKind !== 'customer') throw forbidden('고객 계정으로 로그인해 주세요');
        return true;
      case 'staff':
        if (auth.actorKind !== 'staff') throw forbidden('업체 직원 계정으로 로그인해 주세요');
        return true;
      case 'platform_admin':
        // 세션 정보가 아니라 매 요청 DB 의 현재 권한으로 판단(AuthMiddleware 가 방금 읽은 값)
        if (auth.actorKind !== 'staff' || auth.platformRole !== 'super_admin') throw forbidden();
        return true;
      case 'merchant': {
        if (auth.actorKind !== 'staff') throw forbidden('업체 직원 계정으로 로그인해 주세요');
        if (!auth.tenantId) throw new AppError('TENANT_NOT_SELECTED', 403, '업체를 먼저 선택해 주세요');
        const m = await this.db.asSystem({}, (tx) =>
          tx
            .selectFrom('tenant_members as m')
            .innerJoin('tenants as t', 't.id', 'm.tenant_id')
            .select(['m.role', 'm.can_refund', 'm.status', 't.status as tenant_status'])
            .where('m.tenant_id', '=', auth.tenantId!)
            .where('m.user_id', '=', auth.userId)
            .executeTakeFirst(),
        );
        if (!m || m.status !== 'active') throw forbidden('이 업체의 직원이 아닙니다');
        if (m.tenant_status === 'rejected' || m.tenant_status === 'closed') throw new AppError('TENANT_NOT_ACTIVE', 403, '이용할 수 없는 업체입니다');
        if (m.tenant_status === 'suspended' && req.method !== 'GET') {
          throw new AppError('TENANT_SUSPENDED', 403, '이용이 정지된 업체입니다. 조회만 가능합니다');
        }
        const role = m.role as NonNullable<AppRequest['merchant']>['role'];
        if (rule.roles && !rule.roles.includes(role)) throw forbidden('이 작업을 할 권한이 없습니다');
        req.merchant = { tenantId: auth.tenantId, role, canRefund: m.can_refund, tenantStatus: m.tenant_status };
        return true;
      }
    }
  }
}
