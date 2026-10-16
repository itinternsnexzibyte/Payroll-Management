/**
 * Read-only loaders for calculated payroll results, shared by anomaly alerts and reconciliation.
 * They only read payroll_run_employees / payroll_lines and never write payroll data.
 */
import { AppError, notFound, toIsoDate } from '@nexzi/server-core';
import { prisma, type Tx } from '../db';
import { periodLabel } from '../payroll/service';
import type { EmployeeResult, LineSnapshot, PeriodResult } from '../anomalies/rules';

export interface RunEmployeeResult extends EmployeeResult {
  departmentName: string | null;
  gross: string | null;
  deductions: string | null;
  resultStatus: string;
}

export interface RunResult extends PeriodResult {
  runId: string;
  year: number;
  month: number;
  status: string;
  rulesApproved: boolean;
  employees: Map<string, RunEmployeeResult>;
}

type Db = Tx | typeof prisma;

/** Loads one run's calculated results; refuses Draft runs (nothing to compare yet). */
export async function loadRunResult(runId: string, db: Db = prisma, employeeIds?: string[]): Promise<RunResult> {
  const run = await db.payrollRun.findUnique({ where: { id: runId } });
  if (!run) throw notFound('Payroll run');
  if (run.status === 'DRAFT') throw new AppError('INVALID_STATE', `${periodLabel(run.year, run.month)} has not been calculated yet.`);
  return (await loadResults([run], db, employeeIds))[0];
}

/** Loads results for several runs in two queries. */
export async function loadResults(
  runs: { id: string; year: number; month: number; status: string; rulesApproved: boolean }[],
  db: Db = prisma,
  employeeIds?: string[],
): Promise<RunResult[]> {
  if (!runs.length) return [];
  const ids = runs.map((r) => r.id);
  const empFilter = employeeIds ? { employeeId: { in: employeeIds } } : {};
  const [members, lines] = await Promise.all([
    db.payrollRunEmployee.findMany({ where: { payrollRunId: { in: ids }, ...empFilter }, include: { salaryVersion: { select: { versionNo: true, effectiveFrom: true } } } }),
    db.payrollLine.findMany({ where: { payrollRunId: { in: ids }, ...empFilter }, orderBy: [{ sortOrder: 'asc' }, { componentCode: 'asc' }] }),
  ]);
  const linesBy = new Map<string, LineSnapshot[]>();
  for (const l of lines) {
    const k = `${l.payrollRunId}:${l.employeeId}`;
    const arr = linesBy.get(k) ?? [];
    arr.push({ code: l.componentCode, name: l.componentName, type: l.componentType, basis: l.basis, amount: l.amount.toString() });
    linesBy.set(k, arr);
  }
  return runs.map((run) => {
    const employees = new Map<string, RunEmployeeResult>();
    for (const m of members.filter((x) => x.payrollRunId === run.id)) {
      employees.set(m.employeeId, {
        employeeId: m.employeeId,
        code: m.employeeCode,
        name: m.employeeName,
        departmentName: m.departmentName,
        salaryVersionId: m.salaryVersionId,
        salaryVersionNo: m.salaryVersion?.versionNo ?? null,
        salaryEffectiveFrom: toIsoDate(m.salaryVersion?.effectiveFrom),
        gross: m.gross?.toString() ?? null,
        deductions: m.deductions?.toString() ?? null,
        net: m.net?.toString() ?? null,
        resultStatus: m.resultStatus,
        lines: linesBy.get(`${run.id}:${m.employeeId}`) ?? [],
      });
    }
    return { runId: run.id, year: run.year, month: run.month, status: run.status, rulesApproved: run.rulesApproved, period: periodLabel(run.year, run.month), employees };
  });
}

/** Finalised runs strictly before the given month, newest first. */
export async function finalisedRunsBefore(year: number, month: number, take: number, db: Db = prisma) {
  return db.payrollRun.findMany({
    where: { status: 'FINALISED', OR: [{ year: { lt: year } }, { year, month: { lt: month } }] },
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
    take,
  });
}
