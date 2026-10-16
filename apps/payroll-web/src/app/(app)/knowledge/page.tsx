'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, BookOpen, CalendarClock, Plus } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  SearchInput,
  Select,
  Spinner,
  StatCard,
  Tabs,
  Textarea,
  Toolbar,
  errorMessage,
  formatDate,
  get,
  post,
  put,
  qs,
  useToast,
} from '@nexzi/ui';
import { ArticleEditor, CATEGORY_LABELS, type ArticleDraft } from '@/components/article-editor';
import type { ArticleSummary } from '@/lib/types';

type Tab = 'articles' | 'coverage' | 'checklist';

export default function KnowledgePage() {
  const [tab, setTab] = useState<Tab>('articles');
  const [draft, setDraft] = useState<ArticleDraft | null>(null);
  const router = useRouter();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['knowledge', 'meta'], queryFn: () => get<{ items: ArticleSummary[]; canManage: boolean }>('/knowledge/articles') });
  const canManage = list.data?.canManage ?? false;
  return (
    <>
      <PageHeader
        title="Knowledge centre"
        description="How payroll is run here: procedures, what each salary component is for, business rules and how to fix validation errors. Versioned, owned and review-dated so a new operator can take over."
        breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Knowledge centre' }]}
        actions={
          canManage && (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setDraft({})}>
              New article
            </Button>
          )
        }
      />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'articles', label: 'Articles' },
          { id: 'coverage', label: 'What is documented' },
          { id: 'checklist', label: 'Monthly checklist' },
        ]}
      />
      {tab === 'articles' && <Articles canManage={canManage} />}
      {tab === 'coverage' && <Coverage canManage={canManage} onDocument={setDraft} />}
      {tab === 'checklist' && <ChecklistTemplate />}
      {draft && (
        <ArticleEditor
          draft={draft}
          onClose={() => setDraft(null)}
          onSaved={(id) => {
            setDraft(null);
            qc.invalidateQueries({ queryKey: ['knowledge'] });
            qc.invalidateQueries({ queryKey: ['knowledge-coverage'] });
            router.push(`/knowledge/${id}`);
          }}
        />
      )}
    </>
  );
}

function StateBadge({ state }: { state: string }) {
  if (state === 'DOCUMENTED') return <Badge tone="success">Documented</Badge>;
  if (state === 'CLIENT_DEPENDENT') return <Badge tone="warning">Awaiting client confirmation</Badge>;
  if (state === 'DRAFT') return <Badge tone="neutral">Draft only</Badge>;
  return <Badge tone="danger">Not documented</Badge>;
}

function Articles({ canManage }: { canManage: boolean }) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [attention, setAttention] = useState('');
  const [archived, setArchived] = useState('false');
  const params = { search, category, attention, archived };
  const q = useQuery({ queryKey: ['knowledge', 'list', params], queryFn: () => get<{ items: ArticleSummary[]; canManage: boolean }>(`/knowledge/articles${qs(params)}`), placeholderData: (p) => p });
  return (
    <Card padded={false}>
      <Toolbar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search titles and text…" className="sm:w-72" />
        <Select aria-label="Type" className="sm:w-48" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All types</option>
          {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <Select aria-label="Needs attention" className="sm:w-56" value={attention} onChange={(e) => setAttention(e.target.value)}>
          <option value="">Any</option>
          <option value="OVERDUE">Review overdue</option>
          <option value="UNCONFIRMED">Not confirmed by the client</option>
        </Select>
        {canManage && (
          <Select aria-label="Archive" className="sm:w-36" value={archived} onChange={(e) => setArchived(e.target.value)}>
            <option value="false">Current</option>
            <option value="true">Archived</option>
          </Select>
        )}
      </Toolbar>
      {q.isLoading && !q.data ? (
        <Spinner />
      ) : q.error || !q.data ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : q.data.items.length ? (
        <ul className="divide-y divide-line">
          {q.data.items.map((a) => (
            <li key={a.id}>
              <Link href={`/knowledge/${a.id}`} className="fx-row block px-5 py-4 hover:bg-mist/40">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[15px] font-medium text-ink">{a.title}</span>
                  <Badge tone="brand">{CATEGORY_LABELS[a.category]}</Badge>
                  {a.status === 'DRAFT' && <Badge tone="neutral">Draft</Badge>}
                  {!a.clientConfirmed && (a.category === 'COMPONENT' || a.category === 'BUSINESS_RULE') && <Badge tone="warning">Awaiting client confirmation</Badge>}
                  {a.reviewOverdue && (
                    <Badge tone="danger">
                      <CalendarClock className="h-3 w-3" /> Review overdue
                    </Badge>
                  )}
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-muted">{a.excerpt}</p>
                <p className="mt-1 text-xs text-muted">
                  {a.ownerName ? `Owner: ${a.ownerName} · ` : 'No owner · '}version {a.currentVersion} · updated {formatDate(a.updatedAt)}
                  {a.reviewDueAt && ` · review by ${formatDate(a.reviewDueAt)}`}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={<BookOpen className="h-6 w-6" />} title="No articles found" hint={canManage ? 'Use “New article” to write the first procedure, or document a component from “What is documented”.' : 'Nothing has been published yet.'} />
      )}
    </Card>
  );
}

interface CoverageItem {
  id: string | null;
  title: string | null;
  state: string;
}

function Coverage({ canManage, onDocument }: { canManage: boolean; onDocument: (d: ArticleDraft) => void }) {
  const q = useQuery({
    queryKey: ['knowledge-coverage'],
    queryFn: () =>
      get<{
        components: (CoverageItem & { code: string; name: string; type: string; basis: string })[];
        validationErrors: (CoverageItem & { code: string; label: string })[];
        totals: { articles: number; published: number; drafts: number; unconfirmed: number; overdueReviews: number };
      }>('/knowledge/coverage'),
  });
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const { components, validationErrors, totals } = q.data;
  const undocumented = components.filter((c) => c.state === 'UNDOCUMENTED').length + validationErrors.filter((v) => v.state === 'UNDOCUMENTED').length;
  const docLink = (item: CoverageItem, draft: ArticleDraft) =>
    item.id ? (
      <Link href={`/knowledge/${item.id}`} className="text-sm font-medium text-cobalt hover:underline">
        {item.title}
      </Link>
    ) : canManage ? (
      <Button size="sm" variant="secondary" className="whitespace-nowrap" onClick={() => onDocument(draft)}>
        Document this
      </Button>
    ) : (
      <span className="text-sm text-muted">—</span>
    );
  return (
    <>
      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Not documented" value={undocumented} tone={undocumented ? 'attention' : 'default'} icon={<AlertTriangle className="h-4 w-4" />} hint="Components and errors without an article" />
        <StatCard label="Awaiting client confirmation" value={totals.unconfirmed} hint="Rules written down but not confirmed in writing" />
        <StatCard label="Reviews overdue" value={totals.overdueReviews} tone={totals.overdueReviews ? 'attention' : 'default'} />
        <StatCard label="Articles" value={totals.articles} hint={`${totals.published} published · ${totals.drafts} drafts`} />
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Salary components" padded={false}>
          <DataTable
            dense
            rows={components}
            rowKey={(c) => c.code}
            empty={<EmptyState title="No active components" />}
            columns={[
              { key: 'c', header: 'Component', render: (c) => (<span><span className="block font-medium text-ink">{c.name}</span><span className="text-xs text-muted">{c.code}</span></span>) },
              { key: 's', header: 'Documentation', render: (c) => <StateBadge state={c.state} /> },
              { key: 'a', header: 'Article', render: (c) => docLink(c, { category: 'COMPONENT', componentCode: c.code, title: c.name }) },
            ]}
          />
        </Card>
        <Card title="Validation errors and how to resolve them" padded={false}>
          <DataTable
            dense
            rows={validationErrors}
            rowKey={(v) => v.code}
            columns={[
              { key: 'c', header: 'Error', render: (v) => (<span><span className="block font-medium text-ink">{v.label}</span><span className="text-xs text-muted">{v.code}</span></span>) },
              { key: 's', header: 'Documentation', render: (v) => <StateBadge state={v.state} /> },
              { key: 'a', header: 'Article', render: (v) => docLink(v, { category: 'VALIDATION_ERROR', errorCode: v.code, title: `How to resolve: ${v.label}` }) },
            ]}
          />
        </Card>
      </div>
    </>
  );
}

interface ChecklistItem {
  id: string;
  label: string;
  description: string | null;
  articleId: string | null;
  article: { id: string; title: string } | null;
  sortOrder: number;
  active: boolean;
}

function ChecklistTemplate() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['checklist-items'], queryFn: () => get<{ items: ChecklistItem[]; canManage: boolean }>('/knowledge/checklist-items') });
  const [editing, setEditing] = useState<ChecklistItem | 'new' | null>(null);
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const { items, canManage } = q.data;
  return (
    <Card
      title="Steps for every payroll month"
      padded={false}
      actions={
        canManage && (
          <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
            Add step
          </Button>
        )
      }
    >
      <p className="border-b border-line px-5 py-3 text-sm text-muted">Each payroll run shows this list on its Checklist tab. Ticking a step records who did it and when; it never changes payroll.</p>
      {items.length ? (
        <ol className="divide-y divide-line">
          {items.map((i, n) => (
            <li key={i.id} className="flex items-start gap-4 px-5 py-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-mist text-xs font-semibold text-primary">{n + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">
                  {i.label} {!i.active && <Badge tone="neutral">Inactive</Badge>}
                </p>
                {i.description && <p className="text-xs text-muted">{i.description}</p>}
                {i.article && (
                  <Link href={`/knowledge/${i.article.id}`} className="text-xs font-medium text-cobalt hover:underline">
                    {i.article.title}
                  </Link>
                )}
              </div>
              {canManage && (
                <Button size="sm" variant="ghost" onClick={() => setEditing(i)}>
                  Edit
                </Button>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState title="No steps yet" />
      )}
      {editing && (
        <StepDialog
          item={editing === 'new' ? null : editing}
          nextOrder={(items.at(-1)?.sortOrder ?? 0) + 10}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            qc.invalidateQueries({ queryKey: ['checklist-items'] });
            qc.invalidateQueries({ queryKey: ['run-checklist'] });
          }}
        />
      )}
    </Card>
  );
}

function StepDialog({ item, nextOrder, onClose, onSaved }: { item: ChecklistItem | null; nextOrder: number; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const articles = useQuery({ queryKey: ['knowledge', 'all-for-steps'], queryFn: () => get<{ items: ArticleSummary[] }>('/knowledge/articles') });
  const [f, setF] = useState({ label: item?.label ?? '', description: item?.description ?? '', articleId: item?.articleId ?? '', sortOrder: String(item?.sortOrder ?? nextOrder), active: item?.active ?? true });
  const m = useMutation({
    mutationFn: () => {
      const body = { label: f.label.trim(), description: f.description.trim() || null, articleId: f.articleId || null, sortOrder: Number(f.sortOrder) || 0, active: f.active };
      return item ? put(`/knowledge/checklist-items/${item.id}`, body) : post('/knowledge/checklist-items', body);
    },
    onSuccess: () => {
      toast.success('Checklist saved.');
      onSaved();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={item ? 'Edit step' : 'Add step'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={m.isPending} disabled={f.label.trim().length < 3} onClick={() => m.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Step" htmlFor="s-label" required>
          <Input id="s-label" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} maxLength={160} />
        </Field>
        <Field label="Done when" htmlFor="s-desc">
          <Textarea id="s-desc" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={1000} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="How-to article" htmlFor="s-article">
            <Select id="s-article" value={f.articleId} onChange={(e) => setF({ ...f, articleId: e.target.value })}>
              <option value="">None</option>
              {articles.data?.items.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Order" htmlFor="s-order">
            <Input id="s-order" inputMode="numeric" value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: e.target.value })} />
          </Field>
        </div>
        <Checkbox label="Active (shown on payroll runs)" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
      </div>
    </Dialog>
  );
}

