/**
 * Knowledge & handover centre (change request F): versioned procedures, component notes,
 * business-rule explanations and validation-error resolutions, plus a monthly checklist.
 * Articles hold no payroll amounts; editors are reminded not to paste salary data.
 */
import { z } from 'zod';
import { AppError, idParam, isoDate, notFound, toIsoDate, type ApiRegistry, type AuthUser } from '@nexzi/server-core';
import { prisma, type Prisma } from '../db';
import { audit } from '../audit';

const CATEGORIES = ['PROCEDURE', 'COMPONENT', 'BUSINESS_RULE', 'VALIDATION_ERROR', 'ONBOARDING'] as const;
const MANAGE = 'knowledge.manage';
const CHECKLIST_WRITERS = ['payroll.input', 'payroll.calculate', 'payroll.approve', 'payroll.finalise'];

/** Exception codes raised by the calculation engine (system behaviour, not client rules). */
export const ENGINE_EXCEPTION_CODES: { code: string; label: string }[] = [
  { code: 'MISSING_INPUT', label: 'A mandatory monthly input is empty' },
  { code: 'INVALID_INPUT', label: 'A monthly input is not a valid value' },
  { code: 'NO_SALARY_VERSION', label: 'No salary structure is effective for the month' },
  { code: 'PERCENTAGE_NOT_CONFIGURED', label: 'A percentage component has no rate or base' },
  { code: 'PERCENTAGE_BASE_MISSING', label: 'The base of a percentage component is missing' },
  { code: 'CIRCULAR_DEPENDENCY', label: 'Components depend on each other in a loop' },
  { code: 'FORMULA_NOT_CONFIGURED', label: 'A formula component has no approved formula' },
  { code: 'FORMULA_ERROR', label: 'An approved formula failed' },
  { code: 'NEGATIVE_NET', label: 'Net pay is negative' },
  { code: 'UNUSUAL_CHANGE', label: 'Net pay changed beyond the warning threshold' },
];

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'article';

const canManage = (u: AuthUser) => u.permissions.has(MANAGE);

type ArticleRow = Prisma.KnowledgeArticleGetPayload<object>;
const today = () => new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
const summary = (a: ArticleRow) => ({
  id: a.id,
  slug: a.slug,
  category: a.category,
  title: a.title,
  excerpt: a.body.replace(/\s+/g, ' ').slice(0, 220),
  componentCode: a.componentCode,
  errorCode: a.errorCode,
  status: a.status,
  clientConfirmed: a.clientConfirmed,
  ownerId: a.ownerId,
  ownerName: a.ownerName,
  reviewDueAt: toIsoDate(a.reviewDueAt),
  reviewOverdue: !!a.reviewDueAt && a.reviewDueAt < today() && !a.archivedAt,
  lastReviewedAt: a.lastReviewedAt,
  lastReviewedBy: a.lastReviewedBy,
  currentVersion: a.currentVersion,
  archived: !!a.archivedAt,
  updatedAt: a.updatedAt,
});

const articleBody = z.object({
  title: z.string().trim().min(3, 'Enter a title.').max(160),
  body: z.string().trim().min(10, 'Write at least a sentence.').max(50_000),
  category: z.enum(CATEGORIES),
  componentCode: z.string().trim().max(40).nullable().optional(),
  errorCode: z.string().trim().max(60).nullable().optional(),
  status: z.enum(['DRAFT', 'PUBLISHED']).default('DRAFT'),
  clientConfirmed: z.boolean().default(false),
  ownerId: z.string().uuid().nullable().optional(),
  reviewDueAt: isoDate.nullable().optional(),
});

async function resolveOwner(ownerId: string | null | undefined) {
  if (!ownerId) return { ownerId: null, ownerName: null };
  const u = await prisma.user.findUnique({ where: { id: ownerId }, select: { id: true, name: true, status: true } });
  if (!u || u.status !== 'ACTIVE') throw new AppError('VALIDATION_ERROR', 'Choose an active user as the owner.', { fields: [{ path: 'ownerId', message: 'Not an active user.' }] });
  return { ownerId: u.id, ownerName: u.name };
}

async function validateLinks(b: { category: string; componentCode?: string | null; errorCode?: string | null }) {
  if (b.componentCode && !(await prisma.salaryComponent.findUnique({ where: { code: b.componentCode } }))) {
    throw new AppError('VALIDATION_ERROR', 'Unknown salary component.', { fields: [{ path: 'componentCode', message: 'No component with this code.' }] });
  }
  if (b.category === 'COMPONENT' && !b.componentCode) throw new AppError('VALIDATION_ERROR', 'Choose the salary component this article documents.', { fields: [{ path: 'componentCode', message: 'Required for component notes.' }] });
  if (b.category === 'VALIDATION_ERROR' && !b.errorCode) throw new AppError('VALIDATION_ERROR', 'Choose the validation error this article resolves.', { fields: [{ path: 'errorCode', message: 'Required for validation-error articles.' }] });
}

export function registerKnowledgeRoutes(r: ApiRegistry) {
  // ------------------------------------------------------------------ Articles
  r.add({
    method: 'get',
    path: '/knowledge/articles',
    tag: 'Knowledge',
    summary: 'Search knowledge articles (published only, unless you can edit the knowledge centre)',
    query: z.object({
      search: z.string().trim().max(100).optional(),
      category: z.enum(CATEGORIES).optional(),
      componentCode: z.string().max(40).optional(),
      errorCode: z.string().max(60).optional(),
      status: z.enum(['DRAFT', 'PUBLISHED']).optional(),
      attention: z.enum(['OVERDUE', 'UNCONFIRMED']).optional(),
      archived: z.enum(['true', 'false']).default('false'),
    }),
    handler: async ({ query, user }) => {
      const manager = canManage(user);
      const where: Prisma.KnowledgeArticleWhereInput = {
        archivedAt: query.archived === 'true' && manager ? { not: null } : null,
        ...(manager ? (query.status ? { status: query.status } : {}) : { status: 'PUBLISHED' }),
        ...(query.category ? { category: query.category } : {}),
        ...(query.componentCode ? { componentCode: query.componentCode } : {}),
        ...(query.errorCode ? { errorCode: query.errorCode } : {}),
        ...(query.attention === 'OVERDUE' ? { reviewDueAt: { lt: today() } } : query.attention === 'UNCONFIRMED' ? { clientConfirmed: false } : {}),
        ...(query.search ? { OR: [{ title: { contains: query.search, mode: 'insensitive' } }, { body: { contains: query.search, mode: 'insensitive' } }, { componentCode: { contains: query.search, mode: 'insensitive' } }, { errorCode: { contains: query.search, mode: 'insensitive' } }] } : {}),
      };
      const rows = await prisma.knowledgeArticle.findMany({ where, orderBy: [{ category: 'asc' }, { title: 'asc' }], take: 500 });
      return { items: rows.map(summary), canManage: manager };
    },
  });

  r.add({
    method: 'get',
    path: '/knowledge/articles/:id',
    tag: 'Knowledge',
    summary: 'One article with its version history',
    params: idParam,
    handler: async ({ params, user }) => {
      const a = await prisma.knowledgeArticle.findUnique({ where: { id: params.id }, include: { versions: { orderBy: { version: 'desc' }, select: { version: true, title: true, changeNote: true, createdAt: true, createdByName: true } } } });
      if (!a || (!canManage(user) && (a.status !== 'PUBLISHED' || a.archivedAt))) throw notFound('Article');
      return { ...summary(a), body: a.body, versions: a.versions, canManage: canManage(user) };
    },
  });

  r.add({
    method: 'get',
    path: '/knowledge/articles/:id/versions/:version',
    tag: 'Knowledge',
    summary: 'The text of an earlier version',
    params: z.object({ id: z.string().uuid(), version: z.coerce.number().int().min(1) }),
    handler: async ({ params, user }) => {
      const a = await prisma.knowledgeArticle.findUnique({ where: { id: params.id } });
      if (!a || (!canManage(user) && (a.status !== 'PUBLISHED' || a.archivedAt))) throw notFound('Article');
      const v = await prisma.knowledgeArticleVersion.findUnique({ where: { articleId_version: { articleId: a.id, version: params.version } } });
      if (!v) throw notFound('Version');
      return { version: v.version, title: v.title, body: v.body, changeNote: v.changeNote, createdAt: v.createdAt, createdByName: v.createdByName };
    },
  });

  r.add({
    method: 'post',
    path: '/knowledge/articles',
    tag: 'Knowledge',
    summary: 'Create an article (version 1)',
    permission: MANAGE,
    status: 201,
    body: articleBody.extend({ changeNote: z.string().trim().max(300).default('First version') }),
    handler: async ({ body, user, ip }) => {
      await validateLinks(body);
      const owner = await resolveOwner(body.ownerId === undefined ? user.id : body.ownerId);
      let slug = slugify(body.title);
      if (await prisma.knowledgeArticle.findUnique({ where: { slug } })) slug = `${slug}-${Date.now().toString(36)}`;
      return prisma.$transaction(async (tx) => {
        const a = await tx.knowledgeArticle.create({
          data: {
            slug,
            title: body.title,
            body: body.body,
            category: body.category,
            componentCode: body.componentCode ?? null,
            errorCode: body.errorCode ?? null,
            status: body.status,
            clientConfirmed: body.clientConfirmed,
            ...owner,
            reviewDueAt: body.reviewDueAt ?? null,
            createdById: user.id,
            updatedById: user.id,
          },
        });
        await tx.knowledgeArticleVersion.create({ data: { articleId: a.id, version: 1, title: a.title, body: a.body, changeNote: body.changeNote, createdById: user.id, createdByName: user.name } });
        await audit.tx(tx, { actorId: user.id, action: 'knowledge.article_created', entity: 'knowledge_article', entityId: a.id, after: { title: a.title, category: a.category, status: a.status }, ip });
        return summary(a);
      });
    },
  });

  r.add({
    method: 'put',
    path: '/knowledge/articles/:id',
    tag: 'Knowledge',
    summary: 'Save a new version of an article (optimistic concurrency on the version number)',
    permission: MANAGE,
    params: idParam,
    body: articleBody.extend({ changeNote: z.string().trim().min(3, 'Describe what changed.').max(300), expectedVersion: z.number().int().min(1) }),
    handler: async ({ params, body, user, ip }) => {
      await validateLinks(body);
      const owner = await resolveOwner(body.ownerId);
      return prisma.$transaction(async (tx) => {
        const before = await tx.knowledgeArticle.findUnique({ where: { id: params.id } });
        if (!before) throw notFound('Article');
        if (before.archivedAt) throw new AppError('INVALID_STATE', 'Restore the article before editing it.');
        const next = before.currentVersion + 1;
        const res = await tx.knowledgeArticle.updateMany({
          where: { id: params.id, currentVersion: body.expectedVersion },
          data: {
            title: body.title,
            body: body.body,
            category: body.category,
            componentCode: body.componentCode ?? null,
            errorCode: body.errorCode ?? null,
            status: body.status,
            clientConfirmed: body.clientConfirmed,
            ...owner,
            reviewDueAt: body.reviewDueAt ?? null,
            currentVersion: next,
            updatedById: user.id,
          },
        });
        if (res.count !== 1) throw new AppError('CONFLICT', 'Someone else saved this article while you were editing. Reload to see their version.', { currentVersion: before.currentVersion });
        await tx.knowledgeArticleVersion.create({ data: { articleId: params.id, version: next, title: body.title, body: body.body, changeNote: body.changeNote, createdById: user.id, createdByName: user.name } });
        const after = await tx.knowledgeArticle.findUniqueOrThrow({ where: { id: params.id } });
        await audit.tx(tx, {
          actorId: user.id,
          action: 'knowledge.article_updated',
          entity: 'knowledge_article',
          entityId: params.id,
          before: { title: before.title, status: before.status, clientConfirmed: before.clientConfirmed, version: before.currentVersion },
          after: { title: after.title, status: after.status, clientConfirmed: after.clientConfirmed, version: next },
          metadata: { changeNote: body.changeNote },
          ip,
        });
        return summary(after);
      });
    },
  });

  r.add({
    method: 'post',
    path: '/knowledge/articles/:id/review',
    tag: 'Knowledge',
    summary: 'Record that the article was reviewed and is still correct; optionally set the next review date',
    permission: MANAGE,
    params: idParam,
    body: z.object({ nextReviewDueAt: isoDate.nullable().optional() }),
    handler: async ({ params, body, user, ip }) => {
      const a = await prisma.knowledgeArticle.findUnique({ where: { id: params.id } });
      if (!a) throw notFound('Article');
      const updated = await prisma.knowledgeArticle.update({
        where: { id: params.id },
        data: { lastReviewedAt: new Date(), lastReviewedBy: user.name, ...(body.nextReviewDueAt !== undefined ? { reviewDueAt: body.nextReviewDueAt } : {}) },
      });
      await audit.write({ actorId: user.id, action: 'knowledge.article_reviewed', entity: 'knowledge_article', entityId: a.id, after: { reviewDueAt: toIsoDate(updated.reviewDueAt) }, ip });
      return summary(updated);
    },
  });

  for (const action of ['archive', 'restore'] as const) {
    r.add({
      method: 'post',
      path: `/knowledge/articles/:id/${action}`,
      tag: 'Knowledge',
      summary: action === 'archive' ? 'Archive an article (kept with its history; hidden from search)' : 'Restore an archived article',
      permission: MANAGE,
      params: idParam,
      handler: async ({ params, user, ip }) => {
        const a = await prisma.knowledgeArticle.findUnique({ where: { id: params.id } });
        if (!a) throw notFound('Article');
        const updated = await prisma.knowledgeArticle.update({ where: { id: a.id }, data: { archivedAt: action === 'archive' ? new Date() : null, updatedById: user.id } });
        await audit.write({ actorId: user.id, action: `knowledge.article_${action}d`, entity: 'knowledge_article', entityId: a.id, ip });
        return summary(updated);
      },
    });
  }

  r.add({
    method: 'get',
    path: '/knowledge/owners',
    tag: 'Knowledge',
    summary: 'Active users who can own documentation',
    permission: MANAGE,
    handler: async () => prisma.user.findMany({ where: { status: 'ACTIVE' }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  });

  r.add({
    method: 'get',
    path: '/knowledge/coverage',
    tag: 'Knowledge',
    summary: 'What is documented: components and validation errors without a published article, unconfirmed rules, overdue reviews',
    handler: async () => {
      const [components, articles] = await Promise.all([
        prisma.salaryComponent.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }], select: { code: true, name: true, type: true, basis: true } }),
        prisma.knowledgeArticle.findMany({ where: { archivedAt: null }, select: { id: true, title: true, status: true, componentCode: true, errorCode: true, clientConfirmed: true, reviewDueAt: true, category: true } }),
      ]);
      const published = articles.filter((a) => a.status === 'PUBLISHED');
      const link = (pred: (a: (typeof articles)[number]) => boolean) => {
        const p = published.find(pred);
        const d = articles.find(pred);
        return p ? { id: p.id, title: p.title, state: p.clientConfirmed ? 'DOCUMENTED' : 'CLIENT_DEPENDENT' } : d ? { id: d.id, title: d.title, state: 'DRAFT' } : { id: null, title: null, state: 'UNDOCUMENTED' };
      };
      const t = today();
      return {
        components: components.map((c) => ({ ...c, ...link((a) => a.componentCode === c.code) })),
        validationErrors: ENGINE_EXCEPTION_CODES.map((e) => ({ ...e, ...link((a) => a.errorCode === e.code) })),
        totals: {
          articles: articles.length,
          published: published.length,
          drafts: articles.length - published.length,
          unconfirmed: articles.filter((a) => !a.clientConfirmed && a.category !== 'ONBOARDING' && a.category !== 'PROCEDURE').length,
          overdueReviews: articles.filter((a) => a.reviewDueAt && a.reviewDueAt < t).length,
        },
      };
    },
  });

  // ------------------------------------------------------------------ Monthly checklist
  r.add({
    method: 'get',
    path: '/knowledge/checklist-items',
    tag: 'Knowledge',
    summary: 'The monthly payroll checklist template',
    handler: async ({ user }) => ({
      items: await prisma.checklistItem.findMany({ where: canManage(user) ? {} : { active: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], include: { article: { select: { id: true, title: true } } } }),
      canManage: canManage(user),
    }),
  });

  const itemBody = z.object({
    label: z.string().trim().min(3).max(160),
    description: z.string().trim().max(1000).nullable().optional(),
    articleId: z.string().uuid().nullable().optional(),
    sortOrder: z.number().int().min(0).max(9999).default(0),
    active: z.boolean().default(true),
  });
  r.add({
    method: 'post',
    path: '/knowledge/checklist-items',
    tag: 'Knowledge',
    summary: 'Add a checklist step',
    permission: MANAGE,
    status: 201,
    body: itemBody,
    handler: async ({ body, user, ip }) => {
      if (body.articleId && !(await prisma.knowledgeArticle.findUnique({ where: { id: body.articleId } }))) throw notFound('Article');
      const item = await prisma.checklistItem.create({ data: { ...body, description: body.description ?? null, articleId: body.articleId ?? null } });
      await audit.write({ actorId: user.id, action: 'checklist.item_created', entity: 'checklist_item', entityId: item.id, after: { label: item.label }, ip });
      return item;
    },
  });
  r.add({
    method: 'put',
    path: '/knowledge/checklist-items/:id',
    tag: 'Knowledge',
    summary: 'Edit, reorder or deactivate a checklist step',
    permission: MANAGE,
    params: idParam,
    body: itemBody.partial(),
    handler: async ({ params, body, user, ip }) => {
      const before = await prisma.checklistItem.findUnique({ where: { id: params.id } });
      if (!before) throw notFound('Checklist step');
      if (body.articleId && !(await prisma.knowledgeArticle.findUnique({ where: { id: body.articleId } }))) throw notFound('Article');
      const item = await prisma.checklistItem.update({ where: { id: params.id }, data: body });
      await audit.write({ actorId: user.id, action: 'checklist.item_updated', entity: 'checklist_item', entityId: item.id, before: { label: before.label, active: before.active }, after: { label: item.label, active: item.active }, ip });
      return item;
    },
  });

  r.add({
    method: 'get',
    path: '/payroll-runs/:id/checklist',
    tag: 'Knowledge',
    summary: 'Checklist progress for a payroll run',
    permission: 'payroll.view',
    params: idParam,
    handler: async ({ params, user }) => {
      const run = await prisma.payrollRun.findUnique({ where: { id: params.id } });
      if (!run) throw notFound('Payroll run');
      const [items, entries] = await Promise.all([
        prisma.checklistItem.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], include: { article: { select: { id: true, title: true, status: true } } } }),
        prisma.payrollRunChecklist.findMany({ where: { payrollRunId: run.id } }),
      ]);
      const by = new Map(entries.map((e) => [e.itemId, e]));
      const rows = items.map((i) => {
        const e = by.get(i.id);
        return {
          itemId: i.id,
          label: i.label,
          description: i.description,
          article: i.article && (i.article.status === 'PUBLISHED' || canManage(user)) ? { id: i.article.id, title: i.article.title } : null,
          done: e?.done ?? false,
          note: e?.note ?? null,
          doneByName: e?.doneByName ?? null,
          doneAt: e?.doneAt ?? null,
        };
      });
      return { items: rows, done: rows.filter((x) => x.done).length, total: rows.length, canUpdate: CHECKLIST_WRITERS.some((p) => user.permissions.has(p)) };
    },
  });

  r.add({
    method: 'put',
    path: '/payroll-runs/:id/checklist/:itemId',
    tag: 'Knowledge',
    summary: 'Tick or untick a checklist step for a run (process tracking only; never changes payroll)',
    permission: CHECKLIST_WRITERS,
    params: z.object({ id: z.string().uuid(), itemId: z.string().uuid() }),
    body: z.object({ done: z.boolean(), note: z.string().trim().max(500).nullable().optional() }),
    handler: async ({ params, body, user, ip }) => {
      const [run, item] = await Promise.all([prisma.payrollRun.findUnique({ where: { id: params.id } }), prisma.checklistItem.findUnique({ where: { id: params.itemId } })]);
      if (!run) throw notFound('Payroll run');
      if (!item || !item.active) throw notFound('Checklist step');
      const data = { done: body.done, note: body.note ?? null, doneById: body.done ? user.id : null, doneByName: body.done ? user.name : null, doneAt: body.done ? new Date() : null };
      const saved = await prisma.payrollRunChecklist.upsert({ where: { payrollRunId_itemId: { payrollRunId: run.id, itemId: item.id } }, create: { payrollRunId: run.id, itemId: item.id, ...data }, update: data });
      await audit.write({ actorId: user.id, action: body.done ? 'checklist.step_done' : 'checklist.step_undone', entity: 'payroll_run', entityId: run.id, metadata: { step: item.label }, ip });
      return saved;
    },
  });
}

/**
 * Default checklist, created once when none exists. It lists the steps of this application's
 * workflow (system facts); client-specific steps are added by the payroll owner.
 */
export async function ensureDefaultChecklist() {
  if ((await prisma.checklistItem.count()) > 0) return;
  const steps: [string, string][] = [
    ['Check new joiners, exits and salary changes for the month', 'Employees and salary versions effective in the month are up to date before the run starts.'],
    ['Enter all monthly inputs', 'Every input column the client fills in manually today has been entered for each employee.'],
    ['Calculate and clear blocking exceptions', 'No employee shows a red (blocking) exception after calculation.'],
    ['Review payroll alerts', 'Every open alert has been reviewed and explained.'],
    ['Reconcile with the previous month', 'Differences against the previous finalised month are explained as expected or resolved.'],
    ['Submit for review', 'The run has been submitted, with warnings acknowledged.'],
    ['Approve and finalise', 'An authorised approver has approved and finalised the run.'],
    ['Generate payslips and reports', 'Payslips and the monthly reports have been generated and checked.'],
  ];
  await prisma.checklistItem.createMany({ data: steps.map(([label, description], i) => ({ label, description, sortOrder: (i + 1) * 10 })) });
}
