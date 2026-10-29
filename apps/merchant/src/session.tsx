import { useQuery } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { api } from './api.js';
import type { Me, Role, Store, Tenant } from './types.js';

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/api/auth/me') });
}

export function useTenant(enabled = true) {
  // 승인·정지는 다른 사람이 바꾸므로 주기적으로 다시 읽는다
  return useQuery({ queryKey: ['tenant'], queryFn: () => api.get<Tenant>('/api/merchant/tenant'), enabled, refetchInterval: 60_000 });
}

export function useStores(enabled = true) {
  return useQuery({ queryKey: ['stores'], queryFn: () => api.get<Store[]>('/api/merchant/stores'), enabled });
}

/** 화면의 버튼 표시용. 실제 권한 검사는 서버가 한다 */
export function can(role: Role | undefined, action: 'orders' | 'cancel' | 'menus' | 'admin' | 'reports') {
  if (!role) return false;
  if (role === 'tenant_admin') return true;
  if (action === 'orders') return role === 'order_staff';
  if (action === 'menus') return role === 'menu_staff';
  if (action === 'reports') return role === 'viewer';
  return false;
}

interface StoreCtx {
  storeId: string | null;
  setStoreId(id: string): void;
}
const Ctx = createContext<StoreCtx>({ storeId: null, setStoreId: () => {} });

export function StoreProvider({ stores, children }: { stores: Store[]; children: ReactNode }) {
  const [storeId, set] = useState<string | null>(() => {
    try {
      return localStorage.getItem('qr_merchant_store');
    } catch {
      return null;
    }
  });
  useEffect(() => {
    if (stores.length && !stores.some((s) => s.id === storeId)) set(stores[0]!.id);
  }, [stores, storeId]);
  const setStoreId = (id: string) => {
    set(id);
    try {
      localStorage.setItem('qr_merchant_store', id);
    } catch {
      /* 무시 */
    }
  };
  return <Ctx.Provider value={{ storeId: stores.some((s) => s.id === storeId) ? storeId : (stores[0]?.id ?? null), setStoreId }}>{children}</Ctx.Provider>;
}

export const useStoreId = () => useContext(Ctx);
