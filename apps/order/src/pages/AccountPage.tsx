import { Button, ErrorBox, Notice, Spinner } from '@qr/web';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useMe } from '../hooks.js';

export function AccountPage() {
  const me = useMe();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const logout = useMutation({
    mutationFn: () => api.post('/api/auth/logout'),
    onSuccess: async () => {
      await qc.invalidateQueries();
      nav('/menu');
    },
  });
  const withdraw = useMutation({
    mutationFn: () => api.del('/api/auth/me'),
    onSuccess: async () => {
      await qc.invalidateQueries();
      nav('/menu');
    },
  });

  if (me.isPending) return <Spinner />;
  if (me.isError) return <ErrorBox error={me.error} onRetry={() => void me.refetch()} />;
  if (!me.data.authenticated || me.data.actorKind !== 'customer')
    return (
      <div className="space-y-3 pt-10 text-center">
        <p className="text-gray-600">로그인하지 않았습니다.</p>
        <Link to="/login?returnTo=/account" className="font-semibold text-orange-600">
          로그인
        </Link>
      </div>
    );
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">내 정보</h1>
      <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
        <p>{me.data.displayName ?? '고객'}님</p>
        <p className="mt-1 text-xs text-gray-500">카카오 계정으로 로그인됨</p>
      </div>
      <div className="flex gap-3 text-sm text-gray-600">
        <Link to="/legal/terms" className="underline">이용약관</Link>
        <Link to="/legal/privacy" className="underline">개인정보 처리방침</Link>
      </div>
      <Button tone="secondary" className="w-full" busy={logout.isPending} onClick={() => logout.mutate()}>
        로그아웃
      </Button>
      {!confirming ? (
        <button type="button" className="w-full text-center text-xs text-gray-400 underline" onClick={() => setConfirming(true)}>
          회원 탈퇴
        </button>
      ) : (
        <Notice tone="warn">
          <p>탈퇴하면 카카오 연결과 연락처가 삭제됩니다. 주문·결제 기록은 법령에 따른 보존 기간 동안 개인을 알아볼 수 없는 형태로 남습니다.</p>
          <ErrorBox error={withdraw.error} />
          <div className="mt-2 flex gap-2">
            <Button tone="danger" busy={withdraw.isPending} onClick={() => withdraw.mutate()}>
              탈퇴하기
            </Button>
            <Button tone="secondary" onClick={() => setConfirming(false)}>
              취소
            </Button>
          </div>
        </Notice>
      )}
    </div>
  );
}
