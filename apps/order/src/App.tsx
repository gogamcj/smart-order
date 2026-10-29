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
  return (
    <CartProvider storeId={ctx.data?.storeId ?? null}>
      <div className="mx-auto flex min-h-dvh max-w-lg flex-col bg-gray-50">
        <Header />
        <main className="flex-1 px-4 pb-28 pt-3">
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

function Header() {
  const ctx = useOrderContext();
  return (
    <header className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
      <Link to="/menu" className="min-w-0">
        <p className="truncate text-base font-bold">{ctx.data?.storeName ?? '테이블 주문'}</p>
        {ctx.data && <p className="text-xs text-gray-500">테이블 {ctx.data.tableLabel}</p>}
      </Link>
      <nav className="flex shrink-0 gap-3 text-sm text-gray-600">
        <Link to="/orders">주문 내역</Link>
        <Link to="/account">내 정보</Link>
      </nav>
    </header>
  );
}

function CartBar() {
  const { count, lines } = useCart();
  const { pathname } = useLocation();
  if (!count || pathname !== '/menu') return null;
  const est = lines.reduce((s, l) => s + l.estimatedUnit * l.quantity, 0);
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-lg p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <Link to="/cart" className="flex items-center justify-between rounded-xl bg-orange-500 px-5 py-4 font-semibold text-white shadow-lg">
        <span>장바구니 {count}개</span>
        <span>예상 {new Intl.NumberFormat('ko-KR').format(est)}원</span>
      </Link>
    </div>
  );
}
