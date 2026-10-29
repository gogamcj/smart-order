import { Badge, Button, ErrorBox, Spinner } from '@qr/web';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useMe } from '../session.js';
import { ROLE_LABEL } from '../types.js';

const STATUS: Record<string, string> = { pending: '승인 대기', active: '이용 중', suspended: '정지', rejected: '거절됨', closed: '해지' };

export function SelectTenantPage() {
  const me = useMe();
  const qc = useQueryClient();
  const nav = useNavigate();
  const select = useMutation({
    mutationFn: (tenantId: string) => api.post('/api/auth/staff/select-tenant', { tenantId }),
    onSuccess: async () => {
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
      await qc.invalidateQueries({ queryKey: ['me'] });
      nav('/', { replace: true });
    },
  });
  if (me.isPending) return <Spinner />;
  const list = me.data?.memberships ?? [];
  return (
    <div className="mx-auto max-w-md space-y-4 px-4 pt-16">
      <h1 className="text-xl font-bold">업체 선택</h1>
      <ErrorBox error={select.error} />
      {list.map((m) => {
        const usable = m.status === 'active' && m.tenantStatus !== 'rejected' && m.tenantStatus !== 'closed';
        return (
          <div key={m.tenantId} className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4">
            <div>
              <p className="font-semibold">{m.tenantName}</p>
              <p className="mt-1 flex gap-1 text-xs">
                <Badge className="bg-gray-100 text-gray-600">{ROLE_LABEL[m.role]}</Badge>
                <Badge className="bg-gray-100 text-gray-600">{STATUS[m.tenantStatus] ?? m.tenantStatus}</Badge>
                {m.status !== 'active' && <Badge className="bg-red-100 text-red-700">비활성 직원</Badge>}
              </p>
            </div>
            <Button tone="secondary" disabled={!usable} busy={select.isPending && select.variables === m.tenantId} onClick={() => select.mutate(m.tenantId)}>
              선택
            </Button>
          </div>
        );
      })}
      <Link to="/apply" className="block text-center text-sm text-neutral-900 underline-offset-2 hover:underline">새 업체 가입 신청</Link>
    </div>
  );
}
