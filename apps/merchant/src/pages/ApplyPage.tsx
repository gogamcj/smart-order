import { Button, ErrorBox, Field, fieldIssues, Input, Notice } from '@qr/web';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';

const FIELDS = [
  ['name', '업체(상호) 이름', 'text', ''],
  ['slug', '업체 주소용 영문 이름', 'text', '영문 소문자·숫자·하이픈 3~40자 (예: hong-kimchi)'],
  ['businessRegistrationNo', '사업자등록번호', 'text', '숫자 10자리, 하이픈 없이'],
  ['representativeName', '대표자 이름', 'text', ''],
  ['contactPhone', '연락처', 'tel', ''],
  ['contactEmail', '연락 이메일', 'email', ''],
  ['storeName', '첫 매장 이름', 'text', '나중에 매장을 더 추가할 수 있습니다'],
] as const;

type Form = Record<(typeof FIELDS)[number][0], string>;

export function ApplyPage() {
  const [form, setForm] = useState<Form>({ name: '', slug: '', businessRegistrationNo: '', representativeName: '', contactPhone: '', contactEmail: '', storeName: '' });
  const qc = useQueryClient();
  const nav = useNavigate();
  const apply = useMutation({
    mutationFn: async () => {
      const r = await api.post<{ tenantId: string }>('/api/tenants/apply', { ...form, businessRegistrationNo: form.businessRegistrationNo.replace(/\D/g, '') });
      await api.post('/api/auth/staff/select-tenant', { tenantId: r.tenantId });
    },
    onSuccess: async () => {
      await qc.invalidateQueries();
      nav('/', { replace: true });
    },
  });
  const issues = fieldIssues(apply.error);
  return (
    <div className="mx-auto max-w-lg space-y-4 px-4 py-10">
      <h1 className="text-xl font-bold">업체 가입 신청</h1>
      <Notice>신청 후 플랫폼 관리자가 확인하고 승인합니다. 승인 전에도 메뉴와 테이블을 준비할 수 있습니다. 현재 무료로 운영 중이며 이용료가 청구되지 않습니다.</Notice>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          apply.mutate();
        }}
      >
        {FIELDS.map(([k, label, type, hint]) => (
          <Field key={k} label={label} hint={hint || undefined} error={issues.find((i) => i.path === k)?.message}>
            <Input type={type} required value={form[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} />
          </Field>
        ))}
        <ErrorBox error={apply.error} />
        <Button type="submit" className="w-full" busy={apply.isPending}>신청하기</Button>
      </form>
    </div>
  );
}
