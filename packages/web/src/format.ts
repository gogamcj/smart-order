const wonFmt = new Intl.NumberFormat('ko-KR');

export function won(n: number): string {
  return `${wonFmt.format(n)}원`;
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function timeOnly(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

/** 주문 상태 (DB orders.status) */
export type OrderStatus = 'pending_payment' | 'placed' | 'accepted' | 'preparing' | 'ready' | 'completed' | 'rejected' | 'cancelled' | 'expired';

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending_payment: '결제 대기',
  placed: '접수 대기',
  accepted: '접수됨',
  preparing: '준비 중',
  ready: '준비 완료',
  completed: '완료',
  rejected: '거절됨',
  cancelled: '취소됨',
  expired: '결제 시간 초과',
};

export const ORDER_STATUS_TONE: Record<OrderStatus, string> = {
  pending_payment: 'bg-gray-100 text-gray-700',
  placed: 'bg-amber-100 text-amber-800',
  accepted: 'bg-blue-100 text-blue-800',
  preparing: 'bg-indigo-100 text-indigo-800',
  ready: 'bg-green-100 text-green-800',
  completed: 'bg-gray-100 text-gray-600',
  rejected: 'bg-red-100 text-red-700',
  cancelled: 'bg-red-100 text-red-700',
  expired: 'bg-gray-100 text-gray-500',
};

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  ready: '결제 전',
  pending: '결제 확인 중',
  paid: '결제 완료',
  failed: '결제 실패',
  cancelled: '결제 취소',
  partial_refunded: '부분 환불',
  refunded: '환불 완료',
};

export const REFUND_STATUS_LABEL: Record<string, string> = {
  requested: '환불 요청됨 (처리 대기)',
  processing: '환불 처리 중',
  completed: '환불 완료',
  failed: '환불 실패',
};

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
