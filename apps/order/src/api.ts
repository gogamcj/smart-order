import { createApi } from '@qr/web';

// 고객 로그인은 업체·관리자 로그인과 다른 쿠키를 쓴다 (같은 브라우저에서 서로 로그아웃시키지 않도록)
export const api = createApi(import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000', undefined, 'customer');
export const devLoginEnabled = import.meta.env.VITE_DEV_LOGIN === 'true';
