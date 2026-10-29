import { randomInt } from 'node:crypto';
import { Body, Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { sql } from 'kysely';
import { z } from 'zod';
import { CustomerOnly, Public } from '../auth/access.js';
import { AppError, notFound } from '../common/errors.js';
import type { AppRequest } from '../common/request.js';
import { localNow } from '../common/time.js';
import { parse } from '../common/zod.js';
import { Database, type Tx } from '../db/database.js';
import { MediaService } from '../media/media.service.js';
import { OrderContextService } from './order-context.service.js';
import { cartSchema, priceCart } from './pricing.js';

const createOrderSchema = cartSchema.extend({
  clientRequestId: z.string().min(8).max(100),
  expectedTotal: z.number().int().min(0),
  customerRequest: z.string().trim().max(500).optional(),
});

const ORDER_NO_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

@Controller('api')
export class OrderingController {
  constructor(
    private readonly db: Database,
    private readonly contexts: OrderContextService,
    private readonly media: MediaService,
  ) {}

  /** QR 스캔 진입점: 토큰을 검증하고 주문 컨텍스트 쿠키를 심는다 */
  @Get('qr/:token')
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async resolveQr(@Param('token') token: string, @Res({ passthrough: true }) res: Response) {
    const ctx = await this.contexts.resolveToken(token);
    if (!ctx) throw new AppError('QR_INVALID', 404, '사용할 수 없는 QR 코드입니다. 직원에게 문의해 주세요');
    this.contexts.setCookie(res, ctx);
    return this.describe(ctx);
  }

  @Get('order-context')
  @Public()
  async currentContext(@Req() req: AppRequest) {
    return this.describe(await this.contexts.require(req));
  }

  private async describe(ctx: Awaited<ReturnType<OrderContextService['require']>>) {
    const info = await this.db.asActor({ actor: 'customer', tenantId: ctx.tenantId }, async (tx) => {
      const store = await tx.selectFrom('stores as s').leftJoin('media_files as f', 'f.id', 's.logo_media_id').select(['s.status', 's.business_hours', 'f.storage_key']).where('s.id', '=', ctx.storeId).executeTakeFirstOrThrow();
      const settings = await tx.selectFrom('tenant_settings').select(['accepting_orders']).executeTakeFirstOrThrow();
      return { store, settings };
    });
    return {
      storeId: ctx.storeId,
      tenantName: ctx.tenantName,
      storeName: ctx.storeName,
      tableLabel: ctx.tableLabel,
      storeStatus: info.store.status,
      acceptingOrders: info.settings.accepting_orders && info.store.status === 'open',
      businessHours: info.store.business_hours,
      logoUrl: this.media.publicUrl(info.store.storage_key),
    };
  }

  /** 현재 QR 매장의 메뉴. 로그인 없이 볼 수 있고, 주문할 때 로그인한다 */
  @Get('menus')
  @Public()
  async menus(@Req() req: AppRequest) {
    const ctx = await this.contexts.require(req);
    const local = localNow(ctx.timezone);
    return this.db.asActor({ actor: 'customer', tenantId: ctx.tenantId, userId: req.auth?.userId }, async (tx) => {
      const categories = await tx
        .selectFrom('menu_categories')
        .select(['id', 'name'])
        .where('store_id', '=', ctx.storeId)
        .where('deleted_at', 'is', null)
        .where('is_visible', '=', true)
        .orderBy('sort_order')
        .execute();
      const menus = await tx
        .selectFrom('menus as m')
        .leftJoin('media_files as f', 'f.id', 'm.image_media_id')
        .select(['m.id', 'm.category_id', 'm.name', 'm.description', 'm.price', 'm.sale_price', 'm.status', 'm.is_popular', 'f.storage_key'])
        .where('m.store_id', '=', ctx.storeId)
        .where('m.deleted_at', 'is', null)
        .where('m.status', 'in', ['on_sale', 'sold_out'])
        .orderBy('m.sort_order')
        .execute();
      const ids = menus.map((m) => m.id);
      const groups = ids.length ? await tx.selectFrom('menu_option_groups').selectAll().where('menu_id', 'in', ids).orderBy('sort_order').execute() : [];
      const options = groups.length
        ? await tx.selectFrom('menu_options').selectAll().where('group_id', 'in', groups.map((g) => g.id)).where('status', '<>', 'inactive').orderBy('sort_order').execute()
        : [];
      const windows = ids.length ? await tx.selectFrom('menu_availability').selectAll().where('menu_id', 'in', ids).execute() : [];
      const visibleCategory = new Set(categories.map((c) => c.id));
      return {
        categories,
        menus: menus
          .filter((m) => visibleCategory.has(m.category_id))
          .map((m) => {
            const w = windows.filter((x) => x.menu_id === m.id);
            const availableNow = !w.length || w.some((x) => x.day_of_week === local.dow && x.start_time.slice(0, 5) <= local.time && local.time < x.end_time.slice(0, 5));
            return {
              id: m.id,
              categoryId: m.category_id,
              name: m.name,
              description: m.description,
              price: m.price,
              salePrice: m.sale_price,
              soldOut: m.status === 'sold_out',
              availableNow,
              isPopular: m.is_popular,
              imageUrl: this.media.publicUrl(m.storage_key),
              availability: w.map((x) => ({ dayOfWeek: x.day_of_week, start: x.start_time.slice(0, 5), end: x.end_time.slice(0, 5) })),
              optionGroups: groups
                .filter((g) => g.menu_id === m.id)
                .map((g) => ({
                  id: g.id,
                  name: g.name,
                  minSelect: g.min_select,
                  maxSelect: g.max_select,
                  options: options.filter((o) => o.group_id === g.id).map((o) => ({ id: o.id, name: o.name, extraPrice: o.extra_price, soldOut: o.status === 'sold_out' })),
                })),
            };
          }),
      };
    });
  }

  @Post('orders/quote')
  @Public()
  async quote(@Body() body: unknown, @Req() req: AppRequest) {
    const ctx = await this.contexts.require(req);
    const cart = parse(cartSchema, body);
    return this.db.asActor({ actor: 'customer', tenantId: ctx.tenantId, userId: req.auth?.userId }, (tx) => priceCart(tx, ctx.storeId, cart));
  }

  /**
   * 주문 생성(결제 전, pending_payment). 업체 화면에는 결제가 확인된 뒤에만 보인다.
   * 같은 clientRequestId 로 다시 보내면 새 주문을 만들지 않고 처음 주문을 돌려준다.
   */
  @Post('orders')
  @CustomerOnly()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async create(@Body() body: unknown, @Req() req: AppRequest) {
    const ctx = await this.contexts.require(req);
    const input = parse(createOrderSchema, body);
    const userId = req.auth!.userId;

    return this.db.asActor({ actor: 'customer', tenantId: ctx.tenantId, userId }, async (tx) => {
      const existing = await tx.selectFrom('orders').select(['id', 'tenant_id']).where('user_id', '=', userId).where('client_request_id', '=', input.clientRequestId).executeTakeFirst();
      if (existing) {
        if (existing.tenant_id !== ctx.tenantId) throw new AppError('IDEMPOTENCY_CONFLICT', 409, '이미 사용한 요청 키입니다');
        return { ...(await this.loadOrder(tx, existing.id)), duplicate: true };
      }

      await this.requireConsents(tx, userId);
      const quote = await priceCart(tx, ctx.storeId, input);
      if (quote.total !== input.expectedTotal) {
        throw new AppError('PRICE_CHANGED', 409, '메뉴 가격이나 구성이 바뀌었습니다. 금액을 다시 확인해 주세요', { quote });
      }

      const local = localNow(ctx.timezone);
      const displayNo = (await sql<{ n: number }>`SELECT app.next_display_no(${ctx.storeId}::uuid, ${local.date}::date) AS n`.execute(tx)).rows[0]!.n;
      const orderNo = `${local.date.slice(2).replace(/-/g, '')}-${Array.from({ length: 6 }, () => ORDER_NO_ALPHABET[randomInt(ORDER_NO_ALPHABET.length)]).join('')}`;
      const order = await tx
        .insertInto('orders')
        .values({
          tenant_id: ctx.tenantId,
          store_id: ctx.storeId,
          table_id: ctx.tableId,
          user_id: userId,
          order_no: orderNo,
          business_date: local.date,
          display_no: displayNo,
          store_name_snapshot: ctx.storeName,
          table_label_snapshot: ctx.tableLabel,
          subtotal_amount: quote.subtotal,
          discount_amount: quote.discount,
          total_amount: quote.total,
          customer_request: input.customerRequest || null,
          client_request_id: input.clientRequestId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      for (const line of quote.lines) {
        const item = await tx
          .insertInto('order_items')
          .values({
            tenant_id: ctx.tenantId,
            order_id: order.id,
            menu_id: line.menuId,
            menu_name_snapshot: line.name,
            list_price_snapshot: line.listPrice,
            unit_price: line.unitPrice,
            options_total: line.optionsTotal,
            quantity: line.quantity,
            line_total: line.lineTotal,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        if (line.options.length) {
          await tx
            .insertInto('order_item_options')
            .values(line.options.map((o) => ({ tenant_id: ctx.tenantId, order_item_id: item.id, option_id: o.optionId, group_name_snapshot: o.groupName, option_name_snapshot: o.name, extra_price: o.extraPrice })))
            .execute();
        }
      }
      return { ...(await this.loadOrder(tx, order.id)), duplicate: false };
    });
  }

  @Get('orders/me')
  @CustomerOnly()
  async myOrders(@Req() req: AppRequest, @Query('limit') limit?: string) {
    const n = parse(z.coerce.number().int().min(1).max(50).catch(20), limit ?? 20);
    return this.db.asActor({ actor: 'customer', userId: req.auth!.userId }, (tx) =>
      tx
        .selectFrom('orders')
        .select(['id', 'order_no as orderNo', 'display_no as displayNo', 'store_name_snapshot as storeName', 'table_label_snapshot as tableLabel', 'status', 'total_amount as totalAmount', 'created_at as createdAt'])
        .where('status', '<>', 'expired')
        .orderBy('created_at', 'desc')
        .limit(n)
        .execute(),
    );
  }

  @Get('orders/:id')
  @CustomerOnly()
  async order(@Param('id') id: string, @Req() req: AppRequest) {
    const orderId = parse(z.string().uuid(), id);
    return this.db.asActor({ actor: 'customer', userId: req.auth!.userId }, (tx) => this.loadOrder(tx, orderId));
  }

  private async requireConsents(tx: Tx, userId: string) {
    const missing = await tx
      .selectFrom('terms_documents as d')
      .select(['d.id', 'd.title'])
      .where('d.required', '=', true)
      .where('d.effective_at', '<=', new Date())
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('user_consents as c')
              .select('c.id')
              .whereRef('c.terms_id', '=', 'd.id')
              .where('c.user_id', '=', userId)
              .where('c.agreed', '=', true)
              .where('c.withdrawn_at', 'is', null),
          ),
        ),
      )
      .execute();
    if (missing.length) throw new AppError('CONSENT_REQUIRED', 403, '필수 약관에 동의해 주세요', { terms: missing });
  }

  /** 고객 RLS 로 읽으므로 본인 주문이 아니면 NOT_FOUND */
  async loadOrder(tx: Tx, orderId: string) {
    const o = await tx.selectFrom('orders').selectAll().where('id', '=', orderId).executeTakeFirst();
    if (!o) throw notFound('주문');
    const items = await tx.selectFrom('order_items').selectAll().where('order_id', '=', orderId).orderBy('id').execute();
    const opts = items.length ? await tx.selectFrom('order_item_options').selectAll().where('order_item_id', 'in', items.map((i) => i.id)).execute() : [];
    const payment = await tx.selectFrom('payments').select(['id', 'status', 'method', 'amount', 'approved_at', 'refunded_amount']).where('order_id', '=', orderId).orderBy('created_at', 'desc').executeTakeFirst();
    const refunds = await tx.selectFrom('refunds').select(['id', 'amount', 'status', 'created_at', 'completed_at']).where('order_id', '=', orderId).orderBy('created_at').execute();
    return {
      id: o.id,
      orderNo: o.order_no,
      displayNo: o.display_no,
      storeName: o.store_name_snapshot,
      tableLabel: o.table_label_snapshot,
      status: o.status,
      version: o.version,
      subtotalAmount: o.subtotal_amount,
      discountAmount: o.discount_amount,
      totalAmount: o.total_amount,
      customerRequest: o.customer_request,
      createdAt: o.created_at,
      placedAt: o.placed_at,
      acceptedAt: o.accepted_at,
      readyAt: o.ready_at,
      completedAt: o.completed_at,
      cancelledAt: o.cancelled_at,
      expiresAt: o.expires_at,
      items: items.map((i) => ({
        id: i.id,
        name: i.menu_name_snapshot,
        unitPrice: i.unit_price,
        optionsTotal: i.options_total,
        quantity: i.quantity,
        lineTotal: i.line_total,
        options: opts.filter((x) => x.order_item_id === i.id).map((x) => ({ groupName: x.group_name_snapshot, name: x.option_name_snapshot, extraPrice: x.extra_price })),
      })),
      payment: payment
        ? { id: payment.id, status: payment.status, method: payment.method, amount: payment.amount, approvedAt: payment.approved_at, refundedAmount: payment.refunded_amount }
        : null,
      refunds: refunds.map((r) => ({ id: r.id, amount: r.amount, status: r.status, createdAt: r.created_at, completedAt: r.completed_at })),
    };
  }
}
