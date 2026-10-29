import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { api } from './api.js';
import type { Me, MenuBoard, OrderContext } from './types.js';

export function useOrderContext() {
  // QR 진입 화면은 컨텍스트를 직접 받아 저장하므로, 그 전에 따로 조회하지 않는다
  const onQrEntry = useLocation().pathname.startsWith('/q/');
  return useQuery({ queryKey: ['order-context'], queryFn: () => api.get<OrderContext>('/api/order-context'), staleTime: 10_000, refetchInterval: 30_000, enabled: !onQrEntry });
}

export function useMenus(enabled: boolean) {
  return useQuery({ queryKey: ['menus'], queryFn: () => api.get<MenuBoard>('/api/menus'), enabled, refetchInterval: 60_000 });
}

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/api/auth/me'), staleTime: 30_000 });
}
