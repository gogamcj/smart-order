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
  const [catId, setCatId] = useState<string | null>(null);
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
  const activeCat = catId && cats.data.some((c) => c.id === catId) ? catId : (cats.data[0]?.id ?? null);
  const list = menus.data.filter((m) => m.categoryId === activeCat);

  return (
    <div className="grid gap-4 md:grid-cols-[260px_1fr]">
      <aside className="space-y-2">
        <h2 className="font-semibold">카테고리</h2>
        {cats.data.map((c) => (
          <div key={c.id} className={`group flex items-center gap-1 rounded-lg border px-2 py-1.5 text-sm ${c.id === activeCat ? 'border-neutral-900 bg-neutral-50' : 'border-gray-200 bg-white'}`}>
            <button type="button" className="flex-1 truncate text-left" onClick={() => setCatId(c.id)}>
              {c.name} {!c.isVisible && <Badge className="bg-gray-200 text-gray-600">숨김</Badge>}
            </button>
            {editable && (
              <span className="flex gap-0.5 text-xs text-gray-500">
                <button type="button" title="위로" onClick={() => catOp.mutate({ kind: 'up', cat: c })}>▲</button>
                <button type="button" title="아래로" onClick={() => catOp.mutate({ kind: 'down', cat: c })}>▼</button>
                <button type="button" title="이름 변경" onClick={() => { const name = prompt('카테고리 이름', c.name); if (name?.trim()) catOp.mutate({ kind: 'rename', cat: c, name: name.trim() }); }}>✎</button>
                <button type="button" title={c.isVisible ? '숨기기' : '보이기'} onClick={() => catOp.mutate({ kind: 'toggle', cat: c })}>{c.isVisible ? '◉' : '○'}</button>
                <button type="button" title="삭제" onClick={() => confirm(`'${c.name}' 카테고리를 삭제할까요?`) && catOp.mutate({ kind: 'delete', cat: c })}>✕</button>
              </span>
            )}
          </div>
        ))}
        {editable && (
          <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); if (newCat.trim()) addCat.mutate(); }}>
            <Input placeholder="새 카테고리" value={newCat} maxLength={50} onChange={(e) => setNewCat(e.target.value)} />
            <Button type="submit" tone="secondary" busy={addCat.isPending}>추가</Button>
          </form>
        )}
        <ErrorBox error={addCat.error ?? catOp.error} />
      </aside>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">메뉴</h2>
          {editable && activeCat && <Button onClick={() => setEditing('new')}>메뉴 추가</Button>}
        </div>
        {!editable && <Notice>메뉴를 볼 수만 있습니다. 메뉴 수정은 업체 관리자나 메뉴 관리 직원이 할 수 있습니다.</Notice>}
        {!activeCat && <Notice>먼저 카테고리를 만들어 주세요.</Notice>}
        <ErrorBox error={menuOp.error} />
        {editing && activeCat && <MenuEditor storeId={storeId!} categories={cats.data} categoryId={activeCat} menu={editing === 'new' ? null : editing} onDone={() => { setEditing(null); void refresh(); }} />}
        <div className="grid gap-2 lg:grid-cols-2">
          {list.map((m) => (
            <Card key={m.id} className="flex gap-3">
              {m.imageUrl ? <img src={m.imageUrl} alt="" className="h-20 w-20 rounded-lg object-cover" /> : <div className="h-20 w-20 rounded-lg bg-gray-100" />}
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-1">
                  <span className="font-semibold">{m.name}</span>
                  <Badge className={m.status === 'on_sale' ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-700'}>{MENU_STATUS_LABEL[m.status]}</Badge>
                  {m.isPopular && <Badge className="bg-amber-50 text-amber-600">인기</Badge>}
                </div>
                <p className="text-sm">{m.salePrice != null ? <><s className="text-gray-400">{won(m.price)}</s> {won(m.salePrice)}</> : won(m.price)}</p>
                <p className="text-xs text-gray-500">옵션 그룹 {m.optionGroups.length}개{m.availability.length > 0 && ' · 판매 시간 지정'}</p>
                {editable && (
                  <div className="flex flex-wrap gap-1 pt-1 text-xs">
                    {(['on_sale', 'sold_out', 'paused'] as const).filter((s) => s !== m.status).map((s) => (
                      <button key={s} type="button" className="rounded border px-2 py-0.5" onClick={() => menuOp.mutate({ kind: 'status', menu: m, status: s })}>{MENU_STATUS_LABEL[s]}로</button>
                    ))}
                    <button type="button" className="rounded border px-2 py-0.5" onClick={() => setEditing(m)}>수정</button>
                    <button type="button" className="rounded border px-2 py-0.5" onClick={() => menuOp.mutate({ kind: 'duplicate', menu: m })}>복제</button>
                    <button type="button" className="rounded border px-2 py-0.5 text-red-600" onClick={() => confirm(`'${m.name}' 메뉴를 삭제할까요?`) && menuOp.mutate({ kind: 'delete', menu: m })}>삭제</button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
        {activeCat && !list.length && <p className="text-sm text-gray-500">이 카테고리에 메뉴가 없습니다.</p>}
      </section>
    </div>
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
