import { z } from 'zod';
import { AppError } from '../common/errors.js';
import { localNow } from '../common/time.js';
import type { Tx } from '../db/database.js';

export const cartSchema = z.object({
  items: z
    .array(
      z.object({
        menuId: z.string().uuid(),
        quantity: z.number().int().min(1).max(99),
        optionIds: z.array(z.string().uuid()).max(30).default([]),
      }),
    )
    .min(1, '장바구니가 비어 있습니다')
    .max(50),
});
export type Cart = z.infer<typeof cartSchema>;

export interface PricedOption {
  optionId: string;
  groupName: string;
  name: string;
  extraPrice: number;
}

export interface PricedLine {
  menuId: string;
  name: string;
  listPrice: number;
  unitPrice: number;
  optionsTotal: number;
  quantity: number;
  lineTotal: number;
  options: PricedOption[];
}

export interface Quote {
  lines: PricedLine[];
  subtotal: number;
  discount: number;
  total: number;
}

export interface LineProblem {
  index: number;
  menuId: string;
  code: 'MENU_NOT_FOUND' | 'MENU_SOLD_OUT' | 'MENU_UNAVAILABLE' | 'MENU_NOT_IN_HOURS' | 'OPTION_INVALID' | 'OPTION_SOLD_OUT' | 'OPTION_COUNT';
  message: string;
}

interface StoreInfo {
  id: string;
  status: string;
  timezone: string;
  business_hours: unknown;
}

/**
 * 장바구니 금액을 서버에서 다시 계산한다. 브라우저가 보낸 가격은 사용하지 않는다.
 * tx 는 고객 RLS 컨텍스트(해당 업체)여야 하며, 다른 매장 메뉴 ID 를 섞어 보내면 MENU_NOT_FOUND 가 된다.
 */
export async function priceCart(tx: Tx, storeId: string, cart: Cart, now = new Date()): Promise<Quote> {
  const store = (await tx.selectFrom('stores').select(['id', 'status', 'timezone', 'business_hours']).where('id', '=', storeId).executeTakeFirst()) as StoreInfo | undefined;
  if (!store) throw new AppError('QR_INVALID', 403, '매장을 찾을 수 없습니다');
  if (store.status !== 'open') throw new AppError('STORE_CLOSED', 409, '지금은 주문을 받지 않는 매장입니다');
  const local = localNow(store.timezone, now);
  if (!withinBusinessHours(store.business_hours, local)) throw new AppError('STORE_CLOSED', 409, '영업시간이 아닙니다');

  const menuIds = [...new Set(cart.items.map((i) => i.menuId))];
  const menus = await tx
    .selectFrom('menus as m')
    .innerJoin('menu_categories as c', 'c.id', 'm.category_id')
    .select(['m.id', 'm.name', 'm.price', 'm.sale_price', 'm.status', 'c.is_visible', 'c.deleted_at as category_deleted'])
    .where('m.id', 'in', menuIds)
    .where('m.store_id', '=', storeId)
    .where('m.deleted_at', 'is', null)
    .execute();
  const groups = menus.length
    ? await tx.selectFrom('menu_option_groups').select(['id', 'menu_id', 'name', 'min_select', 'max_select']).where('menu_id', 'in', menus.map((m) => m.id)).execute()
    : [];
  const options = groups.length
    ? await tx.selectFrom('menu_options').select(['id', 'group_id', 'name', 'extra_price', 'status']).where('group_id', 'in', groups.map((g) => g.id)).execute()
    : [];
  const windows = menus.length
    ? await tx.selectFrom('menu_availability').select(['menu_id', 'day_of_week', 'start_time', 'end_time']).where('menu_id', 'in', menus.map((m) => m.id)).execute()
    : [];

  const problems: LineProblem[] = [];
  const lines: PricedLine[] = [];
  cart.items.forEach((item, index) => {
    const menu = menus.find((m) => m.id === item.menuId);
    const problem = (code: LineProblem['code'], message: string) => problems.push({ index, menuId: item.menuId, code, message });
    if (!menu || !menu.is_visible || menu.category_deleted) return problem('MENU_NOT_FOUND', '판매하지 않는 메뉴입니다');
    if (menu.status === 'sold_out') return problem('MENU_SOLD_OUT', `${menu.name}: 품절되었습니다`);
    if (menu.status !== 'on_sale') return problem('MENU_UNAVAILABLE', `${menu.name}: 지금은 판매하지 않습니다`);
    const menuWindows = windows.filter((w) => w.menu_id === menu.id);
    if (menuWindows.length && !menuWindows.some((w) => w.day_of_week === local.dow && w.start_time.slice(0, 5) <= local.time && local.time < w.end_time.slice(0, 5))) {
      return problem('MENU_NOT_IN_HOURS', `${menu.name}: 판매 시간이 아닙니다`);
    }

    const menuGroups = groups.filter((g) => g.menu_id === menu.id);
    const chosen: PricedOption[] = [];
    if (new Set(item.optionIds).size !== item.optionIds.length) return problem('OPTION_INVALID', `${menu.name}: 같은 옵션을 두 번 선택했습니다`);
    for (const optionId of item.optionIds) {
      const opt = options.find((o) => o.id === optionId);
      const group = opt && menuGroups.find((g) => g.id === opt.group_id);
      if (!opt || !group || opt.status === 'inactive') return problem('OPTION_INVALID', `${menu.name}: 선택할 수 없는 옵션입니다`);
      if (opt.status === 'sold_out') return problem('OPTION_SOLD_OUT', `${menu.name}: ${opt.name} 옵션이 품절되었습니다`);
      chosen.push({ optionId: opt.id, groupName: group.name, name: opt.name, extraPrice: opt.extra_price });
    }
    for (const g of menuGroups) {
      const count = chosen.filter((c) => options.find((o) => o.id === c.optionId)?.group_id === g.id).length;
      if (count < g.min_select || count > g.max_select) {
        return problem('OPTION_COUNT', `${menu.name}: '${g.name}'은(는) ${g.min_select === g.max_select ? `${g.min_select}개` : `${g.min_select}~${g.max_select}개`} 선택해야 합니다`);
      }
    }

    const unitPrice = menu.sale_price ?? menu.price;
    const optionsTotal = chosen.reduce((s, c) => s + c.extraPrice, 0);
    lines.push({
      menuId: menu.id,
      name: menu.name,
      listPrice: menu.price,
      unitPrice,
      optionsTotal,
      quantity: item.quantity,
      lineTotal: (unitPrice + optionsTotal) * item.quantity,
      options: chosen,
    });
  });

  if (problems.length) throw new AppError('CART_INVALID', 409, problems[0]!.message, problems);
  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  // 할인가는 단가에 이미 반영되어 있고, 주문 단위 할인(쿠폰 등)은 아직 없다
  const discount = 0;
  if (subtotal - discount <= 0) throw new AppError('CART_INVALID', 409, '결제 금액이 0원인 주문은 할 수 없습니다');
  if (subtotal > 10_000_000) throw new AppError('CART_INVALID', 409, '한 번에 주문할 수 있는 금액을 넘었습니다');
  return { lines, subtotal, discount, total: subtotal - discount };
}

/** business_hours 가 비어 있으면 항상 영업. 자정을 넘는 영업(예: 18:00~02:00)도 지원 */
export function withinBusinessHours(hours: unknown, local: { dow: number; time: string }): boolean {
  if (!Array.isArray(hours) || hours.length === 0) return true;
  const prevDow = (local.dow + 6) % 7;
  return (hours as { dow: number; open: string; close: string }[]).some((h) => {
    if (h.open < h.close) return h.dow === local.dow && h.open <= local.time && local.time < h.close;
    // 자정을 넘는 구간: 당일 open 이후, 또는 전날 구간의 close 이전
    return (h.dow === local.dow && local.time >= h.open) || (h.dow === prevDow && local.time < h.close);
  });
}
