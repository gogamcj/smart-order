import type { ReactNode } from 'react';

/** 화면 맨 위 흰 띠: 제목 + 한 줄 설명 + 오른쪽 버튼 */
export function PageHeader({ title, desc, children }: { title: string; desc: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-gray-200 bg-white px-5 py-4">
      <h1 className="text-xl font-bold">{title}</h1>
      <p className="text-xs text-gray-500">{desc}</p>
      {children && <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
