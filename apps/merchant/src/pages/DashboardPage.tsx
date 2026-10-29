import { Button, ErrorBox, Notice, Spinner, timeOnly, won } from '@qr/web';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useStoreId, useTenant } from '../session.js';
import { beep, unlockSound } from '../sound.js';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader.js';
import type { MerchantOrder, Role, TableRow } from '../types.js';
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
  const [view, setView] = useState<'tables' | 'columns'>(() => {
    try {
      return localStorage.getItem('qr_merchant_board_view') === 'columns' ? 'columns' : 'tables';
    } catch {
      return 'tables';
    }
  });
  const changeView = (v: 'tables' | 'columns') => {
    setView(v);
    try {
      localStorage.setItem('qr_merchant_board_view', v);
    } catch {
      /* 무시 */
    }
  };
  const [openTable, setOpenTable] = useState<TableRow | null>(null);
  const tables = useQuery({ queryKey: ['tables', storeId], queryFn: () => api.get<TableRow[]>(`/api/merchant/tables?storeId=${storeId}`), enabled: !!storeId });

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
  const role = tenant.data!.myRole;
  return (
    <div className="space-y-4">
      <PageHeader title="주문 현황" desc="각 테이블의 주문을 확인하고 처리합니다.">
        {role === 'tenant_admin' && settings && (
          <Button tone={settings.acceptingOrders ? 'secondary' : 'danger'} busy={accepting.isPending} onClick={() => accepting.mutate(!settings.acceptingOrders)}>
            {settings.acceptingOrders ? '주문 접수 중 · 일시 중지' : '주문 중지됨 · 다시 받기'}
          </Button>
        )}
        <Button tone={soundOn ? 'secondary' : 'primary'} onClick={async () => setSoundOn(soundOn ? false : await unlockSound())}>
          {soundOn ? '🔔 알림음 켜짐' : '🔕 알림음 켜기'}
        </Button>
      </PageHeader>
      {settings && !settings.acceptingOrders && <Notice tone="warn">주문 접수를 중지했습니다. 고객은 메뉴만 볼 수 있습니다.</Notice>}
      {settings && !settings.orderSoundEnabled && soundOn && <Notice>설정에서 신규 주문 알림음이 꺼져 있습니다.</Notice>}
      {conflict && (
        <Notice tone="warn">
          {conflict} <button type="button" className="underline" onClick={() => setConflict(null)}>닫기</button>
        </Notice>
      )}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-gray-200 bg-white px-5 py-3 text-sm">
        {view === 'tables' && TILE_STATES.map((t) => (
          <span key={t.key} className="flex items-center gap-1.5 font-medium text-gray-700"><span className={`h-3.5 w-3.5 rounded ${t.dot}`} aria-hidden />{t.label}</span>
        ))}
        <div className="ml-auto flex rounded-full border border-gray-300 p-0.5 text-xs font-semibold">
          {(['tables', 'columns'] as const).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => changeView(v)} className={`rounded-full px-3 py-1 ${view === v ? 'bg-slate-700 text-white' : 'text-gray-600'}`}>{v === 'tables' ? '테이블 보기' : '처리 단계별 보기'}</button>
          ))}
        </div>
      </div>
      <ErrorBox error={orders.error ?? tables.error} onRetry={() => void Promise.all([orders.refetch(), tables.refetch()])} />
      {orders.isPending || (view === 'tables' && tables.isPending) ? (
        <Spinner />
      ) : view === 'tables' ? (
        <TableGrid tables={(tables.data ?? []).filter((t) => t.isActive)} orders={orders.data ?? []} onOpen={setOpenTable} />
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
                  <OrderCard key={o.id} order={o} role={role} onConflict={setConflict} />
                ))}
                {!list.length && <p className="rounded-xl border border-dashed border-gray-300 bg-white/50 p-6 text-center text-sm text-gray-400">없음</p>}
              </section>
            );
          })}
        </div>
      )}
      {openTable && (
        <TableSheet
          label={openTable.label}
          orders={(orders.data ?? []).filter((o) => o.tableId === openTable.id).sort((a, b) => (a.placedAt ?? '').localeCompare(b.placedAt ?? ''))}
          role={role}
          onConflict={setConflict}
          onClose={() => setOpenTable(null)}
        />
      )}
      <p className="text-xs text-gray-400">5초마다 새 주문을 확인합니다. 마지막 확인 {orders.dataUpdatedAt ? new Date(orders.dataUpdatedAt).toLocaleTimeString('ko-KR') : '-'}</p>
    </div>
  );
}

const TILE_STATES = [
  { key: 'empty', label: '비어있음', dot: 'bg-gray-300', tile: 'border-gray-200 bg-white text-gray-500' },
  { key: 'new', label: '새 주문', dot: 'bg-red-500', tile: 'border-red-500 bg-red-50 text-red-700 ring-2 ring-red-200' },
  { key: 'more', label: '추가 주문', dot: 'bg-green-500', tile: 'border-green-500 bg-green-50 text-green-700 ring-2 ring-green-200' },
  { key: 'cooking', label: '조리 중', dot: 'bg-amber-400', tile: 'border-amber-400 bg-amber-50 text-amber-800' },
  { key: 'ready', label: '준비 완료', dot: 'bg-blue-500', tile: 'border-blue-500 bg-blue-50 text-blue-700' },
] as const;
type TileState = (typeof TILE_STATES)[number];

/** 새 주문이 있으면 새 주문(이미 진행 중인 주문이 있으면 추가 주문), 아니면 조리 중 → 준비 완료 순 */
function tileState(list: MerchantOrder[]): TileState {
  const by = (k: TileState['key']) => TILE_STATES.find((t) => t.key === k)!;
  if (!list.length) return by('empty');
  const placed = list.filter((o) => o.status === 'placed').length;
  if (placed) return list.length > placed ? by('more') : by('new');
  if (list.some((o) => o.status === 'accepted' || o.status === 'preparing')) return by('cooking');
  return by('ready');
}

function TableGrid({ tables, orders, onOpen }: { tables: TableRow[]; orders: MerchantOrder[]; onOpen: (t: TableRow) => void }) {
  if (!tables.length)
    return (
      <div className="space-y-3 py-12 text-center">
        <p className="font-semibold text-red-600">테이블이 없습니다. 테이블과 QR 코드를 먼저 만들어 주세요.</p>
        <Link to="/tables" className="inline-block rounded-xl bg-slate-700 px-5 py-3 text-sm font-semibold text-white">테이블·QR 만들기</Link>
      </div>
    );
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      {tables.map((t) => {
        const list = orders.filter((o) => o.tableId === t.id);
        const st = tileState(list);
        const total = list.reduce((s, o) => s + o.totalAmount, 0);
        const first = list.map((o) => o.placedAt).filter(Boolean).sort()[0];
        return (
          <button key={t.id} type="button" onClick={() => onOpen(t)} aria-label={`테이블 ${t.label} · ${st.label}${list.length ? ` · 주문 ${list.length}건` : ''}`} className={`flex aspect-[4/3] flex-col rounded-2xl border-2 p-3 text-left shadow-sm transition-transform hover:-translate-y-0.5 ${st.tile}`}>
            <span className="text-2xl font-black text-gray-900">{t.label}</span>
            <span className="text-sm font-bold">{st.label}</span>
            {list.length > 0 && (
              <span className="mt-auto flex flex-wrap items-end justify-between gap-x-2 text-xs text-gray-600">
                <span>{list.length}건 · {first ? timeOnly(first) : ''}</span>
                <b className="text-sm text-gray-900">{won(total)}</b>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function TableSheet({ label, orders, role, onConflict, onClose }: { label: string; orders: MerchantOrder[]; role: Role; onConflict: (m: string) => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-black/30" onClick={onClose} role="dialog" aria-modal aria-label={`테이블 ${label} 주문`}>
      <div className="h-full w-full max-w-md space-y-3 overflow-y-auto bg-slate-100 p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">테이블 {label}</h2>
          <Button tone="secondary" onClick={onClose}>닫기</Button>
        </div>
        {orders.map((o) => (
          <OrderCard key={o.id} order={o} role={role} onConflict={onConflict} />
        ))}
        {!orders.length && <p className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-400">진행 중인 주문이 없습니다.</p>}
      </div>
    </div>
  );
}
