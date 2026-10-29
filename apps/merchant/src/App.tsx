import { Badge, ErrorBox, Notice, Select, Spinner } from '@qr/web';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Navigate, NavLink, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import { api } from './api.js';
import { ApplyPage } from './pages/ApplyPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { HistoryPage } from './pages/HistoryPage.js';
import { LoginPage, SignupPage } from './pages/AuthPages.js';
import { MembersPage } from './pages/MembersPage.js';
import { ProductStatsPage, SalesPage } from './pages/ReportsPages.js';
import { MenusPage } from './pages/MenusPage.js';
import { SelectTenantPage } from './pages/SelectTenantPage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { TablesPage } from './pages/TablesPage.js';
import { can, StoreProvider, useMe, useStoreId, useStores, useTenant } from './session.js';
import { ROLE_LABEL } from './types.js';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route element={<RequireStaff />}>
        <Route path="/select" element={<SelectTenantPage />} />
        <Route path="/apply" element={<ApplyPage />} />
        <Route element={<RequireTenant />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/menus" element={<MenusPage />} />
          <Route path="/sales" element={<SalesPage />} />
          <Route path="/products" element={<ProductStatsPage />} />
          <Route path="/tables" element={<TablesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/members" element={<MembersPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function RequireStaff() {
  const me = useMe();
  if (me.isPending) return <Spinner />;
  if (me.isError) return <div className="p-6"><ErrorBox error={me.error} onRetry={() => void me.refetch()} /></div>;
  if (!me.data.authenticated || me.data.actorKind !== 'staff') return <Navigate to="/login" replace />;
  return <Outlet />;
}

function RequireTenant() {
  const me = useMe();
  const tenant = useTenant(!!me.data?.tenantId);
  const stores = useStores(!!me.data?.tenantId);
  if (!me.data?.tenantId) return <Navigate to={me.data?.memberships?.length ? '/select' : '/apply'} replace />;
  if (tenant.isPending || stores.isPending) return <Spinner />;
  if (tenant.isError) return <div className="p-6"><ErrorBox error={tenant.error} onRetry={() => void tenant.refetch()} /></div>;
  if (stores.isError) return <div className="p-6"><ErrorBox error={stores.error} onRetry={() => void stores.refetch()} /></div>;
  return (
    <StoreProvider stores={stores.data}>
      <Layout />
    </StoreProvider>
  );
}

const TENANT_STATUS: Record<string, { tone: 'info' | 'warn'; text: string }> = {
  pending: { tone: 'info', text: '가입 승인 대기 중입니다. 메뉴·테이블을 미리 준비할 수 있으며, 승인되면 고객 주문을 받을 수 있습니다.' },
  suspended: { tone: 'warn', text: '이용이 정지된 업체입니다. 조회만 가능하고 고객 주문을 받을 수 없습니다.' },
};

function Layout() {
  const tenant = useTenant();
  const stores = useStores();
  const me = useMe();
  const { storeId, setStoreId } = useStoreId();
  const qc = useQueryClient();
  const nav = useNavigate();
  const logout = useMutation({
    mutationFn: () => api.post('/api/auth/logout'),
    onSuccess: async () => {
      qc.clear();
      nav('/login');
    },
  });
  const t = tenant.data!;
  const role = t.myRole;
  const links = [
    { to: '/', label: '주문 현황', show: true },
    { to: '/history', label: '주문 내역', show: true },
    { to: '/menus', label: '메뉴 관리', show: true },
    { to: '/sales', label: '판매현황', show: can(role, 'reports') },
    { to: '/products', label: '상품 판매통계', show: can(role, 'reports') },
    { to: '/tables', label: '테이블·QR', show: can(role, 'admin') },
    { to: '/settings', label: '설정', show: true },
    { to: '/members', label: '직원', show: can(role, 'admin') },
  ];
  const status = TENANT_STATUS[t.status];
  const pill = 'shrink-0 rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-gray-800 hover:bg-gray-100';
  return (
    <div className="flex min-h-dvh flex-col bg-slate-100">
      <header className="sticky top-0 z-20 bg-neutral-700 text-white">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold">{t.name} 관리자</span>
            <Badge className="bg-white/15 text-white">{ROLE_LABEL[role]}</Badge>
          </div>
          {stores.data && stores.data.length > 1 && (
            <Select className="w-auto py-1 text-gray-900" value={storeId ?? ''} onChange={(e) => setStoreId(e.target.value)} aria-label="매장 선택">
              {stores.data.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          )}
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-sm text-white/70 sm:inline">{me.data?.displayName}</span>
            {(me.data?.memberships?.length ?? 0) > 1 && <NavLink to="/select" className={pill}>업체 변경</NavLink>}
            <button type="button" className={pill} onClick={() => logout.mutate()}>로그아웃</button>
          </div>
        </div>
      </header>
      <div className="flex flex-1 flex-col md:flex-row">
        {/* 넓은 화면은 왼쪽 큰 버튼, 좁은 화면은 가로로 넘기는 버튼 줄 */}
        <nav className="flex gap-2 overflow-x-auto bg-neutral-600 p-2 md:w-48 md:shrink-0 md:flex-col md:gap-3 md:overflow-visible md:p-3" aria-label="관리 메뉴">
          {links.filter((l) => l.show).map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end
              className={({ isActive }) =>
                `shrink-0 rounded-xl px-4 py-2 text-center text-sm font-bold shadow-md transition-colors md:py-5 md:text-[1.05rem] ${isActive ? 'bg-white text-blue-600' : 'bg-neutral-500/70 text-white hover:bg-neutral-500'}`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
        <main className="min-w-0 flex-1 space-y-4 p-4 md:p-5">
          {status && <Notice tone={status.tone}>{status.text}{t.statusReason && ` (사유: ${t.statusReason})`}</Notice>}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
