import { Button, ErrorBox, Field, Input, Notice } from '@qr/web';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, devLoginEnabled } from '../api.js';

const ERRORS: Record<string, string> = {
  cancelled: '카카오 로그인을 취소했습니다. 주문하려면 로그인이 필요합니다.',
  invalid_state: '로그인 요청이 만료되었거나 올바르지 않습니다. 다시 시도해 주세요.',
  kakao_error: '카카오 로그인 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.',
  kakao_not_configured: '카카오 로그인이 아직 설정되지 않았습니다. 매장 직원에게 문의해 주세요.',
  account_unavailable: '사용할 수 없는 계정입니다.',
};

/** 앱 내부 경로만 복귀 대상으로 허용한다(서버도 다시 검사) */
function safeReturnTo(v: string | null) {
  return v && /^\/(?![/\\])/.test(v) ? v : '/menu';
}

export function LoginPage() {
  const [params] = useSearchParams();
  const returnTo = safeReturnTo(params.get('returnTo'));
  const error = params.get('error');

  const kakao = () => {
    window.location.href = api.url(`/api/auth/kakao/start?returnTo=${encodeURIComponent(returnTo)}`);
  };

  return (
    <div className="space-y-5 pt-8">
      <div className="text-center">
        <h1 className="text-xl font-bold">로그인</h1>
        <p className="mt-1 text-sm text-gray-600">주문과 주문 상태 확인을 위해 카카오 계정으로 로그인해 주세요.</p>
      </div>
      {error && <Notice tone="warn">{ERRORS[error] ?? '로그인하지 못했습니다. 다시 시도해 주세요.'}</Notice>}
      <button type="button" onClick={kakao} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#FEE500] py-3.5 text-base font-semibold text-black/85">
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
          <path fill="currentColor" d="M12 3C6.48 3 2 6.48 2 10.8c0 2.78 1.86 5.22 4.65 6.6l-.95 3.48c-.08.3.26.54.52.37l4.13-2.73c.54.06 1.09.1 1.65.1 5.52 0 10-3.48 10-7.82S17.52 3 12 3z" />
        </svg>
        카카오로 시작하기
      </button>
      <p className="text-center text-xs text-gray-500">로그인하면 이용약관과 개인정보 처리방침을 확인하고 동의하는 단계가 있습니다.</p>
      {devLoginEnabled && <DevLogin returnTo={returnTo} />}
    </div>
  );
}

/** 로컬 개발 전용. 서버도 APP_ENV=local 이고 DEV_LOGIN_ENABLED=true 일 때만 허용한다 */
function DevLogin({ returnTo }: { returnTo: string }) {
  const [nickname, setNickname] = useState('테스트고객');
  const nav = useNavigate();
  const qc = useQueryClient();
  const login = useMutation({
    mutationFn: () => api.post('/api/auth/dev-login', { nickname }),
    onSuccess: async () => {
      await qc.invalidateQueries();
      nav(returnTo, { replace: true });
    },
  });
  return (
    <div className="space-y-2 rounded-xl border-2 border-dashed border-gray-300 p-4">
      <p className="text-sm font-semibold text-gray-700">개발용 로그인 (카카오 로그인 아님)</p>
      <Field label="닉네임">
        <Input value={nickname} onChange={(e) => setNickname(e.target.value)} />
      </Field>
      <ErrorBox error={login.error} />
      <Button tone="secondary" className="w-full" busy={login.isPending} onClick={() => login.mutate()}>
        개발용 로그인
      </Button>
    </div>
  );
}
