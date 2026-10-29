import { createApi } from '@qr/web';

export const api = createApi(import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000');
export const devLoginEnabled = import.meta.env.VITE_DEV_LOGIN === 'true';
