import { ApiError, Button, ErrorBox, Field, Notice, Spinner, Textarea, won } from '@qr/web';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { type CartLine, useCart } from '../cart.js';
import { useMe, useOrderContext } from '../hooks.js';
import type { CartProblem, OrderDetail, Quote, Terms } from '../types.js';
import { ContextError } from './NoContext.js';

const toItems = (lines: CartLine[]) => lines.map((l) => ({ menuId: l.menuId, quantity: l.quantity, optionIds: l.optionIds }));

/** 같은 장바구니로 다시 누르면 같은 요청 키를 보내 주문이 두 번 만들어지지 않게 한다 */
function requestIdFor(signature: string) {
  const k = `qr_req:${signature}`;
  try {
    const found = sessionStorage.getItem(k);
    if (found) return found;
    const id = crypto.randomUUID();
    sessionStorage.setItem(k, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export function CartPage() {
  const ctx = useOrderContext();
  const cart = useCart();
  const me = useMe();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [agree, setAgree] = useState<Record<string, boolean>>({});
  const [priceNotice, setPriceNotice] = useState(false);

  const items = useMemo(() => toItems(cart.lines), [cart.lines]);
  const signature = JSON.stringify(items);
  const quote = useQuery({
    queryKey: ['quote', signature],
    queryFn: () => api.post<Quote>('/api/orders/quote', { items }),
    enabled: items.length > 0 && ctx.isSuccess,
    staleTime: 0,
  });
  const isCustomer = me.data?.authenticated && me.data.actorKind === 'customer';
  const terms = useQuery({ queryKey: ['terms', me.data?.userId], queryFn: () => api.get<Terms[]>('/api/auth/terms'), enabled: !!isCustomer });
  const missingTerms = (terms.data ?? []).filter((t) => t.required && !t.agreed);

  const place = useMutation({
    mutationFn: async () => {
      if (missingTerms.length) {
        await api.post('/api/auth/consents', { termsIds: missingTerms.map((t) => t.id) });
        await qc.invalidateQueries({ queryKey: ['terms'] });
      }
      return api.post<OrderDetail>('/api/orders', { items, clientRequestId: requestIdFor(signature), expectedTotal: quote.data!.total, customerRequest: note.trim() || undefined });
    },
    onSuccess: (order) => {
      cart.clear();
      nav(`/pay/${order.id}`);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'PRICE_CHANGED') {
        setPriceNotice(true);
        void quote.refetch();
      }
      if (e instanceof ApiError && e.code === 'CONSENT_REQUIRED') void terms.refetch();
    },
  });

  if (ctx.isError) return <ContextError error={ctx.error} onRetry={() => void ctx.refetch()} />;
  if (!cart.lines.length)
    return (
      <div className="space-y-4 pt-10 text-center">
        <p className="text-gray-600">장바구니가 비어 있습니다.</p>
        <Link to="/menu" className="font-semibold text-neutral-900 underline-offset-2 hover:underline">메뉴 보러 가기</Link>
      </div>
    );

  const problems: CartProblem[] = quote.error instanceof ApiError && quote.error.code === 'CART_INVALID' ? ((quote.error.details as { problems?: CartProblem[] })?.problems ?? []) : [];
  const blocking = quote.isError && !problems.length ? quote.error : null;
  const allAgreed = missingTerms.every((t) => agree[t.id]);

  const checkout = () => {
    if (!isCustomer) {
      nav(`/login?returnTo=${encodeURIComponent('/cart')}`);
      return;
    }
    place.mutate();
  };

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">장바구니</h1>
      <ul className="space-y-2">
        {cart.lines.map((l, i) => {
          const server = quote.data?.lines[i];
          const problem = problems.find((p) => p.index === i);
          return (
            <li key={l.key} className={`rounded-xl border bg-white p-3 ${problem ? 'border-red-300' : 'border-gray-200'}`}>
              <div className="flex justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold">{l.name}</p>
                  {l.optionLabels.length > 0 && <p className="text-xs text-gray-500">{l.optionLabels.join(', ')}</p>}
                  {problem && <p className="mt-1 text-xs text-red-600">{problem.message}</p>}
                </div>
                <p className="shrink-0 text-sm font-semibold">{server ? won(server.lineTotal) : '…'}</p>
              </div>
              <div className="mt-2 flex items-center justify-end gap-3">
                <button type="button" className="h-8 w-8 rounded-full border" onClick={() => cart.setQty(l.key, l.quantity - 1)} aria-label="수량 줄이기">−</button>
                <span className="w-6 text-center">{l.quantity}</span>
                <button type="button" className="h-8 w-8 rounded-full border" onClick={() => cart.setQty(l.key, l.quantity + 1)} aria-label="수량 늘리기">+</button>
              </div>
            </li>
          );
        })}
      </ul>

      {priceNotice && quote.data && <Notice tone="warn">메뉴 가격이나 구성이 바뀌어 금액을 다시 계산했습니다. 바뀐 금액을 확인한 뒤 다시 주문해 주세요.</Notice>}
      {problems.length > 0 && <Notice tone="warn">주문할 수 없는 메뉴가 있습니다. 해당 메뉴를 빼거나 수량을 바꿔 주세요.</Notice>}
      <ErrorBox error={blocking} onRetry={() => void quote.refetch()} />

      <Field label="요청 사항 (선택)">
        <Textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 덜 맵게 해 주세요" />
      </Field>

      <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
        {quote.isFetching && !quote.data ? (
          <Spinner label="금액 확인 중" />
        ) : quote.data ? (
          <dl className="space-y-1">
            <div className="flex justify-between"><dt className="text-gray-600">상품 금액</dt><dd>{won(quote.data.subtotal)}</dd></div>
            {quote.data.discount > 0 && <div className="flex justify-between"><dt className="text-gray-600">할인</dt><dd>−{won(quote.data.discount)}</dd></div>}
            <div className="flex justify-between pt-1 text-base font-bold"><dt>결제 금액</dt><dd>{won(quote.data.total)}</dd></div>
          </dl>
        ) : (
          <p className="text-gray-500">금액을 확인할 수 없습니다.</p>
        )}
        <p className="mt-2 text-xs text-gray-500">금액은 매장의 현재 가격으로 서버에서 다시 계산됩니다.</p>
      </div>

      {isCustomer && missingTerms.length > 0 && (
        <div className="space-y-2 rounded-xl border border-gray-200 bg-white p-4 text-sm">
          <p className="font-semibold">주문하려면 약관에 동의해 주세요</p>
          {missingTerms.map((t) => (
            <label key={t.id} className="flex items-center gap-2">
              <input type="checkbox" className="accent-neutral-900" checked={!!agree[t.id]} onChange={(e) => setAgree((a) => ({ ...a, [t.id]: e.target.checked }))} />
              <span>[필수] {t.title}</span>
              {t.body_url && <Link to={t.body_url} className="ml-auto text-xs text-gray-500 underline">보기</Link>}
            </label>
          ))}
        </div>
      )}

      <ErrorBox error={place.error instanceof ApiError && place.error.code === 'PRICE_CHANGED' ? null : place.error} />
      <Button className="w-full py-3.5 text-base" busy={place.isPending} disabled={!quote.data || problems.length > 0 || !ctx.data?.acceptingOrders || (isCustomer && !allAgreed)} onClick={checkout}>
        {!ctx.data?.acceptingOrders ? '지금은 주문을 받지 않습니다' : !isCustomer ? '카카오 로그인 후 주문하기' : quote.data ? `${won(quote.data.total)} 주문하기` : '주문하기'}
      </Button>
    </div>
  );
}
