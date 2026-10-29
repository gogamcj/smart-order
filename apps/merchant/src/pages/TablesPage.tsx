import { PageHeader } from '../components/PageHeader.js';
import { Badge, Button, Card, ErrorBox, Input, Notice, saveBlob, Spinner, dateTime } from '@qr/web';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useStoreId } from '../session.js';
import type { TableRow } from '../types.js';

export function TablesPage() {
  const { storeId } = useStoreId();
  const qc = useQueryClient();
  const tables = useQuery({ queryKey: ['tables', storeId], queryFn: () => api.get<TableRow[]>(`/api/merchant/tables?storeId=${storeId}`), enabled: !!storeId });
  const [label, setLabel] = useState('');
  const [range, setRange] = useState({ from: '1', to: '10' });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [showQr, setShowQr] = useState<TableRow | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['tables'] });

  const add = useMutation({ mutationFn: () => api.post('/api/merchant/tables', { storeId, label: label.trim() }), onSuccess: () => { setLabel(''); void refresh(); } });
  const bulk = useMutation({ mutationFn: () => api.post<{ created: number }>('/api/merchant/tables/bulk', { storeId, from: Number(range.from), to: Number(range.to) }), onSuccess: () => void refresh() });
  const op = useMutation({
    mutationFn: async (v: { kind: 'toggle' | 'delete' | 'reissue' | 'revoke'; t: TableRow }) => {
      if (v.kind === 'toggle') return api.patch(`/api/merchant/tables/${v.t.id}`, { isActive: !v.t.isActive });
      if (v.kind === 'delete') return api.del(`/api/merchant/tables/${v.t.id}`);
      if (v.kind === 'reissue') return api.post(`/api/merchant/tables/${v.t.id}/qr-codes`);
      return api.del(`/api/merchant/qr-codes/${v.t.qrCodeId}`);
    },
    onSettled: () => {
      setShowQr(null);
      void refresh();
    },
  });
  const print = useMutation({
    mutationFn: async (ids: string[]) => saveBlob(await api.download('/api/merchant/qr-codes/print', { tableIds: ids }), 'table-qr.pdf'),
  });

  if (tables.isPending) return <Spinner />;
  if (tables.isError) return <ErrorBox error={tables.error} onRetry={() => void tables.refetch()} />;
  const printable = tables.data.filter((t) => t.qrCodeId && t.isActive);
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="space-y-4">
      <PageHeader title="테이블·QR" desc="테이블을 만들고 QR 코드를 발급·인쇄합니다." />
      <div className="flex flex-wrap gap-4">
        <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); if (label.trim()) add.mutate(); }}>
          <Input className="w-36" placeholder="테이블 이름 (예: 창가1)" maxLength={30} value={label} onChange={(e) => setLabel(e.target.value)} />
          <Button type="submit" tone="secondary" busy={add.isPending}>추가</Button>
        </form>
        <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); bulk.mutate(); }}>
          <Input type="number" min={1} max={999} className="w-20" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} aria-label="시작 번호" />
          ~
          <Input type="number" min={1} max={999} className="w-20" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} aria-label="끝 번호" />
          <Button type="submit" tone="secondary" busy={bulk.isPending}>번호로 한꺼번에 만들기</Button>
        </form>
      </div>
      {bulk.data && <Notice tone="success">{bulk.data.created}개 테이블을 만들었습니다. (이미 있는 번호는 건너뜀)</Notice>}
      <ErrorBox error={add.error ?? bulk.error ?? op.error ?? print.error} />
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={!printable.length} busy={print.isPending} onClick={() => print.mutate((picked.size ? printable.filter((t) => picked.has(t.id)) : printable).map((t) => t.id))}>
          {picked.size ? `선택한 ${picked.size}개 QR 인쇄용 PDF` : '전체 QR 인쇄용 PDF'}
        </Button>
        <span className="text-xs text-gray-500">A4 한 장에 6개. 한글 테이블 이름은 PDF 에 아직 표시되지 않습니다(영문·숫자만, 6단계에서 한글 글꼴 추가).</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {tables.data.map((t) => (
          <Card key={t.id} className={`space-y-2 ${!t.isActive ? 'opacity-60' : ''}`}>
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 font-semibold">
                <input type="checkbox" checked={picked.has(t.id)} disabled={!t.qrCodeId || !t.isActive} onChange={() => toggle(t.id)} />
                {t.label}
              </label>
              {!t.isActive ? <Badge className="bg-gray-200 text-gray-600">사용 안 함</Badge> : t.qrCodeId ? <Badge className="bg-green-100 text-green-700">QR 사용 중</Badge> : <Badge className="bg-red-100 text-red-700">QR 없음</Badge>}
            </div>
            {t.qrIssuedAt && <p className="text-xs text-gray-500">QR 발급 {dateTime(t.qrIssuedAt)}</p>}
            <div className="flex flex-wrap gap-1 text-xs">
              {t.qrCodeId && <button type="button" className="rounded border px-2 py-0.5" onClick={() => setShowQr(t)}>QR 보기</button>}
              <button type="button" className="rounded border px-2 py-0.5" onClick={() => confirm('QR 을 새로 발급하면 기존 QR 은 바로 사용할 수 없습니다. 계속할까요?') && op.mutate({ kind: 'reissue', t })}>{t.qrCodeId ? '재발급' : 'QR 발급'}</button>
              {t.qrCodeId && <button type="button" className="rounded border px-2 py-0.5" onClick={() => confirm('이 QR 을 사용 중지할까요?') && op.mutate({ kind: 'revoke', t })}>QR 중지</button>}
              <button type="button" className="rounded border px-2 py-0.5" onClick={() => op.mutate({ kind: 'toggle', t })}>{t.isActive ? '사용 안 함' : '다시 사용'}</button>
              <button type="button" className="rounded border px-2 py-0.5 text-red-600" onClick={() => confirm(`테이블 ${t.label} 을(를) 삭제할까요?`) && op.mutate({ kind: 'delete', t })}>삭제</button>
            </div>
          </Card>
        ))}
      </div>
      {!tables.data.length && <p className="text-sm text-gray-500">테이블이 없습니다. 위에서 추가해 주세요.</p>}
      {showQr && <QrModal table={showQr} onClose={() => setShowQr(null)} />}
    </div>
  );
}

function QrModal({ table, onClose }: { table: TableRow; onClose: () => void }) {
  const info = useQuery({ queryKey: ['qr', table.qrCodeId], queryFn: () => api.get<{ url: string }>(`/api/merchant/qr-codes/${table.qrCodeId}`) });
  const [img, setImg] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let url: string | null = null;
    api.download(`/api/merchant/qr-codes/${table.qrCodeId}/image.png`).then((b) => setImg((url = URL.createObjectURL(b)))).catch(setError);
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [table.qrCodeId]);
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm space-y-3 rounded-2xl bg-white p-5 text-center" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold">테이블 {table.label}</h3>
        <ErrorBox error={error ?? info.error} />
        {img ? <img src={img} alt={`테이블 ${table.label} QR`} className="mx-auto w-64" /> : <Spinner />}
        {info.data && <p className="break-all text-xs text-gray-500">{info.data.url}</p>}
        <div className="flex justify-center gap-2">
          {img && <a href={img} download={`table-${table.label}.png`} className="rounded-lg border px-4 py-2 text-sm font-semibold">PNG 저장</a>}
          <Button tone="secondary" onClick={onClose}>닫기</Button>
        </div>
      </div>
    </div>
  );
}
