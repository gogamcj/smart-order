import { Button, ErrorBox, Field, Input } from '@qr/web';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import type { Me } from '../types.js';

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-sm space-y-5 px-4 pt-16">
      <div className="text-center">
        <p className="text-sm font-semibold text-orange-600">QR 테이블 주문</p>
        <h1 className="mt-1 text-2xl font-bold">{title}</h1>
      </div>
      {children}
    </div>
  );
}

/** 로그인 후 업체가 하나면 바로 선택, 여러 개면 선택 화면, 없으면 가입 신청 */
async function afterLogin(qc: ReturnType<typeof useQueryClient>, nav: ReturnType<typeof useNavigate>) {
  const me = await api.get<Me>('/api/auth/me');
  const active = (me.memberships ?? []).filter((m) => m.status === 'active' && m.tenantStatus !== 'rejected' && m.tenantStatus !== 'closed');
  if (active.length === 1) await api.post('/api/auth/staff/select-tenant', { tenantId: active[0]!.tenantId });
  await qc.invalidateQueries();
  nav(active.length === 0 ? '/apply' : active.length === 1 ? '/' : '/select', { replace: true });
}

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const qc = useQueryClient();
  const nav = useNavigate();
  const login = useMutation({
    mutationFn: async () => {
      await api.post('/api/auth/staff/login', { email, password });
      await afterLogin(qc, nav);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate();
  };
  return (
    <Shell title="매장 관리 로그인">
      <form onSubmit={submit} className="space-y-3">
        <Field label="이메일">
          <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="비밀번호">
          <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <ErrorBox error={login.error} />
        <Button type="submit" className="w-full" busy={login.isPending}>로그인</Button>
      </form>
      <p className="text-center text-sm text-gray-600">
        처음이신가요? <Link to="/signup" className="font-semibold text-orange-600">계정 만들기</Link>
      </p>
    </Shell>
  );
}

export function SignupPage() {
  const [form, setForm] = useState({ email: '', password: '', displayName: '' });
  const qc = useQueryClient();
  const nav = useNavigate();
  const signup = useMutation({
    mutationFn: async () => {
      await api.post('/api/auth/staff/signup', form);
      await afterLogin(qc, nav);
    },
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <Shell title="계정 만들기">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          signup.mutate();
        }}
        className="space-y-3"
      >
        <Field label="이름">
          <Input required maxLength={50} value={form.displayName} onChange={set('displayName')} />
        </Field>
        <Field label="이메일">
          <Input type="email" autoComplete="username" required value={form.email} onChange={set('email')} />
        </Field>
        <Field label="비밀번호" hint="10자 이상">
          <Input type="password" autoComplete="new-password" required minLength={10} value={form.password} onChange={set('password')} />
        </Field>
        <ErrorBox error={signup.error} />
        <Button type="submit" className="w-full" busy={signup.isPending}>가입하기</Button>
      </form>
      <p className="text-center text-sm text-gray-600">
        이미 계정이 있나요? <Link to="/login" className="font-semibold text-orange-600">로그인</Link>
      </p>
    </Shell>
  );
}
