/**
 * Change requests A (anomaly alerts), B (reconciliation) and F (knowledge & handover centre),
 * end to end against the test database with real payroll runs.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Agent } from 'supertest';
import { prisma } from '../../src/db';
import { createUser } from '../../src/bootstrap';
import { ensureDefaultChecklist } from '../../src/knowledge/routes';
import { login, ORIGIN, PASSWORD, resetDb, seedMasters } from '../helpers';

let admin: Agent;
let user: Agent;
let restricted: Agent;
let m: Awaited<ReturnType<typeof seedMasters>>;
const emp: Record<string, string> = {};
const runs: Record<number, string> = {};

const post = (a: Agent, path: string, body?: object) => a.post(path).set('Origin', ORIGIN).send(body ?? {});
const put = (a: Agent, path: string, body: object) => a.put(path).set('Origin', ORIGIN).send(body);

async function setBonus(runId: string, amount: string) {
  const res = await put(user, `/payroll-runs/${runId}/inputs`, { entries: [{ employeeId: emp.e1, inputKey: 'BONUS_INPUT', value: amount }] });
  expect(res.body.saved).toBe(1);
}

async function runMonth(month: number, bonus: string, finalise: boolean) {
  const res = await post(user, '/payroll-runs', { year: 2026, month });
  expect(res.status).toBe(201);
  runs[month] = res.body.id;
  await setBonus(res.body.id, bonus);
  const calc = await post(user, `/payroll-runs/${res.body.id}/calculate`);
  expect(calc.status).toBe(200);
  if (finalise) {
    expect((await post(user, `/payroll-runs/${res.body.id}/submit-review`, { acknowledgeWarnings: true })).status).toBe(200);
    expect((await post(admin, `/payroll-runs/${res.body.id}/approve`)).status).toBe(200);
    expect((await post(admin, `/payroll-runs/${res.body.id}/finalise`)).status).toBe(200);
  }
  return calc.body;
}

const alerts = async (runId: string, status = 'ALL') => (await admin.get(`/payroll-runs/${runId}/anomalies?status=${status}`)).body.items as { id: string; rule: string; employeeId: string; status: string; severity: string; message: string; componentCode: string | null }[];

beforeAll(async () => {
  await resetDb();
  m = await seedMasters();
  // A role with view access but no amounts and no review rights.
  const role = await prisma.role.create({ data: { code: 'RESTRICTED', name: 'Restricted', enabled: true, permissions: { create: [{ permissionCode: 'payroll.view' }, { permissionCode: 'reports.view' }] } } });
  await createUser('restricted@test.local', 'Restricted User', role.code, PASSWORD, false);
  admin = await login('admin@test.local');
  user = await login('user@test.local');
  restricted = await login('restricted@test.local');

  const mk = async (key: string, code: string, name: string, joiningDate: string, dept = true) => {
    const res = await post(admin, '/employees', { employeeCode: code, fullName: name, joiningDate, ...(dept ? { departmentId: m.dept.id } : {}) });
    expect(res.status).toBe(201);
    emp[key] = res.body.id;
  };
  await mk('e1', 'EMP-1', 'Asha Rao', '2026-01-01');
  await mk('e2', 'EMP-2', 'Ravi Kumar', '2026-01-01', false);
  await mk('e3', 'EMP-3', 'ravi kumar', '2026-01-01', false);
  const salary = (id: string, values: { componentId: string; value: string }[]) => post(admin, `/employees/${id}/salary`, { effectiveFrom: '2026-01-01', changeReason: 'Initial', values });
  await salary(emp.e1, [
    { componentId: m.basic.id, value: '20000' },
    { componentId: m.pct.id, value: '10' },
    { componentId: m.ded.id, value: '500' },
  ]);
  await salary(emp.e2, [{ componentId: m.basic.id, value: '15000' }]);
  await salary(emp.e3, [{ componentId: m.basic.id, value: '15000' }]);

  for (const month of [5, 6, 7]) await runMonth(month, '1000', true);
  // August: EMP-3 has left, a new joiner starts, EMP-1 receives an unusually large bonus.
  expect((await post(admin, `/employees/${emp.e3}/deactivate`, { status: 'EXITED', exitDate: '2026-07-31', reason: 'Resigned' })).status).toBe(200);
  await mk('e4', 'EMP-4', 'New Joiner', '2026-08-01');
  await post(admin, `/employees/${emp.e4}/salary`, { effectiveFrom: '2026-08-01', changeReason: 'Joining', values: [{ componentId: m.basic.id, value: '12000' }] });
  await runMonth(8, '9000', false);
});

describe('A. explainable anomaly alerts', () => {
  it('detects alerts automatically after calculation, with plain-language reasons', async () => {
    const items = await alerts(runs[8], 'OPEN');
    const outlier = items.find((a) => a.rule === 'ADJUSTMENT_OUTLIER' && a.employeeId === emp.e1)!;
    expect(outlier.severity).toBe('HIGH'); // 9000 > 2 × (2 × 1000)
    expect(outlier.message).toContain('Bonus is 9,000.00');
    expect(outlier.message).toContain('at most 1,000.00');
    expect(outlier.message).toContain('May 2026 – July 2026');
    const net = items.find((a) => a.rule === 'NET_CHANGE' && a.employeeId === emp.e1)!;
    expect(net.message).toContain('22,500.00 in July 2026 to 30,500.00 (+35.6%)');
    // The new joiner has no history, so nothing is flagged for them.
    expect(items.some((a) => a.employeeId === emp.e4)).toBe(false);
  });

  it('flags possible duplicate employees and repeated adjustments in earlier months', async () => {
    const july = await alerts(runs[7]);
    expect(july.filter((a) => a.rule === 'DUPLICATE_EMPLOYEE').map((a) => a.employeeId).sort()).toEqual([emp.e2, emp.e3].sort());
    expect(july.find((a) => a.rule === 'REPEATED_ADJUSTMENT')).toMatchObject({ employeeId: emp.e1, componentCode: 'BONUS' });
  });

  it('re-scans idempotently, including concurrent scans, and never touches finalised results', async () => {
    const linesBefore = await prisma.payrollLine.findMany({ where: { payrollRunId: runs[7] }, orderBy: { id: 'asc' } });
    const countBefore = await prisma.payrollAnomaly.count({ where: { payrollRunId: runs[7] } });
    const scans = await Promise.all([1, 2, 3].map(() => post(user, `/payroll-runs/${runs[7]}/anomalies/scan`)));
    expect(scans.map((s) => s.status)).toEqual([200, 200, 200]);
    expect(scans.every((s) => s.body.opened === 0)).toBe(true);
    expect(await prisma.payrollAnomaly.count({ where: { payrollRunId: runs[7] } })).toBe(countBefore);
    const linesAfter = await prisma.payrollLine.findMany({ where: { payrollRunId: runs[7] }, orderBy: { id: 'asc' } });
    expect(linesAfter.map((l) => l.amount.toString())).toEqual(linesBefore.map((l) => l.amount.toString()));
    expect((await admin.get(`/payroll-runs/${runs[7]}`)).body.status).toBe('FINALISED');
  });

  it('records reviews with outcome and comment, once, with an append-only trail', async () => {
    const outlier = (await alerts(runs[8], 'OPEN')).find((a) => a.rule === 'ADJUSTMENT_OUTLIER')!;
    expect((await post(user, `/anomalies/${outlier.id}/review`, { outcome: 'EXPECTED', comment: 'no' })).status).toBe(400);
    const [a, b] = await Promise.all([
      post(user, `/anomalies/${outlier.id}/review`, { outcome: 'EXPECTED', comment: 'Festival bonus approved by management' }),
      post(user, `/anomalies/${outlier.id}/review`, { outcome: 'EXPECTED', comment: 'Festival bonus approved by management' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const detail = await admin.get(`/anomalies/${outlier.id}`);
    expect(detail.body).toMatchObject({ status: 'REVIEWED', reviewOutcome: 'EXPECTED', reviewedByName: 'Test Payroll User' });
    expect(detail.body.events.map((e: { action: string }) => e.action)).toEqual(['DETECTED', 'REVIEWED']);
    expect(await prisma.auditLog.count({ where: { action: 'payroll.anomaly_reviewed', entityId: outlier.id } })).toBe(1);
    await expect(prisma.payrollAnomalyEvent.deleteMany({ where: { anomalyId: outlier.id } })).rejects.toThrow(/append-only/);
  });

  it('re-opens a reviewed alert when its figures change, and clears alerts that disappear', async () => {
    await setBonus(runs[8], '9500');
    const calc = await post(user, `/payroll-runs/${runs[8]}/calculate`);
    expect(calc.body.alerts.reopened).toBeGreaterThanOrEqual(1);
    const outlier = (await alerts(runs[8])).find((a) => a.rule === 'ADJUSTMENT_OUTLIER')!;
    expect(outlier.status).toBe('OPEN');
    const events = (await admin.get(`/anomalies/${outlier.id}`)).body.events.map((e: { action: string }) => e.action);
    expect(events).toEqual(['DETECTED', 'REVIEWED', 'REOPENED']);

    await setBonus(runs[8], '1000');
    const recalc = await post(user, `/payroll-runs/${runs[8]}/calculate`);
    expect(recalc.body.alerts.cleared).toBeGreaterThanOrEqual(1);
    expect((await alerts(runs[8])).find((a) => a.rule === 'ADJUSTMENT_OUTLIER')!.status).toBe('CLEARED');
    // History page still lists it.
    const history = await admin.get(`/anomalies?status=CLEARED&runId=${runs[8]}`);
    expect(history.body.items.some((a: { id: string }) => a.id === outlier.id)).toBe(true);
  });

  it('enforces permissions on the server', async () => {
    expect((await restricted.get(`/payroll-runs/${runs[8]}/anomalies`)).status).toBe(403);
    expect((await restricted.get('/anomalies')).status).toBe(403);
    const any = (await alerts(runs[8], 'OPEN'))[0];
    expect((await post(restricted, `/anomalies/${any.id}/review`, { outcome: 'EXPECTED', comment: 'Trying without rights' })).status).toBe(403);
    expect((await post(restricted, `/payroll-runs/${runs[8]}/anomalies/scan`)).status).toBe(403);
  });

  it('uses the configurable thresholds from payroll settings', async () => {
    const settings = (await admin.get('/settings')).body;
    expect(settings.anomalyRules).toMatchObject({ enabled: true, netChangePercent: 20 });
    expect((await put(admin, '/settings', { anomalyRules: { ...settings.anomalyRules, enabled: false } })).status).toBe(200);
    const scan = await post(user, `/payroll-runs/${runs[8]}/anomalies/scan`);
    expect(scan.body.enabled).toBe(false);
    expect((await put(admin, '/settings', { anomalyRules: { ...settings.anomalyRules, netChangePercent: 0 } })).status).toBe(400);
    await put(admin, '/settings', { anomalyRules: settings.anomalyRules });
  });
});

describe('B. reconciliation and variance analysis', () => {
  const q = (extra = '') => `/reconciliation?baseRunId=${runs[7]}&compareRunId=${runs[8]}${extra}`;

  beforeAll(async () => {
    await setBonus(runs[8], '4000');
    expect((await post(user, `/payroll-runs/${runs[8]}/calculate`)).status).toBe(200);
  });

  it('compares two months employee-wise and component-wise', async () => {
    const res = await admin.get(q('&change=ALL'));
    expect(res.status).toBe(200);
    expect(res.body.base.period).toBe('July 2026');
    expect(res.body.compare.period).toBe('August 2026');
    const by = Object.fromEntries(res.body.employees.map((e: { employeeId: string; change: string }) => [e.employeeId, e.change]));
    expect(by).toEqual({ [emp.e1]: 'CHANGED', [emp.e2]: 'UNCHANGED', [emp.e3]: 'MISSING', [emp.e4]: 'NEW' });
    const e1 = res.body.employees.find((e: { employeeId: string }) => e.employeeId === emp.e1);
    expect(e1.difference.net).toBe('3000.00');
    expect(e1.components.find((c: { code: string }) => c.code === 'BONUS')).toMatchObject({ base: '1000.00', compare: '4000.00', difference: '3000.00', changePercent: '300.00' });
    expect(res.body.totals.difference.net).toBe('0.00'); // +3000 (EMP-1) − 15000 (EMP-3 left) + 12000 (EMP-4 joined)
    expect(res.body.summary).toMatchObject({ unresolved: 3, expected: 0 });
  });

  it('filters by change type, department, employee and component', async () => {
    expect((await admin.get(q('&change=NEW'))).body.employees.map((e: { employeeId: string }) => e.employeeId)).toEqual([emp.e4]);
    expect((await admin.get(q('&department=Test%20Dept'))).body.employees.map((e: { employeeId: string }) => e.employeeId).sort()).toEqual([emp.e1, emp.e4].sort());
    expect((await admin.get(q('&component=BONUS'))).body.employees.map((e: { employeeId: string }) => e.employeeId)).toEqual([emp.e1]);
    expect((await admin.get(q('&search=emp-3'))).body.employees.map((e: { employeeId: string }) => e.employeeId)).toEqual([emp.e3]);
    // Default view hides unchanged employees.
    expect((await admin.get(q())).body.employees.some((e: { employeeId: string }) => e.employeeId === emp.e2)).toBe(false);
  });

  it('records explanations that separate expected changes from unresolved discrepancies', async () => {
    const note = (employeeId: string, classification: string, text: string, componentCode = '') =>
      put(user, '/reconciliation/notes', { baseRunId: runs[7], compareRunId: runs[8], employeeId, componentCode, classification, note: text });
    expect((await note(emp.e1, 'EXPECTED', 'Festival bonus for August')).status).toBe(200);
    expect((await note(emp.e3, 'DISCREPANCY', 'Final settlement not yet processed')).status).toBe(200);
    expect((await note(emp.e1, 'EXPECTED', 'Bonus line explained', 'BONUS')).status).toBe(200);
    let res = await admin.get(q('&change=ALL'));
    expect(res.body.summary).toMatchObject({ expected: 1, unresolved: 2, discrepancies: 1, unexplained: 1 });
    expect(res.body.employees.find((e: { employeeId: string }) => e.employeeId === emp.e1).components.find((c: { code: string }) => c.code === 'BONUS').note.note).toBe('Bonus line explained');
    const unresolved = (await admin.get(q('&explanation=UNRESOLVED'))).body.employees.map((e: { employeeId: string }) => e.employeeId).sort();
    expect(unresolved).toEqual([emp.e3, emp.e4].sort());

    expect((await note(emp.e3, 'RESOLVED', 'Settlement processed in September')).status).toBe(200);
    res = await admin.get(q('&change=ALL'));
    expect(res.body.summary).toMatchObject({ resolved: 1, unresolved: 1 });
    const audits = await prisma.auditLog.findMany({ where: { action: 'reconciliation.note_updated' } });
    expect(audits.some((a) => (a.before as { classification?: string })?.classification === 'DISCREPANCY')).toBe(true);
  });

  it('validates input on the server', async () => {
    expect((await admin.get(`/reconciliation?baseRunId=${runs[7]}&compareRunId=${runs[7]}`)).status).toBe(400);
    expect((await put(user, '/reconciliation/notes', { baseRunId: runs[7], compareRunId: runs[8], employeeId: emp.e1, componentCode: 'NOPE', classification: 'EXPECTED', note: 'Unknown component here' })).status).toBe(400);
    expect((await put(user, '/reconciliation/notes', { baseRunId: runs[7], compareRunId: runs[8], employeeId: emp.e1, classification: 'EXPECTED', note: 'x' })).status).toBe(400);
    const draft = await post(user, '/payroll-runs', { year: 2026, month: 9 });
    expect((await admin.get(`/reconciliation?baseRunId=${runs[8]}&compareRunId=${draft.body.id}`)).status).toBe(409);
  });

  it('downloads the reconciliation report', async () => {
    const res = await admin.get(q('&format=xlsx').replace('/reconciliation?', '/reconciliation/export?')).buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toContain('reconciliation-august-2026-vs-july-2026.xlsx');
  });

  it('enforces permissions on the server', async () => {
    expect((await restricted.get(q())).status).toBe(403);
    expect((await put(restricted, '/reconciliation/notes', { baseRunId: runs[7], compareRunId: runs[8], employeeId: emp.e1, classification: 'EXPECTED', note: 'Not allowed to do this' })).status).toBe(403);
  });
});

describe('F. knowledge and handover centre', () => {
  let articleId: string;

  it('lets only knowledge managers create articles, with validated links', async () => {
    const body = { title: 'Basic salary', body: 'Basic is the fixed monthly amount from the salary structure.', category: 'COMPONENT', componentCode: 'BASIC', status: 'PUBLISHED' };
    expect((await post(user, '/knowledge/articles', body)).status).toBe(403);
    expect((await post(admin, '/knowledge/articles', { ...body, componentCode: 'NOPE' })).status).toBe(400);
    expect((await post(admin, '/knowledge/articles', { ...body, componentCode: null })).status).toBe(400);
    const res = await post(admin, '/knowledge/articles', body);
    expect(res.status).toBe(201);
    articleId = res.body.id;
    expect(res.body).toMatchObject({ slug: 'basic-salary', currentVersion: 1, ownerName: 'Test Admin', clientConfirmed: false });
  });

  it('versions every save and rejects stale edits', async () => {
    const edit = (expectedVersion: number, text: string) =>
      put(admin, `/knowledge/articles/${articleId}`, { title: 'Basic salary', body: text, category: 'COMPONENT', componentCode: 'BASIC', status: 'PUBLISHED', changeNote: 'Clarified', expectedVersion });
    expect((await edit(1, 'Basic is the fixed monthly amount; it is the base for percentage components.')).status).toBe(200);
    expect((await edit(1, 'A stale edit from another tab.')).status).toBe(409);
    const detail = await user.get(`/knowledge/articles/${articleId}`);
    expect(detail.body.currentVersion).toBe(2);
    expect(detail.body.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    const v1 = await user.get(`/knowledge/articles/${articleId}/versions/1`);
    expect(v1.body.body).toBe('Basic is the fixed monthly amount from the salary structure.');
    await expect(prisma.knowledgeArticleVersion.updateMany({ where: { articleId }, data: { body: 'tampered' } })).rejects.toThrow(/append-only/);
  });

  it('shows drafts only to managers and searches published text', async () => {
    const draft = await post(admin, '/knowledge/articles', { title: 'Month-end procedure', body: 'Draft steps for closing the payroll month.', category: 'PROCEDURE', status: 'DRAFT' });
    expect((await user.get(`/knowledge/articles/${draft.body.id}`)).status).toBe(404);
    expect((await user.get('/knowledge/articles')).body.items.map((a: { id: string }) => a.id)).toEqual([articleId]);
    expect((await admin.get('/knowledge/articles')).body.items).toHaveLength(2);
    expect((await user.get('/knowledge/articles?search=percentage')).body.items.map((a: { id: string }) => a.id)).toEqual([articleId]);
  });

  it('reports undocumented and client-dependent items instead of guessing', async () => {
    const cov = (await user.get('/knowledge/coverage')).body;
    expect(cov.components.find((c: { code: string }) => c.code === 'BASIC').state).toBe('CLIENT_DEPENDENT');
    expect(cov.components.find((c: { code: string }) => c.code === 'PCT').state).toBe('UNDOCUMENTED');
    expect(cov.validationErrors.find((e: { code: string }) => e.code === 'MISSING_INPUT').state).toBe('UNDOCUMENTED');
  });

  it('tracks the monthly checklist per run', async () => {
    await ensureDefaultChecklist();
    await ensureDefaultChecklist(); // idempotent
    const list = await user.get(`/payroll-runs/${runs[8]}/checklist`);
    expect(list.body.total).toBe(8);
    const step = list.body.items[0].itemId;
    expect((await put(user, `/payroll-runs/${runs[8]}/checklist/${step}`, { done: true, note: 'Checked with HR' })).status).toBe(200);
    expect((await put(restricted, `/payroll-runs/${runs[8]}/checklist/${step}`, { done: false })).status).toBe(403);
    const after = await admin.get(`/payroll-runs/${runs[8]}/checklist`);
    expect(after.body.done).toBe(1);
    expect(after.body.items[0]).toMatchObject({ done: true, note: 'Checked with HR', doneByName: 'Test Payroll User' });
  });
});
