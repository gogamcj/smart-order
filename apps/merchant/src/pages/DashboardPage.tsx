import { Button, ErrorBox, Notice, Spinner } from '@qr/web';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useStoreId, useTenant } from '../session.js';
import { beep, unlockSound } from '../sound.js';
import type { MerchantOrder } from '../types.js';
import { OrderCard } from './OrderCard.js';

const COLUMNS = [
  { key: 'new', title: '신규 주문', statuses: ['placed'] },
  { key: 'cooking', title: '접수·준비 중', statuses: ['accepted', 'preparing'] },
  { key: 'ready', title: '준비 완료', statuses: ['ready'] },
] as const;

/**
 * 주문 현황판. 실시간 연결(SSE)은 4단계에서 붙이며, 지금은 5초마다 다시 조회한다.
 * 결제가 확인된 주문만 보인다.
 */
export function DashboardPage() {
  const { storeId } = useStoreId();
  const tenant = useTenant();
  const qc = useQueryClient();
  const [soundOn, setSoundOn] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const seen = useRef<Set<string> | null>(null);

  const orders = useQuery({
    queryKey: ['orders', 'board', storeId],
    queryFn: () => api.get<MerchantOrder[]>(`/api/merchant/orders?storeId=${storeId}&status=placed,accepted,preparing,ready`),
    enabled: !!storeId,
    refetchInterval: 5_000,
    refetchIntervalInBackground: true,
  });

  useEffect(() => {
    if (!orders.data) return;
    const placed = orders.data.filter((o) => o.status === 'placed').map((o) => o.id);
    if (seen.current) {
      const fresh = placed.filter((id) => !seen.current!.has(id));
      if (fresh.length && soundOn && tenant.data?.settings.orderSoundEnabled) beep();
    }
    seen.current = new Set([...(seen.current ?? []), ...placed]);
  }, [orders.data, soundOn, tenant.data?.settings.orderSoundEnabled]);

  const accepting = useMutation({
    mutationFn: (v: boolean) => api.patch('/api/merchant/settings', { acceptingOrders: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenant'] }),
  });

  if (!storeId) return <Notice>매장이 없습니다. 설정에서 매장을 추가해 주세요.</Notice>;
  const settings = tenant.data?.settings;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-lg font-bold">주문 현황</h1>
        {tenant.data?.myRole === 'tenant_admin' && settings && (
          <Button tone={settings.acceptingOrders ? 'secondary' : 'danger'} busy={accepting.isPending} onClick={() => accepting.mutate(!settings.acceptingOrders)}>
            {settings.acceptingOrders ? '주문 접수 중 · 일시 중지' : '주문 중지됨 · 다시 받기'}
          </Button>
        )}
        <Button tone={soundOn ? 'secondary' : 'primary'} onClick={async () => setSoundOn(soundOn ? false : await unlockSound())}>
          {soundOn ? '🔔 알림음 켜짐' : '🔕 알림음 켜기'}
        </Button>
      </div>
      {settings && !settings.acceptingOrders && <Notice tone="warn">주문 접수를 중지했습니다. 고객은 메뉴만 볼 수 있습니다.</Notice>}
      {settings && !settings.orderSoundEnabled && soundOn && <Notice>설정에서 신규 주문 알림음이 꺼져 있습니다.</Notice>}
      {conflict && (
        <Notice tone="warn">
          {conflict} <button type="button" className="underline" onClick={() => setConflict(null)}>닫기</button>
        </Notice>
      )}
      <ErrorBox error={orders.error} onRetry={() => void orders.refetch()} />
      {orders.isPending ? (
        <Spinner />
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {COLUMNS.map((c) => {
            const list = (orders.data ?? []).filter((o) => (c.statuses as readonly string[]).includes(o.status)).sort((a, b) => (a.placedAt ?? '').localeCompare(b.placedAt ?? ''));
            return (
              <section key={c.key} className="space-y-2">
                <h2 className="flex items-center gap-2 font-semibold text-gray-700">
                  {c.title} <span className="rounded-full bg-gray-200 px-2 text-xs">{list.length}</span>
                </h2>
                {list.map((o) => (
                  <OrderCard key={o.id} order={o} role={tenant.data!.myRole} onConflict={setConflict} />
                ))}
                {!list.length && <p className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-400">없음</p>}
              </section>
            );
          })}
        </div>
      )}
      <p className="text-xs text-gray-400">5초마다 새 주문을 확인합니다. 마지막 확인 {orders.dataUpdatedAt ? new Date(orders.dataUpdatedAt).toLocaleTimeString('ko-KR') : '-'}</p>
    </div>
  );
}
