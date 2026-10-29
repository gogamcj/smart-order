import { describe, expect, it } from 'vitest';
import { addLine, groupError, setQuantity, toggleOption } from '../src/cart.js';
import type { OptionGroup } from '../src/types.js';

const spicy: OptionGroup = { id: 'g1', name: '맵기', minSelect: 1, maxSelect: 1, options: [{ id: 'mild', name: '순한맛', extraPrice: 0, soldOut: false }, { id: 'hot', name: '매운맛', extraPrice: 500, soldOut: false }] };
const extra: OptionGroup = { id: 'g2', name: '추가', minSelect: 0, maxSelect: 2, options: ['a', 'b', 'c'].map((id) => ({ id, name: id, extraPrice: 1000, soldOut: false })) };

describe('장바구니', () => {
  it('같은 메뉴·같은 옵션은 수량을 합치고, 옵션 순서는 상관없다', () => {
    let lines = addLine([], { menuId: 'm', name: '찌개', optionIds: ['a', 'b'], optionLabels: [], estimatedUnit: 1, quantity: 1 });
    lines = addLine(lines, { menuId: 'm', name: '찌개', optionIds: ['b', 'a'], optionLabels: [], estimatedUnit: 1, quantity: 2 });
    lines = addLine(lines, { menuId: 'm', name: '찌개', optionIds: ['a'], optionLabels: [], estimatedUnit: 1, quantity: 1 });
    expect(lines.map((l) => l.quantity)).toEqual([3, 1]);
    expect(setQuantity(lines, lines[0]!.key, 0)).toHaveLength(1);
    expect(setQuantity(lines, lines[0]!.key, 500)[0]!.quantity).toBe(99);
  });

  it('필수 1개 그룹은 라디오처럼, 최대 개수를 넘는 선택은 무시', () => {
    expect(groupError(spicy, [])).toBe('맵기을(를) 선택해 주세요');
    let sel = toggleOption(spicy, [], 'mild');
    sel = toggleOption(spicy, sel, 'hot');
    expect(sel).toEqual(['hot']);
    expect(groupError(spicy, sel)).toBeNull();
    let ex = toggleOption(extra, sel, 'a');
    ex = toggleOption(extra, ex, 'b');
    ex = toggleOption(extra, ex, 'c');
    expect(ex).toEqual(['hot', 'a', 'b']);
  });
});
