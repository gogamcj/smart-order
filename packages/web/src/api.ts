/**
 * 백엔드 API 호출. 세션은 HttpOnly 쿠키로만 다루며(credentials: include) 토큰을 JS 에 저장하지 않는다.
 * 모든 요청에 CSRF 확인용 사용자 정의 헤더를 붙인다(서버가 Origin 과 함께 검사).
 */
export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  del<T>(path: string): Promise<T>;
  upload<T>(path: string, form: FormData): Promise<T>;
  /** 파일 응답(PDF 등)을 Blob 으로 받는다 */
  download(path: string, body?: unknown): Promise<Blob>;
  url(path: string): string;
}

const NETWORK_MESSAGE = '서버에 연결할 수 없습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요';

export function createApi(baseUrl: string, fetchImpl: typeof fetch = (...a) => fetch(...a)): ApiClient {
  const base = baseUrl.replace(/\/+$/, '');
  async function request<T>(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<T> {
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
    const headers: Record<string, string> = { 'X-Requested-With': 'qr-order', Accept: 'application/json', ...extra };
    if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
    let res: Response;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method,
        credentials: 'include',
        headers,
        body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, 'NETWORK_ERROR', NETWORK_MESSAGE);
    }
    const text = await res.text();
    let data: unknown = null; // 본문이 없는 응답(서버가 null 을 돌려준 경우 등)은 null
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = undefined;
      }
    }
    if (!res.ok) {
      const err = (data as { error?: ApiErrorBody } | undefined)?.error;
      if (err?.code) throw new ApiError(res.status, err.code, err.message, err.details, err.requestId);
      throw new ApiError(res.status, 'HTTP_ERROR', res.status >= 500 ? '일시적인 서버 오류입니다. 잠시 후 다시 시도해 주세요' : `요청을 처리하지 못했습니다 (${res.status})`);
    }
    return data as T;
  }
  async function download(path: string, body?: unknown): Promise<Blob> {
    let res: Response;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        credentials: 'include',
        headers: { 'X-Requested-With': 'qr-order', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, 'NETWORK_ERROR', NETWORK_MESSAGE);
    }
    if (!res.ok) {
      const err = ((await res.json().catch(() => undefined)) as { error?: ApiErrorBody } | undefined)?.error;
      throw new ApiError(res.status, err?.code ?? 'HTTP_ERROR', err?.message ?? `파일을 받지 못했습니다 (${res.status})`);
    }
    return res.blob();
  }
  return {
    download,
    get: (p) => request('GET', p),
    post: (p, b, h) => request('POST', p, b ?? {}, h),
    patch: (p, b) => request('PATCH', p, b ?? {}),
    put: (p, b) => request('PUT', p, b ?? {}),
    del: (p) => request('DELETE', p),
    upload: (p, f) => request('POST', p, f),
    url: (p) => `${base}${p}`,
  };
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return '알 수 없는 오류가 발생했습니다';
}

/** 422 VALIDATION_FAILED 의 항목별 사유 */
export function fieldIssues(e: unknown): { path: string; message: string }[] {
  return e instanceof ApiError && e.code === 'VALIDATION_FAILED' && Array.isArray(e.details) ? (e.details as { path: string; message: string }[]) : [];
}
