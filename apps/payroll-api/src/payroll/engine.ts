import { createHash } from 'node:crypto';
import { DECIMAL_RE, Dec, dec, money, roundTo, type RoundingMode } from '@nexzi/server-core';
import type { FormulaRegistry } from './formulas';

/**
 * Payroll calculation engine — pure, deterministic and side-effect free.
 *
 * Inputs: the active salary components, the employee's salary version values and the monthly
 * inputs. Output: one line per applicable component plus gross / deductions / net.
 *
 * Generic rules implemented here (all PROVISIONAL until reconciled against the client workbook):
 *  - FIXED:      amount = employee's configured monthly value.
 *  - PERCENTAGE: amount = base component amount × (employee rate, else component default rate) ÷ 100.
 *  - INPUT:      amount = the monthly input value entered for the employee.
 *  - FORMULA:    amount = registered, client-approved formula; unregistered → blocking exception.
 *  - Gross = Σ earnings, Deductions = Σ deductions, Net = Gross − Deductions.
 *  - Rounding per the configured rule (scale, mode, line-level or total-level).
 *  - Proration (when on): FIXED earnings × days payable ÷ days in month, where days payable = days
 *    employed in the month − loss-of-pay days. PERCENTAGE components follow their prorated base.
 *  - Gratuity (when on): rate × the chosen components, reported as an employer cost only.
 * An employee's structure is the set of FIXED/PERCENTAGE/FORMULA components present in their
 * salary version, so employees may have different structures.
 */

export type ComponentType = 'EARNING' | 'DEDUCTION';
export type Basis = 'FIXED' | 'PERCENTAGE' | 'INPUT' | 'FORMULA';

export interface ComponentDef {
  id: string;
  code: string;
  name: string;
  type: ComponentType;
  basis: Basis;
  percentOfCode: string | null;
  defaultPercentage: string | null;
  inputKey: string | null;
  formulaRef: string | null;
  sortOrder: number;
  showOnPayslip: boolean;
}

export interface InputDef {
  key: string;
  label: string;
  dataType: 'NUMBER' | 'TEXT';
  mandatory: boolean;
  minValue: string | null;
  maxValue: string | null;
}

export interface RoundingRule {
  scale: number;
  mode: RoundingMode;
  level: 'LINE' | 'TOTAL';
}

export interface CalcSettings {
  year: number;
  month: number;
  rounding: RoundingRule;
  /** Percentage change in net pay vs the previous finalised month that raises a warning (null = off). */
  unusualChangeThresholdPercent: number | null;
  /** Pro-rate FIXED earnings; lopInputKey = monthly input holding loss-of-pay days. */
  proration?: { enabled: boolean; lopInputKey: string | null };
  /** Gratuity accrual (employer cost, never deducted). */
  gratuity?: { enabled: boolean; ratePercent: number; baseComponents: string[] };
}

/** Pay days and employer costs behind one employee's result (shown on payslips). */
export interface CalcSummary {
  daysInMonth: number;
  employedDays: number;
  lopDays: string;
  payableDays: string;
  prorated: boolean;
  employerPf: string;
  employerEsi: string;
  gratuity: string;
}

export interface EmployeeCalcInput {
  employeeId: string;
  employeeCode: string;
  /** null when no salary version is effective for the payroll month */
  salaryValues: Record<string, string> | null;
  monthlyInputs: Record<string, string>;
  previousNet: string | null;
  /** Days of the payroll month the employee was employed (joining / exit); default = whole month. */
  employedDays?: number;
}

export type Severity = 'ERROR' | 'WARNING';
export interface CalcException {
  code: string;
  severity: Severity;
  message: string;
  field?: string;
}

export interface LineResult {
  componentId: string;
  componentCode: string;
  componentName: string;
  componentType: ComponentType;
  basis: Basis;
  sortOrder: number;
  showOnPayslip: boolean;
  amount: string;
  detail: Record<string, string | null>;
}

export interface EmployeeResult {
  employeeId: string;
  lines: LineResult[];
  gross: string;
  deductions: string;
  net: string;
  status: 'OK' | 'WARNING' | 'ERROR';
  exceptions: CalcException[];
  summary: CalcSummary;
}

export interface InputValidationIssue {
  inputKey: string;
  message: string;
}

/** Validates one raw monthly input value against its definition. Empty = not entered. */
export function validateInputValue(def: InputDef, raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim();
  if (value === '') return def.mandatory ? `${def.label} is required.` : null;
  if (def.dataType === 'TEXT') return value.length > 500 ? `${def.label} must be at most 500 characters.` : null;
  if (!DECIMAL_RE.test(value)) return `${def.label} must be a number (up to 6 decimal places).`;
  const n = dec(value);
  if (def.minValue !== null && n.lt(dec(def.minValue))) return `${def.label} must be at least ${def.minValue}.`;
  if (def.maxValue !== null && n.gt(dec(def.maxValue))) return `${def.label} must be at most ${def.maxValue}.`;
  return null;
}

export function calculateEmployee(
  employee: EmployeeCalcInput,
  components: ComponentDef[],
  inputDefs: InputDef[],
  settings: CalcSettings,
  formulas: FormulaRegistry,
): EmployeeResult {
  const exceptions: CalcException[] = [];
  const { scale, mode, level } = settings.rounding;
  const lineScale = level === 'LINE' ? scale : 4;
  const daysInMonth = new Date(Date.UTC(settings.year, settings.month, 0)).getUTCDate();

  // 1. Validate monthly inputs
  const numericInputs = new Map<string, Dec>();
  for (const def of inputDefs) {
    const raw = employee.monthlyInputs[def.key];
    const problem = validateInputValue(def, raw);
    if (problem) {
      exceptions.push({ code: (raw ?? '').trim() === '' ? 'MISSING_INPUT' : 'INVALID_INPUT', severity: 'ERROR', message: problem, field: def.key });
      continue;
    }
    if (def.dataType === 'NUMBER' && (raw ?? '').trim() !== '') numericInputs.set(def.key, dec(raw!.trim()));
  }

  if (employee.salaryValues === null) {
    exceptions.push({ code: 'NO_SALARY_VERSION', severity: 'ERROR', message: 'No salary structure is effective for this payroll month.' });
  }
  const values = employee.salaryValues ?? {};

  // Pay days for proration
  const employedDays = Math.max(0, Math.min(daysInMonth, employee.employedDays ?? daysInMonth));
  const lopKey = settings.proration?.lopInputKey ?? null;
  const lopRaw = lopKey ? numericInputs.get(lopKey) ?? new Dec(0) : new Dec(0);
  const lopDays = Dec.min(Dec.max(lopRaw, new Dec(0)), new Dec(employedDays));
  const payableDays = new Dec(employedDays).sub(lopDays);
  const prorate = Boolean(settings.proration?.enabled) && payableDays.lt(daysInMonth);
  if (lopRaw.gt(employedDays)) {
    exceptions.push({ code: 'LOP_EXCEEDS_DAYS', severity: 'WARNING', message: `Loss-of-pay days (${lopRaw.toString()}) exceed the ${employedDays} day(s) employed this month.`, field: lopKey ?? undefined });
  }

  // 2. Determine applicable components
  const byCode = new Map(components.map((c) => [c.code, c]));
  const applicable = components.filter((c) => {
    if (c.basis === 'INPUT') return c.inputKey !== null && numericInputs.has(c.inputKey);
    if (c.basis === 'FORMULA' && c.formulaRef && formulas[c.formulaRef]?.appliesToAll && employee.salaryValues !== null) return true;
    return Object.prototype.hasOwnProperty.call(values, c.code);
  });
  const applicableCodes = new Set(applicable.map((c) => c.code));

  // 3. Evaluate with dependency resolution and cycle detection
  const amounts = new Map<string, Dec>();
  const details = new Map<string, Record<string, string | null>>();
  const visiting = new Set<string>();
  const failed = new Set<string>();

  const evaluate = (code: string): Dec | null => {
    if (amounts.has(code)) return amounts.get(code)!;
    if (failed.has(code)) return null;
    const c = byCode.get(code);
    if (!c || !applicableCodes.has(code)) return null;
    if (visiting.has(code)) {
      exceptions.push({ code: 'CIRCULAR_DEPENDENCY', severity: 'ERROR', message: `Component ${c.name} has a circular dependency.` });
      failed.add(code);
      return null;
    }
    visiting.add(code);
    let amount: Dec | null = null;
    const detail: Record<string, string | null> = {};
    switch (c.basis) {
      case 'FIXED': {
        const v = values[code];
        amount = dec(v);
        detail.configuredValue = v;
        if (prorate && c.type === 'EARNING') {
          amount = amount.mul(payableDays).div(daysInMonth);
          detail.prorated = `${payableDays.toString()} of ${daysInMonth} days`;
        }
        break;
      }
      case 'PERCENTAGE': {
        const rateRaw = values[code] !== undefined && values[code] !== '' ? values[code] : c.defaultPercentage;
        if (!c.percentOfCode || rateRaw === null || rateRaw === undefined) {
          exceptions.push({ code: 'PERCENTAGE_NOT_CONFIGURED', severity: 'ERROR', message: `${c.name}: percentage rate or base component is not configured.` });
          break;
        }
        const base = applicableCodes.has(c.percentOfCode) ? evaluate(c.percentOfCode) : null;
        if (base === null) {
          exceptions.push({ code: 'PERCENTAGE_BASE_MISSING', severity: 'ERROR', message: `${c.name}: base component ${c.percentOfCode} is not part of this employee's salary structure.` });
          break;
        }
        amount = base.mul(dec(rateRaw)).div(100);
        detail.rate = dec(rateRaw).toString();
        detail.baseComponent = c.percentOfCode;
        detail.baseAmount = base.toString();
        break;
      }
      case 'INPUT': {
        amount = numericInputs.get(c.inputKey!)!;
        detail.inputKey = c.inputKey;
        break;
      }
      case 'FORMULA': {
        const formula = c.formulaRef ? formulas[c.formulaRef] : undefined;
        if (!formula) {
          exceptions.push({
            code: 'FORMULA_NOT_CONFIGURED',
            severity: 'ERROR',
            message: `${c.name}: formula "${c.formulaRef ?? '(none)'}" is awaiting configuration from the client's approved workbook.`,
          });
          break;
        }
        try {
          const param = values[code];
          amount = formula.evaluate({
            year: settings.year,
            month: settings.month,
            daysInMonth,
            parameter: param !== undefined && param !== '' ? dec(param) : null,
            component: (dep) => {
              const r = evaluate(dep);
              if (r === null) throw new Error(`Required component ${dep} is unavailable`);
              return r;
            },
            input: (key) => numericInputs.get(key) ?? null,
            componentOrNull: (dep) => (applicableCodes.has(dep) ? evaluate(dep) : null),
            note: (key, value) => {
              detail[key] = value;
            },
          });
          detail.formulaRef = c.formulaRef;
          detail.workbookReference = formula.workbookReference;
        } catch (e) {
          exceptions.push({ code: 'FORMULA_ERROR', severity: 'ERROR', message: `${c.name}: ${(e as Error).message}.` });
        }
        break;
      }
    }
    visiting.delete(code);
    if (amount === null) {
      failed.add(code);
      return null;
    }
    const rounded = roundTo(amount, lineScale, mode);
    amounts.set(code, rounded);
    details.set(code, detail);
    return rounded;
  };

  for (const c of applicable) evaluate(c.code);

  // 4. Totals
  let gross = new Dec(0);
  let deductions = new Dec(0);
  const lines: LineResult[] = [];
  for (const c of applicable) {
    const amount = amounts.get(c.code);
    if (amount === undefined) continue;
    if (c.type === 'EARNING') gross = gross.add(amount);
    else deductions = deductions.add(amount);
    lines.push({
      componentId: c.id,
      componentCode: c.code,
      componentName: c.name,
      componentType: c.type,
      basis: c.basis,
      sortOrder: c.sortOrder,
      showOnPayslip: c.showOnPayslip,
      amount: money(amount, lineScale),
      detail: details.get(c.code) ?? {},
    });
  }
  gross = roundTo(gross, scale, mode);
  deductions = roundTo(deductions, scale, mode);
  const net = gross.sub(deductions);

  if (net.isNegative()) exceptions.push({ code: 'NEGATIVE_NET', severity: 'WARNING', message: 'Net pay is negative.' });
  if (settings.unusualChangeThresholdPercent !== null && employee.previousNet !== null) {
    const prev = dec(employee.previousNet);
    if (!prev.isZero()) {
      const change = net.sub(prev).abs().div(prev.abs()).mul(100);
      if (change.gt(settings.unusualChangeThresholdPercent)) {
        exceptions.push({
          code: 'UNUSUAL_CHANGE',
          severity: 'WARNING',
          message: `Net pay changed by ${change.toFixed(1)}% compared with the previous finalised month.`,
        });
      }
    }
  }

  // 5. Employer costs (not part of net pay)
  const employerShare = (ref: string) =>
    lines.filter((l) => l.detail.formulaRef === ref && l.detail.employerContribution).reduce((acc, l) => acc.add(dec(l.detail.employerContribution!)), new Dec(0));
  let gratuity = new Dec(0);
  if (settings.gratuity?.enabled) {
    const base = settings.gratuity.baseComponents.reduce((acc, code) => acc.add(amounts.get(code) ?? new Dec(0)), new Dec(0));
    gratuity = roundTo(base.mul(dec(String(settings.gratuity.ratePercent))).div(100), scale, mode);
  }
  const summary: CalcSummary = {
    daysInMonth,
    employedDays,
    lopDays: lopDays.toString(),
    payableDays: payableDays.toString(),
    prorated: prorate,
    employerPf: money(employerShare('STATUTORY_PF'), scale),
    employerEsi: money(employerShare('STATUTORY_ESI'), scale),
    gratuity: money(gratuity, scale),
  };

  const status = exceptions.some((e) => e.severity === 'ERROR') ? 'ERROR' : exceptions.length ? 'WARNING' : 'OK';
  lines.sort((a, b) => a.sortOrder - b.sortOrder || a.componentCode.localeCompare(b.componentCode));
  return { employeeId: employee.employeeId, lines, gross: money(gross, scale), deductions: money(deductions, scale), net: money(net, scale), status, exceptions, summary };
}

export interface RunCalculation {
  results: EmployeeResult[];
  totals: { gross: string; deductions: string; net: string };
  hash: string;
}

/** Calculates every employee and the run totals; the hash fingerprints all inputs for determinism checks. */
export function calculateRun(
  employees: EmployeeCalcInput[],
  components: ComponentDef[],
  inputDefs: InputDef[],
  settings: CalcSettings,
  formulas: FormulaRegistry,
): RunCalculation {
  const sortedEmployees = [...employees].sort((a, b) => a.employeeCode.localeCompare(b.employeeCode));
  const results = sortedEmployees.map((e) => calculateEmployee(e, components, inputDefs, settings, formulas));
  const sum = (k: 'gross' | 'deductions' | 'net') => money(results.reduce((acc, r) => acc.add(dec(r[k])), new Dec(0)), settings.rounding.scale);
  const canonical = JSON.stringify({
    settings,
    components: [...components].sort((a, b) => a.code.localeCompare(b.code)),
    inputDefs: [...inputDefs].sort((a, b) => a.key.localeCompare(b.key)),
    employees: sortedEmployees.map((e) => ({ ...e, salaryValues: e.salaryValues && Object.fromEntries(Object.entries(e.salaryValues).sort()), monthlyInputs: Object.fromEntries(Object.entries(e.monthlyInputs).sort()) })),
    formulas: Object.keys(formulas).filter((k) => components.some((c) => c.formulaRef === k)).sort().map((k) => [k, formulas[k].fingerprint ?? null]),
  });
  return { results, totals: { gross: sum('gross'), deductions: sum('deductions'), net: sum('net') }, hash: createHash('sha256').update(canonical).digest('hex') };
}

/** Selects the salary version effective for a payroll month according to the configured rule. */
export function selectSalaryVersion<T extends { effectiveFrom: Date; effectiveTo: Date | null }>(
  versions: T[],
  year: number,
  month: number,
  rule: 'MONTH_START' | 'MONTH_END',
): T | null {
  const asOf = rule === 'MONTH_START' ? new Date(Date.UTC(year, month - 1, 1)) : new Date(Date.UTC(year, month, 0));
  const candidates = versions.filter((v) => v.effectiveFrom <= asOf && (v.effectiveTo === null || v.effectiveTo >= asOf));
  candidates.sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());
  return candidates[0] ?? null;
}

/** Days of the payroll month between the joining and exit dates (inclusive). */
export function employedDaysInMonth(e: { joiningDate: Date; exitDate: Date | null }, year: number, month: number): number {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  const from = e.joiningDate > start ? e.joiningDate : start;
  const to = e.exitDate && e.exitDate < end ? e.exitDate : end;
  return to < from ? 0 : Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
}

/** An employee is eligible when employed for at least part of the payroll month. */
export function isEligible(e: { joiningDate: Date; exitDate: Date | null; status: string }, year: number, month: number): boolean {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  if (e.status === 'INACTIVE') return false;
  if (e.joiningDate > end) return false;
  if (e.exitDate && e.exitDate < start) return false;
  return true;
}
