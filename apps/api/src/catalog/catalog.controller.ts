import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { Merchant } from '../auth/access.js';
import { audit } from '../common/audit.js';
import { AppError, notFound } from '../common/errors.js';
import type { AppRequest } from '../common/request.js';
import { parse } from '../common/zod.js';
import { Database, type Tx } from '../db/database.js';
import { MAX_UPLOAD_BYTES, MediaService } from '../media/media.service.js';

const uuid = z.string().uuid();
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const menuStatus = z.enum(['on_sale', 'sold_out', 'paused', 'inactive']);

const categorySchema = z.object({ storeId: uuid, name: z.string().trim().min(1).max(50), isVisible: z.boolean().optional() });
const categoryUpdateSchema = z.object({ name: z.string().trim().min(1).max(50), isVisible: z.boolean() }).partial();
const reorderSchema = z.object({ ids: z.array(uuid).min(1).max(500) });

const menuBase = z.object({
  categoryId: uuid,
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000).nullable().optional(),
  price: z.number().int().min(0).max(10_000_000),
  salePrice: z.number().int().min(0).nullable().optional(),
  status: menuStatus.optional(),
  isPopular: z.boolean().optional(),
  imageMediaId: uuid.nullable().optional(),
});
const menuCreateSchema = menuBase.extend({ storeId: uuid }).refine((m) => m.salePrice == null || m.salePrice < m.price, { message: '할인가는 정가보다 낮아야 합니다', path: ['salePrice'] });
const menuUpdateSchema = menuBase.partial();
const statusSchema = z.object({ status: menuStatus });

const optionGroupsSchema = z.object({
  groups: z
    .array(
      z
        .object({
          name: z.string().trim().min(1).max(50),
          minSelect: z.number().int().min(0).max(20),
          maxSelect: z.number().int().min(1).max(20),
          options: z
            .array(z.object({ name: z.string().trim().min(1).max(50), extraPrice: z.number().int().min(0).max(1_000_000), status: z.enum(['available', 'sold_out', 'inactive']).optional() }))
            .min(1)
            .max(30),
        })
        .refine((g) => g.maxSelect >= g.minSelect, { message: '최대 선택 수는 최소 선택 수 이상이어야 합니다' })
        .refine((g) => g.minSelect <= g.options.length, { message: '최소 선택 수가 옵션 개수보다 많습니다' }),
    )
    .max(20),
});
const availabilitySchema = z.object({
  windows: z.array(z.object({ dayOfWeek: z.number().int().min(0).max(6), start: hhmm, end: hhmm }).refine((w) => w.start < w.end, '시작 시각은 종료 시각보다 빨라야 합니다')).max(50),
});

@Controller('api/merchant')
export class CatalogController {
  constructor(
    private readonly db: Database,
    private readonly media: MediaService,
  ) {}

  private staff<T>(req: AppRequest, fn: (tx: Tx) => Promise<T>) {
    return this.db.asActor({ actor: 'staff', tenantId: req.merchant!.tenantId, userId: req.auth!.userId }, fn);
  }

  // ── 카테고리 ─────────────────────────────────────────────────────────

  @Get('categories')
  @Merchant()
  categories(@Query('storeId') storeId: string, @Req() req: AppRequest) {
    const sid = parse(uuid, storeId);
    return this.staff(req, (tx) =>
      tx
        .selectFrom('menu_categories')
        .select(['id', 'store_id as storeId', 'name', 'sort_order as sortOrder', 'is_visible as isVisible'])
        .where('store_id', '=', sid)
        .where('deleted_at', 'is', null)
        .orderBy('sort_order')
        .orderBy('created_at')
        .execute(),
    );
  }

  @Post('categories')
  @Merchant('tenant_admin', 'menu_staff')
  createCategory(@Body() body: unknown, @Req() req: AppRequest) {
    const input = parse(categorySchema, body);
    return this.staff(req, async (tx) => {
      const max = await tx
        .selectFrom('menu_categories')
        .select((eb) => eb.fn.coalesce(eb.fn.max('sort_order'), eb.val(0)).as('m'))
        .where('store_id', '=', input.storeId)
        .executeTakeFirst();
      return tx
        .insertInto('menu_categories')
        .values({ tenant_id: req.merchant!.tenantId, store_id: input.storeId, name: input.name, is_visible: input.isVisible ?? true, sort_order: Number(max?.m ?? 0) + 1 })
        .returning('id')
        .executeTakeFirstOrThrow();
    });
  }

  @Patch('categories/:id')
  @Merchant('tenant_admin', 'menu_staff')
  updateCategory(@Param('id') id: string, @Body() body: unknown, @Req() req: AppRequest) {
    const cid = parse(uuid, id);
    const input = parse(categoryUpdateSchema, body);
    return this.staff(req, async (tx) => {
      const r = await tx.updateTable('menu_categories').set({ name: input.name, is_visible: input.isVisible }).where('id', '=', cid).where('deleted_at', 'is', null).executeTakeFirst();
      if (!r.numUpdatedRows) throw notFound('카테고리');
      return { ok: true };
    });
  }

  @Delete('categories/:id')
  @Merchant('tenant_admin', 'menu_staff')
  deleteCategory(@Param('id') id: string, @Req() req: AppRequest) {
    const cid = parse(uuid, id);
    return this.staff(req, async (tx) => {
      const live = await tx.selectFrom('menus').select('id').where('category_id', '=', cid).where('deleted_at', 'is', null).executeTakeFirst();
      if (live) throw new AppError('CATEGORY_NOT_EMPTY', 409, '메뉴가 남아 있는 카테고리는 삭제할 수 없습니다');
      const r = await tx.updateTable('menu_categories').set({ deleted_at: new Date() }).where('id', '=', cid).where('deleted_at', 'is', null).executeTakeFirst();
      if (!r.numUpdatedRows) throw notFound('카테고리');
      return { ok: true };
    });
  }

  @Put('categories/order')
  @Merchant('tenant_admin', 'menu_staff')
  reorderCategories(@Body() body: unknown, @Req() req: AppRequest) {
    const { ids } = parse(reorderSchema, body);
    return this.staff(req, async (tx) => {
      for (const [i, id] of ids.entries()) await tx.updateTable('menu_categories').set({ sort_order: i + 1 }).where('id', '=', id).execute();
      return { ok: true };
    });
  }

  // ── 메뉴 ─────────────────────────────────────────────────────────────

  @Get('menus')
  @Merchant()
  async menus(@Query('storeId') storeId: string, @Req() req: AppRequest) {
    const sid = parse(uuid, storeId);
    return this.staff(req, async (tx) => {
      const menus = await tx
        .selectFrom('menus as m')
        .leftJoin('media_files as f', 'f.id', 'm.image_media_id')
        .select(['m.id', 'm.category_id', 'm.name', 'm.description', 'm.price', 'm.sale_price', 'm.status', 'm.is_popular', 'm.sort_order', 'm.image_media_id', 'f.storage_key'])
        .where('m.store_id', '=', sid)
        .where('m.deleted_at', 'is', null)
        .orderBy('m.sort_order')
        .orderBy('m.created_at')
        .execute();
      const ids = menus.map((m) => m.id);
      const groups = ids.length ? await tx.selectFrom('menu_option_groups').selectAll().where('menu_id', 'in', ids).orderBy('sort_order').execute() : [];
      const options = groups.length
        ? await tx.selectFrom('menu_options').selectAll().where('group_id', 'in', groups.map((g) => g.id)).orderBy('sort_order').execute()
        : [];
      const windows = ids.length ? await tx.selectFrom('menu_availability').selectAll().where('menu_id', 'in', ids).execute() : [];
      return menus.map((m) => ({
        id: m.id,
        categoryId: m.category_id,
        name: m.name,
        description: m.description,
        price: m.price,
        salePrice: m.sale_price,
        status: m.status,
        isPopular: m.is_popular,
        sortOrder: m.sort_order,
        imageMediaId: m.image_media_id,
        imageUrl: this.media.publicUrl(m.storage_key),
        optionGroups: groups
          .filter((g) => g.menu_id === m.id)
          .map((g) => ({
            id: g.id,
            name: g.name,
            minSelect: g.min_select,
            maxSelect: g.max_select,
            options: options.filter((o) => o.group_id === g.id).map((o) => ({ id: o.id, name: o.name, extraPrice: o.extra_price, status: o.status })),
          })),
        availability: windows
          .filter((w) => w.menu_id === m.id)
          .map((w) => ({ dayOfWeek: w.day_of_week, start: w.start_time.slice(0, 5), end: w.end_time.slice(0, 5) })),
      }));
    });
  }

  @Post('menus')
  @Merchant('tenant_admin', 'menu_staff')
  createMenu(@Body() body: unknown, @Req() req: AppRequest) {
    const input = parse(menuCreateSchema, body);
    return this.staff(req, async (tx) => {
      const max = await tx
        .selectFrom('menus')
        .select((eb) => eb.fn.coalesce(eb.fn.max('sort_order'), eb.val(0)).as('m'))
        .where('category_id', '=', input.categoryId)
        .executeTakeFirst();
      const row = await tx
        .insertInto('menus')
        .values({
          tenant_id: req.merchant!.tenantId,
          store_id: input.storeId,
          category_id: input.categoryId,
          name: input.name,
          description: input.description ?? null,
          price: input.price,
          sale_price: input.salePrice ?? null,
          status: input.status ?? 'on_sale',
          is_popular: input.isPopular ?? false,
          image_media_id: input.imageMediaId ?? null,
          sort_order: Number(max?.m ?? 0) + 1,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await audit(tx, { actorUserId: req.auth!.userId, actorKind: 'staff', tenantId: req.merchant!.tenantId, action: 'menu.create', targetType: 'menu', targetId: row.id, requestId: req.id });
      return row;
    });
  }

  @Patch('menus/:id')
  @Merchant('tenant_admin', 'menu_staff')
  updateMenu(@Param('id') id: string, @Body() body: unknown, @Req() req: AppRequest) {
    const mid = parse(uuid, id);
    const input = parse(menuUpdateSchema, body);
    return this.staff(req, async (tx) => {
      const current = await tx.selectFrom('menus').select(['price', 'sale_price']).where('id', '=', mid).where('deleted_at', 'is', null).executeTakeFirst();
      if (!current) throw notFound('메뉴');
      const price = input.price ?? current.price;
      const salePrice = input.salePrice === undefined ? current.sale_price : input.salePrice;
      if (salePrice != null && salePrice >= price) throw new AppError('VALIDATION_FAILED', 422, '할인가는 정가보다 낮아야 합니다');
      await tx
        .updateTable('menus')
        .set({
          category_id: input.categoryId,
          name: input.name,
          description: input.description,
          price: input.price,
          sale_price: input.salePrice,
          status: input.status,
          is_popular: input.isPopular,
          image_media_id: input.imageMediaId,
        })
        .where('id', '=', mid)
        .execute();
      // 가격 변경은 감사 로그에 남긴다 (기존 주문은 스냅샷이라 영향 없음)
      if (input.price !== undefined || input.salePrice !== undefined) {
        await audit(tx, {
          actorUserId: req.auth!.userId,
          actorKind: 'staff',
          tenantId: req.merchant!.tenantId,
          action: 'menu.price_change',
          targetType: 'menu',
          targetId: mid,
          details: { from: { price: current.price, salePrice: current.sale_price }, to: { price, salePrice } },
          requestId: req.id,
        });
      }
      return { ok: true };
    });
  }

  /** 품절·판매 중지는 주문 처리 직원도 할 수 있다 */
  @Patch('menus/:id/status')
  @Merchant('tenant_admin', 'menu_staff', 'order_staff')
  menuStatus(@Param('id') id: string, @Body() body: unknown, @Req() req: AppRequest) {
    const mid = parse(uuid, id);
    const { status } = parse(statusSchema, body);
    return this.staff(req, async (tx) => {
      const r = await tx.updateTable('menus').set({ status }).where('id', '=', mid).where('deleted_at', 'is', null).executeTakeFirst();
      if (!r.numUpdatedRows) throw notFound('메뉴');
      return { ok: true };
    });
  }

  @Delete('menus/:id')
  @Merchant('tenant_admin', 'menu_staff')
  deleteMenu(@Param('id') id: string, @Req() req: AppRequest) {
    const mid = parse(uuid, id);
    return this.staff(req, async (tx) => {
      const r = await tx.updateTable('menus').set({ deleted_at: new Date(), status: 'inactive' }).where('id', '=', mid).where('deleted_at', 'is', null).executeTakeFirst();
      if (!r.numUpdatedRows) throw notFound('메뉴');
      await audit(tx, { actorUserId: req.auth!.userId, actorKind: 'staff', tenantId: req.merchant!.tenantId, action: 'menu.delete', targetType: 'menu', targetId: mid, requestId: req.id });
      return { ok: true };
    });
  }

  /** 메뉴 복제: 옵션·판매 시간까지 복사하고 판매 중지 상태로 만든다 */
  @Post('menus/:id/duplicate')
  @Merchant('tenant_admin', 'menu_staff')
  duplicate(@Param('id') id: string, @Req() req: AppRequest) {
    const mid = parse(uuid, id);
    return this.staff(req, async (tx) => {
      const src = await tx.selectFrom('menus').selectAll().where('id', '=', mid).where('deleted_at', 'is', null).executeTakeFirst();
      if (!src) throw notFound('메뉴');
      const copy = await tx
        .insertInto('menus')
        .values({
          tenant_id: src.tenant_id,
          store_id: src.store_id,
          category_id: src.category_id,
          name: `${src.name} (복사본)`.slice(0, 100),
          description: src.description,
          price: src.price,
          sale_price: src.sale_price,
          status: 'paused',
          is_popular: false,
          image_media_id: src.image_media_id,
          sort_order: src.sort_order + 1,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const groups = await tx.selectFrom('menu_option_groups').selectAll().where('menu_id', '=', mid).execute();
      for (const g of groups) {
        const ng = await tx
          .insertInto('menu_option_groups')
          .values({ tenant_id: g.tenant_id, menu_id: copy.id, name: g.name, min_select: g.min_select, max_select: g.max_select, sort_order: g.sort_order })
          .returning('id')
          .executeTakeFirstOrThrow();
        const opts = await tx.selectFrom('menu_options').selectAll().where('group_id', '=', g.id).execute();
        if (opts.length) {
          await tx
            .insertInto('menu_options')
            .values(opts.map((o) => ({ tenant_id: o.tenant_id, group_id: ng.id, name: o.name, extra_price: o.extra_price, status: o.status, sort_order: o.sort_order })))
            .execute();
        }
      }
      const windows = await tx.selectFrom('menu_availability').selectAll().where('menu_id', '=', mid).execute();
      if (windows.length) {
        await tx
          .insertInto('menu_availability')
          .values(windows.map((w) => ({ tenant_id: w.tenant_id, menu_id: copy.id, day_of_week: w.day_of_week, start_time: w.start_time, end_time: w.end_time })))
          .execute();
      }
      return copy;
    });
  }

  @Put('menus/order')
  @Merchant('tenant_admin', 'menu_staff')
  reorderMenus(@Body() body: unknown, @Req() req: AppRequest) {
    const { ids } = parse(reorderSchema, body);
    return this.staff(req, async (tx) => {
      for (const [i, id] of ids.entries()) await tx.updateTable('menus').set({ sort_order: i + 1 }).where('id', '=', id).execute();
      return { ok: true };
    });
  }

  /** 옵션 그룹 전체 교체. 기존 주문은 옵션명·가격을 스냅샷으로 갖고 있어 영향이 없다 */
  @Put('menus/:id/option-groups')
  @Merchant('tenant_admin', 'menu_staff')
  replaceOptions(@Param('id') id: string, @Body() body: unknown, @Req() req: AppRequest) {
    const mid = parse(uuid, id);
    const { groups } = parse(optionGroupsSchema, body);
    return this.staff(req, async (tx) => {
      const menu = await tx.selectFrom('menus').select('id').where('id', '=', mid).where('deleted_at', 'is', null).executeTakeFirst();
      if (!menu) throw notFound('메뉴');
      await tx.deleteFrom('menu_option_groups').where('menu_id', '=', mid).execute();
      for (const [gi, g] of groups.entries()) {
        const ng = await tx
          .insertInto('menu_option_groups')
          .values({ tenant_id: req.merchant!.tenantId, menu_id: mid, name: g.name, min_select: g.minSelect, max_select: g.maxSelect, sort_order: gi })
          .returning('id')
          .executeTakeFirstOrThrow();
        await tx
          .insertInto('menu_options')
          .values(g.options.map((o, oi) => ({ tenant_id: req.merchant!.tenantId, group_id: ng.id, name: o.name, extra_price: o.extraPrice, status: o.status ?? 'available', sort_order: oi })))
          .execute();
      }
      return { ok: true };
    });
  }

  @Put('menus/:id/availability')
  @Merchant('tenant_admin', 'menu_staff')
  setAvailability(@Param('id') id: string, @Body() body: unknown, @Req() req: AppRequest) {
    const mid = parse(uuid, id);
    const { windows } = parse(availabilitySchema, body);
    return this.staff(req, async (tx) => {
      const menu = await tx.selectFrom('menus').select('id').where('id', '=', mid).where('deleted_at', 'is', null).executeTakeFirst();
      if (!menu) throw notFound('메뉴');
      await tx.deleteFrom('menu_availability').where('menu_id', '=', mid).execute();
      if (windows.length) {
        await tx
          .insertInto('menu_availability')
          .values(windows.map((w) => ({ tenant_id: req.merchant!.tenantId, menu_id: mid, day_of_week: w.dayOfWeek, start_time: w.start, end_time: w.end })))
          .execute();
      }
      return { ok: true };
    });
  }

  // ── 이미지 ───────────────────────────────────────────────────────────

  @Post('media')
  @Merchant('tenant_admin', 'menu_staff')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  async upload(@UploadedFile() file: Express.Multer.File | undefined, @Body('kind') kind: string, @Req() req: AppRequest) {
    if (!file) throw new AppError('INVALID_FILE', 422, '파일을 선택해 주세요');
    const k = parse(z.enum(['menu_image', 'store_logo']).catch('menu_image'), kind);
    const stored = await this.media.storeImage(req.merchant!.tenantId, k, file.buffer);
    return this.staff(req, async (tx) => {
      const row = await tx
        .insertInto('media_files')
        .values({
          tenant_id: req.merchant!.tenantId,
          kind: k,
          storage_key: stored.storageKey,
          mime_type: stored.mimeType,
          byte_size: stored.byteSize,
          sha256: stored.sha256,
          width: stored.width,
          height: stored.height,
          status: 'ready',
          uploaded_by: req.auth!.userId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { id: row.id, url: this.media.publicUrl(stored.storageKey), width: stored.width, height: stored.height };
    });
  }
}
