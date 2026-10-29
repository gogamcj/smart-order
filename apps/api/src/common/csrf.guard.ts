import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../config/env.js';
import { AppError } from './errors.js';
import type { AppRequest } from './request.js';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_HEADER_VALUE = 'qr-order';

/**
 * 상태를 바꾸는 요청은 (1) 사용자 정의 헤더가 있어야 하고 (2) Origin 이 허용 목록이어야 한다.
 * 사용자 정의 헤더는 CORS 사전 요청을 강제하므로 허용되지 않은 사이트의 폼·스크립트는 보낼 수 없다.
 * 세션 쿠키는 SameSite=Lax 라 다른 사이트의 POST 에는 실리지 않는다(이중 방어).
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly origins: Set<string>;

  constructor(@Inject(ENV) env: Env) {
    this.origins = new Set([env.ORDER_WEB_ORIGIN, env.MERCHANT_WEB_ORIGIN, env.ADMIN_WEB_ORIGIN, env.API_PUBLIC_URL].map((o) => new URL(o).origin));
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AppRequest>();
    if (SAFE.has(req.method)) return true;
    if (req.path.startsWith('/api/webhooks/')) return true; // 웹훅은 서명으로 검증
    if (req.get(CSRF_HEADER) !== CSRF_HEADER_VALUE) throw new AppError('CSRF_REJECTED', 403, '허용되지 않은 요청입니다');
    const origin = req.get('origin');
    if (origin && !this.origins.has(origin)) throw new AppError('CSRF_REJECTED', 403, '허용되지 않은 요청입니다');
    return true;
  }
}
