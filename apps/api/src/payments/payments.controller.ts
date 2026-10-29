import { Body, Controller, HttpCode, Inject, Optional, Param, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { CustomerOnly, Public } from '../auth/access.js';
import { AppError } from '../common/errors.js';
import type { AppRequest } from '../common/request.js';
import { parse } from '../common/zod.js';
import { FakePaymentProvider } from './fake-payment.provider.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from './payment-provider.js';
import { PaymentsService } from './payments.service.js';

@Controller('api')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    @Optional() @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider | null,
  ) {}

  @Post('payments')
  @CustomerOnly()
  create(@Body() body: unknown, @Req() req: AppRequest) {
    const { orderId } = parse(z.object({ orderId: z.string().uuid() }), body);
    return this.payments.create(req.auth!.userId, orderId);
  }

  @Post('payments/:id/confirm')
  @CustomerOnly()
  @HttpCode(200)
  confirm(@Param('id') id: string, @Req() req: AppRequest) {
    return this.payments.confirm(parse(z.string().uuid(), id), 'confirm', req.auth!.userId);
  }

  /** 가짜 PG 의 결제창 버튼 (PAYMENT_PROVIDER=fake 일 때만 존재). 실제 PG 에서는 PG 결제창이 이 역할을 한다 */
  @Post('dev/fake-pg/:paymentRequestId')
  @Public()
  @HttpCode(200)
  simulate(@Param('paymentRequestId') prid: string, @Body() body: unknown) {
    if (!(this.provider instanceof FakePaymentProvider)) throw new AppError('NOT_FOUND', 404, '요청한 경로를 찾을 수 없습니다');
    const input = parse(z.object({ outcome: z.enum(['approve', 'fail']), approvedAmount: z.number().int().positive().optional() }), body);
    if (!this.provider.simulate(prid, input.outcome, input.approvedAmount)) throw new AppError('NOT_FOUND', 404, '결제 요청을 찾을 수 없거나 이미 처리되었습니다');
    return { ok: true };
  }
}
