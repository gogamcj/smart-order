export interface CheckoutRequest {
  paymentRequestId: string;
  amount: number;
  orderName: string;
}

export interface ProviderPayment {
  status: 'paid' | 'pending' | 'failed' | 'cancelled' | 'not_found';
  providerPaymentId?: string;
  approvedAmount?: number;
  method?: 'card' | 'easy_pay' | 'kakaopay';
  approvedAt?: Date;
  failureCode?: string;
  failureMessage?: string;
}

/**
 * PG 연동 인터페이스. 실제 PG(PortOne 등) 어댑터는 PG 계약 후 3단계에서 추가한다.
 * 판단은 항상 getPayment() 로 PG 에 다시 물어본 결과로 한다(브라우저 복귀·웹훅 본문을 믿지 않음).
 */
export interface PaymentProvider {
  readonly name: 'fake';
  readonly environment: 'test' | 'live';
  /** 브라우저가 결제창을 띄우는 데 필요한 값 */
  createCheckout(req: CheckoutRequest): Promise<Record<string, unknown>>;
  getPayment(paymentRequestId: string): Promise<ProviderPayment>;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
