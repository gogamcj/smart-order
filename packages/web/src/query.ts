import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api.js';

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // 4xx 는 다시 시도해도 같으므로 재시도하지 않는다
        retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
        refetchOnWindowFocus: true,
        staleTime: 5_000,
      },
      mutations: { retry: false },
    },
  });
}
