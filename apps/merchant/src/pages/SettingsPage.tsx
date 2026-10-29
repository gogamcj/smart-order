import { Badge, Button, Card, ErrorBox, Field, Input, Notice, Select, Spinner } from '@qr/web';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useStoreId, useStores, useTenant } from '../session.js';
import type { Store } from '../types.js';

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
const BANKS: [string, string][] = [['004', 'KB국민'], ['088', '신한'], ['020', '우리'], ['081', '하나'], ['011', 'NH농협'], ['003', 'IBK기업'], ['090', '카카오뱅크'], ['092', '토스뱅크'], ['023', 'SC제일'], ['071', '우체국'], ['045', '새마을금고'], ['048', '신협']];

export function SettingsPage() {
  const tenant = useTenant();
  const admin = tenant.data?.myRole === 'tenant_admin';
  if (tenant.isPending) return <Spinner />;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <OrderSettings />
      <StoreSettings />
      {admin && <TenantInfo />}
      {admin && <SettlementAccount />}
      {admin && <AddStore />}
      {!admin && <Notice>설정 변경은 업체 관리자만 할 수 있습니다.</Notice>}
    </div>
  );
}

function OrderSettings() {
  const tenant = useTenant();
  const qc = useQueryClient();
  const save = useMutation({ mutationFn: (v: Record<string, boolean>) => api.patch('/api/merchant/settings', v), onSettled: () => qc.invalidateQueries({ queryKey: ['tenant'] }) });
  const s = tenant.data!.settings;
  const admin = tenant.data!.myRole === 'tenant_admin';
  const row = (key: keyof typeof s, label: string, hint: string) => (
    <label className="flex items-start gap-3 py-2">
      <input type="checkbox" className="mt-1" checked={s[key]} disabled={!admin || save.isPending} onChange={(e) => save.mutate({ [key]: e.target.checked })} />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-gray-500">{hint}</span>
      </span>
    </label>
  );
  return (
    <Card>
      <h2 className="mb-2 font-semibold">주문 설정</h2>
      {row('acceptingOrders', '주문 받기', '끄면 고객은 메뉴만 볼 수 있습니다')}
      {row('autoAcceptOrders', '자동 접수', '결제가 확인되면 바로 접수 상태로 바꿉니다')}
      {row('orderSoundEnabled', '신규 주문 알림음', '주문 현황 화면에서 알림음을 켠 경우 소리를 냅니다')}
      <ErrorBox error={save.error} />
      <p className="mt-2 text-xs text-gray-500">요금제: 무료 (과금 기능은 꺼져 있습니다)</p>
    </Card>
  );
}

function StoreSettings() {
  const { storeId } = useStoreId();
  const stores = useStores();
  const tenant = useTenant();
  const store = stores.data?.find((s) => s.id === storeId);
  const qc = useQueryClient();
  const [f, setF] = useState<Store | null>(null);
  useEffect(() => setF(store ?? null), [store]);
  const save = useMutation({
    mutationFn: () => api.patch(`/api/merchant/stores/${storeId}`, { name: f!.name, address: f!.address || null, phone: f!.phone || null, status: f!.status, businessHours: f!.businessHours }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stores'] }),
  });
  if (!f) return null;
  const admin = tenant.data?.myRole === 'tenant_admin';
  return (
    <Card className="space-y-3">
      <h2 className="font-semibold">매장 정보</h2>
      <Field label="매장 이름"><Input value={f.name} disabled={!admin} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="주소"><Input value={f.address ?? ''} disabled={!admin} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
      <Field label="전화"><Input value={f.phone ?? ''} disabled={!admin} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
      <Field label="매장 상태">
        <Select value={f.status} disabled={!admin} onChange={(e) => setF({ ...f, status: e.target.value as Store['status'] })}>
          <option value="open">영업 중</option>
          <option value="paused">일시 중지</option>
          <option value="inactive">운영 안 함</option>
        </Select>
      </Field>
      <div className="space-y-1">
        <p className="text-sm font-medium">영업시간</p>
        {!f.businessHours.length && <p className="text-xs text-gray-500">지정하지 않으면 시간 제한 없이 주문을 받습니다.</p>}
        {f.businessHours.map((h, i) => (
          <div key={i} className="flex items-center gap-2">
            <Select className="w-20" value={h.dow} disabled={!admin} onChange={(e) => setF({ ...f, businessHours: f.businessHours.map((x, j) => (j === i ? { ...x, dow: Number(e.target.value) } : x)) })}>
              {DAYS.map((d, n) => <option key={n} value={n}>{d}</option>)}
            </Select>
            <Input type="time" className="w-32" value={h.open} disabled={!admin} onChange={(e) => setF({ ...f, businessHours: f.businessHours.map((x, j) => (j === i ? { ...x, open: e.target.value } : x)) })} />
            ~
            <Input type="time" className="w-32" value={h.close} disabled={!admin} onChange={(e) => setF({ ...f, businessHours: f.businessHours.map((x, j) => (j === i ? { ...x, close: e.target.value } : x)) })} />
            {admin && <button type="button" className="text-gray-400" onClick={() => setF({ ...f, businessHours: f.businessHours.filter((_, j) => j !== i) })} aria-label="삭제">✕</button>}
          </div>
        ))}
        {admin && (
          <div className="flex gap-2 text-xs">
            <button type="button" className="text-neutral-900 underline-offset-2 hover:underline" onClick={() => setF({ ...f, businessHours: [...f.businessHours, { dow: 1, open: '11:00', close: '21:00' }] })}>+ 시간 추가</button>
            <button type="button" className="text-neutral-900 underline-offset-2 hover:underline" onClick={() => setF({ ...f, businessHours: DAYS.map((_, dow) => ({ dow, open: '11:00', close: '21:00' })) })}>매일 11:00~21:00 로 채우기</button>
          </div>
        )}
        <p className="text-xs text-gray-500">닫는 시각이 여는 시각보다 이르면 다음 날 새벽까지 영업으로 봅니다.</p>
      </div>
      <ErrorBox error={save.error} />
      {save.isSuccess && <p className="text-xs text-green-700">저장했습니다.</p>}
      {admin && <Button busy={save.isPending} onClick={() => save.mutate()}>저장</Button>}
    </Card>
  );
}

function TenantInfo() {
  const tenant = useTenant();
  const qc = useQueryClient();
  const t = tenant.data!;
  const [f, setF] = useState({ name: t.name, representativeName: t.representativeName, contactPhone: t.contactPhone, contactEmail: t.contactEmail });
  const save = useMutation({ mutationFn: () => api.patch('/api/merchant/tenant', f), onSuccess: () => qc.invalidateQueries({ queryKey: ['tenant'] }) });
  return (
    <Card className="space-y-3">
      <h2 className="font-semibold">업체 정보</h2>
      <p className="text-xs text-gray-500">사업자등록번호 {t.businessRegistrationNo} · 업체 주소 이름 {t.slug}</p>
      <Field label="상호"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="대표자"><Input value={f.representativeName} onChange={(e) => setF({ ...f, representativeName: e.target.value })} /></Field>
      <Field label="연락처"><Input value={f.contactPhone} onChange={(e) => setF({ ...f, contactPhone: e.target.value })} /></Field>
      <Field label="이메일"><Input value={f.contactEmail} onChange={(e) => setF({ ...f, contactEmail: e.target.value })} /></Field>
      <ErrorBox error={save.error} />
      {save.isSuccess && <p className="text-xs text-green-700">저장했습니다.</p>}
      <Button busy={save.isPending} onClick={() => save.mutate()}>저장</Button>
    </Card>
  );
}

function SettlementAccount() {
  const qc = useQueryClient();
  const acc = useQuery({ queryKey: ['settlement-account'], queryFn: () => api.get<{ bankCode: string; accountHolder: string; accountLast4: string; status: string } | null>('/api/merchant/settlement-account') });
  const [f, setF] = useState({ bankCode: '004', accountHolder: '', accountNumber: '' });
  const [edit, setEdit] = useState(false);
  const save = useMutation({
    mutationFn: () => api.post('/api/merchant/settlement-account', { ...f, accountNumber: f.accountNumber.trim() }),
    onSuccess: () => {
      setEdit(false);
      setF((x) => ({ ...x, accountNumber: '' }));
      void qc.invalidateQueries({ queryKey: ['settlement-account'] });
    },
  });
  const STATUS: Record<string, string> = { pending: '확인 대기', verified: '확인 완료', rejected: '확인 실패' };
  return (
    <Card className="space-y-3">
      <h2 className="font-semibold">정산 계좌</h2>
      <p className="text-xs text-gray-500">고객 결제는 플랫폼이 대표로 받은 뒤 이 계좌로 정산합니다. 계좌번호는 암호화해 저장하며 화면에는 끝 4자리만 표시합니다. 정산 지급 기능은 PG 계약 후 제공됩니다.</p>
      {acc.isPending ? <Spinner /> : acc.data && !edit ? (
        <div className="flex items-center justify-between text-sm">
          <span>{BANKS.find(([c]) => c === acc.data!.bankCode)?.[1] ?? acc.data.bankCode} ****{acc.data.accountLast4} · {acc.data.accountHolder}</span>
          <Badge className="bg-gray-100 text-gray-700">{STATUS[acc.data.status] ?? acc.data.status}</Badge>
        </div>
      ) : (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <Field label="은행">
            <Select value={f.bankCode} onChange={(e) => setF({ ...f, bankCode: e.target.value })}>
              {BANKS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
            </Select>
          </Field>
          <Field label="예금주"><Input required maxLength={50} value={f.accountHolder} onChange={(e) => setF({ ...f, accountHolder: e.target.value })} /></Field>
          <Field label="계좌번호"><Input required inputMode="numeric" autoComplete="off" value={f.accountNumber} onChange={(e) => setF({ ...f, accountNumber: e.target.value })} /></Field>
          <ErrorBox error={save.error} />
          <div className="flex gap-2">
            <Button type="submit" busy={save.isPending}>저장</Button>
            {acc.data && <Button tone="secondary" onClick={() => setEdit(false)}>취소</Button>}
          </div>
        </form>
      )}
      {acc.data && !edit && <button type="button" className="text-xs text-neutral-900 underline-offset-2 hover:underline underline" onClick={() => setEdit(true)}>계좌 변경</button>}
    </Card>
  );
}

function AddStore() {
  const qc = useQueryClient();
  const { setStoreId } = useStoreId();
  const [name, setName] = useState('');
  const add = useMutation({
    mutationFn: () => api.post<{ id: string }>('/api/merchant/stores', { name }),
    onSuccess: async (r) => {
      setName('');
      await qc.invalidateQueries({ queryKey: ['stores'] });
      setStoreId(r.id);
    },
  });
  return (
    <Card className="space-y-2">
      <h2 className="font-semibold">매장 추가</h2>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) add.mutate(); }}>
        <Input placeholder="새 매장 이름" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" tone="secondary" busy={add.isPending}>추가</Button>
      </form>
      <ErrorBox error={add.error} />
    </Card>
  );
}
