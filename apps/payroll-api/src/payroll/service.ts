import { AppError, notFound, type AuthUser } from '@nexzi/server-core';
import { Prisma, prisma, type Tx } from '../db';
import { audit } from '../audit';
import { config } from '../config';
import { getSettings, type PayrollSettings } from '../settings';
import { calculateRun, employedDaysInMonth, isEligible, selectSalaryVersion, validateInputValue, type CalcSettings, type ComponentDef, type EmployeeCalcInput, type InputDef } from './engine';
import { FORMULA_REGISTRY, type FormulaRegistry } from './formulas';
import { buildStatutoryFormulas } from '../statutory/rules';

export type RunStatus = 'DRAFT' | 'CALCULATED' | 'UNDER_REVIEW' | 'APPROVED' | 'FINALISED';
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const periodLabel = (year: number, month: number) => `${MONTHS[month - 1]} ${year}`;

/** Formula registry in use — overridable only by tests. */
let formulas: FormulaRegistry = FORMULA_REGISTRY;
export const setFormulaRegistryForTests = (f: FormulaRegistry) => {
  formulas = f;
};
/** Client-approved formulas plus the statutory formulas built from the confirmed settings. */
export const formulasFor = (settings: PayrollSettings): FormulaRegistry => ({ ...buildStatutoryFormulas(settings.statutory), ...formulas });

/** Engine settings for a payroll month (part of the calculation fingerprint). */
export const calcSettingsFor = (year: number, month: number, settings: PayrollSettings): CalcSettings => ({
  year,
  month,
  rounding: settings.rounding,
  unusualChangeThresholdPercent: settings.unusualChangeThresholdPercent,
  proration: { enabled: settings.proration.enabled, lopInputKey: settings.inputMappings.unpaidLeaveDays },
  gratuity: settings.gratuity,
});

/** Locks the run row for the rest of the transaction and checks its state. */
async function lockRun(tx: Tx, id: string, allowed: RunStatus[]) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM payroll_runs WHERE id = ${id}::uuid FOR UPDATE`;
  if (!rows.length) throw notFound('Payroll run');
  const run = await tx.payrollRun.findUniqueOrThrow({ where: { id } });
  if (!allowed.includes(run.status as RunStatus)) {
    throw new AppError('INVALID_STATE', `This action is not allowed while the payroll is ${run.status.replace('_', ' ').toLowerCase()}.`, { status: run.status });
  }
  return run;
}

async function addEvent(tx: Tx, runId: string, action: string, from: string | null, to: string, user: AuthUser, reason?: string) {
  await tx.payrollRunEvent.create({ data: { payrollRunId: runId, action, fromStatus: from, toStatus: to, reason: reason ?? null, actorId: user.id, actorName: user.name } });
}

export async function createRun(user: AuthUser, year: number, month: number, employeeIds: string[] | undefined, ip: string | null) {
  const existing = await prisma.payrollRun.findUnique({ where: { year_month: { year, month } } });
  if (existing) {
    throw new AppError('CONFLICT', `A payroll run for ${periodLabel(year, month)} already exists.`, { existingRunId: existing.id });
  }
  const settings = await getSettings();
  const employees = await prisma.employee.findMany({
    where: employeeIds ? { id: { in: employeeIds } } : {},
    include: { department: true, designation: true, salaryVersions: true },
    orderBy: { employeeCode: 'asc' },
  });
  const eligible = employees.filter((e) => isEligible(e, year, month));
  if (employeeIds) {
    const notEligible = employees.filter((e) => !isEligible(e, year, month)).map((e) => e.employeeCode);
    if (notEligible.length) throw new AppError('VALIDATION_ERROR', `Not employed in ${periodLabel(year, month)}: ${notEligible.join(', ')}.`);
    if (employees.length !== employeeIds.length) throw new AppError('VALIDATION_ERROR', 'One or more selected employees do not exist.');
  }
  if (!eligible.length) throw new AppError('VALIDATION_ERROR', `No employees are eligible for ${periodLabel(year, month)}.`);
  try {
    const run = await prisma.$transaction(async (tx) => {
      const created = await tx.payrollRun.create({ data: { year, month, status: 'DRAFT', employeeCount: eligible.length, createdById: user.id } });
      await tx.payrollRunEmployee.createMany({
        data: eligible.map((e) => ({
          payrollRunId: created.id,
          employeeId: e.id,
          salaryVersionId: selectSalaryVersion(e.salaryVersions, year, month, settings.salaryVersionRule)?.id ?? null,
          employeeCode: e.employeeCode,
          employeeName: e.fullName,
          departmentName: e.department?.name ?? null,
          designationName: e.designation?.name ?? null,
        })),
      });
      await addEvent(tx, created.id, 'CREATED', null, 'DRAFT', user);
      await audit.tx(tx, { actorId: user.id, action: 'payroll.run_created', entity: 'payroll_run', entityId: created.id, after: { year, month, employees: eligible.length }, ip });
      return created;
    });
    return run;
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') throw new AppError('CONFLICT', `A payroll run for ${periodLabel(year, month)} already exists.`);
    throw e;
  }
}

export async function updateRunEmployees(user: AuthUser, runId: string, add: string[], remove: string[], ip: string | null) {
  return prisma.$transaction(async (tx) => {
    const run = await lockRun(tx, runId, ['DRAFT', 'CALCULATED']);
    const settings = await getSettings(tx);
    if (add.length) {
      const emps = await tx.employee.findMany({ where: { id: { in: add } }, include: { department: true, designation: true, salaryVersions: true } });
      const bad = emps.filter((e) => !isEligible(e, run.year, run.month));
      if (bad.length || emps.length !== add.length) throw new AppError('VALIDATION_ERROR', `Not eligible for ${periodLabel(run.year, run.month)}: ${bad.map((b) => b.employeeCode).join(', ') || 'unknown employee'}.`);
      await tx.payrollRunEmployee.createMany({
        skipDuplicates: true,
        data: emps.map((e) => ({
          payrollRunId: run.id,
          employeeId: e.id,
          salaryVersionId: selectSalaryVersion(e.salaryVersions, run.year, run.month, settings.salaryVersionRule)?.id ?? null,
          employeeCode: e.employeeCode,
          employeeName: e.fullName,
          departmentName: e.department?.name ?? null,
          designationName: e.designation?.name ?? null,
        })),
      });
    }
    if (remove.length) {
      await tx.payrollLine.deleteMany({ where: { payrollRunId: run.id, employeeId: { in: remove } } });
      await tx.payrollInput.deleteMany({ where: { payrollRunId: run.id, employeeId: { in: remove } } });
      await tx.payrollRunEmployee.deleteMany({ where: { payrollRunId: run.id, employeeId: { in: remove } } });
    }
    const count = await tx.payrollRunEmployee.count({ where: { payrollRunId: run.id } });
    if (count === 0) throw new AppError('VALIDATION_ERROR', 'A payroll run must include at least one employee.');
    await invalidateResults(tx, run.id);
    await tx.payrollRun.update({ where: { id: run.id }, data: { employeeCount: count, status: 'DRAFT', version: { increment: 1 } } });
    if (run.status !== 'DRAFT') await addEvent(tx, run.id, 'RETURNED_TO_DRAFT', run.status, 'DRAFT', user, 'Employee selection changed');
    await audit.tx(tx, { actorId: user.id, action: 'payroll.employees_changed', entity: 'payroll_run', entityId: run.id, metadata: { added: add.length, removed: remove.length }, ip });
    return { employeeCount: count };
  });
}

async function invalidateResults(tx: Tx, runId: string) {
  await tx.payrollLine.deleteMany({ where: { payrollRunId: runId } });
  await tx.payrollRunEmployee.updateMany({ where: { payrollRunId: runId }, data: { gross: null, deductions: null, net: null, resultStatus: 'PENDING', exceptions: [], calcSummary: {} } });
  await tx.payrollRun.update({ where: { id: runId }, data: { totalEarnings: null, totalDeductions: null, totalNet: null, calcHash: null, calculatedAt: null, calculatedById: null } });
}

export async function loadInputDefs(db: Tx | typeof prisma = prisma): Promise<InputDef[]> {
  const defs = await db.payrollInputDefinition.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }] });
  return defs.map((d) => ({ key: d.key, label: d.label, dataType: d.dataType, mandatory: d.mandatory, minValue: d.minValue?.toString() ?? null, maxValue: d.maxValue?.toString() ?? null }));
}

export interface InputEntry {
  employeeId: string;
  inputKey: string;
  value: string;
}

/** Saves valid cells and reports invalid ones; valid input is never discarded because another cell failed. */
export async function saveInputs(user: AuthUser, runId: string, entries: InputEntry[], ip: string | null) {
  return prisma.$transaction(async (tx) => {
    const run = await lockRun(tx, runId, ['DRAFT', 'CALCULATED']);
    const defs = new Map((await loadInputDefs(tx)).map((d) => [d.key, d]));
    const members = new Set((await tx.payrollRunEmployee.findMany({ where: { payrollRunId: runId }, select: { employeeId: true } })).map((m) => m.employeeId));
    const errors: { employeeId: string; inputKey: string; message: string }[] = [];
    let saved = 0;
    for (const e of entries) {
      const def = defs.get(e.inputKey);
      if (!def) {
        errors.push({ ...e, message: 'Unknown input column.' });
        continue;
      }
      if (!members.has(e.employeeId)) {
        errors.push({ ...e, message: 'Employee is not part of this payroll run.' });
        continue;
      }
      const value = e.value.trim();
      // Mandatory-ness is checked at calculation time; here only the format is validated.
      const problem = value === '' ? null : validateInputValue({ ...def, mandatory: false }, value);
      if (problem) {
        errors.push({ ...e, message: problem });
        continue;
      }
      if (value === '') {
        await tx.payrollInput.deleteMany({ where: { payrollRunId: runId, employeeId: e.employeeId, inputKey: e.inputKey } });
      } else {
        await tx.payrollInput.upsert({
          where: { payrollRunId_employeeId_inputKey: { payrollRunId: runId, employeeId: e.employeeId, inputKey: e.inputKey } },
          create: { payrollRunId: runId, employeeId: e.employeeId, inputKey: e.inputKey, value, updatedById: user.id },
          update: { value, updatedById: user.id },
        });
      }
      saved++;
    }
    if (saved > 0 && run.status === 'CALCULATED') {
      await invalidateResults(tx, runId);
      await tx.payrollRun.update({ where: { id: runId }, data: { status: 'DRAFT', version: { increment: 1 } } });
      await addEvent(tx, runId, 'RETURNED_TO_DRAFT', 'CALCULATED', 'DRAFT', user, 'Monthly inputs changed');
    }
    if (saved > 0) await audit.tx(tx, { actorId: user.id, action: 'payroll.inputs_saved', entity: 'payroll_run', entityId: runId, metadata: { cells: saved }, ip });
    return { saved, errors };
  });
}

export async function buildCalculationInput(tx: Tx, runId: string, settings: PayrollSettings) {
  const run = await tx.payrollRun.findUniqueOrThrow({ where: { id: runId } });
  const members = await tx.payrollRunEmployee.findMany({ where: { payrollRunId: runId }, include: { employee: { include: { salaryVersions: { include: { values: { include: { component: true } } } } } } } });
  const inputs = await tx.payrollInput.findMany({ where: { payrollRunId: runId } });
  const comps = await tx.salaryComponent.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] });
  const inputDefs = await loadInputDefs(tx);

  // Previous finalised month (for unusual-change warnings)
  const prevMonth = run.month === 1 ? { year: run.year - 1, month: 12 } : { year: run.year, month: run.month - 1 };
  const prevRun = await tx.payrollRun.findFirst({ where: { ...prevMonth, status: 'FINALISED' }, include: { employees: true } });
  const prevNet = new Map(prevRun?.employees.map((e) => [e.employeeId, e.net?.toString() ?? null]) ?? []);

  const components: ComponentDef[] = comps.map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    type: c.type,
    basis: c.basis,
    percentOfCode: c.percentOfCode,
    defaultPercentage: c.defaultPercentage?.toString() ?? null,
    inputKey: c.inputKey,
    formulaRef: c.formulaRef,
    sortOrder: c.sortOrder,
    showOnPayslip: c.showOnPayslip,
  }));
  const activeCodes = new Set(components.map((c) => c.code));
  const versionByEmployee = new Map<string, string | null>();
  const employees: EmployeeCalcInput[] = members.map((m) => {
    const version = selectSalaryVersion(m.employee.salaryVersions, run.year, run.month, settings.salaryVersionRule);
    versionByEmployee.set(m.employeeId, version?.id ?? null);
    return {
      employeeId: m.employeeId,
      employeeCode: m.employeeCode,
      salaryValues: version ? Object.fromEntries(version.values.filter((v) => activeCodes.has(v.component.code)).map((v) => [v.component.code, v.value.toString()])) : null,
      monthlyInputs: Object.fromEntries(inputs.filter((i) => i.employeeId === m.employeeId).map((i) => [i.inputKey, i.value])),
      previousNet: prevNet.get(m.employeeId) ?? null,
      employedDays: employedDaysInMonth(m.employee, run.year, run.month),
    };
  });
  return { run, employees, components, inputDefs, versionByEmployee };
}

export async function calculate(user: AuthUser, runId: string, ip: string | null) {
  return prisma.$transaction(
    async (tx) => {
      const run = await lockRun(tx, runId, ['DRAFT', 'CALCULATED']);
      const settings = await getSettings(tx);
      const input = await buildCalculationInput(tx, runId, settings);
      const calc = calculateRun(input.employees, input.components, input.inputDefs, calcSettingsFor(run.year, run.month, settings), formulasFor(settings));

      await tx.payrollLine.deleteMany({ where: { payrollRunId: runId } });
      const lineRows: Prisma.PayrollLineCreateManyInput[] = [];
      for (const r of calc.results) {
        await tx.payrollRunEmployee.update({
          where: { payrollRunId_employeeId: { payrollRunId: runId, employeeId: r.employeeId } },
          data: {
            salaryVersionId: input.versionByEmployee.get(r.employeeId) ?? null,
            gross: new Prisma.Decimal(r.gross),
            deductions: new Prisma.Decimal(r.deductions),
            net: new Prisma.Decimal(r.net),
            resultStatus: r.status,
            exceptions: r.exceptions as unknown as Prisma.InputJsonValue,
            calcSummary: r.summary as unknown as Prisma.InputJsonValue,
          },
        });
        for (const l of r.lines) {
          lineRows.push({
            payrollRunId: runId,
            employeeId: r.employeeId,
            componentId: l.componentId,
            componentCode: l.componentCode,
            componentName: l.componentName,
            componentType: l.componentType,
            basis: l.basis,
            sortOrder: l.sortOrder,
            showOnPayslip: l.showOnPayslip,
            amount: new Prisma.Decimal(l.amount),
            calcDetail: l.detail,
          });
        }
      }
      if (lineRows.length) await tx.payrollLine.createMany({ data: lineRows });
      const counts = { ok: 0, warning: 0, error: 0 };
      for (const r of calc.results) counts[r.status.toLowerCase() as 'ok' | 'warning' | 'error']++;
      await tx.payrollRun.update({
        where: { id: runId },
        data: {
          status: 'CALCULATED',
          totalEarnings: new Prisma.Decimal(calc.totals.gross),
          totalDeductions: new Prisma.Decimal(calc.totals.deductions),
          totalNet: new Prisma.Decimal(calc.totals.net),
          calcHash: calc.hash,
          rulesApproved: config.PAYROLL_RULES_APPROVED,
          calculatedAt: new Date(),
          calculatedById: user.id,
          version: { increment: 1 },
        },
      });
      await addEvent(tx, runId, 'CALCULATED', run.status, 'CALCULATED', user);
      // Amounts are deliberately not written to the audit log metadata.
      await audit.tx(tx, { actorId: user.id, action: 'payroll.calculated', entity: 'payroll_run', entityId: runId, metadata: { employees: calc.results.length, ...counts, hash: calc.hash }, ip });
      return { status: 'CALCULATED' as const, hash: calc.hash, ...counts };
    },
    { timeout: 120_000 },
  );
}

/** Recomputes the calculation fingerprint to detect salary/input/config changes since calculation. */
async function assertResultsCurrent(tx: Tx, runId: string, calcHash: string | null) {
  const settings = await getSettings(tx);
  const input = await buildCalculationInput(tx, runId, settings);
  const calc = calculateRun(input.employees, input.components, input.inputDefs, calcSettingsFor(input.run.year, input.run.month, settings), formulasFor(settings));
  if (calc.hash !== calcHash) {
    throw new AppError('INVALID_STATE', 'Salary data, inputs or payroll settings changed after this payroll was calculated. Return it to draft and recalculate before continuing.', { reason: 'STALE_CALCULATION' });
  }
}

async function assertNoErrors(tx: Tx, runId: string) {
  const errors = await tx.payrollRunEmployee.count({ where: { payrollRunId: runId, resultStatus: { in: ['ERROR', 'PENDING'] } } });
  if (errors) throw new AppError('INVALID_STATE', `${errors} employee(s) have blocking exceptions (missing inputs, missing salary structure or unconfigured formulas). Resolve them and recalculate.`);
}

export async function submitForReview(user: AuthUser, runId: string, acknowledgeWarnings: boolean, ip: string | null) {
  return prisma.$transaction(async (tx) => {
    const run = await lockRun(tx, runId, ['CALCULATED']);
    await assertNoErrors(tx, runId);
    const warnings = await tx.payrollRunEmployee.count({ where: { payrollRunId: runId, resultStatus: 'WARNING' } });
    if (warnings && !acknowledgeWarnings) throw new AppError('VALIDATION_ERROR', `${warnings} employee(s) have warnings. Review and acknowledge them before submitting.`, { reason: 'WARNINGS_NOT_ACKNOWLEDGED', warnings });
    await assertResultsCurrent(tx, runId, run.calcHash);
    await tx.payrollRun.update({ where: { id: runId }, data: { status: 'UNDER_REVIEW', submittedAt: new Date(), submittedById: user.id, version: { increment: 1 } } });
    await addEvent(tx, runId, 'SUBMITTED', run.status, 'UNDER_REVIEW', user, warnings ? `${warnings} warning(s) acknowledged` : undefined);
    await audit.tx(tx, { actorId: user.id, action: 'payroll.submitted', entity: 'payroll_run', entityId: runId, metadata: { warningsAcknowledged: warnings }, ip });
    return { status: 'UNDER_REVIEW' as const };
  });
}

export async function returnRun(user: AuthUser, runId: string, reason: string, ip: string | null) {
  return prisma.$transaction(async (tx) => {
    const run = await lockRun(tx, runId, ['UNDER_REVIEW', 'APPROVED']);
    await tx.payrollRun.update({ where: { id: runId }, data: { status: 'CALCULATED', submittedAt: null, submittedById: null, approvedAt: null, approvedById: null, version: { increment: 1 } } });
    await addEvent(tx, runId, 'RETURNED', run.status, 'CALCULATED', user, reason);
    await audit.tx(tx, { actorId: user.id, action: 'payroll.returned', entity: 'payroll_run', entityId: runId, metadata: { reason, from: run.status }, ip });
    return { status: 'CALCULATED' as const };
  });
}

export async function approve(user: AuthUser, runId: string, ip: string | null) {
  return prisma.$transaction(async (tx) => {
    const run = await lockRun(tx, runId, ['UNDER_REVIEW']);
    const settings = await getSettings(tx);
    if (settings.separateApprover && (run.calculatedById === user.id || run.submittedById === user.id)) {
      throw new AppError('FORBIDDEN', 'The approver must be a different person from the one who calculated or submitted this payroll.');
    }
    await assertNoErrors(tx, runId);
    await assertResultsCurrent(tx, runId, run.calcHash);
    await tx.payrollRun.update({ where: { id: runId }, data: { status: 'APPROVED', approvedAt: new Date(), approvedById: user.id, version: { increment: 1 } } });
    await addEvent(tx, runId, 'APPROVED', run.status, 'APPROVED', user);
    await audit.tx(tx, { actorId: user.id, action: 'payroll.approved', entity: 'payroll_run', entityId: runId, ip });
    return { status: 'APPROVED' as const };
  });
}

export async function finalise(user: AuthUser, runId: string, ip: string | null) {
  return prisma.$transaction(
    async (tx) => {
      const settings = await getSettings(tx);
      const run = await lockRun(tx, runId, settings.requireApprovalStep ? ['APPROVED'] : ['UNDER_REVIEW', 'APPROVED']);
      if (settings.separateApprover && run.status === 'UNDER_REVIEW' && (run.calculatedById === user.id || run.submittedById === user.id)) {
        throw new AppError('FORBIDDEN', 'The person finalising must be different from the one who calculated or submitted this payroll.');
      }
      await assertNoErrors(tx, runId);
      await assertResultsCurrent(tx, runId, run.calcHash);
      const now = new Date();
      await tx.payrollRun.update({
        where: { id: runId },
        data: {
          status: 'FINALISED',
          finalisedAt: now,
          finalisedById: user.id,
          ...(run.status === 'UNDER_REVIEW' ? { approvedAt: now, approvedById: user.id } : {}),
          version: { increment: 1 },
        },
      });
      await addEvent(tx, runId, 'FINALISED', run.status, 'FINALISED', user);
      await audit.tx(tx, { actorId: user.id, action: 'payroll.finalised', entity: 'payroll_run', entityId: runId, metadata: { hash: run.calcHash, rulesApproved: run.rulesApproved }, ip });
      return { status: 'FINALISED' as const };
    },
    { timeout: 120_000 },
  );
}

export async function reopen(user: AuthUser, runId: string, reason: string, ip: string | null) {
  return prisma.$transaction(async (tx) => {
    const run = await lockRun(tx, runId, ['FINALISED']);
    await tx.payrollRun.update({
      where: { id: runId },
      data: { status: 'CALCULATED', finalisedAt: null, finalisedById: null, approvedAt: null, approvedById: null, submittedAt: null, submittedById: null, reopenCount: { increment: 1 }, version: { increment: 1 } },
    });
    await tx.payslip.updateMany({ where: { payrollRunId: runId, supersededAt: null }, data: { supersededAt: new Date() } });
    await addEvent(tx, runId, 'REOPENED', 'FINALISED', 'CALCULATED', user, reason);
    await audit.tx(tx, { actorId: user.id, action: 'payroll.reopened', entity: 'payroll_run', entityId: runId, before: { status: 'FINALISED', finalisedAt: run.finalisedAt }, after: { status: 'CALCULATED' }, metadata: { reason }, ip });
    return { status: 'CALCULATED' as const };
  });
}

export function allowedActions(user: AuthUser, status: RunStatus, settings: PayrollSettings): string[] {
  const p = user.permissions;
  const a: string[] = [];
  if ((status === 'DRAFT' || status === 'CALCULATED') && p.has('payroll.input')) a.push('editInputs', 'editEmployees');
  if ((status === 'DRAFT' || status === 'CALCULATED') && p.has('payroll.calculate')) a.push('calculate');
  if (status === 'CALCULATED' && p.has('payroll.calculate')) a.push('submit');
  if ((status === 'UNDER_REVIEW' || status === 'APPROVED') && (p.has('payroll.approve') || p.has('payroll.finalise') || p.has('payroll.calculate'))) a.push('return');
  if (status === 'UNDER_REVIEW' && p.has('payroll.approve') && settings.requireApprovalStep) a.push('approve');
  if (((status === 'APPROVED') || (status === 'UNDER_REVIEW' && !settings.requireApprovalStep)) && p.has('payroll.finalise')) a.push('finalise');
  if (status === 'FINALISED' && p.has('payroll.reopen')) a.push('reopen');
  return a;
}
