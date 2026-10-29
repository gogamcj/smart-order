import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../config/env.js';

@Injectable()
export class CryptoService {
  private readonly encKey: Buffer;
  private readonly hmacKey: Buffer;
  private readonly signKey: Buffer;

  constructor(@Inject(ENV) env: Env) {
    this.encKey = Buffer.from(env.DATA_ENCRYPTION_KEY, 'base64');
    this.hmacKey = Buffer.from(env.DATA_HMAC_KEY, 'base64');
    this.signKey = createHash('sha256').update(env.SESSION_SECRET).digest();
  }

  /** AES-256-GCM. 결과 = iv(12) | tag(16) | 암호문 */
  encrypt(plain: string): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encKey, iv);
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]);
  }

  decrypt(data: Buffer): string {
    const decipher = createDecipheriv('aes-256-gcm', this.encKey, data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
  }

  hmac(value: string): Buffer {
    return createHmac('sha256', this.hmacKey).update(value).digest();
  }

  /** 서명된 쿠키 값: base64url(JSON).base64url(HMAC) */
  sign(payload: object): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${body}.${createHmac('sha256', this.signKey).update(body).digest('base64url')}`;
  }

  verify<T>(token: string | undefined): T | null {
    if (!token) return null;
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    const expected = createHmac('sha256', this.signKey).update(body).digest();
    const given = Buffer.from(sig, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    try {
      return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T;
    } catch {
      return null;
    }
  }

  static sha256(value: string): Buffer {
    return createHash('sha256').update(value).digest();
  }

  static randomToken(bytes = 32): string {
    return randomBytes(bytes).toString('base64url');
  }
}
