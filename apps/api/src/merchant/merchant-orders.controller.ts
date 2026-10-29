import { Body, Controller, Get, Param, Patch, Query, Req } from '@nestjs/common';
import { sql } from 'kysely';
import { z } from 'zod';
import { Merchant } from '../auth/access.js';
import { AppError, forbidden, notFound } from '../common/errors.js';
import type { AppRequest } from '../common/request.js';
import { parse } from '../common/zod.js';
import { Database, type Tx } from '../db/database.js';

const BOARD_STATUSES = ['placed', 'accepted', 'preparing', 'ready', 'completed', 'rejected', 'cancelled'] as const;

const listSchema = z.object({
  storeId: z.string().uuid().optional(),
  status: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',') : undefined))
    .pipe(z.array(z.enum(BOARD_STATUSES)).optional()),
  tableId: z.string().uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  q: z.string().trim().max(30).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

const statusSchema = z.object({
  to: z.enum(['accepted', 'rejected', 'preparing', 'ready', 'completed', 'cancelled']),
  expectedVersion: z.number().int().min(1),
  reason: z.string().trim().max(200).optional(),
});

@Controller('api/merchant/orders')
export class MerchantOrdersController {
  constructor(private readonly db: Database) {}

  private staff<T>(req: AppRequest, fn: (tx: Tx) => Promise<T>) {
    return this.db.asActor({ actor: 'staff', tenantId: req.merchant!.tenantId, userId: req.auth!.userId }, fn);
  }

  /** 주문 대시보드. 결제 확인 전(pending_payment)·만료 주문은 보이지 않는다 */
  @Get()
  @Merchant()
  list(@Query() query: Record<string, string>, @Req() req: AppRequest) {
    const f = parse(listSchema, query);
    return this.staff(req, async (tx) => {
      let q = tx
        .selectFrom('orders')
        .selectAll()
        .where('status', 'in', f.status ?? [...BOARD_STATUSES])
        .orderBy('placed_at', 'desc')
        .limit(f.limit);
      if (f.storeId) q = q.where('store_id', '=', f.storeId);
      if (f.tableId) q = q.where('table_id', '=', f.tableId);
      if (f.from) q = q.where('business_date', '>=', f.from);
      if (f.to) q = q.where('business_date', '<=', f.to);
      if (f.q) {
        const term = f.q;
        q = q.where((eb) => eb.or([eb('order_no', 'ilike', `%${term.replace(/[%_\\]/g, '')}%`), ...( /^\d+$/.test(term) ? [eb('display_no', '=', Number(term))] : [])]));
      }
      const orders = await q.execute();
      return this.withDetails(tx, orders);
    });
  }

  /** 미처리 주문 수 등 상태별 건수 (오늘 영업일 기준이 아니라 진행 중인 전체) */
  @Get('summary')
  @Merchant()
  summary(@Query('storeId') storeId: string | undefined, @Req() req: AppRequest) {
    const sid = parse(z.string().uuid().optional(), storeId || undefined);
    return this.staff(req, async (tx) => {
      let q = tx
        .selectFrom('orders')
        .select(['status', (eb) => eb.fn.countAll<string>().as('n')])
        .where('status', 'in', ['placed', 'accepted', 'preparing', 'ready'])
        .groupBy('status');
      if (sid) q = q.where('store_id', '=', sid);
      const rows = await q.execute();
      const counts = Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
      return { placed: counts.placed ?? 0, accepted: counts.accepted ?? 0, preparing: counts.preparing ?? 0, ready: counts.ready ?? 0 };
    });
  }

  @Get(':id')
  @Merchant()
  async detail(@Param('id') id: string, @Req() req: AppRequest) {
    const orderId = parse(z.string().uuid(), id);
    return this.staff(req, async (tx) => {
      const o = await tx.selectFrom('orders').selectAll().where('id', '=', orderId).where('status', '<>', 'pending_payment').executeTakeFirst();
      if (!o) throw notFound('주문');
      const [detail] = await this.withDetails(tx, [o]);
      const history = await tx
        .selectFrom('order_status_history as h')
        .leftJoin('users as u', 'u.id', 'h.actor_user_id')
        .select(['h.from_status as from', 'h.to_status as to', 'h.actor_kind as actorKind', 'u.display_name as actorName', 'h.reason', 'h.created_at as at'])
        .where('h.order_id', '=', orderId)
        .orderBy('h.id')
        .execute();
      return { ...detail, history };
    });
  }

  /**
   * 주문 상태 변경. expectedVersion 이 현재 버전과 다르면(다른 직원이 먼저 처리) 409 와 최신 상태를 돌려준다.
   * 결제된 주문을 거절·취소하면 같은 트랜잭션에서 전액 환불 요청을 만든다. 실제 PG 환불 실행은 3단계에서 구현한다.
   */
  @Patch(':id/status')
  @Merchant('tenant_admin', 'order_staff')
  async changeStatus(@Param('id') id: string, @Body() body: unknown, @Req() req: AppRequest) {
    const orderId = parse(z.string().uuid(), id);
    const input = parse(statusSchema, body);
    const m = req.merchant!;
    if (input.to === 'cancelled' && m.role !== 'tenant_admin' && !m.canRefund) throw forbidden('취소·환불 권한이 없습니다');
    if ((input.to === 'cancelled' || input.to === 'rejected') && !input.reason) throw new AppError('VALIDATION_FAILED', 422, '거절·취소 사유를 입력해 주세요');

    return this.staff(req, async (tx) => {
      await sql`SELECT set_config('app.status_reason', ${input.reason ?? ''}, true)`.execute(tx);
      const updated = await tx
        .updateTable('orders')
        .set({ status: input.to })
        .where('id', '=', orderId)
        .where('version', '=', input.expectedVersion)
        .where('status', '<>', 'pending_payment')
        .returning(['id', 'status', 'version', 'total_amount'])
        .executeTakeFirst();
      if (!updated) {
        const current = await tx.selectFrom('orders').select(['status', 'version']).where('id', '=', orderId).where('status', '<>', 'pending_payment').executeTakeFirst();
        if (!current) throw notFound('주문');
        throw new AppError('VERSION_CONFLICT', 409, '다른 직원이 먼저 처리했습니다. 최신 상태를 확인해 주세요', current);
      }

      let refundRequested = false;
      if (input.to === 'rejected' || input.to === 'cancelled') {
        const payment = await tx
          .selectFrom('payments')
          .select(['id', 'approved_amount', 'refunded_amount'])
          .where('order_id', '=', orderId)
          .where('status', 'in', ['paid', 'partial_refunded'])
          .executeTakeFirst();
        if (payment && payment.approved_amount! > payment.refunded_amount) {
          await tx
            .insertInto('refunds')
            .values({
              tenant_id: m.tenantId,
              payment_id: payment.id,
              order_id: orderId,
              amount: payment.approved_amount! - payment.refunded_amount,
              reason: input.reason!.slice(0, 200),
              idempotency_key: `order-${input.to}-${orderId}`,
              requested_by: req.auth!.userId,
              requested_kind: 'staff',
            })
            .onConflict((oc) => oc.columns(['payment_id', 'idempotency_key']).doNothing())
            .execute();
          refundRequested = true;
        }
      }
      return { id: updated.id, status: updated.status, version: updated.version, refundRequested };
    });
  }

  private async withDetails(tx: Tx, orders: { id: string; [k: string]: unknown }[]) {
    if (!orders.length) return [];
    const ids = orders.map((o) => o.id);
    const items = await tx.selectFrom('order_items').selectAll().where('order_id', 'in', ids).orderBy('id').execute();
    const opts = items.length ? await tx.selectFrom('order_item_options').selectAll().where('order_item_id', 'in', items.map((i) => i.id)).execute() : [];
    const payments = await tx.selectFrom('payments').select(['order_id', 'status', 'method', 'amount', 'refunded_amount']).where('order_id', 'in', ids).where('status', 'in', ['paid', 'partial_refunded', 'refunded']).execute();
    const refunds = await tx.selectFrom('refunds').select(['order_id', 'status', 'amount']).where('order_id', 'in', ids).execute();
    return orders.map((raw) => {
      const o = raw as unknown as {
        id: string; order_no: string; display_no: number; store_id: string; table_id: string; table_label_snapshot: string; status: string; version: number;
        total_amount: number; customer_request: string | null; placed_at: Date | null; accepted_at: Date | null; ready_at: Date | null; completed_at: Date | null; cancelled_at: Date | null; business_date: string;
      };
      const p = payments.find((x) => x.order_id === o.id);
      return {
        id: o.id,
        orderNo: o.order_no,
        displayNo: o.display_no,
        storeId: o.store_id,
        tableId: o.table_id,
        tableLabel: o.table_label_snapshot,
        status: o.status,
        version: o.version,
        totalAmount: o.total_amount,
        customerRequest: o.customer_request,
        businessDate: o.business_date,
        placedAt: o.placed_at,
        acceptedAt: o.accepted_at,
        readyAt: o.ready_at,
        completedAt: o.completed_at,
        cancelledAt: o.cancelled_at,
        payment: p ? { status: p.status, method: p.method, amount: p.amount, refundedAmount: p.refunded_amount } : null,
        refunds: refunds.filter((r) => r.order_id === o.id).map((r) => ({ status: r.status, amount: r.amount })),
        items: items
          .filter((i) => i.order_id === o.id)
          .map((i) => ({
            name: i.menu_name_snapshot,
            quantity: i.quantity,
            unitPrice: i.unit_price,
            lineTotal: i.line_total,
            options: opts.filter((x) => x.order_item_id === i.id).map((x) => ({ groupName: x.group_name_snapshot, name: x.option_name_snapshot, extraPrice: x.extra_price })),
          })),
      };
    });
  }
}
