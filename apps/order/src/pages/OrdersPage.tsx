import { ApiError, Badge, dateTime, ErrorBox, ORDER_STATUS_LABEL, ORDER_STATUS_TONE, Spinner, won } from '@qr/web';
import { useQuery } from '@tanstack/react-query';
import { Link, Navigate } from 'react-router-dom';
import { api } from '../api.js';
import type { OrderSummary } from '../types.js';

export function OrdersPage() {
  const orders = useQuery({ queryKey: ['orders'], queryFn: () => api.get<OrderSummary[]>('/api/orders/me'), refetchInterval: 15_000 });
  if (orders.isPending) return <Spinner />;
  if (orders.error instanceof ApiError && orders.error.status === 401) return <Navigate to={`/login?returnTo=${encodeURIComponent('/orders')}`} replace />;
  if (orders.isError) return <ErrorBox error={orders.error} onRetry={() => void orders.refetch()} />;
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold">주문 내역</h1>
      {!orders.data.length && <p className="py-10 text-center text-sm text-gray-500">주문 내역이 없습니다.</p>}
      {orders.data.map((o) => (
        <Link key={o.id} to={o.status === 'pending_payment' ? `/pay/${o.id}` : `/orders/${o.id}`} className="block rounded-xl border border-gray-200 bg-white p-3">
          <div className="flex items-center justify-between">
            <span className="font-semibold">{o.storeName}</span>
            <Badge className={ORDER_STATUS_TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Badge>
          </div>
          <p className="mt-1 text-sm text-gray-600">
            {dateTime(o.createdAt)} · 테이블 {o.tableLabel} · {won(o.totalAmount)}
          </p>
        </Link>
      ))}
    </div>
  );
}
