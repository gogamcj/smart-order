import { Badge, ErrorBox, Input, ORDER_STATUS_LABEL, ORDER_STATUS_TONE, Select, Spinner, dateTime, won } from '@qr/web';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api.js';
import { useStoreId, useTenant } from '../session.js';
import type { MerchantOrder } from '../types.js';
import { OrderCard } from './OrderCard.js';

const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });

export function HistoryPage() {
  const { storeId } = useStoreId();
  const tenant = useTenant();
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const params = new URLSearchParams({ storeId: storeId ?? '', from, to, limit: '200', ...(status ? { status } : {}), ...(q.trim() ? { q: q.trim() } : {}) });
  const orders = useQuery({ queryKey: ['orders', 'history', params.toString()], queryFn: () => api.get<MerchantOrder[]>(`/api/merchant/orders?${params}`), enabled: !!storeId });
  const total = (orders.data ?? []).filter((o) => o.status === 'completed').reduce((s, o) => s + o.totalAmount, 0);

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold">주문 내역</h1>
      <div className="flex flex-wrap gap-2">
        <Input type="date" className="w-auto" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="시작일" />
        <Input type="date" className="w-auto" value={to} onChange={(e) => setTo(e.target.value)} aria-label="종료일" />
        <Select className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="상태">
          <option value="">전체 상태</option>
          {(['placed', 'accepted', 'preparing', 'ready', 'completed', 'rejected', 'cancelled'] as const).map((s) => (
            <option key={s} value={s}>{ORDER_STATUS_LABEL[s]}</option>
          ))}
        </Select>
        <Input className="w-40" placeholder="주문번호·표시번호" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ErrorBox error={orders.error} onRetry={() => void orders.refetch()} />
      {orders.isPending ? (
        <Spinner />
      ) : (
        <>
          <p className="text-sm text-gray-600">{orders.data?.length ?? 0}건 · 완료 주문 합계 {won(total)}</p>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-500">
                <tr><th className="p-2">번호</th><th className="p-2">테이블</th><th className="p-2">시각</th><th className="p-2">메뉴</th><th className="p-2 text-right">금액</th><th className="p-2">상태</th></tr>
              </thead>
              <tbody>
                {(orders.data ?? []).map((o) => (
                  <tr key={o.id} className="cursor-pointer border-t hover:bg-gray-50" onClick={() => setOpen(open === o.id ? null : o.id)}>
                    <td className="p-2 font-semibold">{o.displayNo}</td>
                    <td className="p-2">{o.tableLabel}</td>
                    <td className="p-2 whitespace-nowrap">{dateTime(o.placedAt)}</td>
                    <td className="p-2">{o.items.map((i) => `${i.name}×${i.quantity}`).join(', ')}</td>
                    <td className="p-2 text-right">{won(o.totalAmount)}</td>
                    <td className="p-2"><Badge className={ORDER_STATUS_TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {open && orders.data?.find((o) => o.id === open) && tenant.data && (
            <div className="max-w-md">
              <OrderCard order={orders.data.find((o) => o.id === open)!} role={tenant.data.myRole} onConflict={() => void orders.refetch()} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
