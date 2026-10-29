import { createContext, createElement, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Menu, OptionGroup } from './types.js';

/**
 * 장바구니는 화면 표시용이다. 금액은 서버 견적(/api/orders/quote)으로만 확정하며,
 * 여기서 계산한 값은 '예상 금액'으로만 보여 준다.
 */
export interface CartLine {
  key: string;
  menuId: string;
  name: string;
  optionIds: string[];
  optionLabels: string[];
  estimatedUnit: number;
  quantity: number;
}

export const MAX_QTY = 99;

export function lineKey(menuId: string, optionIds: string[]) {
  return `${menuId}:${[...optionIds].sort().join(',')}`;
}

export function addLine(lines: CartLine[], line: Omit<CartLine, 'key'>): CartLine[] {
  const key = lineKey(line.menuId, line.optionIds);
  const found = lines.find((l) => l.key === key);
  if (found) return lines.map((l) => (l.key === key ? { ...l, quantity: Math.min(MAX_QTY, l.quantity + line.quantity) } : l));
  return [...lines, { ...line, key, quantity: Math.min(MAX_QTY, line.quantity) }];
}

export function setQuantity(lines: CartLine[], key: string, quantity: number): CartLine[] {
  if (quantity <= 0) return lines.filter((l) => l.key !== key);
  return lines.map((l) => (l.key === key ? { ...l, quantity: Math.min(MAX_QTY, quantity) } : l));
}

/** 옵션 그룹 선택 개수 검사(화면 안내용. 최종 검사는 서버) */
export function groupError(group: OptionGroup, selected: string[]): string | null {
  const n = group.options.filter((o) => selected.includes(o.id)).length;
  if (n < group.minSelect) return group.minSelect === 1 && group.maxSelect === 1 ? `${group.name}을(를) 선택해 주세요` : `${group.name}: ${group.minSelect}개 이상 선택해 주세요`;
  if (n > group.maxSelect) return `${group.name}: 최대 ${group.maxSelect}개까지 선택할 수 있습니다`;
  return null;
}

export function toggleOption(group: OptionGroup, selected: string[], optionId: string): string[] {
  const inGroup = new Set(group.options.map((o) => o.id));
  const current = selected.filter((id) => inGroup.has(id));
  if (current.includes(optionId)) return selected.filter((id) => id !== optionId);
  // 하나만 고르는 그룹은 라디오처럼 바꾼다
  if (group.maxSelect === 1) return [...selected.filter((id) => !inGroup.has(id)), optionId];
  if (current.length >= group.maxSelect) return selected;
  return [...selected, optionId];
}

export function estimateUnit(menu: Menu, optionIds: string[]): number {
  const base = menu.salePrice ?? menu.price;
  const extras = menu.optionGroups.flatMap((g) => g.options).filter((o) => optionIds.includes(o.id)).reduce((s, o) => s + o.extraPrice, 0);
  return base + extras;
}

// ── React 상태 (매장별로 localStorage 에 보관) ─────────────────────────

interface CartState {
  lines: CartLine[];
  add(line: Omit<CartLine, 'key'>): void;
  setQty(key: string, qty: number): void;
  clear(): void;
  count: number;
}

const Ctx = createContext<CartState | null>(null);
const storageKey = (storeId: string) => `qr_cart_v1:${storeId}`;

function load(storeId: string | null): CartLine[] {
  if (!storeId) return [];
  try {
    const raw = localStorage.getItem(storageKey(storeId));
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(v) ? (v as CartLine[]) : [];
  } catch {
    return [];
  }
}

export function CartProvider({ storeId, children }: { storeId: string | null; children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(() => load(storeId));
  useEffect(() => setLines(load(storeId)), [storeId]);
  useEffect(() => {
    if (!storeId) return;
    try {
      localStorage.setItem(storageKey(storeId), JSON.stringify(lines));
    } catch {
      // 저장 공간이 없거나 사생활 보호 모드면 메모리에만 둔다
    }
  }, [storeId, lines]);
  const add = useCallback((l: Omit<CartLine, 'key'>) => setLines((x) => addLine(x, l)), []);
  const setQty = useCallback((k: string, q: number) => setLines((x) => setQuantity(x, k, q)), []);
  const clear = useCallback(() => setLines([]), []);
  const value = useMemo(() => ({ lines, add, setQty, clear, count: lines.reduce((s, l) => s + l.quantity, 0) }), [lines, add, setQty, clear]);
  return createElement(Ctx.Provider, { value }, children);
}

export function useCart() {
  const v = useContext(Ctx);
  if (!v) throw new Error('CartProvider 가 없습니다');
  return v;
}
