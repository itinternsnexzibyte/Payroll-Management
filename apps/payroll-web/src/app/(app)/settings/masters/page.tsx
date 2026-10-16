'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Button, Card, DataTable, EmptyState, Input, PageHeader, RequirePermission, StatusBadge, errorMessage, get, post, put, useToast } from '@nexzi/ui';
import type { Master } from '@/lib/types';

export default function MastersPage() {
  return (
    <RequirePermission permission={['settings.manage', 'employees.manage']}>
      <PageHeader title="Departments & designations" description="Lists used on employee records and validated during import. Entries in use are deactivated rather than deleted." breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Departments & designations' }]} />
      <div className="grid gap-6 xl:grid-cols-2">
        <MasterCard kind="departments" title="Departments" />
        <MasterCard kind="designations" title="Designations" />
      </div>
    </RequirePermission>
  );
}

function MasterCard({ kind, title }: { kind: 'departments' | 'designations'; title: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: [kind], queryFn: () => get<Master[]>(`/${kind}`), staleTime: 60_000 });
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await post(`/${kind}`, { name: name.trim(), active: true });
      setName('');
      await qc.invalidateQueries({ queryKey: [kind] });
      toast.success(`${title.slice(0, -1)} added.`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const toggle = async (m: Master) => {
    try {
      await put(`/${kind}/${m.id}`, { active: !m.active });
      await qc.invalidateQueries({ queryKey: [kind] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Card title={title} padded={false}>
      <form
        className="flex gap-2 border-b border-line px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <Input aria-label={`New ${title.toLowerCase().slice(0, -1)} name`} placeholder={`New ${title.toLowerCase().slice(0, -1)}`} value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" icon={<Plus className="h-4 w-4" />} loading={busy}>
          Add
        </Button>
      </form>
      <DataTable<Master>
        dense
        rows={q.data}
        loading={q.isLoading}
        error={q.error ? errorMessage(q.error) : null}
        rowKey={(m) => m.id}
        empty={<EmptyState title={`No ${title.toLowerCase()} yet`} />}
        columns={[
          { key: 'name', header: 'Name', render: (m) => m.name },
          { key: 'used', header: 'Employees', align: 'right', render: (m) => m._count?.employees ?? 0 },
          { key: 'status', header: 'Status', render: (m) => <StatusBadge status={m.active ? 'ACTIVE' : 'INACTIVE'} /> },
          { key: 't', header: '', align: 'right', render: (m) => <Button size="sm" variant="ghost" onClick={() => toggle(m)}>{m.active ? 'Deactivate' : 'Activate'}</Button> },
        ]}
      />
    </Card>
  );
}
