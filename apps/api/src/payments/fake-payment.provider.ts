import { randomUUID } from 'node:crypto';
import type { CheckoutRequest, PaymentProvider, ProviderPayment } from './payment-provider.js';

interface FakeRecord {
  amount: number;
  result?: ProviderPayment;
}

/**
 * 가짜 PG (APP_ENV=local/staging 의 테스트 전용, 운영 설정에서는 켤 수 없고 DB 도 거부한다).
 * 실제 돈이 오가지 않으며 화면에도 '테스트 결제'로 표시한다. 기록은 프로세스 메모리에만 있다.
 */
export class FakePaymentProvider implements PaymentProvider {
  readonly name = 'fake' as const;
  readonly environment = 'test' as const;
  private readonly records = new Map<string, FakeRecord>();

  async createCheckout(req: CheckoutRequest) {
    this.records.set(req.paymentRequestId, { amount: req.amount });
    return { kind: 'fake', paymentRequestId: req.paymentRequestId, amount: req.amount, orderName: req.orderName, notice: '테스트 결제입니다. 실제 결제가 이루어지지 않습니다.' };
  }

  async getPayment(paymentRequestId: string): Promise<ProviderPayment> {
    const rec = this.records.get(paymentRequestId);
    if (!rec) return { status: 'not_found' };
    return rec.result ?? { status: 'pending' };
  }

  /** 테스트 결제창의 '승인'·'실패' 버튼. approvedAmount 를 바꿔 금액 불일치도 흉내 낼 수 있다 */
  simulate(paymentRequestId: string, outcome: 'approve' | 'fail', approvedAmount?: number): boolean {
    const rec = this.records.get(paymentRequestId);
    if (!rec || rec.result) return false;
    rec.result =
      outcome === 'approve'
        ? { status: 'paid', providerPaymentId: `fake_${randomUUID()}`, approvedAmount: approvedAmount ?? rec.amount, method: 'card', approvedAt: new Date() }
        : { status: 'failed', failureCode: 'FAKE_DECLINED', failureMessage: '테스트 결제 실패' };
    return true;
  }
}
