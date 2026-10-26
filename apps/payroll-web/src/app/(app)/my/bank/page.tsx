'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { Alert, Button, Card, Field, Input, KeyValue, PageHeader, RequirePermission, Spinner, errorMessage, formatDateTime, get, put, useToast } from '@nexzi/ui';

interface Bank {
  accountHolder: string;
  accountNumberMasked: string;
  ifsc: string;
  bankName: string | null;
  branch: string | null;
  updatedAt: string;
}
interface MyBank {
  keyConfigured: boolean;
  bank: Bank | null;
}

export default function MyBankPage() {
  const q = useQuery({ queryKey: ['me-bank'], queryFn: () => get<MyBank>('/me/bank'), retry: false });
  const [editing, setEditing] = useState(false);
  return (
    <RequirePermission permission="self.service">
      <PageHeader
        title="My bank details"
        description="The account your salary is paid into. The number is stored encrypted; the payroll team and this page show only its last four digits."
        breadcrumbs={[{ label: 'My payslips', href: '/my' }, { label: 'My bank details' }]}
      />
      {q.isLoading ? (
        <Spinner />
      ) : q.error || !q.data ? (
        <Alert tone="warning" title="Your account is not linked yet">{errorMessage(q.error)}</Alert>
      ) : editing || !q.data.bank ? (
        <BankForm current={q.data.bank} disabled={!q.data.keyConfigured} onDone={q.data.bank ? () => setEditing(false) : undefined} />
      ) : (
        <Card title="Salary account" actions={<Button size="sm" variant="secondary" onClick={() => setEditing(true)}>Change</Button>}>
          <KeyValue
            columns={2}
            items={[
              { label: 'Account holder', value: q.data.bank.accountHolder },
              { label: 'Account number', value: <span className="inline-flex items-center gap-1 font-mono"><Lock className="h-3 w-3 text-muted" />{q.data.bank.accountNumberMasked}</span> },
              { label: 'IFSC', value: q.data.bank.ifsc },
              { label: 'Bank', value: [q.data.bank.bankName, q.data.bank.branch].filter(Boolean).join(', ') || '—' },
              { label: 'Last updated', value: formatDateTime(q.data.bank.updatedAt) },
            ]}
          />
        </Card>
      )}
    </RequirePermission>
  );
}

function BankForm({ current, disabled, onDone }: { current: Bank | null; disabled: boolean; onDone?: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ accountHolder: current?.accountHolder ?? '', accountNumber: '', confirm: '', ifsc: current?.ifsc ?? '', bankName: current?.bankName ?? '', branch: current?.branch ?? '' });
  const clean = (v: string) => v.replace(/[\s-]/g, '');
  const save = useMutation({
    mutationFn: () => put('/me/bank', { accountHolder: f.accountHolder.trim(), accountNumber: clean(f.accountNumber), ifsc: f.ifsc.trim(), bankName: f.bankName.trim() || null, branch: f.branch.trim() || null }),
    onSuccess: () => {
      toast.success('Bank details saved.');
      qc.invalidateQueries({ queryKey: ['me-bank'] });
      onDone?.();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const acctOk = /^[A-Za-z0-9]{6,34}$/.test(clean(f.accountNumber));
  const match = clean(f.accountNumber) === clean(f.confirm);
  const ifscOk = /^[A-Z]{4}0[A-Z0-9]{6}$/.test(f.ifsc.trim().toUpperCase());
  const valid = f.accountHolder.trim() && acctOk && match && ifscOk;
  return (
    <Card title={current ? 'Change salary account' : 'Add your salary account'}>
      {disabled && <Alert tone="warning" className="mb-4">Bank details cannot be saved right now. Please ask the payroll team.</Alert>}
      {current && <Alert tone="info" className="mb-4">Your current account ({current.accountNumberMasked}) is replaced. For security, the full number is never shown — enter it again.</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Account holder name" htmlFor="my-bk-holder" required className="sm:col-span-2">
          <Input id="my-bk-holder" value={f.accountHolder} onChange={(e) => setF({ ...f, accountHolder: e.target.value })} maxLength={100} />
        </Field>
        <Field label="Account number" htmlFor="my-bk-acct" required error={f.accountNumber && !acctOk ? '6–34 letters or digits.' : undefined}>
          <Input id="my-bk-acct" autoComplete="off" inputMode="numeric" value={f.accountNumber} onChange={(e) => setF({ ...f, accountNumber: e.target.value })} />
        </Field>
        <Field label="Confirm account number" htmlFor="my-bk-acct2" required error={f.confirm && !match ? 'The numbers do not match.' : undefined}>
          <Input id="my-bk-acct2" autoComplete="off" inputMode="numeric" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} onPaste={(e) => e.preventDefault()} />
        </Field>
        <Field label="IFSC" htmlFor="my-bk-ifsc" required error={f.ifsc && !ifscOk ? '11 characters, e.g. ABCD0123456.' : undefined}>
          <Input id="my-bk-ifsc" value={f.ifsc} onChange={(e) => setF({ ...f, ifsc: e.target.value.toUpperCase() })} maxLength={11} />
        </Field>
        <Field label="Bank name" htmlFor="my-bk-name">
          <Input id="my-bk-name" value={f.bankName} onChange={(e) => setF({ ...f, bankName: e.target.value })} maxLength={100} />
        </Field>
        <Field label="Branch" htmlFor="my-bk-branch" className="sm:col-span-2">
          <Input id="my-bk-branch" value={f.branch} onChange={(e) => setF({ ...f, branch: e.target.value })} maxLength={100} />
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        {onDone && <Button variant="ghost" onClick={onDone}>Cancel</Button>}
        <Button loading={save.isPending} disabled={!valid || disabled} onClick={() => save.mutate()}>Save bank details</Button>
      </div>
    </Card>
  );
}
