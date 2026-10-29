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
      <div className="space-y-4 pt-24 text-center">
        <p className="text-2xl font-bold leading-snug">QR 코드를 확인할 수 없어요</p>
        <ErrorBox error={error} />
        <p className="text-sm leading-relaxed text-gray-500">QR 코드가 바뀌었거나 사용이 중지되었을 수 있습니다. 테이블의 QR 코드를 다시 스캔하거나 직원에게 문의해 주세요.</p>
      </div>
    );
  return (
    <div className="flex flex-col items-center pt-32 text-center">
      <p className="text-[1.75rem] font-bold leading-snug">
        어서오세요!
        <br />
        테이블을 확인하고 있어요
      </p>
      <Spinner label="잠시만 기다려 주세요" />
    </div>
  );
}
