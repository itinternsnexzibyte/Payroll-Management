import { z } from 'zod';
import { createLogger, idParam, listQuery, notFound, skipTake, toIsoDate, toPage, type ApiRegistry, type AuthUser } from '@nexzi/server-core';
import { prisma, Prisma } from '../db';
import { config } from '../config';
import { getSettings } from '../settings';
import { isEligible, selectSalaryVersion } from './engine';
import * as svc from './service';
import { scanRun } from '../anomalies/service';
import { notifyRun } from '../notify';

const alertLog = createLogger('payroll-api-alerts', process.env.LOG_LEVEL);

export const canSeeAmounts = (u: AuthUser) => u.permissions.has('payroll.view_amounts');
const amt = (u: AuthUser, v: Prisma.Decimal | null | undefined) => (canSeeAmounts(u) && v !== null && v !== undefined ? v.toString() : null);

const runIdParam = idParam;
const currentYear = new Date().getUTCFullYear();

export function serializeRunSummary(u: AuthUser, r: Prisma.PayrollRunGetPayload<object>) {
  return {
    id: r.id,
    year: r.year,
    month: r.month,
    period: svc.periodLabel(r.year, r.month),
    status: r.status,
    employeeCount: r.employeeCount,
    totalEarnings: amt(u, r.totalEarnings),
    totalDeductions: amt(u, r.totalDeductions),
    totalNet: amt(u, r.totalNet),
    rulesApproved: r.rulesApproved,
    calculatedAt: r.calculatedAt,
    submittedAt: r.submittedAt,
    approvedAt: r.approvedAt,
    finalisedAt: r.finalisedAt,
    reopenCount: r.reopenCount,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export function registerPayrollRoutes(r: ApiRegistry) {
  r.add({
    method: 'get',
    path: '/payroll-runs',
    tag: 'Payroll Runs',
    summary: 'List payroll runs (history)',
    permission: 'payroll.view',
    query: listQuery(['period', 'createdAt', 'status'], 'period', {
      year: z.coerce.number().int().min(2000).max(2100).optional(),
      status: z.enum(['DRAFT', 'CALCULATED', 'UNDER_REVIEW', 'APPROVED', 'FINALISED']).optional(),
    }),
    handler: async ({ query, user }) => {
      const where: Prisma.PayrollRunWhereInput = { ...(query.year ? { year: query.year } : {}), ...(query.status ? { status: query.status } : {}) };
      const orderBy: Prisma.PayrollRunOrderByWithRelationInput[] =
        query.sortBy === 'period' ? [{ year: query.sortDir }, { month: query.sortDir }] : [{ [query.sortBy]: query.sortDir }];
      const [items, total] = await Promise.all([prisma.payrollRun.findMany({ where, orderBy, ...skipTake(query.page, query.pageSize) }), prisma.payrollRun.count({ where })]);
      return toPage(items.map((i) => serializeRunSummary(user, i)), total, query.page, query.pageSize);
    },
  });

  r.add({
    method: 'get',
    path: '/payroll-runs/eligible-employees',
    tag: 'Payroll Runs',
    summary: 'Employees eligible for a payroll month (for selection when starting a run)',
    permission: 'payroll.input',
    query: z.object({ year: z.coerce.number().int().min(2000).max(2100), month: z.coerce.number().int().min(1).max(12) }),
    handler: async ({ query }) => {
      const settings = await getSettings();
      const emps = await prisma.employee.findMany({ include: { department: true, salaryVersions: true }, orderBy: { employeeCode: 'asc' } });
      return emps
        .filter((e) => isEligible(e, query.year, query.month))
        .map((e) => ({
          id: e.id,
          employeeCode: e.employeeCode,
          fullName: e.fullName,
          department: e.department?.name ?? null,
          status: e.status,
          hasSalaryStructure: Boolean(selectSalaryVersion(e.salaryVersions, query.year, query.month, settings.salaryVersionRule)),
        }));
    },
  });

  r.add({
    method: 'post',
    path: '/payroll-runs',
    tag: 'Payroll Runs',
    summary: 'Start a payroll run for a month (status Draft). One run per month.',
    permission: 'payroll.input',
    status: 201,
    body: z.object({
      year: z.number().int().min(2000).max(currentYear + 1),
      month: z.number().int().min(1).max(12),
      employeeIds: z.array(z.string().uuid()).min(1).max(2000).optional(),
    }),
    handler: async ({ body, user, ip }) => serializeRunSummary(user, await svc.createRun(user, body.year, body.month, body.employeeIds, ip)),
  });

  r.add({
    method: 'get',
    path: '/payroll-runs/:id',
    tag: 'Payroll Runs',
    summary: 'Payroll run details: employees, results, exceptions, events and allowed actions',
    permission: 'payroll.view',
    params: runIdParam,
    handler: async ({ params, user }) => {
      const run = await prisma.payrollRun.findUnique({ where: { id: params.id }, include: { events: { orderBy: { occurredAt: 'asc' } } } });
      if (!run) throw notFound('Payroll run');
      const settings = await getSettings();
      const members = await prisma.payrollRunEmployee.findMany({ where: { payrollRunId: run.id }, orderBy: { employeeCode: 'asc' } });
      const showAmounts = canSeeAmounts(user);
      const lines = showAmounts ? await prisma.payrollLine.findMany({ where: { payrollRunId: run.id }, orderBy: [{ sortOrder: 'asc' }, { componentCode: 'asc' }] }) : [];
      const columns = [...new Map(lines.map((l) => [l.componentCode, { code: l.componentCode, name: l.componentName, type: l.componentType, sortOrder: l.sortOrder }])).values()].sort(
        (a, b) => (a.type === b.type ? a.sortOrder - b.sortOrder : a.type === 'EARNING' ? -1 : 1),
      );
      const counts = { OK: 0, WARNING: 0, ERROR: 0, PENDING: 0 } as Record<string, number>;
      for (const m of members) counts[m.resultStatus] = (counts[m.resultStatus] ?? 0) + 1;
      return {
        ...serializeRunSummary(user, run),
        canSeeAmounts: showAmounts,
        allowedActions: svc.allowedActions(user, run.status, settings),
        requireApprovalStep: settings.requireApprovalStep,
        rulesApprovedNow: config.PAYROLL_RULES_APPROVED,
        resultCounts: counts,
        componentColumns: columns,
        employees: members.map((m) => ({
          employeeId: m.employeeId,
          employeeCode: m.employeeCode,
          employeeName: m.employeeName,
          department: m.departmentName,
          designation: m.designationName,
          hasSalaryVersion: Boolean(m.salaryVersionId),
          resultStatus: m.resultStatus,
          exceptions: m.exceptions,
          gross: amt(user, m.gross),
          deductions: amt(user, m.deductions),
          net: amt(user, m.net),
          lines: showAmounts ? Object.fromEntries(lines.filter((l) => l.employeeId === m.employeeId).map((l) => [l.componentCode, l.amount.toString()])) : {},
        })),
        events: run.events.map((e) => ({ action: e.action, fromStatus: e.fromStatus, toStatus: e.toStatus, reason: e.reason, actorName: e.actorName, occurredAt: e.occurredAt })),
      };
    },
  });

  r.add({
    method: 'put',
    path: '/payroll-runs/:id/employees',
    tag: 'Payroll Runs',
    summary: 'Add or remove employees from a draft/calculated run',
    permission: 'payroll.input',
    params: runIdParam,
    body: z.object({ add: z.array(z.string().uuid()).max(2000).default([]), remove: z.array(z.string().uuid()).max(2000).default([]) }),
    handler: async ({ params, body, user, ip }) => svc.updateRunEmployees(user, params.id, body.add, body.remove, ip),
  });

  r.add({
    method: 'get',
    path: '/payroll-runs/:id/inputs',
    tag: 'Payroll Runs',
    summary: 'Monthly input grid (columns = active input definitions)',
    permission: 'payroll.view',
    params: runIdParam,
    handler: async ({ params }) => {
      const run = await prisma.payrollRun.findUnique({ where: { id: params.id } });
      if (!run) throw notFound('Payroll run');
      const [defs, members, inputs] = await Promise.all([
        svc.loadInputDefs(),
        prisma.payrollRunEmployee.findMany({ where: { payrollRunId: run.id }, orderBy: { employeeCode: 'asc' } }),
        prisma.payrollInput.findMany({ where: { payrollRunId: run.id } }),
      ]);
      return {
        status: run.status,
        columns: defs,
        rows: members.map((m) => ({
          employeeId: m.employeeId,
          employeeCode: m.employeeCode,
          employeeName: m.employeeName,
          department: m.departmentName,
          values: Object.fromEntries(inputs.filter((i) => i.employeeId === m.employeeId).map((i) => [i.inputKey, i.value])),
        })),
      };
    },
  });

  r.add({
    method: 'put',
    path: '/payroll-runs/:id/inputs',
    tag: 'Payroll Runs',
    summary: 'Save monthly input cells (valid cells are saved even if others fail; errors are returned per cell)',
    permission: 'payroll.input',
    params: runIdParam,
    body: z.object({ entries: z.array(z.object({ employeeId: z.string().uuid(), inputKey: z.string().max(40), value: z.string().max(500) })).max(20000) }),
    handler: async ({ params, body, user, ip }) => svc.saveInputs(user, params.id, body.entries, ip),
  });

  r.add({
    method: 'post',
    path: '/payroll-runs/:id/calculate',
    tag: 'Payroll Runs',
    summary: 'Calculate payroll on the server (deterministic; safe to repeat)',
    permission: 'payroll.calculate',
    params: runIdParam,
    handler: async ({ params, user, ip }) => {
      const result = await svc.calculate(user, params.id, ip);
      // Anomaly alerts run after the calculation has committed; a failure here is logged and
      // never blocks or alters payroll (the scan can be repeated from the run screen).
      const alerts = await scanRun(params.id, user, ip).catch((err: Error) => {
        alertLog.error({ runId: params.id, err: err.message }, 'Anomaly scan after calculation failed');
        return null;
      });
      return { ...result, alerts };
    },
  });

  r.add({
    method: 'post',
    path: '/payroll-runs/:id/submit-review',
    tag: 'Payroll Runs',
    summary: 'Submit calculated payroll for review',
    permission: 'payroll.calculate',
    params: runIdParam,
    body: z.object({ acknowledgeWarnings: z.boolean().default(false) }),
    handler: async ({ params, body, user, ip }) => {
      const result = await svc.submitForReview(user, params.id, body.acknowledgeWarnings, ip);
      void notifyRun(params.id, 'SUBMITTED');
      return result;
    },
  });

  r.add({
    method: 'post',
    path: '/payroll-runs/:id/return',
    tag: 'Payroll Runs',
    summary: 'Return a run under review / approved back to Calculated (reason required)',
    permission: ['payroll.approve', 'payroll.finalise', 'payroll.calculate'],
    params: runIdParam,
    body: z.object({ reason: z.string().trim().min(5, 'Enter a reason (at least 5 characters).').max(500) }),
    handler: async ({ params, body, user, ip }) => svc.returnRun(user, params.id, body.reason, ip),
  });

  r.add({
    method: 'post',
    path: '/payroll-runs/:id/approve',
    tag: 'Payroll Runs',
    summary: 'Approve a payroll run under review',
    permission: 'payroll.approve',
    params: runIdParam,
    handler: async ({ params, user, ip }) => {
      const result = await svc.approve(user, params.id, ip);
      void notifyRun(params.id, 'APPROVED');
      return result;
    },
  });

  r.add({
    method: 'post',
    path: '/payroll-runs/:id/finalise',
    tag: 'Payroll Runs',
    summary: 'Finalise payroll — results become an immutable snapshot',
    permission: 'payroll.finalise',
    params: runIdParam,
    handler: async ({ params, user, ip }) => svc.finalise(user, params.id, ip),
  });

  r.add({
    method: 'post',
    path: '/payroll-runs/:id/reopen',
    tag: 'Payroll Runs',
    summary: 'Re-open a finalised run (Administrator; reason required; audit-logged)',
    permission: 'payroll.reopen',
    params: runIdParam,
    body: z.object({ reason: z.string().trim().min(10, 'Enter a reason of at least 10 characters.').max(1000) }),
    handler: async ({ params, body, user, ip }) => svc.reopen(user, params.id, body.reason, ip),
  });

  r.add({
    method: 'get',
    path: '/payroll-runs/:id/employees/:employeeId',
    tag: 'Payroll Runs',
    summary: 'One employee’s calculated lines in a run',
    permission: 'payroll.view_amounts',
    params: z.object({ id: z.string().uuid(), employeeId: z.string().uuid() }),
    handler: async ({ params }) => {
      const m = await prisma.payrollRunEmployee.findUnique({ where: { payrollRunId_employeeId: { payrollRunId: params.id, employeeId: params.employeeId } }, include: { salaryVersion: true } });
      if (!m) throw notFound('Employee in this payroll run');
      const lines = await prisma.payrollLine.findMany({ where: { payrollRunId: params.id, employeeId: params.employeeId }, orderBy: [{ sortOrder: 'asc' }] });
      const inputs = await prisma.payrollInput.findMany({ where: { payrollRunId: params.id, employeeId: params.employeeId } });
      return {
        employeeId: m.employeeId,
        employeeCode: m.employeeCode,
        employeeName: m.employeeName,
        department: m.departmentName,
        designation: m.designationName,
        salaryVersion: m.salaryVersion ? { versionNo: m.salaryVersion.versionNo, effectiveFrom: toIsoDate(m.salaryVersion.effectiveFrom) } : null,
        gross: m.gross?.toString() ?? null,
        deductions: m.deductions?.toString() ?? null,
        net: m.net?.toString() ?? null,
        resultStatus: m.resultStatus,
        exceptions: m.exceptions,
        inputs: Object.fromEntries(inputs.map((i) => [i.inputKey, i.value])),
        lines: lines.map((l) => ({ code: l.componentCode, name: l.componentName, type: l.componentType, basis: l.basis, amount: l.amount.toString(), detail: l.calcDetail })),
      };
    },
  });

  r.add({
    method: 'get',
    path: '/employees/:id/payroll-history',
    tag: 'Payroll Runs',
    summary: "An employee's payroll results across runs",
    permission: 'payroll.view',
    params: idParam,
    handler: async ({ params, user }) => {
      const rows = await prisma.payrollRunEmployee.findMany({ where: { employeeId: params.id }, include: { payrollRun: true }, orderBy: [{ payrollRun: { year: 'desc' } }, { payrollRun: { month: 'desc' } }] });
      return rows.map((m) => ({
        runId: m.payrollRunId,
        year: m.payrollRun.year,
        month: m.payrollRun.month,
        period: svc.periodLabel(m.payrollRun.year, m.payrollRun.month),
        runStatus: m.payrollRun.status,
        resultStatus: m.resultStatus,
        gross: amt(user, m.gross),
        deductions: amt(user, m.deductions),
        net: amt(user, m.net),
      }));
    },
  });
}
