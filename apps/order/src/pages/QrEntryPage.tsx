import { ErrorBox, Spinner } from '@qr/web';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import type { OrderContext } from '../types.js';

/** QR 스캔 진입: 서버가 토큰을 확인하고 주문 컨텍스트 쿠키를 심는다 */
export function QrEntryPage() {
  const { token = '' } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<OrderContext>(`/api/qr/${encodeURIComponent(token)}`)
      .then((ctx) => {
        if (cancelled) return;
        qc.setQueryData(['order-context'], ctx);
        void qc.invalidateQueries({ queryKey: ['menus'] });
        nav('/menu', { replace: true });
      })
      .catch((e) => !cancelled && setError(e));
    return () => {
      cancelled = true;
    };
  }, [token, nav, qc]);

  if (error)
    return (
      <div className="space-y-3 pt-10">
        <ErrorBox error={error} />
        <p className="text-sm text-gray-600">QR 코드가 바뀌었거나 사용이 중지되었을 수 있습니다. 테이블의 QR 코드를 다시 스캔하거나 직원에게 문의해 주세요.</p>
      </div>
    );
  return <Spinner label="테이블 정보를 확인하는 중" />;
}
