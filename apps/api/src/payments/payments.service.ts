import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { AppError, notFound } from '../common/errors.js';
import { Database } from '../db/database.js';
import { PAYMENT_PROVIDER, type PaymentProvider, type ProviderPayment } from './payment-provider.js';

export interface ConfirmResult {
  paymentStatus: string;
  orderStatus: string;
  orderId: string;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger('Payments');

  constructor(
    private readonly db: Database,
    @Optional() @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider | null,
  ) {}

  private requireProvider(): PaymentProvider {
    if (!this.provider) throw new AppError('PAYMENT_NOT_CONFIGURED', 503, '결제 서비스 연동을 준비 중입니다. 매장에 문의해 주세요');
    return this.provider;
  }

  get providerInfo() {
    return this.provider ? { name: this.provider.name, environment: this.provider.environment } : null;
  }

  /** 결제 요청 생성. 고객 본인의 결제 대기 주문만, 금액은 주문에 저장된 서버 계산 금액 */
  async create(userId: string, orderId: string) {
    const provider = this.requireProvider();
    const order = await this.db.asActor({ actor: 'customer', userId }, (tx) =>
      tx.selectFrom('orders').select(['id', 'tenant_id', 'status', 'total_amount', 'expires_at', 'order_no']).where('id', '=', orderId).executeTakeFirst(),
    );
    if (!order) throw notFound('주문');
    if (order.status !== 'pending_payment') throw new AppError('ORDER_NOT_PAYABLE', 409, '결제할 수 없는 주문 상태입니다');
    if (order.expires_at < new Date()) throw new AppError('ORDER_EXPIRED', 409, '결제 가능 시간이 지났습니다. 다시 주문해 주세요');

    return this.db.asSystem({ tenantId: order.tenant_id, userId, actorKind: 'customer' }, async (tx) => {
      // 같은 주문의 진행 중 결제 요청이 있으면 재사용 (중복 클릭)
      const open = await tx
        .selectFrom('payments')
        .select(['id', 'payment_request_id', 'amount'])
        .where('order_id', '=', orderId)
        .where('status', 'in', ['ready', 'pending'])
        .where('provider', '=', provider.name)
        .orderBy('created_at', 'desc')
        .executeTakeFirst();
      const payment =
        open ??
        (await tx
          .insertInto('payments')
          .values({
            tenant_id: order.tenant_id,
            order_id: orderId,
            payment_request_id: `pay_${randomBytes(12).toString('hex')}`,
            provider: provider.name,
            environment: provider.environment,
            amount: order.total_amount,
            status: 'ready',
          })
          .returning(['id', 'payment_request_id', 'amount'])
          .executeTakeFirstOrThrow());
      const checkout = await provider.createCheckout({ paymentRequestId: payment.payment_request_id, amount: payment.amount, orderName: `주문 ${order.order_no}` });
      return { paymentId: payment.id, paymentRequestId: payment.payment_request_id, amount: payment.amount, provider: provider.name, environment: provider.environment, checkout };
    });
  }

  /**
   * 결제 확정. 브라우저 복귀·웹훅·대사 작업이 모두 이 함수를 호출하며 여러 번 불려도 결과가 같다.
   * 1) PG 에 결제 상태를 다시 조회 → 2) 결제 행을 잠그고 → 3) 승인 금액이 청구 금액과 같을 때만 paid + 주문 placed
   */
  async confirm(paymentId: string, source: 'confirm' | 'reconcile' | 'webhook', asUserId?: string): Promise<ConfirmResult> {
    const provider = this.requireProvider();
    const payment = await this.db.asSystem({}, (tx) =>
      tx.selectFrom('payments').select(['id', 'tenant_id', 'order_id', 'payment_request_id', 'amount', 'status', 'provider']).where('id', '=', paymentId).executeTakeFirst(),
    );
    if (!payment) throw notFound('결제');
    if (asUserId) {
      const own = await this.db.asActor({ actor: 'customer', userId: asUserId }, (tx) => tx.selectFrom('orders').select('id').where('id', '=', payment.order_id).executeTakeFirst());
      if (!own) throw notFound('결제');
    }

    const remote: ProviderPayment = payment.status === 'paid' ? { status: 'paid' } : await provider.getPayment(payment.payment_request_id);

    return this.db.asSystem({ tenantId: payment.tenant_id, actorKind: 'system', statusReason: `payment:${source}` }, async (tx) => {
      await tx
        .insertInto('payment_events')
        .values({
          tenant_id: payment.tenant_id,
          payment_id: payment.id,
          provider: payment.provider,
          source,
          event_type: `payment.${remote.status}`,
          signature_verified: false,
          payload: JSON.stringify({ status: remote.status, approvedAmount: remote.approvedAmount, providerPaymentId: remote.providerPaymentId, failureCode: remote.failureCode }),
          processing_status: 'processed',
          processed_at: new Date(),
        })
        .execute();

      const locked = await tx.selectFrom('payments').select(['status', 'amount']).where('id', '=', payment.id).forUpdate().executeTakeFirstOrThrow();
      if (locked.status === 'ready' || locked.status === 'pending') {
        if (remote.status === 'paid') {
          if (remote.approvedAmount !== locked.amount) {
            await tx
              .updateTable('payments')
              .set({ status: 'failed', failure_code: 'AMOUNT_MISMATCH', failure_message: `approved=${remote.approvedAmount} expected=${locked.amount}`, failed_at: new Date(), provider_payment_id: remote.providerPaymentId ?? null, last_synced_at: new Date() })
              .where('id', '=', payment.id)
              .execute();
            // 승인된 금액의 PG 취소는 3단계(실제 PG 어댑터)에서 자동 실행. 지금은 결제 오류로 기록만 한다
            this.logger.error(`결제 금액 불일치 payment=${payment.id} approved=${remote.approvedAmount} expected=${locked.amount}`);
          } else {
            await tx
              .updateTable('payments')
              .set({ status: 'paid', approved_amount: remote.approvedAmount, provider_payment_id: remote.providerPaymentId!, approved_at: remote.approvedAt ?? new Date(), method: remote.method ?? null, last_synced_at: new Date() })
              .where('id', '=', payment.id)
              .execute();
          }
        } else if (remote.status === 'failed' || remote.status === 'cancelled') {
          await tx
            .updateTable('payments')
            .set({ status: 'failed', failure_code: remote.failureCode ?? remote.status.toUpperCase(), failure_message: remote.failureMessage ?? null, failed_at: new Date(), last_synced_at: new Date() })
            .where('id', '=', payment.id)
            .execute();
        } else {
          await tx.updateTable('payments').set({ status: 'pending', last_synced_at: new Date() }).where('id', '=', payment.id).execute();
        }
      }

      const now = await tx.selectFrom('payments').select('status').where('id', '=', payment.id).executeTakeFirstOrThrow();
      const order = await tx.selectFrom('orders').select(['status']).where('id', '=', payment.order_id).forUpdate().executeTakeFirstOrThrow();
      let orderStatus = order.status;
      if (now.status === 'paid' && order.status === 'pending_payment') {
        await tx.updateTable('orders').set({ status: 'placed' }).where('id', '=', payment.order_id).execute();
        orderStatus = 'placed';
        const settings = await tx.selectFrom('tenant_settings').select('auto_accept_orders').where('tenant_id', '=', payment.tenant_id).executeTakeFirst();
        if (settings?.auto_accept_orders) {
          await tx.updateTable('orders').set({ status: 'accepted' }).where('id', '=', payment.order_id).execute();
          orderStatus = 'accepted';
        }
      } else if (now.status === 'paid' && (order.status === 'expired' || order.status === 'cancelled')) {
        // 주문이 끝난 뒤 승인된 결제: 전액 환불 요청을 남긴다 (PG 환불 실행은 3단계)
        await tx
          .insertInto('refunds')
          .values({ tenant_id: payment.tenant_id, payment_id: payment.id, order_id: payment.order_id, amount: locked.amount, reason: '주문 종료 후 승인된 결제 자동 환불', idempotency_key: `late-payment-${payment.id}`, requested_kind: 'system' })
          .onConflict((oc) => oc.columns(['payment_id', 'idempotency_key']).doNothing())
          .execute();
      }
      return { paymentStatus: now.status, orderStatus, orderId: payment.order_id };
    });
  }
}
