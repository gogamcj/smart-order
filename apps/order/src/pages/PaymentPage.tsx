import { ApiError, Button, ErrorBox, Notice, Spinner, won } from '@qr/web';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import type { OrderDetail, PaymentStart } from '../types.js';

interface ConfirmResult {
  paymentStatus: string;
  orderStatus: string;
  orderId: string;
}

/**
 * 결제 단계. 주문 확정은 서버가 PG 에 결제 결과를 다시 확인한 뒤에만 이루어진다.
 * 현재 연결된 PG 가 없으므로, 로컬 개발에서는 '테스트 결제'(가짜 PG)만 동작하며 화면에 분명히 표시한다.
 */
export function PaymentPage() {
  const { orderId = '' } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const order = useQuery({ queryKey: ['order', orderId], queryFn: () => api.get<OrderDetail>(`/api/orders/${orderId}`) });
  const [start, setStart] = useState<PaymentStart | null>(null);
  const [result, setResult] = useState<ConfirmResult | null>(null);

  const begin = useMutation({
    mutationFn: () => api.post<PaymentStart>('/api/payments', { orderId }),
    onSuccess: (s) => {
      setStart(s);
      setResult(null);
    },
  });
  const confirm = useMutation({
    mutationFn: (paymentId: string) => api.post<ConfirmResult>(`/api/payments/${paymentId}/confirm`),
    onSuccess: async (r) => {
      setResult(r);
      if (r.paymentStatus === 'paid') {
        // 이 화면이 읽어 둔 '결제 대기' 주문을 버리고 최신 상태로 다시 읽게 한다
        await qc.invalidateQueries({ queryKey: ['order', r.orderId] });
        void qc.invalidateQueries({ queryKey: ['orders'] });
        nav(`/orders/${r.orderId}`, { replace: true });
      }
    },
  });
  const fakePg = useMutation({
    mutationFn: async (outcome: 'approve' | 'fail') => {
      await api.post(`/api/dev/fake-pg/${start!.paymentRequestId}`, { outcome });
      return outcome;
    },
    onSuccess: () => confirm.mutate(start!.paymentId),
  });

  if (order.isPending) return <Spinner />;
  if (order.isError) return <ErrorBox error={order.error} onRetry={() => void order.refetch()} />;
  if (order.data.status !== 'pending_payment') return <Navigate to={`/orders/${orderId}`} replace />;

  const notConfigured = begin.error instanceof ApiError && begin.error.code === 'PAYMENT_NOT_CONFIGURED';
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">결제</h1>
      <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
        <p className="text-gray-600">주문번호 {order.data.orderNo}</p>
        <p className="mt-1 text-xl font-bold">{won(order.data.totalAmount)}</p>
        <ul className="mt-2 space-y-0.5 text-gray-600">
          {order.data.items.map((i) => (
            <li key={i.id}>
              {i.name} × {i.quantity}
            </li>
          ))}
        </ul>
      </div>

      {notConfigured ? (
        <Notice tone="warn">
          <p className="font-semibold">결제 서비스가 아직 연결되지 않았습니다</p>
          <p className="mt-1">이 매장은 아직 온라인 결제를 받을 수 없습니다. 주문은 결제 전 상태로 남아 있으며 매장에 전달되지 않았습니다. 직원에게 문의해 주세요.</p>
        </Notice>
      ) : (
        <ErrorBox error={begin.error} />
      )}

      {!start && !notConfigured && (
        <Button className="w-full py-3.5 text-base" busy={begin.isPending} onClick={() => begin.mutate()}>
          결제하기
        </Button>
      )}

      {start && start.provider === 'fake' && (
        <div className="space-y-3 rounded-xl border-2 border-dashed border-amber-400 bg-amber-50 p-4">
          <p className="text-center text-base font-bold text-amber-900">테스트 결제 (실제 결제 아님)</p>
          <p className="text-center text-xs text-amber-800">개발용 가짜 PG 입니다. 돈이 결제되지 않으며 운영 환경에서는 사용할 수 없습니다.</p>
          <div className="grid grid-cols-2 gap-2">
            <Button busy={fakePg.isPending && fakePg.variables === 'approve'} disabled={fakePg.isPending || confirm.isPending} onClick={() => fakePg.mutate('approve')}>
              테스트 승인
            </Button>
            <Button tone="secondary" busy={fakePg.isPending && fakePg.variables === 'fail'} disabled={fakePg.isPending || confirm.isPending} onClick={() => fakePg.mutate('fail')}>
              테스트 실패
            </Button>
          </div>
        </div>
      )}
      {start && start.provider !== 'fake' && <Notice tone="warn">이 결제 방식의 결제창 연동은 아직 구현되지 않았습니다.</Notice>}

      <ErrorBox error={fakePg.error ?? confirm.error} />
      {confirm.isPending && <Spinner label="결제 결과를 확인하는 중" />}
      {result?.paymentStatus === 'failed' && (
        <Notice tone="warn">
          결제가 완료되지 않았습니다. 주문은 매장에 전달되지 않았습니다.
          <Button tone="secondary" className="mt-2 w-full" busy={begin.isPending} onClick={() => begin.mutate()}>
            다시 결제하기
          </Button>
        </Notice>
      )}
      {result?.paymentStatus === 'pending' && start && (
        <Notice>
          결제 결과를 아직 받지 못했습니다.
          <Button tone="secondary" className="mt-2 w-full" busy={confirm.isPending} onClick={() => confirm.mutate(start.paymentId)}>
            결제 결과 다시 확인
          </Button>
        </Notice>
      )}
    </div>
  );
}
