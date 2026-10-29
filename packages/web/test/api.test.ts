import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApi } from '../src/api.js';
import { won } from '../src/format.js';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('API 클라이언트', () => {
  it('쿠키를 함께 보내고 CSRF 헤더를 붙인다', async () => {
    const f = vi.fn(async () => json(200, { ok: true }));
    const api = createApi('https://api.example.kr/', f as unknown as typeof fetch);
    await api.post('/api/orders', { a: 1 });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.kr/api/orders');
    expect(init.credentials).toBe('include');
    expect((init.headers as Record<string, string>)['X-Requested-With']).toBe('qr-order');
    expect((init.headers as Record<string, string>)['X-Qr-Session']).toBe('merchant');
    expect(init.body).toBe('{"a":1}');
  });

  it('서버 오류 형식을 ApiError 로 바꾼다', async () => {
    const api = createApi('', (async () => json(409, { error: { code: 'PRICE_CHANGED', message: '가격 변경', details: { quote: { total: 1 } }, requestId: 'r1' } })) as unknown as typeof fetch);
    const err = await api.post('/x').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: 'PRICE_CHANGED', details: { quote: { total: 1 } }, requestId: 'r1' });
  });

  it('네트워크 오류와 JSON 이 아닌 오류 응답도 사용자 메시지로 바꾼다', async () => {
    const down = createApi('', (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch);
    await expect(down.get('/x')).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 });
    const html = createApi('', (async () => new Response('<html>502</html>', { status: 502 })) as unknown as typeof fetch);
    await expect(html.get('/x')).rejects.toMatchObject({ code: 'HTTP_ERROR', status: 502 });
  });

  it('원화 표기', () => {
    expect(won(9500)).toBe('9,500원');
  });
});
