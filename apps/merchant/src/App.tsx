import { Badge, ErrorBox, Notice, Select, Spinner } from '@qr/web';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Navigate, NavLink, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import { api } from './api.js';
import { ApplyPage } from './pages/ApplyPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { HistoryPage } from './pages/HistoryPage.js';
import { LoginPage, SignupPage } from './pages/AuthPages.js';
import { MembersPage } from './pages/MembersPage.js';
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
    { to: '/menus', label: '메뉴', show: true },
    { to: '/tables', label: '테이블·QR', show: can(role, 'admin') },
    { to: '/settings', label: '설정', show: true },
    { to: '/members', label: '직원', show: can(role, 'admin') },
  ];
  const status = TENANT_STATUS[t.status];
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
          <div className="flex items-center gap-2">
            <span className="font-bold">{t.name}</span>
            <Badge className="bg-gray-100 text-gray-600">{ROLE_LABEL[role]}</Badge>
          </div>
          {stores.data && stores.data.length > 1 && (
            <Select className="w-auto py-1" value={storeId ?? ''} onChange={(e) => setStoreId(e.target.value)} aria-label="매장 선택">
              {stores.data.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          )}
          <nav className="order-last flex w-full gap-1 overflow-x-auto text-sm md:order-none md:w-auto">
            {links.filter((l) => l.show).map((l) => (
              <NavLink key={l.to} to={l.to} end className={({ isActive }) => `shrink-0 rounded-lg px-3 py-1.5 ${isActive ? 'bg-neutral-900 font-semibold text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-gray-500">
            <span className="hidden sm:inline">{me.data?.displayName}</span>
            {(me.data?.memberships?.length ?? 0) > 1 && <NavLink to="/select" className="underline">업체 변경</NavLink>}
            <button type="button" className="underline" onClick={() => logout.mutate()}>로그아웃</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl space-y-4 p-4">
        {status && <Notice tone={status.tone}>{status.text}{t.statusReason && ` (사유: ${t.statusReason})`}</Notice>}
        <Outlet />
      </main>
    </div>
  );
}
