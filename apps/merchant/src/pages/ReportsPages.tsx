import { ErrorBox, Spinner, timeOnly, won } from '@qr/web';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { api } from '../api.js';
import { PageHeader } from '../components/PageHeader.js';
import { useStoreId } from '../session.js';

// ── 기간 ─────────────────────────────────────────────────────────────

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const todayKst = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
const addDays = (s: string, n: number) => ymd(new Date(Date.parse(s) + n * 86_400_000));
const monthStart = (s: string) => `${s.slice(0, 7)}-01`;
const prevMonthEnd = (s: string) => addDays(monthStart(s), -1);

type Range = { from: string; to: string };
const PRESETS: { label: string; range: () => Range }[] = [
  { label: '오늘', range: () => ({ from: todayKst(), to: todayKst() }) },
  { label: '어제', range: () => ({ from: addDays(todayKst(), -1), to: addDays(todayKst(), -1) }) },
  { label: '이번달', range: () => ({ from: monthStart(todayKst()), to: todayKst() }) },
  { label: '지난달', range: () => ({ from: monthStart(prevMonthEnd(todayKst())), to: prevMonthEnd(todayKst()) }) },
];

function PeriodBar({ range, onChange, onExport, exportDisabled }: { range: Range; onChange: (r: Range) => void; onExport: () => void; exportDisabled: boolean }) {
  const dateCls = 'rounded-md bg-slate-600 px-3 py-2 text-center text-sm font-semibold text-white [color-scheme:dark]';
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white px-5 py-3">
      <input type="date" className={dateCls} value={range.from} max={range.to} onChange={(e) => e.target.value && onChange({ ...range, from: e.target.value })} aria-label="시작일" />
      <span className="text-gray-400">~</span>
      <input type="date" className={dateCls} value={range.to} min={range.from} onChange={(e) => e.target.value && onChange({ ...range, to: e.target.value })} aria-label="종료일" />
      <div className="ml-1 flex flex-wrap gap-1.5">
        {PRESETS.map((p) => {
          const r = p.range();
          const on = r.from === range.from && r.to === range.to;
          return (
            <button key={p.label} type="button" aria-pressed={on} onClick={() => onChange(r)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${on ? 'border-blue-600 text-blue-600' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
              {p.label}
            </button>
          );
        })}
      </div>
      <button type="button" onClick={onExport} disabled={exportDisabled} className="ml-auto rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50">
        엑셀 저장
      </button>
    </div>
  );
}

/** 엑셀에서 바로 열리는 CSV (한글이 깨지지 않도록 BOM 포함) */
function downloadCsv(name: string, rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const blob = new Blob(['﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function Panel({ title, right, children, className = '' }: { title: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl bg-white shadow-sm ${className}`}>
      <div className="flex items-center justify-between px-5 pt-4">
        <h2 className="font-semibold">{title}</h2>
        {right && <span className="text-xs text-gray-500">{right}</span>}
      </div>
      <div className="p-5 pt-3">{children}</div>
    </section>
  );
}

const Th = ({ children, className = '' }: { children?: ReactNode; className?: string }) => <th className={`px-4 py-3 font-semibold ${className}`}>{children}</th>;
const Empty = ({ cols, text = '조회된 판매 내역이 없습니다.' }: { cols: number; text?: string }) => (
  <tr>
    <td colSpan={cols} className="px-4 py-12 text-center text-sm text-gray-400">{text}</td>
  </tr>
);

/** 한 가지 값의 막대 그래프. 막대에 마우스를 올리면 값이 보인다 */
function Bars({ data }: { data: { label: string; value: number; note?: string }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...data.map((d) => d.value), 1);
  if (!data.length) return <p className="py-16 text-center text-sm text-gray-400">해당 기간에 매출이 없습니다.</p>;
  return (
    <div className="relative">
      <div className="flex h-48 items-end gap-[2px] border-b border-gray-200" role="img" aria-label="기간별 매출 막대 그래프 (아래 표와 같은 내용)">
        {data.map((d, i) => (
          <div key={d.label} className="flex h-full min-w-0 flex-1 items-end" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <div className={`mx-auto w-full max-w-10 rounded-t ${hover === i ? 'bg-slate-800' : 'bg-slate-500'}`} style={{ height: `${Math.max((d.value / max) * 100, d.value ? 2 : 0)}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-gray-500">
        <span>{data[0]!.label}</span>
        {data.length > 1 && <span>{data[data.length - 1]!.label}</span>}
      </div>
      {hover != null && (
        <div className="pointer-events-none absolute -top-2 left-1/2 -translate-x-1/2 rounded-lg bg-gray-900 px-3 py-1.5 text-xs text-white shadow">
          {data[hover]!.label} · <b>{won(data[hover]!.value)}</b>
          {data[hover]!.note && ` · ${data[hover]!.note}`}
        </div>
      )}
    </div>
  );
}

// ── 판매현황 ─────────────────────────────────────────────────────────

interface SalesReport {
  summary: { orderCount: number; refundCount: number; salesAmount: number; refundAmount: number; netAmount: number };
  daily: { date: string; orderCount: number; refundCount: number; salesAmount: number; refundAmount: number }[];
  orders: { id: string; orderNo: string; displayNo: number; date: string; placedAt: string; tableLabel: string | null; status: string; total: number; refunded: number; items: { name: string; options: string; unitPrice: number; quantity: number; lineTotal: number }[] }[];
  truncated: boolean;
}

export function SalesPage() {
  const { storeId } = useStoreId();
  const [range, setRange] = useState<Range>(PRESETS[0]!.range());
  const q = new URLSearchParams({ ...range, ...(storeId ? { storeId } : {}) });
  const report = useQuery({ queryKey: ['reports', 'sales', q.toString()], queryFn: () => api.get<SalesReport>(`/api/merchant/reports/sales?${q}`) });
  const r = report.data;

  const exportCsv = () => {
    if (!r) return;
    const rows: (string | number)[][] = [['날짜', '시간', '주문번호', '테이블', '메뉴', '옵션', '단가', '수량', '합계', '주문 총액', '환불 금액']];
    for (const o of r.orders) for (const i of o.items) rows.push([o.date, timeOnly(o.placedAt), o.orderNo, o.tableLabel ?? '', i.name, i.options, i.unitPrice, i.quantity, i.lineTotal, o.total, o.refunded]);
    downloadCsv(`판매현황_${range.from}_${range.to}.csv`, rows);
  };

  return (
    <div className="space-y-4">
      <PageHeader title="판매현황" desc="날짜별 판매와 정산 금액을 확인합니다. 결제가 승인된 주문만 셉니다." />
      <PeriodBar range={range} onChange={setRange} onExport={exportCsv} exportDisabled={!r?.orders.length} />
      <ErrorBox error={report.error} onRetry={() => void report.refetch()} />
      {report.isPending ? (
        <Spinner />
      ) : r ? (
        <>
          <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
            <Panel title="기간별 매출 추이" right={`${range.from} ~ ${range.to} · 일별`}>
              <Bars data={fillDays(range, r.daily).map((d) => ({ label: d.date.slice(5).replace('-', '.'), value: d.salesAmount, note: `${d.orderCount}건` }))} />
            </Panel>
            <section className="overflow-hidden rounded-xl bg-white shadow-sm">
              <h2 className="bg-slate-600 px-5 py-3 font-semibold text-white">정산 요약</h2>
              <dl className="divide-y divide-gray-100 px-5 text-sm">
                <Row label="주문 건수" value={`${r.summary.orderCount}건`} />
                <Row label="환불 건수" value={`${r.summary.refundCount}건`} tone="text-red-600" />
                <Row label="총 판매금액" value={won(r.summary.salesAmount)} />
                <Row label="환불 금액" value={won(r.summary.refundAmount)} tone="text-red-600" />
                <Row label={<>정산 금액 <span className="text-xs text-gray-400">(총 판매 − 환불)</span></>} value={won(r.summary.netAmount)} tone="text-lg font-bold text-blue-600" />
                <Row label="이용료" value="무료 운영 중 (청구 없음)" tone="text-gray-500" />
              </dl>
            </section>
          </div>

          <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-slate-600 text-left text-white">
                <tr><Th>날짜</Th><Th>주문</Th><Th>메뉴</Th><Th className="text-right">합계</Th><Th className="text-right">환불</Th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {r.orders.map((o) => (
                  <tr key={o.id} className="align-top">
                    <td className="whitespace-nowrap px-4 py-3 text-gray-600">{o.date}<span className="block text-xs">{timeOnly(o.placedAt)}</span></td>
                    <td className="whitespace-nowrap px-4 py-3"><b>{o.displayNo}번</b> · 테이블 {o.tableLabel ?? '-'}<span className="block text-xs text-gray-500">{o.orderNo}</span></td>
                    <td className="px-4 py-3">
                      {o.items.map((i, k) => (
                        <p key={k}>{i.name} × {i.quantity}{i.options && <span className="text-xs text-gray-500"> ({i.options})</span>}</p>
                      ))}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold">{won(o.total)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-red-600">{o.refunded ? won(o.refunded) : ''}</td>
                  </tr>
                ))}
                {!r.orders.length && <Empty cols={5} />}
              </tbody>
            </table>
            {r.truncated && <p className="p-3 text-center text-xs text-gray-500">최근 1,000건만 보여 줍니다. 기간을 줄여 주세요. (요약 금액은 전체 기준)</p>}
          </div>
        </>
      ) : null}
    </div>
  );
}

/** 두 달 이하 기간은 매출 없는 날도 0 으로 채워 날짜 간격이 그래프에 그대로 보이게 한다 */
function fillDays(range: Range, daily: SalesReport['daily']) {
  const days = (Date.parse(range.to) - Date.parse(range.from)) / 86_400_000 + 1;
  if (days > 62) return daily;
  const by = new Map(daily.map((d) => [d.date, d]));
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(range.from, i);
    return by.get(date) ?? { date, orderCount: 0, refundCount: 0, salesAmount: 0, refundAmount: 0 };
  });
}

function Row({ label, value, tone = '' }: { label: ReactNode; value: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between py-3">
      <dt className="text-gray-700">{label}</dt>
      <dd className={`font-semibold ${tone}`}>{value}</dd>
    </div>
  );
}

// ── 상품 판매통계 ─────────────────────────────────────────────────────

interface ProductReport {
  unit: 'day' | 'month';
  totals: { quantity: number; amount: number; kinds: number };
  ranking: { name: string; options: string; quantity: number; amount: number; share: number }[];
  trend: { period: string; quantity: number; amount: number }[];
}

export function ProductStatsPage() {
  const { storeId } = useStoreId();
  const [range, setRange] = useState<Range>(PRESETS[2]!.range());
  const [unit, setUnit] = useState<'day' | 'month'>('day');
  const [sort, setSort] = useState<'amount' | 'quantity'>('amount');
  const q = new URLSearchParams({ ...range, unit, ...(storeId ? { storeId } : {}) });
  const report = useQuery({ queryKey: ['reports', 'products', q.toString()], queryFn: () => api.get<ProductReport>(`/api/merchant/reports/products?${q}`) });
  const r = report.data;
  const ranking = r ? [...r.ranking].sort((a, b) => b[sort] - a[sort] || a.name.localeCompare(b.name)) : [];

  const exportCsv = () => {
    if (!r) return;
    const rows: (string | number)[][] = [['순위', '상품명', '옵션', '판매수량', '판매금액', '비중(%)']];
    ranking.forEach((x, i) => rows.push([i + 1, x.name, x.options, x.quantity, x.amount, x.share]));
    rows.push([], [unit === 'day' ? '날짜' : '월', '판매수량', '판매금액']);
    r.trend.forEach((t) => rows.push([t.period, t.quantity, t.amount]));
    downloadCsv(`상품판매통계_${range.from}_${range.to}.csv`, rows);
  };
  const sortBtn = (k: 'amount' | 'quantity', label: string) => (
    <button type="button" onClick={() => setSort(k)} aria-pressed={sort === k} className={`font-semibold ${sort === k ? 'underline underline-offset-4' : 'text-white/70'}`}>
      {label} {sort === k ? '▼' : ''}
    </button>
  );

  return (
    <div className="space-y-4">
      <PageHeader title="상품 판매통계" desc="기간 동안 상품(옵션 포함)이 얼마나 팔렸는지 확인합니다." />
      <PeriodBar range={range} onChange={setRange} onExport={exportCsv} exportDisabled={!r?.ranking.length} />
      <ErrorBox error={report.error} onRetry={() => void report.refetch()} />
      {report.isPending ? (
        <Spinner />
      ) : r ? (
        <>
          <div className="grid gap-px overflow-hidden rounded-xl bg-slate-700 text-white sm:grid-cols-3">
            {[['총 판매수량', `${r.totals.quantity.toLocaleString('ko-KR')}개`], ['총 판매금액', won(r.totals.amount)], ['상품 종류', `${r.totals.kinds}종`]].map(([k, v]) => (
              <p key={k} className="bg-slate-800 px-5 py-4 text-center text-sm">{k} <b className="ml-1 text-xl">{v}</b></p>
            ))}
          </div>

          <h2 className="border-l-4 border-slate-700 pl-2 font-semibold">상품 · 옵션별 판매 순위</h2>
          <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-slate-600 text-white">
                <tr><Th className="w-16 text-center">순위</Th><Th className="text-left">상품명 · 옵션</Th><Th className="text-right">{sortBtn('quantity', '판매수량')}</Th><Th className="text-right">{sortBtn('amount', '판매금액')}</Th><Th className="w-48 text-left">비중</Th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {ranking.map((x, i) => (
                  <tr key={`${x.name}|${x.options}`}>
                    <td className="px-4 py-3 text-center font-bold text-gray-500">{i + 1}</td>
                    <td className="px-4 py-3"><b>{x.name}</b>{x.options && <span className="block text-xs text-gray-500">{x.options}</span>}</td>
                    <td className="px-4 py-3 text-right">{x.quantity.toLocaleString('ko-KR')}개</td>
                    <td className="px-4 py-3 text-right font-semibold">{won(x.amount)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 rounded-full bg-gray-100"><div className="h-2 rounded-full bg-slate-500" style={{ width: `${x.share}%` }} /></div>
                        <span className="w-12 text-right text-xs text-gray-600">{x.share}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
                {!ranking.length && <Empty cols={5} />}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between">
            <h2 className="border-l-4 border-slate-700 pl-2 font-semibold">{unit === 'day' ? '일별' : '월별'} 판매 추이</h2>
            <div className="flex rounded-full border border-gray-300 bg-white p-0.5 text-xs font-semibold">
              {(['day', 'month'] as const).map((u) => (
                <button key={u} type="button" aria-pressed={unit === u} onClick={() => setUnit(u)} className={`rounded-full px-3 py-1 ${unit === u ? 'bg-slate-700 text-white' : 'text-gray-600'}`}>{u === 'day' ? '일별' : '월별'}</button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
            <table className="w-full min-w-[480px] text-sm">
              <thead className="bg-slate-600 text-white">
                <tr><Th className="text-left">{unit === 'day' ? '날짜' : '월'}</Th><Th className="text-right">판매수량</Th><Th className="text-right">판매금액</Th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {r.trend.map((t) => (
                  <tr key={t.period}>
                    <td className="px-4 py-3">{t.period}</td>
                    <td className="px-4 py-3 text-right">{t.quantity.toLocaleString('ko-KR')}개</td>
                    <td className="px-4 py-3 text-right font-semibold">{won(t.amount)}</td>
                  </tr>
                ))}
                {!r.trend.length && <Empty cols={3} />}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
