import { ApiError, ErrorBox, Notice } from '@qr/web';

export function ContextError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  if (error instanceof ApiError && (error.code === 'QR_CONTEXT_REQUIRED' || error.code === 'QR_INVALID'))
    return (
      <div className="pt-10">
        <Notice tone="warn">
          <p className="font-semibold">테이블 QR 코드를 스캔해 주세요</p>
          <p className="mt-1">{error.code === 'QR_INVALID' ? '이 QR 코드는 더 이상 사용할 수 없습니다. 테이블의 새 QR 코드를 스캔하거나 직원에게 문의해 주세요.' : '주문하려면 테이블에 있는 QR 코드를 휴대폰 카메라로 스캔해 주세요.'}</p>
        </Notice>
      </div>
    );
  return <ErrorBox error={error} onRetry={onRetry} />;
}
