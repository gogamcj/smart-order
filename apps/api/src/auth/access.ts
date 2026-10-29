import { SetMetadata } from '@nestjs/common';
import type { MemberRole } from '../common/request.js';

export type AccessRule =
  | { kind: 'public' }
  | { kind: 'customer' }
  | { kind: 'staff' } // 로그인한 직원 (업체 선택 전 포함)
  | { kind: 'merchant'; roles?: MemberRole[]; refund?: boolean } // 업체를 선택한 직원
  | { kind: 'platform_admin' };

export const ACCESS_KEY = 'qr:access';

/** 모든 라우트는 접근 규칙을 선언해야 한다. 선언이 없으면 AccessGuard 가 거부한다(fail closed) */
export const Access = (rule: AccessRule) => SetMetadata(ACCESS_KEY, rule);
export const Public = () => Access({ kind: 'public' });
export const CustomerOnly = () => Access({ kind: 'customer' });
export const StaffOnly = () => Access({ kind: 'staff' });
export const Merchant = (...roles: MemberRole[]) => Access({ kind: 'merchant', roles: roles.length ? roles : undefined });
export const PlatformAdmin = () => Access({ kind: 'platform_admin' });
