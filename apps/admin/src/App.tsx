import { AuthLayout, Badge, Button, Card, dateTime, ErrorBox, Field, Input, Notice, Select, Spinner } from '@qr/web';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from './api.js';

interface Me {
  authenticated: boolean;
  actorKind?: string;
  displayName?: string | null;
  platformRole?: string | null;
}
interface TenantRow {
  id: string;
  slug: string;
  name: string;
  status: 'pending' | 'active' | 'rejected' | 'suspended' | 'closed';
  statusReason: string | null;
  businessRegistrationNo: string;
  representativeName: string;
  contactEmail: string;
  contactPhone: string;
  createdAt: string;
  approvedAt: string | null;
  storeCount: string;
  orderCount: string;
}
interface AuditRow {
  id: string;
  occurredAt: string;
  actorKind: string;
  action: string;
  tenantId: string | null;
  targetType: string | null;
}

const STATUS: Record<TenantRow['status'], [string, string]> = {
  pending: ['승인 대기', 'bg-amber-100 text-amber-800'],
  active: ['이용 중', 'bg-green-100 text-green-700'],
  rejected: ['거절', 'bg-red-100 text-red-700'],
  suspended: ['정지', 'bg-red-100 text-red-700'],
  closed: ['해지', 'bg-gray-200 text-gray-600'],
};
const ACTIONS: Record<TenantRow['status'], { act: 'approve' | 'reject' | 'suspend' | 'resume'; label: string; reason: boolean; tone: 'primary' | 'secondary' | 'danger' }[]> = {
  pending: [
    { act: 'approve', label: '승인', reason: false, tone: 'primary' },
    { act: 'reject', label: '거절', reason: true, tone: 'secondary' },
  ],
  active: [{ act: 'suspend', label: '이용 정지', reason: true, tone: 'danger' }],
  suspended: [{ act: 'resume', label: '정지 해제', reason: false, tone: 'primary' }],
  rejected: [],
  closed: [],
};

export function App() {
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/api/auth/me') });
  if (me.isPending) return <Spinner />;
  if (me.isError) return <div className="p-6"><ErrorBox error={me.error} onRetry={() => void me.refetch()} /></div>;
  if (!me.data.authenticated || me.data.platformRole !== 'super_admin') return <Login loggedInWrongAccount={me.data.authenticated} />;
  return <Console name={me.data.displayName ?? ''} />;
}

function Login({ loggedInWrongAccount }: { loggedInWrongAccount: boolean }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ email: '', password: '' });
  const login = useMutation({ mutationFn: () => api.post('/api/auth/staff/login', f), onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }) });
  const logout = useMutation({ mutationFn: () => api.post('/api/auth/logout'), onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }) });
  return (
    <AuthLayout eyebrow="최고 관리자" title="플랫폼 관리" intro={'업체 가입 승인과\n운영 기록 확인'} points={['가입 신청 업체 승인·반려', '업체 이용 정지·해제', '모든 관리 작업을 감사 로그로 확인']}>
      {loggedInWrongAccount && (
        <Notice tone="warn">
          최고 관리자 계정이 아닙니다. <button type="button" className="underline" onClick={() => logout.mutate()}>로그아웃</button>
        </Notice>
      )}
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); login.mutate(); }}>
        <Field label="이메일"><Input type="email" autoComplete="username" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="비밀번호"><Input type="password" autoComplete="current-password" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        <ErrorBox error={login.error} />
        <Button type="submit" className="w-full" busy={login.isPending}>로그인</Button>
      </form>
      <p className="text-xs text-gray-500">최고 관리자 계정은 서버에서 <code>pnpm --filter @qr/api admin:create</code> 로만 만들 수 있습니다.</p>
    </AuthLayout>
  );
}

function Console({ name }: { name: string }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string>('pending');
  const [tab, setTab] = useState<'tenants' | 'audit'>('tenants');
  const tenants = useQuery({ queryKey: ['tenants', filter], queryFn: () => api.get<TenantRow[]>(`/api/admin/tenants${filter ? `?status=${filter}` : ''}`) });
  const logs = useQuery({ queryKey: ['audit'], queryFn: () => api.get<AuditRow[]>('/api/admin/audit-logs'), enabled: tab === 'audit' });
  const logout = useMutation({ mutationFn: () => api.post('/api/auth/logout'), onSuccess: () => qc.invalidateQueries() });
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-xl font-bold">플랫폼 관리</h1>
        <button type="button" className={`rounded-lg px-3 py-1.5 text-sm ${tab === 'tenants' ? 'bg-neutral-900 font-semibold text-white' : ''}`} onClick={() => setTab('tenants')}>업체</button>
        <button type="button" className={`rounded-lg px-3 py-1.5 text-sm ${tab === 'audit' ? 'bg-neutral-900 font-semibold text-white' : ''}`} onClick={() => setTab('audit')}>감사 로그</button>
        <span className="text-sm text-gray-500">{name}</span>
        <button type="button" className="text-sm underline" onClick={() => logout.mutate()}>로그아웃</button>
      </header>
      {tab === 'tenants' ? (
        <>
          <Select className="w-auto" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="상태">
            <option value="">전체</option>
            {Object.entries(STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
          </Select>
          <ErrorBox error={tenants.error} onRetry={() => void tenants.refetch()} />
          {tenants.isPending ? <Spinner /> : (
            <div className="grid gap-3 md:grid-cols-2">
              {tenants.data?.map((t) => <TenantCard key={t.id} t={t} />)}
              {!tenants.data?.length && <p className="text-sm text-gray-500">해당하는 업체가 없습니다.</p>}
            </div>
          )}
        </>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <ErrorBox error={logs.error} />
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-500"><tr><th className="p-2">시각</th><th className="p-2">주체</th><th className="p-2">작업</th><th className="p-2">업체</th></tr></thead>
            <tbody>
              {logs.data?.map((l) => (
                <tr key={l.id} className="border-t"><td className="p-2 whitespace-nowrap">{dateTime(l.occurredAt)}</td><td className="p-2">{l.actorKind}</td><td className="p-2 font-mono text-xs">{l.action}</td><td className="p-2 font-mono text-xs">{l.tenantId?.slice(0, 8)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TenantCard({ t }: { t: TenantRow }) {
  const qc = useQueryClient();
  const [pending, setPending] = useState<(typeof ACTIONS)['pending'][number] | null>(null);
  const [reason, setReason] = useState('');
  const run = useMutation({
    mutationFn: (v: { act: string; reason?: string }) => api.post(`/api/admin/tenants/${t.id}/${v.act}`, v.reason ? { reason: v.reason } : {}),
    onSuccess: () => {
      setPending(null);
      setReason('');
      void qc.invalidateQueries({ queryKey: ['tenants'] });
    },
  });
  const [label, tone] = STATUS[t.status];
  return (
    <Card className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-semibold">{t.name}</span>
        <Badge className={tone}>{label}</Badge>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
        <dt className="text-gray-500">사업자번호</dt><dd>{t.businessRegistrationNo.replace(/^(\d{3})(\d{2})(\d{5})$/, '$1-$2-$3')}</dd>
        <dt className="text-gray-500">대표자</dt><dd>{t.representativeName}</dd>
        <dt className="text-gray-500">연락처</dt><dd>{t.contactPhone} · {t.contactEmail}</dd>
        <dt className="text-gray-500">신청일</dt><dd>{dateTime(t.createdAt)}</dd>
        <dt className="text-gray-500">매장·주문</dt><dd>매장 {t.storeCount}개 · 주문 {t.orderCount}건</dd>
        {t.statusReason && <><dt className="text-gray-500">사유</dt><dd>{t.statusReason}</dd></>}
      </dl>
      <p className="text-xs text-gray-500">사업자등록 상태 확인(국세청)은 아직 자동화되지 않았습니다. 승인 전에 직접 확인해 주세요.</p>
      {!pending ? (
        <div className="flex gap-2">
          {ACTIONS[t.status].map((a) => (
            <Button key={a.act} tone={a.tone} busy={run.isPending && run.variables?.act === a.act} onClick={() => (a.reason ? setPending(a) : run.mutate({ act: a.act }))}>{a.label}</Button>
          ))}
        </div>
      ) : (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run.mutate({ act: pending.act, reason }); }}>
          <Input required maxLength={500} placeholder={`${pending.label} 사유`} value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button type="submit" tone="danger" busy={run.isPending}>{pending.label}</Button>
          <Button tone="secondary" onClick={() => setPending(null)}>취소</Button>
        </form>
      )}
      <ErrorBox error={run.error} />
    </Card>
  );
}
