'use client';
import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, GitBranch, Network, UserRound, UsersRound } from 'lucide-react';
import { Badge, Button, Card, Checkbox, Dialog, EmptyState, ErrorState, Field, PageHeader, RequirePermission, SearchInput, Select, Spinner, StatCard, Toolbar, errorMessage, get, put, useAuth, useToast } from '@nexzi/ui';

interface Person {
  id: string;
  employeeCode: string;
  fullName: string;
  department: string | null;
  designation: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'EXITED';
  managerId: string | null;
  directReports: number;
}
interface Org {
  people: Person[];
  stats: { headcount: number; topLevel: number; managers: number; averageSpan: number; widestSpan: number; levels: number; unplaced: number };
}

export default function OrganizationPage() {
  return (
    <RequirePermission permission="employees.view">
      <PageHeader title="Organisation structure" description="Who reports to whom. Set each employee's reporting manager here or on the employee form." breadcrumbs={[{ label: 'Employees', href: '/employees' }, { label: 'Organisation structure' }]} />
      <Chart />
    </RequirePermission>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

function Chart() {
  const { can } = useAuth();
  const [includeExited, setIncludeExited] = useState(false);
  const q = useQuery({ queryKey: ['organization', includeExited], queryFn: () => get<Org>(`/organization?includeExited=${includeExited}`) });
  const [search, setSearch] = useState('');
  const [dept, setDept] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [moving, setMoving] = useState<Person | null>(null);

  const { children, roots, matches, path } = useMemo(() => {
    const people = q.data?.people ?? [];
    const children = new Map<string, Person[]>();
    for (const p of people) if (p.managerId) children.set(p.managerId, [...(children.get(p.managerId) ?? []), p]);
    const byId = new Map(people.map((p) => [p.id, p]));
    const term = search.trim().toLowerCase();
    const hit = (p: Person) => (!term || `${p.fullName} ${p.employeeCode} ${p.designation ?? ''}`.toLowerCase().includes(term)) && (!dept || p.department === dept);
    const matches = new Set(people.filter(hit).map((p) => p.id));
    // Keep every ancestor of a match visible so the match is shown in context.
    const path = new Set<string>();
    for (const id of matches) for (let c: string | null = id; c && !path.has(c); c = byId.get(c)?.managerId ?? null) path.add(c);
    return { children, roots: people.filter((p) => !p.managerId), matches, path };
  }, [q.data, search, dept]);

  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const filtering = Boolean(search.trim() || dept);
  const departments = [...new Set(d.people.map((p) => p.department).filter(Boolean) as string[])].sort();
  const toggle = (id: string) => setCollapsed((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });

  const node = (p: Person): ReactNode => {
    if (filtering && !path.has(p.id)) return null;
    const kids = (children.get(p.id) ?? []).sort((a, b) => b.directReports - a.directReports || a.fullName.localeCompare(b.fullName));
    const open = !collapsed.has(p.id) || filtering;
    return (
      <li key={p.id} className="relative">
        <div className={`fx-enter group flex items-center gap-3 rounded-lg border bg-white px-3 py-2 shadow-sm transition hover:-translate-y-0.5 hover:shadow-[0_10px_24px_-16px_rgb(30_64_175/0.5)] ${filtering && matches.has(p.id) ? 'border-secondary ring-2 ring-mist' : 'border-line'} ${p.status !== 'ACTIVE' ? 'opacity-60' : ''}`}>
          {kids.length ? (
            <button type="button" aria-label={open ? `Collapse ${p.fullName}'s team` : `Expand ${p.fullName}'s team`} aria-expanded={open} onClick={() => toggle(p.id)} className="rounded p-0.5 text-muted hover:bg-mist">
              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          ) : (
            <span className="w-5" />
          )}
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-secondary text-xs font-semibold text-white" aria-hidden>
            {initials(p.fullName)}
          </span>
          <div className="min-w-0 flex-1">
            <Link href={`/employees/${p.id}`} className="block truncate font-medium text-ink hover:text-cobalt hover:underline">
              {p.fullName}
            </Link>
            <p className="truncate text-xs text-muted">
              {p.designation ?? 'No designation'} · {p.department ?? 'No department'} · {p.employeeCode}
            </p>
          </div>
          {p.status !== 'ACTIVE' && <Badge tone="neutral">{p.status.toLowerCase()}</Badge>}
          {kids.length > 0 && (
            <Badge tone="brand">
              <UsersRound className="h-3 w-3" aria-hidden /> {kids.length}
            </Badge>
          )}
          {can('employees.manage') && (
            <Button size="sm" variant="ghost" className="opacity-0 focus:opacity-100 group-hover:opacity-100" onClick={() => setMoving(p)}>
              Change manager
            </Button>
          )}
        </div>
        {kids.length > 0 && open && (
          <ul className="ml-6 mt-2 space-y-2 border-l-2 border-mist pl-5">
            {kids.map((k) => node(k))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="People in the structure" value={d.stats.headcount} hint={`${d.stats.topLevel} at the top level`} icon={<UsersRound className="h-4 w-4" />} />
        <StatCard label="Managers" value={d.stats.managers} hint={`Average span ${d.stats.averageSpan} · widest ${d.stats.widestSpan}`} icon={<UserRound className="h-4 w-4" />} />
        <StatCard label="Reporting levels" value={d.stats.levels} icon={<GitBranch className="h-4 w-4" />} />
        <StatCard label="Not placed yet" value={d.stats.unplaced} hint="No manager and no team" tone={d.stats.unplaced > 1 ? 'attention' : 'default'} icon={<Network className="h-4 w-4" />} />
      </div>
      <Card padded={false}>
        <Toolbar>
          <SearchInput value={search} onChange={setSearch} placeholder="Find a person or role…" className="w-72" />
          <Select className="w-56" aria-label="Filter by department" value={dept} onChange={(e) => setDept(e.target.value)}>
            <option value="">All departments</option>
            {departments.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </Select>
          <Checkbox label="Include exited" checked={includeExited} onChange={(e) => setIncludeExited(e.target.checked)} />
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setCollapsed(new Set())}>
              Expand all
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCollapsed(new Set(d.people.filter((p) => p.directReports > 0).map((p) => p.id)))}>
              Collapse all
            </Button>
          </div>
        </Toolbar>
        <div className="p-4">
          {d.people.length === 0 ? (
            <EmptyState title="No employees yet" />
          ) : filtering && matches.size === 0 ? (
            <EmptyState title="Nobody matches" hint="Try another name or department." />
          ) : (
            <ul className="space-y-2">{roots.sort((a, b) => b.directReports - a.directReports || a.fullName.localeCompare(b.fullName)).map((r) => node(r))}</ul>
          )}
        </div>
      </Card>
      <MoveDialog person={moving} people={d.people} onClose={() => setMoving(null)} />
    </div>
  );
}

function MoveDialog({ person, people, onClose }: { person: Person | null; people: Person[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [managerId, setManagerId] = useState('');
  const [saving, setSaving] = useState(false);
  const [lastId, setLastId] = useState<string | null>(null);
  if (person && person.id !== lastId) {
    setLastId(person.id);
    setManagerId(person.managerId ?? '');
  }
  // People inside this person's own team cannot become their manager.
  const blocked = useMemo(() => {
    const out = new Set<string>();
    if (!person) return out;
    const stack = [person.id];
    while (stack.length) {
      const id = stack.pop()!;
      out.add(id);
      for (const p of people) if (p.managerId === id && !out.has(p.id)) stack.push(p.id);
    }
    return out;
  }, [person, people]);
  const save = async () => {
    if (!person) return;
    setSaving(true);
    try {
      await put(`/employees/${person.id}/manager`, { managerId: managerId || null });
      await Promise.all([qc.invalidateQueries({ queryKey: ['organization'] }), qc.invalidateQueries({ queryKey: ['employee', person.id] })]);
      toast.success(`${person.fullName} moved.`);
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open={Boolean(person)}
      onClose={onClose}
      title={person ? `Reporting manager for ${person.fullName}` : ''}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={saving} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <Field label="Reports to" htmlFor="mgr" hint="Members of this person's own team are not offered, so no reporting loop can be created.">
        <Select id="mgr" value={managerId} onChange={(e) => setManagerId(e.target.value)}>
          <option value="">— No manager (top of the structure) —</option>
          {people
            .filter((p) => !blocked.has(p.id) && p.status !== 'EXITED')
            .sort((a, b) => a.fullName.localeCompare(b.fullName))
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName} · {p.designation ?? p.employeeCode}
              </option>
            ))}
        </Select>
      </Field>
    </Dialog>
  );
}
