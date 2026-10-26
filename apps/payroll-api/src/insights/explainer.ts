/**
 * Payroll calculation explainer: traces every amount on an employee's result back to its source —
 * the salary version value, rate and base, the monthly input (and who entered it), proration,
 * the statutory formula's working, rounding — and re-runs the engine to confirm the stored result
 * still matches today's data. Every explanation request is audit-logged.
 */
import { z } from 'zod';
import { dec, money, notFound, toIsoDate, type ApiRegistry } from '@nexzi/server-core';
import { prisma } from '../db';
import { audit } from '../audit';
import { getSettings } from '../settings';
import { calculateRun } from '../payroll/engine';
import { buildCalculationInput, calcSettingsFor, formulasFor, periodLabel } from '../payroll/service';

const fmt = (v: string | null | undefined) => (v === null || v === undefined ? '—' : `₹${money(dec(v))}`);

type Detail = Record<string, string | null>;

function steps(line: { basis: string; componentType: string; amount: string; detail: Detail }, ctx: { versionNo: number | null; input?: { value: string; by: string | null; at: Date } }) {
  const d = line.detail;
  const out: string[] = [];
  switch (line.basis) {
    case 'FIXED':
      out.push(`Monthly amount ${fmt(d.configuredValue)} configured in salary version ${ctx.versionNo ? `v${ctx.versionNo}` : '(none)'}.`);
      if (d.prorated) out.push(`Pro-rated for ${d.prorated} payable: ${fmt(d.configuredValue)} × ${d.prorated.replace(' of ', ' ÷ ').replace(' days', '')}.`);
      break;
    case 'PERCENTAGE':
      out.push(`${d.rate}% of ${d.baseComponent} (${fmt(d.baseAmount)}) = ${fmt(String(dec(d.baseAmount ?? '0').mul(dec(d.rate ?? '0')).div(100)))}.`);
      break;
    case 'INPUT':
      out.push(ctx.input ? `Monthly input ${d.inputKey} = ${ctx.input.value}, entered by ${ctx.input.by ?? 'an import or another module'} on ${ctx.input.at.toISOString().slice(0, 16).replace('T', ' ')} UTC.` : `Monthly input ${d.inputKey}.`);
      break;
    case 'FORMULA':
      out.push(`Formula ${d.formulaRef} (${d.workbookReference ?? 'no reference'}).`);
      for (const [k, v] of Object.entries(d)) if (!['formulaRef', 'workbookReference'].includes(k) && v !== null) out.push(`${k.replace(/([A-Z])/g, ' $1').toLowerCase()}: ${v}`);
      break;
  }
  out.push(`Result: ${fmt(line.amount)} (${line.componentType === 'EARNING' ? 'added to gross' : 'deducted from gross'}).`);
  return out;
}

export function registerExplainerRoutes(r: ApiRegistry) {
  r.add({
    method: 'get',
    path: '/payroll-runs/:id/employees/:employeeId/explain',
    tag: 'Payroll Runs',
    summary: "Trace every amount of an employee's payroll result to its source and verify it against a fresh recalculation",
    permission: 'payroll.view_amounts',
    params: z.object({ id: z.string().uuid(), employeeId: z.string().uuid() }),
    handler: async ({ params, user, ip }) => {
      const run = await prisma.payrollRun.findUnique({ where: { id: params.id } });
      if (!run) throw notFound('Payroll run');
      const member = await prisma.payrollRunEmployee.findUnique({ where: { payrollRunId_employeeId: { payrollRunId: run.id, employeeId: params.employeeId } }, include: { salaryVersion: true } });
      if (!member) throw notFound('Employee in this payroll run');
      const [lines, inputs, settings, events, employeeAudit] = await Promise.all([
        prisma.payrollLine.findMany({ where: { payrollRunId: run.id, employeeId: params.employeeId }, orderBy: [{ sortOrder: 'asc' }, { componentCode: 'asc' }] }),
        prisma.payrollInput.findMany({ where: { payrollRunId: run.id, employeeId: params.employeeId } }),
        getSettings(),
        prisma.payrollRunEvent.findMany({ where: { payrollRunId: run.id }, orderBy: { occurredAt: 'asc' } }),
        prisma.auditLog.findMany({ where: { entity: 'employee', entityId: params.employeeId }, orderBy: { occurredAt: 'desc' }, take: 25 }),
      ]);
      const userIds = [...new Set([...inputs.map((i) => i.updatedById), member.salaryVersion?.createdById, ...employeeAudit.map((a) => a.actorId)].filter((x): x is string => Boolean(x)))];
      const users = new Map((await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
      const inputByKey = new Map(inputs.map((i) => [i.inputKey, { value: i.value, by: i.updatedById ? users.get(i.updatedById) ?? null : null, at: i.updatedAt }]));

      const explained = lines.map((l) => {
        const detail = (l.calcDetail ?? {}) as Detail;
        return {
          componentCode: l.componentCode,
          componentName: l.componentName,
          type: l.componentType,
          basis: l.basis,
          amount: l.amount.toString(),
          showOnPayslip: l.showOnPayslip,
          detail,
          steps: steps({ basis: l.basis, componentType: l.componentType, amount: l.amount.toString(), detail }, { versionNo: member.salaryVersion?.versionNo ?? null, input: detail.inputKey ? inputByKey.get(detail.inputKey) : undefined }),
        };
      });

      // Re-run the engine on today's data for this employee only (read-only transaction).
      let verification: { status: 'MATCH' | 'DIFFERENT' | 'NOT_CHECKED'; message: string; differences: { componentCode: string; stored: string | null; recalculated: string | null }[] } = { status: 'NOT_CHECKED', message: 'The payroll has not been calculated.', differences: [] };
      if (run.status !== 'DRAFT') {
        const fresh = await prisma.$transaction(async (tx) => {
          const input = await buildCalculationInput(tx, run.id, settings);
          return calculateRun(input.employees.filter((e) => e.employeeId === params.employeeId), input.components, input.inputDefs, calcSettingsFor(run.year, run.month, settings), formulasFor(settings)).results[0];
        });
        const stored = new Map(lines.map((l) => [l.componentCode, l.amount.toString()]));
        const again = new Map((fresh?.lines ?? []).map((l) => [l.componentCode, l.amount]));
        const differences = [...new Set([...stored.keys(), ...again.keys()])]
          .filter((c) => !dec(stored.get(c) ?? '0').eq(dec(again.get(c) ?? '0')))
          .map((c) => ({ componentCode: c, stored: stored.get(c) ?? null, recalculated: again.get(c) ?? null }));
        verification = differences.length
          ? { status: 'DIFFERENT', message: run.status === 'FINALISED' ? 'Salary data, inputs or settings have changed since this month was finalised. The stored (finalised) amounts stand; the differences show what today\'s data would give.' : 'Data or settings changed after calculation. Recalculate the payroll before it is submitted.', differences }
          : { status: 'MATCH', message: "A fresh calculation from today's data reproduces every stored amount.", differences: [] };
      }

      const summary = (member.calcSummary ?? {}) as Record<string, unknown>;
      const earnings = explained.filter((l) => l.type === 'EARNING');
      const deductions = explained.filter((l) => l.type === 'DEDUCTION');
      await audit.write({ actorId: user.id, action: 'payroll.explained', entity: 'payroll_run', entityId: run.id, metadata: { employeeCode: member.employeeCode }, ip });
      return {
        run: { id: run.id, period: periodLabel(run.year, run.month), status: run.status, calculatedAt: run.calculatedAt, finalisedAt: run.finalisedAt, calcHash: run.calcHash },
        employee: { id: member.employeeId, employeeCode: member.employeeCode, employeeName: member.employeeName, department: member.departmentName, designation: member.designationName },
        salaryVersion: member.salaryVersion
          ? { versionNo: member.salaryVersion.versionNo, effectiveFrom: toIsoDate(member.salaryVersion.effectiveFrom), effectiveTo: toIsoDate(member.salaryVersion.effectiveTo), changeReason: member.salaryVersion.changeReason, monthlyGross: member.salaryVersion.monthlyGross?.toString() ?? null, createdBy: member.salaryVersion.createdById ? users.get(member.salaryVersion.createdById) ?? null : null, createdAt: member.salaryVersion.createdAt }
          : null,
        inputs: inputs.map((i) => ({ inputKey: i.inputKey, value: i.value, updatedBy: i.updatedById ? users.get(i.updatedById) ?? null : null, updatedAt: i.updatedAt })),
        lines: explained,
        totals: {
          gross: member.gross?.toString() ?? null,
          deductions: member.deductions?.toString() ?? null,
          net: member.net?.toString() ?? null,
          grossFormula: earnings.map((l) => `${l.componentName} ${money(dec(l.amount))}`).join(' + ') || '—',
          deductionsFormula: deductions.map((l) => `${l.componentName} ${money(dec(l.amount))}`).join(' + ') || '—',
        },
        summary,
        rounding: settings.rounding,
        exceptions: member.exceptions,
        verification,
        runEvents: events.map((e) => ({ action: e.action, toStatus: e.toStatus, actorName: e.actorName, reason: e.reason, occurredAt: e.occurredAt })),
        auditTrail: employeeAudit.map((a) => ({ occurredAt: a.occurredAt, action: a.action, actor: a.actorId ? users.get(a.actorId) ?? a.actorEmail : a.actorEmail })),
      };
    },
  });
}
