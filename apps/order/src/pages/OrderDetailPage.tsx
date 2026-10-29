import { Badge, ErrorBox, Notice, ORDER_STATUS_LABEL, ORDER_STATUS_TONE, type OrderStatus, PAYMENT_STATUS_LABEL, REFUND_STATUS_LABEL, Spinner, timeOnly, won } from '@qr/web';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import type { OrderDetail } from '../types.js';

const ACTIVE: OrderStatus[] = ['placed', 'accepted', 'preparing', 'ready'];
const STEPS: { status: OrderStatus; label: string; at: keyof OrderDetail }[] = [
  { status: 'placed', label: '주문 접수 대기', at: 'placedAt' },
  { status: 'accepted', label: '매장 접수', at: 'acceptedAt' },
  { status: 'preparing', label: '준비 중', at: 'acceptedAt' },
  { status: 'ready', label: '준비 완료', at: 'readyAt' },
  { status: 'completed', label: '완료', at: 'completedAt' },
];

/** 주문 상태 화면. 실시간 푸시(SSE)는 4단계에서 추가하며, 지금은 진행 중인 주문을 5초마다 다시 조회한다 */
export function OrderDetailPage() {
  const { id = '' } = useParams();
  const order = useQuery({
    queryKey: ['order', id],
    queryFn: () => api.get<OrderDetail>(`/api/orders/${id}`),
    refetchInterval: (q) => (q.state.data && ACTIVE.includes(q.state.data.status) ? 5_000 : false),
  });
  if (order.isPending) return <Spinner />;
  if (order.isError) return <ErrorBox error={order.error} onRetry={() => void order.refetch()} />;
  const o = order.data;
  const stepIndex = STEPS.findIndex((s) => s.status === o.status);
  const ended = o.status === 'rejected' || o.status === 'cancelled' || o.status === 'expired';

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 bg-white p-5 text-center">
        <p className="text-sm text-gray-500">{o.storeName} · 테이블 {o.tableLabel}</p>
        <p className="mt-1 text-4xl font-black tracking-tight">{o.displayNo}</p>
        <p className="text-xs text-gray-500">주문번호 {o.orderNo}</p>
        <Badge className={`mt-3 text-sm ${ORDER_STATUS_TONE[o.status]}`}>{ORDER_STATUS_LABEL[o.status]}</Badge>
        {o.status === 'ready' && <p className="mt-3 font-semibold text-green-700">음식이 준비되었습니다!</p>}
      </div>

      {o.status === 'pending_payment' && (
        <Notice tone="warn">
          결제가 끝나지 않아 매장에 전달되지 않은 주문입니다. <Link to={`/pay/${o.id}`} className="font-semibold underline">결제하러 가기</Link>
        </Notice>
      )}
      {ended && o.status !== 'expired' && <Notice tone="warn">{o.status === 'rejected' ? '매장에서 주문을 받지 못했습니다.' : '주문이 취소되었습니다.'} 결제한 금액은 환불됩니다.</Notice>}

      {!ended && o.status !== 'pending_payment' && (
        <ol className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
          {STEPS.map((s, i) => (
            <li key={s.status} className={`flex items-center gap-3 text-sm ${i <= stepIndex ? 'text-gray-900' : 'text-gray-400'}`}>
              <span className={`h-3 w-3 rounded-full ${i < stepIndex ? 'bg-orange-300' : i === stepIndex ? 'bg-orange-500 ring-4 ring-orange-100' : 'bg-gray-200'}`} />
              <span className="flex-1">{s.label}</span>
            </li>
          ))}
        </ol>
      )}

      <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
        <ul className="space-y-2">
          {o.items.map((i) => (
            <li key={i.id} className="flex justify-between gap-2">
              <div>
                <p>
                  {i.name} × {i.quantity}
                </p>
                {i.options.length > 0 && <p className="text-xs text-gray-500">{i.options.map((x) => x.name).join(', ')}</p>}
              </div>
              <span>{won(i.lineTotal)}</span>
            </li>
          ))}
        </ul>
        {o.customerRequest && <p className="mt-3 rounded bg-gray-50 p-2 text-gray-600">요청: {o.customerRequest}</p>}
        <div className="mt-3 flex justify-between border-t pt-3 font-bold">
          <span>합계</span>
          <span>{won(o.totalAmount)}</span>
        </div>
        {o.payment && (
          <p className="mt-2 text-xs text-gray-500">
            {PAYMENT_STATUS_LABEL[o.payment.status] ?? o.payment.status}
            {o.payment.approvedAt && ` · ${timeOnly(o.payment.approvedAt)}`}
          </p>
        )}
        {o.refunds.map((r) => (
          <p key={r.id} className="mt-1 text-xs text-gray-500">
            환불 {won(r.amount)} · {REFUND_STATUS_LABEL[r.status] ?? r.status}
          </p>
        ))}
      </div>
      <Link to="/menu" className="block text-center text-sm font-semibold text-orange-600">
        추가 주문하기
      </Link>
    </div>
  );
}
