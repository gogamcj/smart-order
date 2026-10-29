import type { Tx } from '../db/database.js';

export interface AuditEntry {
  actorUserId?: string | null;
  actorKind: 'customer' | 'staff' | 'platform_admin' | 'system';
  tenantId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  ip?: string | null;
  requestId?: string;
  // 민감정보(비밀번호, 토큰, 전화번호·계좌번호 원문)를 넣지 않는다
  details?: Record<string, unknown>;
}

export async function audit(tx: Tx, e: AuditEntry) {
  await tx
    .insertInto('audit_logs')
    .values({
      actor_user_id: e.actorUserId ?? null,
      actor_kind: e.actorKind,
      tenant_id: e.tenantId ?? null,
      action: e.action,
      target_type: e.targetType ?? null,
      target_id: e.targetId ?? null,
      ip: e.ip ?? null,
      request_id: e.requestId ?? null,
      details: JSON.stringify(e.details ?? {}),
    })
    .execute();
}
