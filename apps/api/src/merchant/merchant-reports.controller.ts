import { Controller, Get, Query, Req } from '@nestjs/common';
import { sql } from 'kysely';
import { z } from 'zod';
import { Merchant } from '../auth/access.js';
import { AppError } from '../common/errors.js';
import type { AppRequest } from '../common/request.js';
import { parse } from '../common/zod.js';
import { Database, type Tx } from '../db/database.js';

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const periodSchema = z.object({ from: ymd, to: ymd, storeId: z.string().uuid().optional() });
const MAX_DAYS = 366;
const MAX_ORDERS = 1000;

/**
 * 판매 집계. 결제 승인된 주문(payments.status = paid/partial_refunded/refunded)만 매출로 센다.
 * 기간은 주문의 영업일(business_date) 기준이며, 환불 금액은 결제에 반영된 refunded_amount 이다.
 */
const PAID = sql`p.status IN ('paid', 'partial_refunded', 'refunded')`;

function period(query: Record<string, string>) {
  const f = parse(periodSchema, query);
  const days = (Date.parse(f.to) - Date.parse(f.from)) / 86_400_000;
  if (!(days >= 0)) throw new AppError('VALIDATION_FAILED', 422, '시작일은 종료일보다 늦을 수 없습니다');
  if (days >= MAX_DAYS) throw new AppError('VALIDATION_FAILED', 422, `조회 기간은 최대 ${MAX_DAYS}일입니다`);
  return f;
}

const storeFilter = (storeId?: string) => (storeId ? sql`AND o.store_id = ${storeId}` : sql``);

@Controller('api/merchant/reports')
export class MerchantReportsController {
  constructor(private readonly db: Database) {}

  private staff<T>(req: AppRequest, fn: (tx: Tx) => Promise<T>) {
    return this.db.asActor({ actor: 'staff', tenantId: req.merchant!.tenantId, userId: req.auth!.userId }, fn);
  }

  /** 판매현황: 정산 요약, 일별 추이, 주문별 내역 */
  @Get('sales')
  @Merchant('tenant_admin', 'viewer')
  sales(@Query() query: Record<string, string>, @Req() req: AppRequest) {
    const f = period(query);
    return this.staff(req, async (tx) => {
      const daily = await sql<{ date: string; orderCount: string; refundCount: string; salesAmount: string; refundAmount: string }>`
        SELECT o.business_date::text AS "date",
               count(*) AS "orderCount",
               count(*) FILTER (WHERE p.refunded_amount > 0) AS "refundCount",
               coalesce(sum(p.approved_amount), 0) AS "salesAmount",
               coalesce(sum(p.refunded_amount), 0) AS "refundAmount"
        FROM orders o JOIN payments p ON p.order_id = o.id
        WHERE ${PAID} AND o.business_date BETWEEN ${f.from} AND ${f.to} ${storeFilter(f.storeId)}
        GROUP BY o.business_date ORDER BY o.business_date`.execute(tx);

      const orders = await sql<{ id: string; orderNo: string; displayNo: number; date: string; placedAt: string; tableLabel: string | null; status: string; total: number; refunded: number }>`
        SELECT o.id, o.order_no AS "orderNo", o.display_no AS "displayNo", o.business_date::text AS "date", o.placed_at AS "placedAt",
               t.label AS "tableLabel", o.status, p.approved_amount AS "total", p.refunded_amount AS "refunded"
        FROM orders o JOIN payments p ON p.order_id = o.id
        LEFT JOIN store_tables t ON t.id = o.table_id
        WHERE ${PAID} AND o.business_date BETWEEN ${f.from} AND ${f.to} ${storeFilter(f.storeId)}
        ORDER BY o.placed_at DESC LIMIT ${MAX_ORDERS}`.execute(tx);

      const ids = orders.rows.map((o) => o.id);
      const items = ids.length
        ? (
            await sql<{ orderId: string; name: string; options: string; unitPrice: number; quantity: number; lineTotal: number }>`
              SELECT oi.order_id AS "orderId", oi.menu_name_snapshot AS "name",
                     coalesce((SELECT string_agg(x.option_name_snapshot, ', ' ORDER BY x.option_name_snapshot) FROM order_item_options x WHERE x.order_item_id = oi.id), '') AS "options",
                     oi.unit_price + oi.options_total AS "unitPrice", oi.quantity, oi.line_total AS "lineTotal"
              FROM order_items oi WHERE oi.order_id IN (${sql.join(ids)}) ORDER BY oi.id`.execute(tx)
          ).rows
        : [];

      const days = daily.rows.map((d) => ({ date: d.date, orderCount: Number(d.orderCount), refundCount: Number(d.refundCount), salesAmount: Number(d.salesAmount), refundAmount: Number(d.refundAmount) }));
      const sum = (k: 'orderCount' | 'refundCount' | 'salesAmount' | 'refundAmount') => days.reduce((s, d) => s + d[k], 0);
      return {
        from: f.from,
        to: f.to,
        summary: { orderCount: sum('orderCount'), refundCount: sum('refundCount'), salesAmount: sum('salesAmount'), refundAmount: sum('refundAmount'), netAmount: sum('salesAmount') - sum('refundAmount') },
        daily: days,
        orders: orders.rows.map((o) => ({ ...o, items: items.filter((i) => i.orderId === o.id).map(({ orderId: _, ...i }) => i) })),
        truncated: orders.rows.length === MAX_ORDERS,
      };
    });
  }

  /** 상품 판매통계: 상품·옵션 조합별 순위와 일별/월별 수량·금액 */
  @Get('products')
  @Merchant('tenant_admin', 'viewer')
  products(@Query() query: Record<string, string>, @Req() req: AppRequest) {
    const f = period(query);
    const unit = parse(z.enum(['day', 'month']).catch('day'), query.unit);
    return this.staff(req, async (tx) => {
      const ranking = await sql<{ name: string; options: string; quantity: string; amount: string }>`
        SELECT i.name, i.options, sum(i.quantity) AS "quantity", sum(i.line_total) AS "amount"
        FROM (
          SELECT oi.menu_name_snapshot AS name, oi.quantity, oi.line_total,
                 coalesce((SELECT string_agg(x.option_name_snapshot, ', ' ORDER BY x.option_name_snapshot) FROM order_item_options x WHERE x.order_item_id = oi.id), '') AS options
          FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN payments p ON p.order_id = o.id
          WHERE ${PAID} AND o.business_date BETWEEN ${f.from} AND ${f.to} ${storeFilter(f.storeId)}
        ) i
        GROUP BY i.name, i.options ORDER BY "amount" DESC, "quantity" DESC, i.name`.execute(tx);

      const bucket = unit === 'month' ? sql`to_char(o.business_date, 'YYYY-MM')` : sql`o.business_date::text`;
      const trend = await sql<{ period: string; quantity: string; amount: string }>`
        SELECT ${bucket} AS "period", sum(oi.quantity) AS "quantity", sum(oi.line_total) AS "amount"
        FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN payments p ON p.order_id = o.id
        WHERE ${PAID} AND o.business_date BETWEEN ${f.from} AND ${f.to} ${storeFilter(f.storeId)}
        GROUP BY 1 ORDER BY 1`.execute(tx);

      const rows = ranking.rows.map((r) => ({ name: r.name, options: r.options, quantity: Number(r.quantity), amount: Number(r.amount) }));
      const total = rows.reduce((s, r) => s + r.amount, 0);
      return {
        from: f.from,
        to: f.to,
        unit,
        totals: { quantity: rows.reduce((s, r) => s + r.quantity, 0), amount: total, kinds: new Set(rows.map((r) => r.name)).size },
        ranking: rows.map((r) => ({ ...r, share: total ? Math.round((r.amount / total) * 1000) / 10 : 0 })),
        trend: trend.rows.map((t) => ({ period: t.period, quantity: Number(t.quantity), amount: Number(t.amount) })),
      };
    });
  }
}
