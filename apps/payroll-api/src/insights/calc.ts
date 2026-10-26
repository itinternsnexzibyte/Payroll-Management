/**
 * In-memory payroll calculation for what-if tools (digital twin, policy lab). Everything here only
 * READS live data and runs the same engine as payroll runs; nothing is ever written back.
 */
import { Dec, dec, money } from '@nexzi/server-core';
import { prisma } from '../db';
import type { PayrollSettings } from '../settings';
import { calculateRun, employedDaysInMonth, isEligible, selectSalaryVersion, type ComponentDef, type EmployeeCalcInput, type EmployeeResult, type InputDef } from '../payroll/engine';
import { calcSettingsFor, formulasFor, loadInputDefs } from '../payroll/service';

export interface SimEmployee extends EmployeeCalcInput {
  employeeName: string;
  department: string | null;
  joiningDate: Date;
  /** Monthly gross the salary version was generated from (template versions only) */
  monthlyGross: string | null;
  synthetic?: boolean;
}

export interface Population {
  year: number;
  month: number;
  employees: SimEmployee[];
  components: ComponentDef[];
  inputDefs: InputDef[];
}

export const toComponentDef = (c: { id: string; code: string; name: string; type: 'EARNING' | 'DEDUCTION'; basis: 'FIXED' | 'PERCENTAGE' | 'INPUT' | 'FORMULA'; percentOfCode: string | null; defaultPercentage: { toString(): string } | null; inputKey: string | null; formulaRef: string | null; sortOrder: number; showOnPayslip: boolean }): ComponentDef => ({
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
});

/** Employees eligible for a month with their effective salary structure and that month's inputs (if a run exists). */
export async function livePopulation(year: number, month: number, settings: PayrollSettings): Promise<Population> {
  const [comps, inputDefs, employees, run] = await Promise.all([
    prisma.salaryComponent.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] }),
    loadInputDefs(),
    prisma.employee.findMany({ include: { department: true, salaryVersions: { include: { values: { include: { component: true } } } } }, orderBy: { employeeCode: 'asc' } }),
    prisma.payrollRun.findUnique({ where: { year_month: { year, month } }, include: { inputs: true } }),
  ]);
  const components = comps.map(toComponentDef);
  const active = new Set(components.map((c) => c.code));
  const people: SimEmployee[] = employees
    .filter((e) => isEligible(e, year, month))
    .map((e) => {
      const v = selectSalaryVersion(e.salaryVersions, year, month, settings.salaryVersionRule);
      return {
        employeeId: e.id,
        employeeCode: e.employeeCode,
        employeeName: e.fullName,
        department: e.department?.name ?? null,
        joiningDate: e.joiningDate,
        monthlyGross: v?.monthlyGross?.toString() ?? null,
        salaryValues: v ? Object.fromEntries(v.values.filter((x) => active.has(x.component.code)).map((x) => [x.component.code, x.value.toString()])) : null,
        monthlyInputs: Object.fromEntries((run?.inputs ?? []).filter((i) => i.employeeId === e.id).map((i) => [i.inputKey, i.value])),
        previousNet: null,
        employedDays: employedDaysInMonth(e, year, month),
      };
    });
  // What-if tools look at structures, not missing monthly data: mandatory inputs are not enforced.
  return { year, month, employees: people, components, inputDefs: inputDefs.map((d) => ({ ...d, mandatory: false })) };
}

export interface SimResult {
  employee: SimEmployee;
  result: EmployeeResult;
  employerCost: Dec;
}

export function simulate(pop: Population, settings: PayrollSettings): SimResult[] {
  const calc = calculateRun(pop.employees, pop.components, pop.inputDefs, calcSettingsFor(pop.year, pop.month, settings), formulasFor(settings));
  const byId = new Map(pop.employees.map((e) => [e.employeeId, e]));
  return calc.results.map((r) => ({
    employee: byId.get(r.employeeId)!,
    result: r,
    employerCost: dec(r.summary.employerPf).add(dec(r.summary.employerEsi)).add(dec(r.summary.gratuity)),
  }));
}

export interface Totals {
  headcount: number;
  gross: string;
  deductions: string;
  net: string;
  employerCost: string;
  /** gross + employer PF / ESI / gratuity */
  costToCompany: string;
  errors: number;
}

export function totalsOf(results: SimResult[]): Totals {
  const ok = results.filter((r) => r.result.status !== 'ERROR');
  const s = (f: (r: SimResult) => Dec) => ok.reduce((acc, r) => acc.add(f(r)), new Dec(0));
  const gross = s((r) => dec(r.result.gross));
  const employer = s((r) => r.employerCost);
  return {
    headcount: results.length,
    gross: money(gross),
    deductions: money(s((r) => dec(r.result.deductions))),
    net: money(s((r) => dec(r.result.net))),
    employerCost: money(employer),
    costToCompany: money(gross.add(employer)),
    errors: results.length - ok.length,
  };
}

/** The most recent month with a payroll run, else the current month. */
export async function defaultPeriod() {
  const latest = await prisma.payrollRun.findFirst({ orderBy: [{ year: 'desc' }, { month: 'desc' }] });
  if (latest) return { year: latest.year, month: latest.month };
  const now = new Date();
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}
