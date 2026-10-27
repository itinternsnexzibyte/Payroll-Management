'use client';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, CalendarCheck, History, Pencil } from 'lucide-react';
import { Alert, Badge, Button, Card, ConfirmDialog, Dialog, ErrorState, Field, Input, KeyValue, PageHeader, Spinner, errorMessage, formatDate, formatDateTime, get, post, useToast } from '@nexzi/ui';
import { ArticleEditor, CATEGORY_LABELS } from '@/components/article-editor';
import { ArticleText } from '@/components/article-text';
import type { ArticleDetail } from '@/lib/types';

export default function ArticlePage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['knowledge', 'article', id], queryFn: () => get<ArticleDetail>(`/knowledge/articles/${id}`) });
  const [editing, setEditing] = useState(false);
  const [version, setVersion] = useState<number | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['knowledge'] });
    qc.invalidateQueries({ queryKey: ['knowledge-coverage'] });
  };
  const archive = useMutation({
    mutationFn: (action: 'archive' | 'restore') => post(`/knowledge/articles/${id}/${action}`),
    onSuccess: (_r, action) => {
      setArchiving(false);
      refresh();
      toast.success(action === 'archive' ? 'Article archived.' : 'Article restored.');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const a = q.data;

  return (
    <>
      <PageHeader
        title={a.title}
        breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Knowledge centre', href: '/knowledge' }, { label: a.title }]}
        badge={
          <span className="flex flex-wrap gap-2">
            <Badge tone="brand">{CATEGORY_LABELS[a.category]}</Badge>
            {a.status === 'DRAFT' && <Badge tone="neutral">Draft</Badge>}
            {a.archived && <Badge tone="neutral">Archived</Badge>}
          </span>
        }
        actions={
          a.canManage && (
            <>
              {!a.archived && (
                <Button variant="secondary" icon={<CalendarCheck className="h-4 w-4" />} onClick={() => setReviewing(true)}>
                  Mark reviewed
                </Button>
              )}
              <Button variant="ghost" icon={a.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />} onClick={() => (a.archived ? archive.mutate('restore') : setArchiving(true))}>
                {a.archived ? 'Restore' : 'Archive'}
              </Button>
              {!a.archived && (
                <Button icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>
                  Edit
                </Button>
              )}
            </>
          )
        }
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          {a.reviewOverdue && (
            <Alert tone="danger" className="mb-4">
              The review date ({formatDate(a.reviewDueAt)}) has passed. Check the text is still correct.
            </Alert>
          )}
          <ArticleText text={a.body} />
        </Card>
        <div className="space-y-5">
          <Card title="About this article">
            <KeyValue
              columns={1}
              items={[
                { label: 'Owner', value: a.ownerName ?? 'No owner' },
                { label: 'Client confirmation', value: a.clientConfirmed ? <Badge tone="success">Confirmed in writing</Badge> : <Badge tone="warning">Not confirmed</Badge> },
                { label: 'Next review', value: a.reviewDueAt ? formatDate(a.reviewDueAt) : 'Not scheduled' },
                { label: 'Last reviewed', value: a.lastReviewedAt ? `${formatDateTime(a.lastReviewedAt)} by ${a.lastReviewedBy}` : 'Never' },
                ...(a.componentCode ? [{ label: 'Salary component', value: a.componentCode }] : []),
                ...(a.errorCode ? [{ label: 'Validation error', value: a.errorCode }] : []),
              ]}
            />
          </Card>
          <Card title={`Versions (${a.versions.length})`} padded={false}>
            <ul className="divide-y divide-line">
              {a.versions.map((v) => (
                <li key={v.version} className="flex items-start gap-3 px-5 py-3">
                  <span className="mt-0.5 rounded-md bg-mist px-1.5 py-0.5 text-xs font-semibold text-primary">v{v.version}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-ink">{v.changeNote}</p>
                    <p className="text-xs text-muted">
                      {v.createdByName ?? 'Unknown'} · {formatDateTime(v.createdAt)}
                    </p>
                  </div>
                  {v.version !== a.currentVersion && (
                    <Button size="sm" variant="ghost" icon={<History className="h-4 w-4" />} onClick={() => setVersion(v.version)}>
                      View
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
      {editing && (
        <ArticleEditor
          article={a}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            refresh();
          }}
        />
      )}
      {version !== null && <VersionDialog id={a.id} version={version} onClose={() => setVersion(null)} />}
      {reviewing && (
        <ReviewDialog
          id={a.id}
          onClose={() => setReviewing(false)}
          onDone={() => {
            setReviewing(false);
            refresh();
          }}
        />
      )}
      <ConfirmDialog
        open={archiving}
        onClose={() => setArchiving(false)}
        onConfirm={() => archive.mutate('archive')}
        loading={archive.isPending}
        title="Archive article"
        message="The article is hidden from search and checklists but kept with its full history. You can restore it later."
        confirmLabel="Archive"
      />
    </>
  );
}

function VersionDialog({ id, version, onClose }: { id: string; version: number; onClose: () => void }) {
  const q = useQuery({ queryKey: ['knowledge', 'version', id, version], queryFn: () => get<{ version: number; title: string; body: string; changeNote: string; createdAt: string; createdByName: string | null }>(`/knowledge/articles/${id}/versions/${version}`) });
  return (
    <Dialog open onClose={onClose} width="xl" title={`Version ${version}`}>
      {q.isLoading ? (
        <Spinner />
      ) : !q.data ? (
        <ErrorState message={errorMessage(q.error)} />
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted">
            “{q.data.changeNote}” · {q.data.createdByName} · {formatDateTime(q.data.createdAt)}
          </p>
          <h3 className="text-lg font-semibold text-ink">{q.data.title}</h3>
          <ArticleText text={q.data.body} />
        </div>
      )}
    </Dialog>
  );
}

function ReviewDialog({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [next, setNext] = useState('');
  const m = useMutation({
    mutationFn: () => post(`/knowledge/articles/${id}/review`, next ? { nextReviewDueAt: next } : {}),
    onSuccess: () => {
      toast.success('Recorded as reviewed.');
      onDone();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Mark as reviewed"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={m.isPending} onClick={() => m.mutate()}>
            Confirm review
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-ink">Confirm you have read the article and it is still correct. This records your name and today&apos;s date.</p>
        <Field label="Next review by (optional)" htmlFor="next-review">
          <Input id="next-review" type="date" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
