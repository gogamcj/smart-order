import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { errorMessage } from './api.js';

type Tone = 'primary' | 'secondary' | 'danger' | 'ghost';
const TONES: Record<Tone, string> = {
  primary: 'bg-neutral-900 text-white hover:bg-neutral-700 disabled:bg-neutral-300',
  secondary: 'bg-gray-100 text-gray-800 hover:bg-gray-200 disabled:text-gray-400',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300',
  ghost: 'text-gray-700 hover:bg-gray-100 disabled:text-gray-400',
};

export function Button({ tone = 'primary', busy, className = '', children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone; busy?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || busy}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${TONES[tone]} ${className}`}
    >
      {busy && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
      {children}
    </button>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      {children}
      {hint && !error && <span className="block text-xs text-gray-500">{hint}</span>}
      {error && <span className="block text-xs text-red-600">{error}</span>}
    </label>
  );
}

const inputCls = 'w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:border-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-200';
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={`${inputCls} ${p.className ?? ''}`} />;
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={`${inputCls} ${p.className ?? ''}`} />;
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={`${inputCls} ${p.className ?? ''}`} />;

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
      <p>{errorMessage(error)}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-2 font-semibold underline">
          다시 시도
        </button>
      )}
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'success'; children: ReactNode }) {
  const cls = { info: 'border-blue-200 bg-blue-50 text-blue-800', warn: 'border-amber-300 bg-amber-50 text-amber-900', success: 'border-green-200 bg-green-50 text-green-800' }[tone];
  return <div className={`rounded-lg border p-3 text-sm ${cls}`}>{children}</div>;
}

export function Spinner({ label = '불러오는 중' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-500" role="status">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-neutral-900" aria-hidden />
      {label}
    </div>
  );
}

export function Badge({ className = '', children }: { className?: string; children: ReactNode }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${className}`}>{children}</span>;
}

export function Card({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`rounded-2xl border border-gray-100 bg-white p-4 shadow-sm ${className}`}>{children}</div>;
}

/** PC 로그인 화면: 왼쪽 안내 패널 + 오른쪽 입력 폼 (휴대폰에서는 폼만) */
export function AuthLayout({ eyebrow, title, intro, points, footer, children }: { eyebrow: string; title: string; intro: string; points: string[]; footer?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-neutral-100 md:p-8">
      <div className="flex min-h-dvh w-full max-w-5xl flex-col overflow-hidden bg-white md:min-h-[560px] md:flex-row md:rounded-3xl md:shadow-xl">
        <aside className="hidden flex-col justify-between bg-gradient-to-br from-neutral-900 to-neutral-700 p-10 text-white md:flex md:w-[46%]">
          <p className="text-lg font-extrabold tracking-tight">QR 테이블 주문</p>
          <div>
            <h2 className="whitespace-pre-line text-3xl font-bold leading-snug">{intro}</h2>
            <ul className="mt-8 space-y-3 text-sm text-neutral-200">
              {points.map((p) => (
                <li key={p} className="flex items-center gap-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/15 text-xs" aria-hidden>✓</span>
                  {p}
                </li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-neutral-400">© QR 테이블 주문</p>
        </aside>
        <section className="flex flex-1 flex-col justify-center px-6 py-12 md:px-16">
          <div className="mx-auto w-full max-w-sm space-y-6">
            <div>
              <p className="text-sm font-medium text-gray-400">{eyebrow}</p>
              <h1 className="mt-1 text-3xl font-bold tracking-tight">{title}</h1>
            </div>
            {children}
            {footer}
          </div>
        </section>
      </div>
    </div>
  );
}
