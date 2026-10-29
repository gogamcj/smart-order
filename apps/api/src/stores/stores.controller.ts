import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { Merchant } from '../auth/access.js';
import { audit } from '../common/audit.js';
import { CryptoService } from '../common/crypto.service.js';
import { notFound } from '../common/errors.js';
import type { AppRequest } from '../common/request.js';
import { parse } from '../common/zod.js';
import { Database, type Tx } from '../db/database.js';
import { QrService } from './qr.service.js';

const uuid = z.string().uuid();
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const businessHours = z.array(z.object({ dow: z.number().int().min(0).max(6), open: hhmm, close: hhmm })).max(14);

const storeSchema = z.object({
  name: z.string().trim().min(1).max(100),
  address: z.string().trim().max(200).nullable().optional(),
  phone: z.string().trim().max(20).nullable().optional(),
  status: z.enum(['open', 'paused', 'inactive']).optional(),
  businessHours: businessHours.optional(),
});
const tableCreateSchema = z.object({ storeId: uuid, label: z.string().trim().min(1).max(30), sortOrder: z.number().int().optional() });
const tableBulkSchema = z.object({ storeId: uuid, from: z.number().int().min(1).max(999), to: z.number().int().min(1).max(999) }).refine((v) => v.to >= v.from && v.to - v.from < 100, '한 번에 100개까지');
const tableUpdateSchema = z.object({ label: z.string().trim().min(1).max(30), isActive: z.boolean(), sortOrder: z.number().int() }).partial();
const printSchema = z.object({ tableIds: z.array(uuid).min(1).max(200) });

@Controller('api/merchant')
export class StoresController {
  constructor(
    private readonly db: Database,
    private readonly qr: QrService,
  ) {}

  private staff<T>(req: AppRequest, fn: (tx: Tx) => Promise<T>) {
    return this.db.asActor({ actor: 'staff', tenantId: req.merchant!.tenantId, userId: req.auth!.userId }, fn);
  }

  // ── 매장 ─────────────────────────────────────────────────────────────

  @Get('stores')
  @Merchant()
  stores(@Req() req: AppRequest) {
    return this.staff(req, (tx) =>
      tx
        .selectFrom('stores')
        .select(['id', 'name', 'address', 'phone', 'status', 'business_hours as businessHours', 'timezone'])
        .orderBy('created_at')
        .execute(),
    );
  }

  @Post('stores')
  @Merchant('tenant_admin')
  createStore(@Body() body: unknown, @Req() req: AppRequest) {
    const input = parse(storeSchema, body);
    return this.staff(req, async (tx) => {
      const row = await tx
        .insertInto('stores')
        .values({
          tenant_id: req.merchant!.tenantId,
          name: input.name,
          address: input.address ?? null,
          phone: input.phone ?? null,
          status: input.status ?? 'open',
          business_hours: JSON.stringify(input.businessHours ?? []),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await audit(tx, { actorUserId: req.auth!.userId, actorKind: 'staff', tenantId: req.merchant!.tenantId, action: 'store.create', targetType: 'store', targetId: row.id, requestId: req.id });
      return row;
    });
  }

  @Patch('stores/:id')
  @Merchant('tenant_admin')
  updateStore(@Param('id') id: string, @Body() body: unknown, @Req() req: AppRequest) {
    const storeId = parse(uuid, id);
    const input = parse(storeSchema.partial(), body);
    return this.staff(req, async (tx) => {
      const r = await tx
        .updateTable('stores')
        .set({
          name: input.name,
          address: input.address,
          phone: input.phone,
          status: input.status,
          business_hours: input.businessHours ? JSON.stringify(input.businessHours) : undefined,
        })
        .where('id', '=', storeId)
        .executeTakeFirst();
      if (!r.numUpdatedRows) throw notFound('매장');
      return { ok: true };
    });
  }

  // ── 테이블 ───────────────────────────────────────────────────────────

  @Get('tables')
  @Merchant()
  tables(@Query('storeId') storeId: string | undefined, @Req() req: AppRequest) {
    const sid = parse(uuid.optional(), storeId || undefined);
    return this.staff(req, (tx) => {
      let q = tx
        .selectFrom('store_tables as t')
        .leftJoin('qr_codes as q', (j) => j.onRef('q.table_id', '=', 't.id').on('q.status', '=', 'active'))
        .select(['t.id', 't.store_id as storeId', 't.label', 't.sort_order as sortOrder', 't.is_active as isActive', 'q.id as qrCodeId', 'q.created_at as qrIssuedAt'])
        .where('t.deleted_at', 'is', null)
        .orderBy('t.sort_order')
        .orderBy('t.label');
      if (sid) q = q.where('t.store_id', '=', sid);
      return q.execute();
    });
  }

  @Post('tables')
  @Merchant('tenant_admin')
  createTable(@Body() body: unknown, @Req() req: AppRequest) {
    const input = parse(tableCreateSchema, body);
    return this.staff(req, async (tx) => {
      const row = await tx
        .insertInto('store_tables')
        .values({ tenant_id: req.merchant!.tenantId, store_id: input.storeId, label: input.label, sort_order: input.sortOrder ?? 0 })
        .returning('id')
        .executeTakeFirstOrThrow();
      await this.issueQr(tx, req, row.id);
      return row;
    });
  }

  /** 1번부터 N번까지 테이블을 한 번에 만든다 (이미 있는 번호는 건너뜀) */
  @Post('tables/bulk')
  @Merchant('tenant_admin')
  createTablesBulk(@Body() body: unknown, @Req() req: AppRequest) {
    const input = parse(tableBulkSchema, body);
    return this.staff(req, async (tx) => {
      const created: string[] = [];
      for (let n = input.from; n <= input.to; n++) {
        const row = await tx
          .insertInto('store_tables')
          .values({ tenant_id: req.merchant!.tenantId, store_id: input.storeId, label: String(n), sort_order: n })
          .onConflict((oc) => oc.columns(['store_id', 'label']).where('deleted_at', 'is', null).doNothing())
          .returning('id')
          .executeTakeFirst();
        if (row) {
          await this.issueQr(tx, req, row.id);
          created.push(row.id);
        }
      }
      return { created: created.length };
    });
  }

  @Patch('tables/:id')
  @Merchant('tenant_admin')
  updateTable(@Param('id') id: string, @Body() body: unknown, @Req() req: AppRequest) {
    const tableId = parse(uuid, id);
    const input = parse(tableUpdateSchema, body);
    return this.staff(req, async (tx) => {
      const r = await tx
        .updateTable('store_tables')
        .set({ label: input.label, is_active: input.isActive, sort_order: input.sortOrder })
        .where('id', '=', tableId)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      if (!r.numUpdatedRows) throw notFound('테이블');
      return { ok: true };
    });
  }

  /** 테이블 삭제: 기록 보존을 위해 소프트 삭제하고 유효한 QR 은 폐기 */
  @Delete('tables/:id')
  @Merchant('tenant_admin')
  deleteTable(@Param('id') id: string, @Req() req: AppRequest) {
    const tableId = parse(uuid, id);
    return this.staff(req, async (tx) => {
      const r = await tx.updateTable('store_tables').set({ deleted_at: new Date(), is_active: false }).where('id', '=', tableId).where('deleted_at', 'is', null).executeTakeFirst();
      if (!r.numUpdatedRows) throw notFound('테이블');
      await this.revokeActive(tx, req, tableId);
      return { ok: true };
    });
  }

  // ── QR ───────────────────────────────────────────────────────────────

  /** 발급·재발급: 기존 QR 을 폐기하고 새 토큰을 만든다. 이전에 인쇄한 QR 은 더 이상 주문에 쓸 수 없다 */
  @Post('tables/:id/qr-codes')
  @Merchant('tenant_admin')
  reissue(@Param('id') id: string, @Req() req: AppRequest) {
    const tableId = parse(uuid, id);
    return this.staff(req, async (tx) => {
      const table = await tx.selectFrom('store_tables').select('id').where('id', '=', tableId).where('deleted_at', 'is', null).executeTakeFirst();
      if (!table) throw notFound('테이블');
      await this.revokeActive(tx, req, tableId);
      const qrId = await this.issueQr(tx, req, tableId);
      await audit(tx, { actorUserId: req.auth!.userId, actorKind: 'staff', tenantId: req.merchant!.tenantId, action: 'qr.reissue', targetType: 'store_table', targetId: tableId, requestId: req.id });
      return { qrCodeId: qrId };
    });
  }

  @Delete('qr-codes/:id')
  @Merchant('tenant_admin')
  revoke(@Param('id') id: string, @Req() req: AppRequest) {
    const qrId = parse(uuid, id);
    return this.staff(req, async (tx) => {
      const r = await tx
        .updateTable('qr_codes')
        .set({ status: 'revoked', revoked_at: new Date(), revoked_by: req.auth!.userId })
        .where('id', '=', qrId)
        .where('status', '=', 'active')
        .executeTakeFirst();
      if (!r.numUpdatedRows) throw notFound('QR 코드');
      await audit(tx, { actorUserId: req.auth!.userId, actorKind: 'staff', tenantId: req.merchant!.tenantId, action: 'qr.revoke', targetType: 'qr_code', targetId: qrId, requestId: req.id });
      return { ok: true };
    });
  }

  @Get('qr-codes/:id/image.png')
  @Merchant('tenant_admin')
  async image(@Param('id') id: string, @Req() req: AppRequest, @Res() res: Response) {
    const qrId = parse(uuid, id);
    const row = await this.staff(req, (tx) => tx.selectFrom('qr_codes').select('token').where('id', '=', qrId).where('status', '=', 'active').executeTakeFirst());
    if (!row) throw notFound('QR 코드');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(await this.qr.png(row.token));
  }

  @Get('qr-codes/:id')
  @Merchant('tenant_admin')
  async qrInfo(@Param('id') id: string, @Req() req: AppRequest) {
    const qrId = parse(uuid, id);
    const row = await this.staff(req, (tx) => tx.selectFrom('qr_codes').select(['id', 'token', 'status', 'created_at']).where('id', '=', qrId).executeTakeFirst());
    if (!row) throw notFound('QR 코드');
    return { id: row.id, status: row.status, createdAt: row.created_at, url: this.qr.orderUrl(row.token) };
  }

  @Post('qr-codes/print')
  @Merchant('tenant_admin')
  async print(@Body() body: unknown, @Req() req: AppRequest, @Res() res: Response) {
    const { tableIds } = parse(printSchema, body);
    const rows = await this.staff(req, (tx) =>
      tx
        .selectFrom('qr_codes as q')
        .innerJoin('store_tables as t', 't.id', 'q.table_id')
        .innerJoin('stores as s', 's.id', 't.store_id')
        .select(['q.token', 't.label', 's.name'])
        .where('q.status', '=', 'active')
        .where('t.id', 'in', tableIds)
        .orderBy('t.sort_order')
        .orderBy('t.label')
        .execute(),
    );
    if (!rows.length) throw notFound('인쇄할 QR 코드');
    const pdf = await this.qr.printPdf(rows.map((r) => ({ token: r.token, tableLabel: r.label, storeName: r.name })));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="table-qr.pdf"');
    res.send(pdf);
  }

  private async issueQr(tx: Tx, req: AppRequest, tableId: string) {
    const row = await tx
      .insertInto('qr_codes')
      .values({ tenant_id: req.merchant!.tenantId, table_id: tableId, token: CryptoService.randomToken(32), created_by: req.auth!.userId })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  private async revokeActive(tx: Tx, req: AppRequest, tableId: string) {
    await tx
      .updateTable('qr_codes')
      .set({ status: 'revoked', revoked_at: new Date(), revoked_by: req.auth!.userId })
      .where('table_id', '=', tableId)
      .where('status', '=', 'active')
      .execute();
  }
}
