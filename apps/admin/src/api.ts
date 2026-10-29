import { createApi } from '@qr/web';

export const api = createApi(import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000');
