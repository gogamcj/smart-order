import { Badge, Button, Card, ErrorBox, Field, Input, Select, Spinner } from '@qr/web';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api.js';
import { useMe } from '../session.js';
import { type Member, type Role, ROLE_LABEL } from '../types.js';

const ROLES = Object.keys(ROLE_LABEL) as Role[];

export function MembersPage() {
  const qc = useQueryClient();
  const me = useMe();
  const members = useQuery({ queryKey: ['members'], queryFn: () => api.get<Member[]>('/api/merchant/members') });
  const [f, setF] = useState({ email: '', role: 'order_staff' as Role, canRefund: false });
  const refresh = () => qc.invalidateQueries({ queryKey: ['members'] });
  const add = useMutation({ mutationFn: () => api.post('/api/merchant/members', f), onSuccess: () => { setF({ ...f, email: '' }); void refresh(); } });
  const update = useMutation({ mutationFn: (v: { id: string; patch: Partial<Pick<Member, 'role' | 'canRefund' | 'status'>> }) => api.patch(`/api/merchant/members/${v.id}`, v.patch), onSettled: () => void refresh() });

  if (members.isPending) return <Spinner />;
  if (members.isError) return <ErrorBox error={members.error} onRetry={() => void members.refetch()} />;
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">직원</h1>
      <Card className="space-y-2">
        <h2 className="font-semibold">직원 추가</h2>
        <p className="text-xs text-gray-500">직원이 먼저 매장 관리 화면에서 계정을 만든 뒤, 그 이메일로 추가합니다.</p>
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
          <Field label="이메일"><Input type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="역할">
            <Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </Select>
          </Field>
          <label className="flex items-center gap-1 pb-2 text-sm"><input type="checkbox" checked={f.canRefund} onChange={(e) => setF({ ...f, canRefund: e.target.checked })} /> 취소·환불 권한</label>
          <Button type="submit" busy={add.isPending}>추가</Button>
        </form>
        <ErrorBox error={add.error} />
      </Card>
      <ErrorBox error={update.error} />
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500"><tr><th className="p-2">이름</th><th className="p-2">이메일</th><th className="p-2">역할</th><th className="p-2">취소·환불</th><th className="p-2">상태</th></tr></thead>
          <tbody>
            {members.data.map((m) => (
              <tr key={m.id} className="border-t">
                <td className="p-2">{m.displayName}{m.userId === me.data?.userId && <Badge className="ml-1 bg-gray-100 text-gray-600">나</Badge>}</td>
                <td className="p-2">{m.email}</td>
                <td className="p-2">
                  <Select className="w-auto py-1" value={m.role} onChange={(e) => update.mutate({ id: m.id, patch: { role: e.target.value as Role } })}>
                    {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </Select>
                </td>
                <td className="p-2"><input type="checkbox" checked={m.canRefund || m.role === 'tenant_admin'} disabled={m.role === 'tenant_admin'} onChange={(e) => update.mutate({ id: m.id, patch: { canRefund: e.target.checked } })} /></td>
                <td className="p-2">
                  <button type="button" className={`rounded px-2 py-0.5 text-xs ${m.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`} onClick={() => update.mutate({ id: m.id, patch: { status: m.status === 'active' ? 'disabled' : 'active' } })}>
                    {m.status === 'active' ? '사용 중 (끄기)' : '중지됨 (켜기)'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
