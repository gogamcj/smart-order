import { type DynamicModule, type MiddlewareConsumer, Module, type NestModule, type Provider } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminController } from './admin/admin.controller.js';
import { AccessGuard } from './auth/access.guard.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthMiddleware } from './auth/auth.middleware.js';
import { HttpKakaoClient, KAKAO_CLIENT, type KakaoClient } from './auth/kakao.client.js';
import { SessionService } from './auth/session.service.js';
import { CatalogController } from './catalog/catalog.controller.js';
import { CryptoService } from './common/crypto.service.js';
import { CsrfGuard } from './common/csrf.guard.js';
import { ErrorFilter } from './common/error.filter.js';
import { ENV, type Env } from './config/env.js';
import { Database } from './db/database.js';
import { HealthController } from './health/health.controller.js';
import { MediaService } from './media/media.service.js';
import { MerchantOrdersController } from './merchant/merchant-orders.controller.js';
import { MerchantReportsController } from './merchant/merchant-reports.controller.js';
import { OrderContextService } from './ordering/order-context.service.js';
import { OrderingController } from './ordering/ordering.controller.js';
import { FakePaymentProvider } from './payments/fake-payment.provider.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from './payments/payment-provider.js';
import { PaymentsController } from './payments/payments.controller.js';
import { PaymentsService } from './payments/payments.service.js';
import { QrService } from './stores/qr.service.js';
import { StoresController } from './stores/stores.controller.js';
import { TenantsController } from './tenants/tenants.controller.js';

export interface AppOverrides {
  kakaoClient?: KakaoClient;
  paymentProvider?: PaymentProvider | null;
  /** false 면 속도 제한을 끈다(통합 테스트 전용. 속도 제한 자체는 별도 테스트에서 켜고 검증) */
  throttle?: boolean;
}

function paymentProviderFor(env: Env): PaymentProvider | null {
  // portone / tosspayments 는 env 검증 단계에서 '미구현'으로 거부된다
  return env.PAYMENT_PROVIDER === 'fake' ? new FakePaymentProvider() : null;
}

@Module({})
export class AppModule implements NestModule {
  static forRoot(env: Env, overrides: AppOverrides = {}): DynamicModule {
    const providers: Provider[] = [
      { provide: ENV, useValue: env },
      Database,
      CryptoService,
      SessionService,
      OrderContextService,
      MediaService,
      QrService,
      PaymentsService,
      overrides.kakaoClient ? { provide: KAKAO_CLIENT, useValue: overrides.kakaoClient } : { provide: KAKAO_CLIENT, useClass: HttpKakaoClient },
      { provide: PAYMENT_PROVIDER, useValue: overrides.paymentProvider !== undefined ? overrides.paymentProvider : paymentProviderFor(env) },
      // 순서: 속도 제한 → CSRF → 접근 규칙
      { provide: APP_GUARD, useClass: ThrottlerGuard },
      { provide: APP_GUARD, useClass: CsrfGuard },
      { provide: APP_GUARD, useClass: AccessGuard },
      { provide: APP_FILTER, useClass: ErrorFilter },
    ];
    return {
      module: AppModule,
      imports: [ThrottlerModule.forRoot({ throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }], skipIf: () => overrides.throttle === false })],
      controllers: [
        HealthController,
        AuthController,
        TenantsController,
        AdminController,
        StoresController,
        CatalogController,
        OrderingController,
        MerchantOrdersController,
        MerchantReportsController,
        PaymentsController,
      ],
      providers,
    };
  }

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthMiddleware).forRoutes('*');
  }
}
