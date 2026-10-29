import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { CartProvider, useCart } from './cart.js';
import { useOrderContext } from './hooks.js';
import { AccountPage } from './pages/AccountPage.js';
import { CartPage } from './pages/CartPage.js';
import { LegalPage } from './pages/LegalPage.js';
import { LoginPage } from './pages/LoginPage.js';
import { MenuPage } from './pages/MenuPage.js';
import { OrderDetailPage } from './pages/OrderDetailPage.js';
import { OrdersPage } from './pages/OrdersPage.js';
import { PaymentPage } from './pages/PaymentPage.js';
import { QrEntryPage } from './pages/QrEntryPage.js';

export function App() {
  const ctx = useOrderContext();
  const { pathname } = useLocation();
  const isMenu = pathname === '/menu';
  return (
    <CartProvider storeId={ctx.data?.storeId ?? null}>
      <div className={`mx-auto flex min-h-dvh max-w-lg flex-col md:max-w-5xl ${isMenu || pathname.startsWith('/q/') ? 'bg-white' : 'bg-gray-50'}`}>
        <Header isMenu={isMenu} />
        <main className={`flex-1 pb-28 ${isMenu ? '' : 'mx-auto w-full max-w-lg px-4 pt-3'}`}>
          <Routes>
            <Route path="/q/:token" element={<QrEntryPage />} />
            <Route path="/menu" element={<MenuPage />} />
            <Route path="/cart" element={<CartPage />} />
            <Route path="/pay/:orderId" element={<PaymentPage />} />
            <Route path="/orders" element={<OrdersPage />} />
            <Route path="/orders/:id" element={<OrderDetailPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/account" element={<AccountPage />} />
            <Route path="/legal/:kind" element={<LegalPage />} />
            <Route path="*" element={<Navigate to="/menu" replace />} />
          </Routes>
        </main>
        <CartBar />
      </div>
    </CartProvider>
  );
}

const pill = 'inline-flex h-8 shrink-0 items-center rounded-full px-3 text-[13px] font-medium transition-colors md:h-9 md:px-3.5 md:text-sm';

/** 메뉴 화면에서는 휴대폰은 큰 매장 이름, 태블릿은 한 줄 상단바. 다른 화면은 작은 상단바 */
function Header({ isMenu }: { isMenu: boolean }) {
  const ctx = useOrderContext();
  if (useLocation().pathname.startsWith('/q/')) return null;
  return (
    <header className={`top-0 z-20 border-gray-100 bg-white ${isMenu ? 'md:sticky md:border-b' : 'sticky border-b'}`}>
      <div className={`flex gap-3 px-5 md:h-16 md:items-center md:px-6 ${isMenu ? 'items-end pb-5 pt-8 md:py-0' : 'items-center py-3'}`}>
        <Link to="/menu" className="flex min-w-0 flex-1 flex-col md:flex-row md:items-baseline md:gap-3">
          {ctx.data && <p className={`text-gray-500 md:order-2 md:text-base md:font-bold md:text-gray-900 ${isMenu ? 'text-sm' : 'text-xs'}`}>테이블 {ctx.data.tableLabel}</p>}
          <p className={`truncate font-bold tracking-tight md:text-lg ${isMenu ? 'mt-1 text-[1.65rem] leading-tight md:mt-0' : 'text-base'}`}>{ctx.data?.storeName ?? '테이블 주문'}</p>
        </Link>
        <nav className="flex shrink-0 gap-2">
          <Link to="/orders" className={`${pill} border border-gray-200 text-gray-600 md:border-0 md:bg-neutral-800 md:text-white md:hover:bg-neutral-700 ${isMenu ? 'md:hidden' : ''}`}>주문 내역</Link>
          <Link to="/account" className={`${pill} border border-gray-200 text-gray-600 md:border-0 md:bg-neutral-800 md:text-white md:hover:bg-neutral-700`}>내 정보</Link>
        </nav>
      </div>
    </header>
  );
}

/** 휴대폰: 담은 게 있을 때만 검은 장바구니 버튼. 태블릿: 항상 하단 바(주문 내역 + 장바구니) */
function CartBar() {
  const { count, lines } = useCart();
  const { pathname } = useLocation();
  if (pathname !== '/menu') return null;
  const est = lines.reduce((s, l) => s + l.estimatedUnit * l.quantity, 0);
  return (
    <div className={`fixed inset-x-0 bottom-0 z-20 mx-auto max-w-lg gap-3 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:max-w-5xl md:border-t md:border-gray-100 md:bg-white md:px-6 md:py-3 ${count ? 'flex' : 'hidden md:flex'}`}>
      <Link to="/orders" className="hidden h-14 items-center gap-2 rounded-2xl bg-gray-100 px-6 font-semibold text-gray-800 hover:bg-gray-200 md:flex">
        <span aria-hidden>🧾</span>주문 내역
      </Link>
      <Link to="/cart" className="flex h-14 flex-1 items-center justify-between rounded-2xl bg-neutral-900 px-6 font-semibold text-white shadow-lg hover:bg-neutral-800 md:ml-auto md:max-w-md md:shadow-none">
        <span>장바구니{count ? ` ${count}개` : ''}</span>
        {count > 0 && <span>예상 {new Intl.NumberFormat('ko-KR').format(est)}원</span>}
      </Link>
    </div>
  );
}
