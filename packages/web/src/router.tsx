import type { ReactNode } from 'react';
import { BrowserRouter, HashRouter } from 'react-router-dom';

/**
 * VITE_ROUTER=hash 이면 해시 주소(/#/q/...)를 쓴다. Cafe24 처럼 모든 경로를 index.html 로 돌려주는
 * 설정(.htaccess)을 확신할 수 없는 정적 호스팅용. 서버 ORDER_WEB_ROUTING 과 같은 값으로 맞춘다.
 */
export function AppRouter({ children }: { children: ReactNode }) {
  if (import.meta.env.VITE_ROUTER === 'hash') return <HashRouter>{children}</HashRouter>;
  const basename = import.meta.env.BASE_URL.replace(/\/+$/, '') || undefined;
  return <BrowserRouter basename={basename}>{children}</BrowserRouter>;
}
