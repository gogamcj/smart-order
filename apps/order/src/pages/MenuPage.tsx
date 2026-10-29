import { Badge, Button, Notice, Spinner, won } from '@qr/web';
import { useEffect, useRef, useState } from 'react';
import { estimateUnit, groupError, MAX_QTY, toggleOption, useCart } from '../cart.js';
import { useMenus, useOrderContext } from '../hooks.js';
import type { Menu } from '../types.js';
import { ContextError } from './NoContext.js';

export function MenuPage() {
  const ctx = useOrderContext();
  const board = useMenus(ctx.isSuccess);
  const [open, setOpen] = useState<Menu | null>(null);
  // 태블릿처럼 넓은 화면은 사진을 크게, 휴대폰은 목록으로 시작
  const [big, setBig] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches);

  if (ctx.isPending) return <Spinner />;
  if (ctx.isError) return <div className="px-5"><ContextError error={ctx.error} onRetry={() => void ctx.refetch()} /></div>;
  if (board.isPending) return <Spinner label="메뉴를 불러오는 중" />;
  if (board.isError) return <div className="px-5"><ContextError error={board.error} onRetry={() => void board.refetch()} /></div>;

  const { menus } = board.data;
  const categories = board.data.categories.filter((c) => menus.some((m) => m.categoryId === c.id));
  return (
    <div>
      <div className="h-2.5 bg-gray-100 md:hidden" aria-hidden />
      {!ctx.data.acceptingOrders && (
        <div className="px-5 pt-4 md:px-6">
          <Notice tone="warn">지금은 주문을 받지 않고 있습니다. 메뉴만 볼 수 있습니다.</Notice>
        </div>
      )}
      <CategoryTabs categories={categories} big={big} onToggle={() => setBig((b) => !b)} />
      <div className="px-5 md:px-6">
        {categories.map((c) => (
          <section key={c.id} id={`cat-${c.id}`} data-cat={c.id} className="scroll-mt-16 pt-4 md:scroll-mt-36 md:pt-6">
            <h2 className="mb-2 text-xl font-bold tracking-tight">{c.name}</h2>
            {big ? (
              <div className="grid grid-cols-2 gap-x-3 gap-y-6 pt-2 md:grid-cols-3 md:gap-x-4 lg:grid-cols-4">
                {menus.filter((m) => m.categoryId === c.id).map((m) => <MenuTile key={m.id} menu={m} onClick={() => setOpen(m)} />)}
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {menus.filter((m) => m.categoryId === c.id).map((m) => <MenuRow key={m.id} menu={m} onClick={() => setOpen(m)} />)}
              </div>
            )}
          </section>
        ))}
        {!menus.length && <p className="py-16 text-center text-sm text-gray-500">등록된 메뉴가 없습니다.</p>}
      </div>
      {open && <MenuSheet menu={open} canOrder={ctx.data.acceptingOrders} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** 밑줄 탭. 스크롤 위치에 맞춰 지금 보고 있는 분류를 표시한다 */
function CategoryTabs({ categories, big, onToggle }: { categories: { id: string; name: string }[]; big: boolean; onToggle: () => void }) {
  const [active, setActive] = useState(categories[0]?.id ?? '');
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sections = Array.from(document.querySelectorAll<HTMLElement>('section[data-cat]'));
    if (!sections.length || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (hit) setActive((hit.target as HTMLElement).dataset.cat ?? '');
      },
      { rootMargin: '-140px 0px -60% 0px' },
    );
    sections.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [categories, big]);

  useEffect(() => {
    bar.current?.querySelector<HTMLElement>(`[data-tab="${active}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [active]);

  const go = (id: string) => {
    setActive(id);
    document.getElementById(`cat-${id}`)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <>
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-gray-100 bg-white px-5 md:top-16 md:px-6">
        <nav ref={bar} className="flex min-w-0 flex-1 gap-6 overflow-x-auto [scrollbar-width:none]" aria-label="메뉴 분류">
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              data-tab={c.id}
              onClick={() => go(c.id)}
              aria-current={c.id === active ? 'true' : undefined}
              className={`shrink-0 border-b-[3px] py-3.5 text-[1.05rem] transition-colors ${c.id === active ? 'border-neutral-900 font-bold text-neutral-900' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
            >
              {c.name}
            </button>
          ))}
        </nav>
        <ViewToggle big={big} onToggle={onToggle} className="hidden md:flex" />
      </div>
      {/* 휴대폰은 탭을 넓게 쓰도록 보기 전환 버튼을 탭 아래에 둔다 */}
      <div className="flex justify-end px-5 pt-4 md:hidden">
        <ViewToggle big={big} onToggle={onToggle} className="flex" />
      </div>
    </>
  );
}

function ViewToggle({ big, onToggle, className }: { big: boolean; onToggle: () => void; className: string }) {
  return (
    <button type="button" onClick={onToggle} aria-pressed={big} className={`${className} shrink-0 items-center gap-1.5 rounded-full bg-gray-100 px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200`}>
      <span aria-hidden className="grid grid-cols-2 gap-0.5">
        {[0, 1, 2, 3].map((i) => <span key={i} className={`h-1.5 w-1.5 ${big ? 'rounded-full' : 'rounded-[2px]'} bg-gray-500`} />)}
      </span>
      {big ? '목록 보기' : '크게 보기'}
    </button>
  );
}

function Tags({ menu }: { menu: Menu }) {
  const off = discountRate(menu);
  if (!menu.isPopular && !off) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {menu.isPopular && <span className="rounded-md bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-600">인기</span>}
      {off > 0 && <span className="rounded-md bg-orange-50 px-2 py-0.5 text-xs font-semibold text-orange-600">할인</span>}
    </div>
  );
}

function Price({ menu }: { menu: Menu }) {
  const off = discountRate(menu);
  if (menu.salePrice == null) return <p className="text-[1.05rem] text-gray-900">{won(menu.price)}</p>;
  return (
    <p className="flex flex-wrap items-baseline gap-x-1.5 text-[1.05rem]">
      {off > 0 && <span className="font-bold text-orange-500">{off}%</span>}
      <span className="font-semibold text-gray-900">{won(menu.salePrice)}</span>
      <span className="text-sm text-gray-400 line-through">{won(menu.price)}</span>
    </p>
  );
}

function unavailableLabel(menu: Menu) {
  return menu.soldOut ? '품절' : !menu.availableNow ? '지금 주문 불가' : null;
}

/** 휴대폰 목록형: 왼쪽 글, 오른쪽 사진 */
function MenuRow({ menu, onClick }: { menu: Menu; onClick: () => void }) {
  const off = unavailableLabel(menu);
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-4 py-5 text-left">
      <div className={`min-w-0 flex-1 space-y-1.5 ${off ? 'opacity-50' : ''}`}>
        <Tags menu={menu} />
        <p className="text-lg font-bold leading-snug">{menu.name}</p>
        {menu.description && <p className="line-clamp-2 text-sm text-gray-500">{menu.description}</p>}
        <Price menu={menu} />
        {off && !menu.imageUrl && <Badge className="bg-gray-200 text-gray-700">{off}</Badge>}
      </div>
      {menu.imageUrl && <Photo menu={menu} label={off} className="h-24 w-32 shrink-0 rounded-2xl" />}
    </button>
  );
}

/** 크게 보기(태블릿 기본): 사진 카드 격자 */
function MenuTile({ menu, onClick }: { menu: Menu; onClick: () => void }) {
  const off = unavailableLabel(menu);
  return (
    <button type="button" onClick={onClick} className="group flex flex-col text-left">
      <div className="relative w-full">
        <Photo menu={menu} label={off} className="aspect-[4/3] w-full rounded-2xl transition-transform group-active:scale-[0.98]" />
        <div className="absolute left-2 top-2"><Tags menu={menu} /></div>
      </div>
      <div className={`mt-2.5 space-y-0.5 ${off ? 'opacity-50' : ''}`}>
        <p className="font-bold leading-snug">{menu.name}</p>
        <Price menu={menu} />
      </div>
    </button>
  );
}

function Photo({ menu, label, className }: { menu: Menu; label: string | null; className: string }) {
  return (
    <div className={`relative overflow-hidden border border-gray-100 bg-gray-100 ${className}`}>
      {menu.imageUrl ? (
        <img src={menu.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-3xl text-gray-300" aria-hidden>🍽</div>
      )}
      {label && <div className="absolute inset-0 flex items-center justify-center bg-black/45 text-sm font-bold text-white">{label}</div>}
    </div>
  );
}

function discountRate(menu: Menu) {
  if (menu.salePrice == null || menu.price <= 0 || menu.salePrice >= menu.price) return 0;
  return Math.round(((menu.price - menu.salePrice) / menu.price) * 100);
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
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40 md:items-center md:p-6" onClick={onClose} role="dialog" aria-modal aria-label={menu.name}>
      <div className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:rounded-3xl md:p-6" onClick={(e) => e.stopPropagation()}>
        {menu.imageUrl && <img src={menu.imageUrl} alt="" className="mb-3 aspect-video w-full rounded-2xl object-cover" />}
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
                  <label key={o.id} className={`flex items-center justify-between rounded-xl border px-3.5 py-3 text-sm ${on ? 'border-neutral-900 bg-neutral-50' : 'border-gray-200'} ${o.soldOut ? 'opacity-50' : ''}`}>
                    <span className="flex items-center gap-2">
                      <input type={g.maxSelect === 1 ? 'radio' : 'checkbox'} name={g.id} checked={on} disabled={o.soldOut} onChange={() => setSelected((s) => toggleOption(g, s, o.id))} className="accent-neutral-900" />
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
        <Button className="mt-5 w-full rounded-2xl py-4 text-base" disabled={disabled} onClick={add}>
          {menu.soldOut ? '품절' : !menu.availableNow ? '지금은 주문할 수 없는 메뉴입니다' : !canOrder ? '주문 접수 중지' : `${won(unit * qty)} 담기`}
        </Button>
      </div>
    </div>
  );
}
