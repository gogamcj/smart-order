import { ApiError, Badge, Button, ORDER_STATUS_LABEL, ORDER_STATUS_TONE, type OrderStatus, REFUND_STATUS_LABEL, timeOnly, won } from '@qr/web';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api.js';
import { can } from '../session.js';
import type { MerchantOrder, Role } from '../types.js';

const NEXT: Partial<Record<OrderStatus, { to: OrderStatus; label: string }[]>> = {
  placed: [{ to: 'accepted', label: '접수' }],
  accepted: [{ to: 'preparing', label: '준비 시작' }, { to: 'ready', label: '준비 완료' }],
  preparing: [{ to: 'ready', label: '준비 완료' }],
  ready: [{ to: 'completed', label: '완료 처리' }],
};

export function OrderCard({ order, role, onConflict }: { order: MerchantOrder; role: Role; onConflict: (msg: string) => void }) {
  const qc = useQueryClient();
  const [reasonFor, setReasonFor] = useState<'rejected' | 'cancelled' | null>(null);
  const [reason, setReason] = useState('');
  const change = useMutation({
    mutationFn: (v: { to: OrderStatus; reason?: string }) => api.patch<{ refundRequested: boolean }>(`/api/merchant/orders/${order.id}/status`, { to: v.to, expectedVersion: order.version, reason: v.reason }),
    onSuccess: () => {
      setReasonFor(null);
      setReason('');
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'VERSION_CONFLICT') onConflict(`${order.displayNo}번 주문은 다른 직원이 먼저 처리했습니다. 최신 상태로 바꿨습니다.`);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['orders'] }),
  });
  const canAct = can(role, 'orders');
  const canCancel = role === 'tenant_admin' || can(role, 'cancel');
  const active = ['placed', 'accepted', 'preparing', 'ready'].includes(order.status);

  return (
    <article className={`rounded-xl border bg-white p-3 shadow-sm ${order.status === 'placed' ? 'border-amber-400 ring-2 ring-amber-100' : 'border-gray-200'}`}>
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-black">{order.displayNo}</span>
          <span className="font-semibold">테이블 {order.tableLabel}</span>
        </div>
        <Badge className={ORDER_STATUS_TONE[order.status]}>{ORDER_STATUS_LABEL[order.status]}</Badge>
      </header>
      <p className="mt-0.5 text-xs text-gray-500">{timeOnly(order.placedAt)} · {order.orderNo}</p>
      <ul className="mt-2 space-y-1 text-sm">
        {order.items.map((i, idx) => (
          <li key={idx}>
            <span className="font-semibold">{i.name}</span> × {i.quantity}
            {i.options.length > 0 && <span className="block text-xs text-gray-500">{i.options.map((o) => o.name).join(', ')}</span>}
          </li>
        ))}
      </ul>
      {order.customerRequest && <p className="mt-2 rounded bg-amber-50 p-2 text-sm text-amber-900">요청: {order.customerRequest}</p>}
      <p className="mt-2 text-right text-sm font-semibold">{won(order.totalAmount)}</p>
      {order.refunds.map((r, i) => (
        <p key={i} className="text-right text-xs text-red-600">환불 {won(r.amount)} · {REFUND_STATUS_LABEL[r.status] ?? r.status}</p>
      ))}

      {active && canAct && !reasonFor && (
        <div className="mt-3 flex flex-wrap gap-2">
          {(NEXT[order.status] ?? []).map((n) => (
            <Button key={n.to} className="flex-1" busy={change.isPending && change.variables?.to === n.to} disabled={change.isPending} onClick={() => change.mutate({ to: n.to })}>
              {n.label}
            </Button>
          ))}
          {order.status === 'placed' && (
            <Button tone="secondary" disabled={change.isPending} onClick={() => setReasonFor('rejected')}>거절</Button>
          )}
          {order.status !== 'placed' && canCancel && (
            <Button tone="ghost" disabled={change.isPending} onClick={() => setReasonFor('cancelled')}>취소</Button>
          )}
        </div>
      )}
      {reasonFor && (
        <form
          className="mt-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            change.mutate({ to: reasonFor, reason });
          }}
        >
          <p className="text-sm font-semibold">{reasonFor === 'rejected' ? '주문 거절' : '주문 취소'} 사유 (고객에게 안내되며, 결제 금액은 전액 환불 요청됩니다)</p>
          <div className="flex flex-wrap gap-1">
            {['재료 소진', '주문 폭주', '영업 종료', '고객 요청'].map((r) => (
              <button key={r} type="button" className="rounded-full border px-2 py-0.5 text-xs" onClick={() => setReason(r)}>{r}</button>
            ))}
          </div>
          <input className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" required maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유 입력" />
          <div className="flex gap-2">
            <Button type="submit" tone="danger" className="flex-1" busy={change.isPending}>{reasonFor === 'rejected' ? '거절하기' : '취소하기'}</Button>
            <Button tone="secondary" onClick={() => setReasonFor(null)}>닫기</Button>
          </div>
        </form>
      )}
      {change.error && !(change.error instanceof ApiError && change.error.code === 'VERSION_CONFLICT') && <p className="mt-2 text-xs text-red-600">{(change.error as Error).message}</p>}
    </article>
  );
}
