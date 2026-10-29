import { Controller, Get, Inject } from '@nestjs/common';
import { Public } from '../auth/access.js';
import { ENV, type Env } from '../config/env.js';
import { Database } from '../db/database.js';
import { PaymentsService } from '../payments/payments.service.js';

@Controller()
export class HealthController {
  constructor(
    private readonly db: Database,
    private readonly payments: PaymentsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get('healthz')
  @Public()
  health() {
    return { ok: true };
  }

  /** 의존 서비스 연결과 외부 연동 설정 상태. 비밀 값은 노출하지 않는다 */
  @Get('readyz')
  @Public()
  async ready() {
    await this.db.ping();
    return {
      ok: true,
      environment: this.env.APP_ENV,
      integrations: {
        kakaoLogin: this.env.kakaoConfigured ? 'configured' : 'not_configured',
        payment: this.payments.providerInfo ? `${this.payments.providerInfo.name}(${this.payments.providerInfo.environment})` : 'not_configured',
        alimtalk: 'not_implemented',
        mediaStorage: this.env.MEDIA_STORAGE,
      },
    };
  }
}
