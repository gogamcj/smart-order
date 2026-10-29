import { PageHeader } from '../components/PageHeader.js';
import { Badge, Button, Card, ErrorBox, Field, fieldIssues, Input, Notice, Select, Spinner, Textarea, won } from '@qr/web';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api.js';
import { can, useStoreId, useTenant } from '../session.js';
import { type AdminMenu, type AdminOptionGroup, type Category, MENU_STATUS_LABEL, type MenuStatus } from '../types.js';

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];

export function MenusPage() {
  const { storeId } = useStoreId();
  const tenant = useTenant();
  const qc = useQueryClient();
  const editable = can(tenant.data?.myRole, 'menus');
  const cats = useQuery({ queryKey: ['categories', storeId], queryFn: () => api.get<Category[]>(`/api/merchant/categories?storeId=${storeId}`), enabled: !!storeId });
  const menus = useQuery({ queryKey: ['admin-menus', storeId], queryFn: () => api.get<AdminMenu[]>(`/api/merchant/menus?storeId=${storeId}`), enabled: !!storeId });
  const [filter, setFilter] = useState('all');
  const [catsOpen, setCatsOpen] = useState<boolean | null>(null);
  const [editing, setEditing] = useState<AdminMenu | 'new' | null>(null);
  const [newCat, setNewCat] = useState('');
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['categories'] }), qc.invalidateQueries({ queryKey: ['admin-menus'] })]);

  const addCat = useMutation({ mutationFn: () => api.post('/api/merchant/categories', { storeId, name: newCat }), onSuccess: () => { setNewCat(''); void refresh(); } });
  const catOp = useMutation({
    mutationFn: async (v: { kind: 'rename' | 'toggle' | 'delete' | 'up' | 'down'; cat: Category; name?: string }) => {
      if (v.kind === 'rename') return api.patch(`/api/merchant/categories/${v.cat.id}`, { name: v.name });
      if (v.kind === 'toggle') return api.patch(`/api/merchant/categories/${v.cat.id}`, { isVisible: !v.cat.isVisible });
      if (v.kind === 'delete') return api.del(`/api/merchant/categories/${v.cat.id}`);
      const ids = (cats.data ?? []).map((c) => c.id);
      const i = ids.indexOf(v.cat.id);
      const j = v.kind === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j]!, ids[i]!];
      return api.put('/api/merchant/categories/order', { ids });
    },
    onSettled: () => void refresh(),
  });
  const menuOp = useMutation({
    mutationFn: async (v: { kind: 'status' | 'duplicate' | 'delete'; menu: AdminMenu; status?: MenuStatus }) => {
      if (v.kind === 'status') return api.patch(`/api/merchant/menus/${v.menu.id}/status`, { status: v.status });
      if (v.kind === 'duplicate') return api.post(`/api/merchant/menus/${v.menu.id}/duplicate`);
      return api.del(`/api/merchant/menus/${v.menu.id}`);
    },
    onSettled: () => void refresh(),
  });

  if (cats.isPending || menus.isPending) return <Spinner />;
  if (cats.isError || menus.isError) return <ErrorBox error={cats.error ?? menus.error} onRetry={() => void refresh()} />;
  const catName = new Map(cats.data.map((c) => [c.id, c.name]));
  const filters: { key: string; label: string; match: (m: AdminMenu) => boolean; tone?: string }[] = [
    { key: 'all', label: '전체', match: () => true },
    ...cats.data.map((c) => ({ key: c.id, label: c.name, match: (m: AdminMenu) => m.categoryId === c.id })),
    { key: 'on_sale', label: '판매중', match: (m: AdminMenu) => m.status === 'on_sale', tone: 'text-blue-600' },
    { key: 'sold_out', label: '품절', match: (m: AdminMenu) => m.status === 'sold_out', tone: 'text-red-500' },
  ];
  const active = filters.find((x) => x.key === filter) ?? filters[0]!;
  const list = menus.data.filter(active.match);
  const showCats = catsOpen ?? cats.data.length === 0;
  // 새 메뉴는 고른 분류(없으면 첫 분류)에 만든다
  const newMenuCat = cats.data.some((c) => c.id === filter) ? filter : (cats.data[0]?.id ?? null);

  return (
    <div className="space-y-4">
      <PageHeader title="메뉴 관리" desc="메뉴를 추가·수정하고 판매 여부를 바꿉니다.">
        {editable && newMenuCat && <Button onClick={() => setEditing('new')}>메뉴 추가</Button>}
      </PageHeader>

      <section className="rounded-xl border border-gray-200 bg-white px-5 py-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">분류 관리</h2>
          <button type="button" className="rounded-full border border-gray-300 px-3 py-1 text-xs" onClick={() => setCatsOpen(!showCats)} aria-expanded={showCats}>
            {showCats ? '접기' : '펼치기'}
          </button>
        </div>
        {showCats && (
          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap gap-2">
              {cats.data.map((c) => (
                <div key={c.id} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm">
                  <span>{c.name}</span>
                  {!c.isVisible && <Badge className="bg-gray-200 text-gray-600">숨김</Badge>}
                  {editable && (
                    <span className="flex gap-1 text-xs text-gray-500">
                      <button type="button" title="앞으로" onClick={() => catOp.mutate({ kind: 'up', cat: c })}>◀</button>
                      <button type="button" title="뒤로" onClick={() => catOp.mutate({ kind: 'down', cat: c })}>▶</button>
                      <button type="button" title="이름 변경" onClick={() => { const name = prompt('분류 이름', c.name); if (name?.trim()) catOp.mutate({ kind: 'rename', cat: c, name: name.trim() }); }}>✎</button>
                      <button type="button" title={c.isVisible ? '숨기기' : '보이기'} onClick={() => catOp.mutate({ kind: 'toggle', cat: c })}>{c.isVisible ? '◉' : '○'}</button>
                      <button type="button" title="삭제" onClick={() => confirm(`'${c.name}' 분류를 삭제할까요?`) && catOp.mutate({ kind: 'delete', cat: c })}>✕</button>
                    </span>
                  )}
                </div>
              ))}
            </div>
            {editable && (
              <form className="flex max-w-sm gap-1" onSubmit={(e) => { e.preventDefault(); if (newCat.trim()) addCat.mutate(); }}>
                <Input placeholder="새 카테고리" value={newCat} maxLength={50} onChange={(e) => setNewCat(e.target.value)} />
                <Button type="submit" tone="secondary" busy={addCat.isPending}>추가</Button>
              </form>
            )}
            <ErrorBox error={addCat.error ?? catOp.error} />
          </div>
        )}
      </section>

      {!editable && <Notice>메뉴를 볼 수만 있습니다. 메뉴 수정은 업체 관리자나 메뉴 관리 직원이 할 수 있습니다.</Notice>}
      {!cats.data.length && <Notice>먼저 분류(카테고리)를 만들어 주세요.</Notice>}
      <ErrorBox error={menuOp.error} />
      {editing && newMenuCat && <MenuEditor storeId={storeId!} categories={cats.data} categoryId={editing === 'new' ? newMenuCat : editing.categoryId} menu={editing === 'new' ? null : editing} onDone={() => { setEditing(null); void refresh(); }} />}

      <div className="flex flex-wrap gap-2" role="group" aria-label="메뉴 걸러 보기">
        {filters.map((x) => {
          const on = x.key === active.key;
          return (
            <button key={x.key} type="button" aria-pressed={on} onClick={() => setFilter(x.key)} className={`rounded-full border px-3.5 py-1.5 text-sm ${on ? 'border-slate-700 bg-slate-700 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>
              {x.label} <b className={on ? '' : (x.tone ?? '')}>{menus.data.filter(x.match).length}</b>
            </button>
          );
        })}
      </div>

      <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-slate-600 text-white">
            <tr>
              {['분류', '사진', '상품명', '가격', '판매', '옵션', ''].map((h, i) => <th key={i} className="px-3 py-3 text-center font-semibold">{h}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {list.map((m) => (
              <tr key={m.id} className="align-middle">
                <td className="px-3 py-3 text-center text-gray-600">{catName.get(m.categoryId)}</td>
                <td className="px-3 py-3">
                  {m.imageUrl ? <img src={m.imageUrl} alt="" className="mx-auto h-14 w-14 rounded-lg object-cover" /> : <div className="mx-auto h-14 w-14 rounded-lg border border-dashed border-gray-300 bg-gray-50" />}
                </td>
                <td className="px-3 py-3">
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="font-semibold">{m.name}</span>
                    {m.isPopular && <Badge className="bg-amber-50 text-amber-600">인기</Badge>}
                    {m.availability.length > 0 && <Badge className="bg-gray-100 text-gray-600">판매 시간 지정</Badge>}
                  </div>
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-right">{m.salePrice != null ? <><s className="mr-1 text-gray-400">{won(m.price)}</s>{won(m.salePrice)}</> : won(m.price)}</td>
                <td className="px-3 py-3 text-center">
                  <SaleSwitch status={m.status} disabled={!editable || menuOp.isPending} onChange={(status) => menuOp.mutate({ kind: 'status', menu: m, status })} />
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-center text-xs text-gray-600">옵션 그룹 {m.optionGroups.length}개</td>
                <td className="whitespace-nowrap px-3 py-3 text-center">
                  {editable && (
                    <div className="flex justify-center gap-1 text-xs">
                      <button type="button" className="rounded-md border px-2 py-1" onClick={() => setEditing(m)}>수정</button>
                      <button type="button" className="rounded-md border px-2 py-1" onClick={() => menuOp.mutate({ kind: 'duplicate', menu: m })}>복제</button>
                      <button type="button" className="rounded-md bg-red-50 px-2 py-1 text-red-600" onClick={() => confirm(`'${m.name}' 메뉴를 삭제할까요?`) && menuOp.mutate({ kind: 'delete', menu: m })}>삭제</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list.length && <p className="p-8 text-center text-sm text-gray-400">해당하는 메뉴가 없습니다.</p>}
      </div>
    </div>
  );
}

/** 판매중 ↔ 품절 전환. 판매 중지·숨김 상태는 누르면 판매중으로 돌아간다 */
function SaleSwitch({ status, disabled, onChange }: { status: MenuStatus; disabled: boolean; onChange: (s: MenuStatus) => void }) {
  const on = status === 'on_sale';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`판매 상태: ${MENU_STATUS_LABEL[status]}`}
      disabled={disabled}
      onClick={() => onChange(on ? 'sold_out' : 'on_sale')}
      className={`relative inline-flex h-8 w-24 items-center rounded-full text-xs font-semibold transition-colors disabled:opacity-60 ${on ? 'bg-slate-700 text-white' : 'bg-gray-200 text-gray-600'}`}
    >
      <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${on ? 'right-1' : 'left-1'}`} aria-hidden />
      <span className={`w-full ${on ? 'pr-7' : 'pl-7'}`}>{MENU_STATUS_LABEL[status]}</span>
    </button>
  );
}

function MenuEditor({ storeId, categories, categoryId, menu, onDone }: { storeId: string; categories: Category[]; categoryId: string; menu: AdminMenu | null; onDone: () => void }) {
  const [f, setF] = useState({
    categoryId: menu?.categoryId ?? categoryId,
    name: menu?.name ?? '',
    description: menu?.description ?? '',
    price: String(menu?.price ?? ''),
    salePrice: menu?.salePrice != null ? String(menu.salePrice) : '',
    isPopular: menu?.isPopular ?? false,
    imageMediaId: menu?.imageMediaId ?? null,
    imageUrl: menu?.imageUrl ?? null,
  });
  const [groups, setGroups] = useState<AdminOptionGroup[]>(menu?.optionGroups ?? []);
  const [windows, setWindows] = useState(menu?.availability ?? []);
  // 새 메뉴를 만든 뒤 옵션 저장이 실패하면, 다시 저장할 때 메뉴를 또 만들지 않고 수정한다
  const [createdId, setCreatedId] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      form.append('kind', 'menu_image');
      return api.upload<{ id: string; url: string }>('/api/merchant/media', form);
    },
    onSuccess: (r) => setF((x) => ({ ...x, imageMediaId: r.id, imageUrl: r.url })),
  });

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        categoryId: f.categoryId,
        name: f.name,
        description: f.description.trim() || null,
        price: Number(f.price),
        salePrice: f.salePrice === '' ? null : Number(f.salePrice),
        isPopular: f.isPopular,
        imageMediaId: f.imageMediaId,
      };
      let id = menu?.id ?? createdId;
      if (id) await api.patch(`/api/merchant/menus/${id}`, body);
      else {
        id = (await api.post<{ id: string }>('/api/merchant/menus', { ...body, storeId })).id;
        setCreatedId(id);
      }
      await api.put(`/api/merchant/menus/${id}/option-groups`, { groups: groups.map((g) => ({ name: g.name, minSelect: g.minSelect, maxSelect: g.maxSelect, options: g.options.map((o) => ({ name: o.name, extraPrice: o.extraPrice, status: o.status ?? 'available' })) })) });
      await api.put(`/api/merchant/menus/${id}/availability`, { windows });
    },
    onSuccess: onDone,
  });
  const issues = fieldIssues(save.error);
  const issue = (k: string) => issues.find((i) => i.path === k)?.message;
  const setGroup = (i: number, g: Partial<AdminOptionGroup>) => setGroups((gs) => gs.map((x, j) => (j === i ? { ...x, ...g } : x)));

  return (
    <Card className="space-y-4 border-neutral-300">
      <h3 className="font-semibold">{menu ? '메뉴 수정' : '새 메뉴'}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="이름" error={issue('name')}><Input value={f.name} maxLength={100} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="카테고리">
          <Select value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="가격 (원)" error={issue('price')}><Input type="number" min={0} inputMode="numeric" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
        <Field label="할인가 (원, 선택)" error={issue('salePrice')} hint="비우면 할인 없음"><Input type="number" min={0} inputMode="numeric" value={f.salePrice} onChange={(e) => setF({ ...f, salePrice: e.target.value })} /></Field>
      </div>
      <Field label="설명"><Textarea rows={2} maxLength={1000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isPopular} onChange={(e) => setF({ ...f, isPopular: e.target.checked })} /> 인기 메뉴 표시</label>
      <div className="flex items-center gap-3">
        {f.imageUrl ? <img src={f.imageUrl} alt="" className="h-20 w-20 rounded-lg object-cover" /> : <div className="h-20 w-20 rounded-lg bg-gray-100" />}
        <div className="space-y-1 text-sm">
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} />
          <p className="text-xs text-gray-500">JPG·PNG·WebP, 5MB 이하. 서버에서 WebP 로 변환하고 위치정보 등 메타데이터를 지웁니다.</p>
          {f.imageMediaId && <button type="button" className="text-xs text-red-600 underline" onClick={() => setF({ ...f, imageMediaId: null, imageUrl: null })}>이미지 빼기</button>}
          {upload.isPending && <p className="text-xs">업로드 중…</p>}
          <ErrorBox error={upload.error} />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold">옵션 그룹</h4>
          <Button tone="secondary" className="py-1" onClick={() => setGroups([...groups, { name: '', minSelect: 0, maxSelect: 1, options: [{ name: '', extraPrice: 0 }] }])}>그룹 추가</Button>
        </div>
        {menu && groups.length > 0 && <p className="text-xs text-gray-500">옵션을 저장하면 그룹이 새로 만들어집니다. 이미 받은 주문의 옵션 기록은 그대로 남습니다.</p>}
        {groups.map((g, i) => (
          <div key={i} className="space-y-2 rounded-lg border border-gray-200 p-3">
            <div className="flex flex-wrap items-end gap-2">
              <Field label="그룹 이름"><Input value={g.name} maxLength={50} onChange={(e) => setGroup(i, { name: e.target.value })} placeholder="예: 맵기" /></Field>
              <Field label="최소"><Input type="number" min={0} className="w-20" value={g.minSelect} onChange={(e) => setGroup(i, { minSelect: Number(e.target.value) })} /></Field>
              <Field label="최대"><Input type="number" min={1} className="w-20" value={g.maxSelect} onChange={(e) => setGroup(i, { maxSelect: Number(e.target.value) })} /></Field>
              <Button tone="ghost" className="text-red-600" onClick={() => setGroups(groups.filter((_, j) => j !== i))}>그룹 삭제</Button>
            </div>
            {g.options.map((o, k) => (
              <div key={k} className="flex items-center gap-2">
                <Input value={o.name} maxLength={50} placeholder="옵션 이름" onChange={(e) => setGroup(i, { options: g.options.map((x, j) => (j === k ? { ...x, name: e.target.value } : x)) })} />
                <Input type="number" min={0} className="w-28" value={o.extraPrice} onChange={(e) => setGroup(i, { options: g.options.map((x, j) => (j === k ? { ...x, extraPrice: Number(e.target.value) } : x)) })} aria-label="추가 금액" />
                <Select className="w-28" value={o.status ?? 'available'} onChange={(e) => setGroup(i, { options: g.options.map((x, j) => (j === k ? { ...x, status: e.target.value as 'available' | 'sold_out' } : x)) })}>
                  <option value="available">판매</option>
                  <option value="sold_out">품절</option>
                </Select>
                <button type="button" className="text-gray-400" aria-label="옵션 삭제" onClick={() => setGroup(i, { options: g.options.filter((_, j) => j !== k) })}>✕</button>
              </div>
            ))}
            <button type="button" className="text-xs text-neutral-900 underline-offset-2 hover:underline" onClick={() => setGroup(i, { options: [...g.options, { name: '', extraPrice: 0 }] })}>+ 옵션 추가</button>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold">판매 시간 (선택)</h4>
          <Button tone="secondary" className="py-1" onClick={() => setWindows([...windows, { dayOfWeek: 1, start: '11:00', end: '14:00' }])}>시간 추가</Button>
        </div>
        {!windows.length && <p className="text-xs text-gray-500">지정하지 않으면 영업시간 내내 판매합니다.</p>}
        {windows.map((w, i) => (
          <div key={i} className="flex items-center gap-2">
            <Select className="w-20" value={w.dayOfWeek} onChange={(e) => setWindows(windows.map((x, j) => (j === i ? { ...x, dayOfWeek: Number(e.target.value) } : x)))}>
              {DAYS.map((d, n) => <option key={n} value={n}>{d}</option>)}
            </Select>
            <Input type="time" className="w-32" value={w.start} onChange={(e) => setWindows(windows.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
            ~
            <Input type="time" className="w-32" value={w.end} onChange={(e) => setWindows(windows.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />
            <button type="button" className="text-gray-400" aria-label="삭제" onClick={() => setWindows(windows.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
      </div>

      {issues.length > 0 && <ul className="text-xs text-red-600">{issues.map((x, i) => <li key={i}>{x.path ? `${x.path}: ` : ''}{x.message}</li>)}</ul>}
      <ErrorBox error={issues.length ? null : save.error} />
      <div className="flex gap-2">
        <Button busy={save.isPending} onClick={() => save.mutate()}>저장</Button>
        <Button tone="secondary" onClick={onDone}>닫기</Button>
      </div>
    </Card>
  );
}
