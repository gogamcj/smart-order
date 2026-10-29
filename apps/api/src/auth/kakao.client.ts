import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../config/env.js';

export interface KakaoProfile {
  kakaoId: string;
  nickname: string | null;
}

/** 카카오 공식 OAuth 엔드포인트 호출. 테스트에서는 KAKAO_CLIENT 토큰으로 가짜 구현을 주입한다 */
export interface KakaoClient {
  authorizeUrl(state: string): string;
  exchangeCodeForProfile(code: string): Promise<KakaoProfile>;
}

export const KAKAO_CLIENT = Symbol('KAKAO_CLIENT');

export class KakaoApiError extends Error {}

@Injectable()
export class HttpKakaoClient implements KakaoClient {
  constructor(@Inject(ENV) private readonly env: Env) {}

  authorizeUrl(state: string): string {
    const u = new URL('https://kauth.kakao.com/oauth/authorize');
    u.searchParams.set('client_id', this.env.KAKAO_REST_API_KEY!);
    u.searchParams.set('redirect_uri', this.env.KAKAO_REDIRECT_URI!);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('state', state);
    return u.toString();
  }

  async exchangeCodeForProfile(code: string): Promise<KakaoProfile> {
    const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: this.env.KAKAO_REST_API_KEY!,
        client_secret: this.env.KAKAO_CLIENT_SECRET!,
        redirect_uri: this.env.KAKAO_REDIRECT_URI!,
        code,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!tokenRes.ok) throw new KakaoApiError(`token ${tokenRes.status}`);
    const token = (await tokenRes.json()) as { access_token?: string };
    if (!token.access_token) throw new KakaoApiError('no access_token');

    const meRes = await fetch('https://kapi.kakao.com/v2/user/me', {
      headers: { Authorization: `Bearer ${token.access_token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!meRes.ok) throw new KakaoApiError(`me ${meRes.status}`);
    const me = (await meRes.json()) as { id?: number | string; kakao_account?: { profile?: { nickname?: string } } };
    if (me.id === undefined) throw new KakaoApiError('no id');
    return { kakaoId: String(me.id), nickname: me.kakao_account?.profile?.nickname?.slice(0, 50) ?? null };
  }
}
