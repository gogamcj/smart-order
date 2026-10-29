import { Inject, Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { CryptoService } from '../common/crypto.service.js';
import { AppError } from '../common/errors.js';
import type { AppRequest } from '../common/request.js';
import { ENV, type Env } from '../config/env.js';
import { Database } from '../db/database.js';

export const ORDER_CONTEXT_COOKIE = 'qr_ctx';
const CONTEXT_HOURS = 6;

interface SignedContext {
  q: string; // qr_codes.id
  exp: number;
}

export interface OrderContext {
  qrCodeId: string;
  tenantId: string;
  storeId: string;
  tableId: string;
  tenantName: string;
  storeName: string;
  tableLabel: string;
  timezone: string;
}

/**
 * QR 로 시작한 주문 컨텍스트(업체·매장·테이블).
 * 쿠키에는 서명된 QR ID 만 담고, 요청마다 DB 에서 QR·테이블·업체가 아직 유효한지 다시 확인한다.
 * 그래서 URL 이나 요청 본문의 업체 ID 를 바꿔도 다른 매장에 접근할 수 없고, QR 을 폐기하면 즉시 주문이 막힌다.
 */
@Injectable()
export class OrderContextService {
  constructor(
    private readonly db: Database,
    private readonly crypto: CryptoService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async resolveToken(token: string): Promise<OrderContext | null> {
    if (!/^[A-Za-z0-9_-]{43,100}$/.test(token)) return null;
    return this.db.asSystem({}, async (tx) => {
      const row = await tx
        .selectFrom('qr_codes as q')
        .innerJoin('store_tables as t', 't.id', 'q.table_id')
        .innerJoin('stores as s', 's.id', 't.store_id')
        .innerJoin('tenants as tn', 'tn.id', 'q.tenant_id')
        .select(['q.id as qrCodeId', 'tn.id as tenantId', 's.id as storeId', 't.id as tableId', 'tn.name as tenantName', 's.name as storeName', 't.label as tableLabel', 's.timezone'])
        .where('q.token', '=', token)
        .where('q.status', '=', 'active')
        .where('t.is_active', '=', true)
        .where('t.deleted_at', 'is', null)
        .where('s.status', '<>', 'inactive')
        .where('tn.status', '=', 'active')
        .executeTakeFirst();
      return row ?? null;
    });
  }

  setCookie(res: Response, ctx: OrderContext) {
    const value = this.crypto.sign({ q: ctx.qrCodeId, exp: Date.now() + CONTEXT_HOURS * 3600_000 } satisfies SignedContext);
    res.cookie(ORDER_CONTEXT_COOKIE, value, { httpOnly: true, secure: this.env.cookieSecure, sameSite: 'lax', path: '/', maxAge: CONTEXT_HOURS * 3600_000 });
  }

  /** 요청의 주문 컨텍스트. 없거나 무효면 QR_CONTEXT_REQUIRED 오류 */
  async require(req: AppRequest): Promise<OrderContext> {
    const signed = this.crypto.verify<SignedContext>(req.cookies?.[ORDER_CONTEXT_COOKIE]);
    if (!signed || typeof signed.q !== 'string' || signed.exp < Date.now()) {
      throw new AppError('QR_CONTEXT_REQUIRED', 403, '테이블의 QR 코드를 다시 스캔해 주세요');
    }
    const ctx = await this.db.asSystem({}, async (tx) =>
      tx
        .selectFrom('qr_codes as q')
        .innerJoin('store_tables as t', 't.id', 'q.table_id')
        .innerJoin('stores as s', 's.id', 't.store_id')
        .innerJoin('tenants as tn', 'tn.id', 'q.tenant_id')
        .select(['q.id as qrCodeId', 'tn.id as tenantId', 's.id as storeId', 't.id as tableId', 'tn.name as tenantName', 's.name as storeName', 't.label as tableLabel', 's.timezone'])
        .where('q.id', '=', signed.q)
        .where('q.status', '=', 'active')
        .where('t.is_active', '=', true)
        .where('t.deleted_at', 'is', null)
        .where('s.status', '<>', 'inactive')
        .where('tn.status', '=', 'active')
        .executeTakeFirst(),
    );
    if (!ctx) throw new AppError('QR_INVALID', 403, '더 이상 사용할 수 없는 QR 코드입니다. 직원에게 문의해 주세요');
    return ctx;
  }
}
