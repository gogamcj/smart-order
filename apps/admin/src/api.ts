import { createApi } from '@qr/web';

// 화면마다 로그인 쿠키를 따로 쓴다 (같은 브라우저에서 서로 로그아웃시키지 않도록)
export const api = createApi(import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000', undefined, 'admin');
