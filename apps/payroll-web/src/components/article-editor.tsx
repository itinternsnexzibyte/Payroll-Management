'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, ApiError, Button, Checkbox, Dialog, Field, Input, Select, Textarea, errorMessage, get, post, put, useToast } from '@nexzi/ui';
import { useComponents } from '@/lib/hooks';
import type { ArticleDetail, KnowledgeCategory } from '@/lib/types';

export const CATEGORY_LABELS: Record<KnowledgeCategory, string> = {
  PROCEDURE: 'Procedure',
  COMPONENT: 'Salary component',
  BUSINESS_RULE: 'Business rule',
  VALIDATION_ERROR: 'Validation error',
  ONBOARDING: 'Onboarding',
};

export interface ArticleDraft {
  category?: KnowledgeCategory;
  componentCode?: string;
  errorCode?: string;
  title?: string;
}

/** Create or edit a knowledge article. Every save of an existing article creates a new version. */
export function ArticleEditor({ article, draft, onClose, onSaved }: { article?: ArticleDetail; draft?: ArticleDraft; onClose: () => void; onSaved: (id: string) => void }) {
  const toast = useToast();
  const components = useComponents();
  const owners = useQuery({ queryKey: ['knowledge-owners'], queryFn: () => get<{ id: string; name: string }[]>('/knowledge/owners') });
  const coverage = useQuery({ queryKey: ['knowledge-coverage'], queryFn: () => get<{ validationErrors: { code: string; label: string }[] }>('/knowledge/coverage') });
  const [f, setF] = useState({
    title: article?.title ?? draft?.title ?? '',
    body: article?.body ?? '',
    category: (article?.category ?? draft?.category ?? 'PROCEDURE') as KnowledgeCategory,
    componentCode: article?.componentCode ?? draft?.componentCode ?? '',
    errorCode: article?.errorCode ?? draft?.errorCode ?? '',
    status: article?.status ?? 'DRAFT',
    clientConfirmed: article?.clientConfirmed ?? false,
    ownerId: article?.ownerId ?? '',
    reviewDueAt: article?.reviewDueAt ?? '',
    changeNote: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const save = async () => {
    const fe: Record<string, string> = {};
    if (f.title.trim().length < 3) fe.title = 'Enter a title.';
    if (f.body.trim().length < 10) fe.body = 'Write at least a sentence.';
    if (f.category === 'COMPONENT' && !f.componentCode) fe.componentCode = 'Choose the component.';
    if (f.category === 'VALIDATION_ERROR' && !f.errorCode) fe.errorCode = 'Choose the validation error.';
    if (article && f.changeNote.trim().length < 3) fe.changeNote = 'Describe what changed.';
    setErrors(fe);
    setFormError(null);
    if (Object.keys(fe).length) return;
    setSaving(true);
    const payload = {
      title: f.title.trim(),
      body: f.body.trim(),
      category: f.category,
      componentCode: f.category === 'COMPONENT' ? f.componentCode : f.componentCode || null,
      errorCode: f.category === 'VALIDATION_ERROR' ? f.errorCode : f.errorCode || null,
      status: f.status,
      clientConfirmed: f.clientConfirmed,
      ownerId: f.ownerId || null,
      reviewDueAt: f.reviewDueAt || null,
    };
    try {
      const res = article
        ? await put<{ id: string }>(`/knowledge/articles/${article.id}`, { ...payload, changeNote: f.changeNote.trim(), expectedVersion: article.currentVersion })
        : await post<{ id: string }>('/knowledge/articles', { ...payload, ownerId: f.ownerId || undefined });
      toast.success(article ? `Saved as version ${article.currentVersion + 1}.` : 'Article created.');
      onSaved(res.id);
    } catch (e) {
      if (e instanceof ApiError && e.fields.length) setErrors(e.fieldMap());
      setFormError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      width="xl"
      title={article ? `Edit “${article.title}”` : 'New knowledge article'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={saving} onClick={save}>
            {article ? 'Save new version' : 'Create article'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {formError && <Alert tone="danger">{formError}</Alert>}
        <Alert tone="info">Write procedures and rules only. Do not paste salary amounts, bank details or other personal data — everyone who can sign in can read published articles.</Alert>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" htmlFor="a-title" required error={errors.title} className="sm:col-span-2">
            <Input id="a-title" value={f.title} onChange={(e) => set('title', e.target.value)} maxLength={160} invalid={!!errors.title} />
          </Field>
          <Field label="Type" htmlFor="a-cat">
            <Select id="a-cat" value={f.category} onChange={(e) => set('category', e.target.value as KnowledgeCategory)}>
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          {f.category === 'COMPONENT' ? (
            <Field label="Salary component" htmlFor="a-comp" required error={errors.componentCode}>
              <Select id="a-comp" value={f.componentCode} onChange={(e) => set('componentCode', e.target.value)} invalid={!!errors.componentCode}>
                <option value="">Choose…</option>
                {components.data?.items.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name} ({c.code})
                  </option>
                ))}
              </Select>
            </Field>
          ) : f.category === 'VALIDATION_ERROR' ? (
            <Field label="Validation error" htmlFor="a-err" required error={errors.errorCode}>
              <Select id="a-err" value={f.errorCode} onChange={(e) => set('errorCode', e.target.value)} invalid={!!errors.errorCode}>
                <option value="">Choose…</option>
                {coverage.data?.validationErrors.map((v) => (
                  <option key={v.code} value={v.code}>
                    {v.label}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <div />
          )}
          <Field label="Owner" htmlFor="a-owner" hint="Responsible for keeping this up to date.">
            <Select id="a-owner" value={f.ownerId} onChange={(e) => set('ownerId', e.target.value)}>
              <option value="">{article ? 'No owner' : 'Me'}</option>
              {owners.data?.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Next review by" htmlFor="a-review">
            <Input id="a-review" type="date" value={f.reviewDueAt} onChange={(e) => set('reviewDueAt', e.target.value)} />
          </Field>
          <Field label="Status" htmlFor="a-status">
            <Select id="a-status" value={f.status} onChange={(e) => set('status', e.target.value as 'DRAFT' | 'PUBLISHED')}>
              <option value="DRAFT">Draft — visible to editors only</option>
              <option value="PUBLISHED">Published — visible to everyone</option>
            </Select>
          </Field>
          <div className="flex items-end pb-2">
            <Checkbox label="Confirmed in writing by the client" checked={f.clientConfirmed} onChange={(e) => set('clientConfirmed', e.target.checked)} />
          </div>
        </div>
        <Field label="Text" htmlFor="a-body" required error={errors.body} hint="Plain text. Start a line with # for a heading, - for a bullet, 1. for a numbered step.">
          <Textarea id="a-body" className="min-h-64 font-mono text-[13px]" value={f.body} onChange={(e) => set('body', e.target.value)} invalid={!!errors.body} />
        </Field>
        {article && (
          <Field label="What changed" htmlFor="a-note" required error={errors.changeNote} hint={`Saved as version ${article.currentVersion + 1}; earlier versions stay available.`}>
            <Input id="a-note" value={f.changeNote} onChange={(e) => set('changeNote', e.target.value)} maxLength={300} invalid={!!errors.changeNote} />
          </Field>
        )}
      </div>
    </Dialog>
  );
}
