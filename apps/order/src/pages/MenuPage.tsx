import { Badge, Button, Notice, Spinner, won } from '@qr/web';
import { useState } from 'react';
import { estimateUnit, groupError, MAX_QTY, toggleOption, useCart } from '../cart.js';
import { useMenus, useOrderContext } from '../hooks.js';
import type { Menu } from '../types.js';
import { ContextError } from './NoContext.js';

export function MenuPage() {
  const ctx = useOrderContext();
  const board = useMenus(ctx.isSuccess);
  const [open, setOpen] = useState<Menu | null>(null);

  if (ctx.isPending) return <Spinner />;
  if (ctx.isError) return <ContextError error={ctx.error} onRetry={() => void ctx.refetch()} />;
  if (board.isPending) return <Spinner label="메뉴를 불러오는 중" />;
  if (board.isError) return <ContextError error={board.error} onRetry={() => void board.refetch()} />;

  const { categories, menus } = board.data;
  return (
    <div className="space-y-4">
      {!ctx.data.acceptingOrders && <Notice tone="warn">지금은 주문을 받지 않고 있습니다. 메뉴만 볼 수 있습니다.</Notice>}
      <nav className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" aria-label="메뉴 분류">
        {categories.map((c) => (
          <a key={c.id} href={`#cat-${c.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(`cat-${c.id}`)?.scrollIntoView({ behavior: 'smooth' }); }} className="shrink-0 rounded-full border border-gray-300 bg-white px-3 py-1.5 text-sm">
            {c.name}
          </a>
        ))}
      </nav>
      {categories.map((c) => {
        const list = menus.filter((m) => m.categoryId === c.id);
        if (!list.length) return null;
        return (
          <section key={c.id} id={`cat-${c.id}`} className="scroll-mt-20 space-y-2">
            <h2 className="pt-2 text-lg font-bold">{c.name}</h2>
            {list.map((m) => (
              <MenuRow key={m.id} menu={m} onClick={() => setOpen(m)} />
            ))}
          </section>
        );
      })}
      {!menus.length && <p className="py-10 text-center text-sm text-gray-500">등록된 메뉴가 없습니다.</p>}
      {open && <MenuSheet menu={open} canOrder={ctx.data.acceptingOrders} onClose={() => setOpen(null)} />}
    </div>
  );
}

function MenuRow({ menu, onClick }: { menu: Menu; onClick: () => void }) {
  const disabled = menu.soldOut || !menu.availableNow;
  return (
    <button type="button" onClick={onClick} className={`flex w-full gap-3 rounded-xl border border-gray-200 bg-white p-3 text-left ${disabled ? 'opacity-60' : ''}`}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-semibold">{menu.name}</span>
          {menu.isPopular && <Badge className="bg-orange-100 text-orange-700">인기</Badge>}
          {menu.soldOut && <Badge className="bg-gray-200 text-gray-700">품절</Badge>}
          {!menu.soldOut && !menu.availableNow && <Badge className="bg-gray-200 text-gray-700">지금 주문 불가</Badge>}
        </div>
        {menu.description && <p className="mt-0.5 line-clamp-2 text-sm text-gray-500">{menu.description}</p>}
        <p className="mt-1 text-sm">
          {menu.salePrice != null ? (
            <>
              <span className="mr-1 text-gray-400 line-through">{won(menu.price)}</span>
              <span className="font-semibold text-orange-600">{won(menu.salePrice)}</span>
            </>
          ) : (
            <span className="font-semibold">{won(menu.price)}</span>
          )}
        </p>
      </div>
      {menu.imageUrl && <img src={menu.imageUrl} alt="" loading="lazy" className="h-20 w-20 shrink-0 rounded-lg object-cover" />}
    </button>
  );
}

function MenuSheet({ menu, canOrder, onClose }: { menu: Menu; canOrder: boolean; onClose: () => void }) {
  const cart = useCart();
  const [selected, setSelected] = useState<string[]>([]);
  const [qty, setQty] = useState(1);
  const [tried, setTried] = useState(false);
  const errors = menu.optionGroups.map((g) => groupError(g, selected)).filter((e): e is string => !!e);
  const unit = estimateUnit(menu, selected);
  const disabled = menu.soldOut || !menu.availableNow || !canOrder;

  const add = () => {
    setTried(true);
    if (errors.length || disabled) return;
    const opts = menu.optionGroups.flatMap((g) => g.options).filter((o) => selected.includes(o.id));
    cart.add({ menuId: menu.id, name: menu.name, optionIds: selected, optionLabels: opts.map((o) => o.name), estimatedUnit: unit, quantity: qty });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40" onClick={onClose} role="dialog" aria-modal aria-label={menu.name}>
      <div className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]" onClick={(e) => e.stopPropagation()}>
        {menu.imageUrl && <img src={menu.imageUrl} alt="" className="mb-3 aspect-video w-full rounded-xl object-cover" />}
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-xl font-bold">{menu.name}</h3>
          <button type="button" onClick={onClose} className="text-2xl leading-none text-gray-400" aria-label="닫기">×</button>
        </div>
        {menu.description && <p className="mt-1 text-sm text-gray-600">{menu.description}</p>}

        {menu.optionGroups.map((g) => (
          <fieldset key={g.id} className="mt-5">
            <legend className="mb-2 flex items-center gap-2 font-semibold">
              {g.name}
              <span className="text-xs font-normal text-gray-500">{g.minSelect > 0 ? `필수 · ${g.maxSelect === 1 ? '1개 선택' : `${g.minSelect}~${g.maxSelect}개`}` : `선택 · 최대 ${g.maxSelect}개`}</span>
            </legend>
            <div className="space-y-1">
              {g.options.map((o) => {
                const on = selected.includes(o.id);
                return (
                  <label key={o.id} className={`flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm ${on ? 'border-orange-500 bg-orange-50' : 'border-gray-200'} ${o.soldOut ? 'opacity-50' : ''}`}>
                    <span className="flex items-center gap-2">
                      <input type={g.maxSelect === 1 ? 'radio' : 'checkbox'} name={g.id} checked={on} disabled={o.soldOut} onChange={() => setSelected((s) => toggleOption(g, s, o.id))} className="accent-orange-500" />
                      {o.name}
                      {o.soldOut && <span className="text-xs text-gray-500">품절</span>}
                    </span>
                    {o.extraPrice > 0 && <span className="text-gray-600">+{won(o.extraPrice)}</span>}
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}

        <div className="mt-5 flex items-center justify-between">
          <span className="font-semibold">수량</span>
          <div className="flex items-center gap-3">
            <button type="button" className="h-9 w-9 rounded-full border text-lg" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="수량 줄이기">−</button>
            <span className="w-6 text-center font-semibold">{qty}</span>
            <button type="button" className="h-9 w-9 rounded-full border text-lg" onClick={() => setQty((q) => Math.min(MAX_QTY, q + 1))} aria-label="수량 늘리기">+</button>
          </div>
        </div>

        {tried && errors.length > 0 && <p className="mt-3 text-sm text-red-600">{errors[0]}</p>}
        <Button className="mt-5 w-full py-3.5 text-base" disabled={disabled} onClick={add}>
          {menu.soldOut ? '품절' : !menu.availableNow ? '지금은 주문할 수 없는 메뉴입니다' : !canOrder ? '주문 접수 중지' : `${won(unit * qty)} 담기`}
        </Button>
      </div>
    </div>
  );
}
