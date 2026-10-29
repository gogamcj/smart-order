import type { Request } from 'express';

export type MemberRole = 'tenant_admin' | 'order_staff' | 'menu_staff' | 'viewer';

export interface AuthInfo {
  sessionId: string;
  userId: string;
  actorKind: 'customer' | 'staff' | 'platform_admin';
  tenantId: string | null;
  platformRole: 'none' | 'super_admin';
  displayName: string | null;
}

export interface MerchantInfo {
  tenantId: string;
  role: MemberRole;
  canRefund: boolean;
  tenantStatus: string;
}

export interface AppRequest extends Request {
  id: string;
  auth?: AuthInfo;
  merchant?: MerchantInfo;
}

export const clientIp = (req: Request) => req.ip ?? null;
