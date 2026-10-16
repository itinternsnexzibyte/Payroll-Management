import { describe, expect, it } from 'vitest';
import { Dec } from '@nexzi/server-core';
import { calculateEmployee, calculateRun, isEligible, selectSalaryVersion, type CalcSettings, type ComponentDef, type EmployeeCalcInput, type InputDef } from '../../src/payroll/engine';
import type { FormulaRegistry } from '../../src/payroll/formulas';

const comp = (o: Partial<ComponentDef> & Pick<ComponentDef, 'code' | 'type' | 'basis'>): ComponentDef => ({
  id: o.code,
  name: o.code,
  percentOfCode: null,
  defaultPercentage: null,
  inputKey: null,
  formulaRef: null,
  sortOrder: 0,
  showOnPayslip: true,
  ...o,
});

const components: ComponentDef[] = [
  comp({ code: 'BASIC', type: 'EARNING', basis: 'FIXED', sortOrder: 1 }),
  comp({ code: 'ALLOW', type: 'EARNING', basis: 'PERCENTAGE', percentOfCode: 'BASIC', defaultPercentage: '10', sortOrder: 2 }),
  comp({ code: 'EXTRA', type: 'EARNING', basis: 'INPUT', inputKey: 'EXTRA_IN', sortOrder: 3 }),
  comp({ code: 'DED', type: 'DEDUCTION', basis: 'FIXED', sortOrder: 10 }),
];
const inputDefs: InputDef[] = [
  { key: 'EXTRA_IN', label: 'Extra', dataType: 'NUMBER', mandatory: false, minValue: '0', maxValue: null },
  { key: 'NOTE', label: 'Note', dataType: 'TEXT', mandatory: false, minValue: null, maxValue: null },
];
const settings: CalcSettings = { year: 2026, month: 9, rounding: { scale: 2, mode: 'HALF_UP', level: 'LINE' }, unusualChangeThresholdPercent: null };
const emp = (o: Partial<EmployeeCalcInput> = {}): EmployeeCalcInput => ({
  employeeId: 'e1',
  employeeCode: 'E1',
  salaryValues: { BASIC: '20000', ALLOW: '15', DED: '500' },
  monthlyInputs: {},
  previousNet: null,
  ...o,
});

describe('payroll calculation engine', () => {
  it('calculates fixed, percentage and input components with gross/deductions/net', () => {
    const r = calculateEmployee(emp({ monthlyInputs: { EXTRA_IN: '1000.25' } }), components, inputDefs, settings, {});
    expect(r.status).toBe('OK');
    expect(r.lines.map((l) => [l.componentCode, l.amount])).toEqual([
      ['BASIC', '20000.00'],
      ['ALLOW', '3000.00'],
      ['EXTRA', '1000.25'],
      ['DED', '500.00'],
    ]);
    expect(r.gross).toBe('24000.25');
    expect(r.deductions).toBe('500.00');
    expect(r.net).toBe('23500.25');
  });

  it('uses the component default percentage when the employee has no specific rate', () => {
    const r = calculateEmployee(emp({ salaryValues: { BASIC: '1000', ALLOW: '' } }), components, inputDefs, settings, {});
    expect(r.lines.find((l) => l.componentCode === 'ALLOW')?.amount).toBe('100.00');
  });

  it('only includes components in the employee’s own structure', () => {
    const r = calculateEmployee(emp({ salaryValues: { BASIC: '1000' } }), components, inputDefs, settings, {});
    expect(r.lines.map((l) => l.componentCode)).toEqual(['BASIC']);
  });

  it('is decimal-exact (no floating point drift)', () => {
    const r = calculateEmployee(emp({ salaryValues: { BASIC: '0.1' }, monthlyInputs: { EXTRA_IN: '0.2' } }), components, inputDefs, settings, {});
    expect(r.gross).toBe('0.30');
  });

  it('applies the configured rounding mode', () => {
    const half = { BASIC: '100.125' };
    const up = calculateEmployee(emp({ salaryValues: half }), components, inputDefs, settings, {});
    const even = calculateEmployee(emp({ salaryValues: half }), components, inputDefs, { ...settings, rounding: { scale: 2, mode: 'HALF_EVEN', level: 'LINE' } }, {});
    expect(up.gross).toBe('100.13');
    expect(even.gross).toBe('100.12');
    const rupee = calculateEmployee(emp({ salaryValues: { BASIC: '100.5' } }), components, inputDefs, { ...settings, rounding: { scale: 0, mode: 'HALF_UP', level: 'LINE' } }, {});
    expect(rupee.gross).toBe('101');
  });

  it('distinguishes line-level and total-level rounding', () => {
    const vals = { BASIC: '10.004', DED: '0' };
    const comps = [comp({ code: 'BASIC', type: 'EARNING', basis: 'FIXED' }), comp({ code: 'B2', type: 'EARNING', basis: 'FIXED' }), comp({ code: 'DED', type: 'DEDUCTION', basis: 'FIXED' })];
    const line = calculateEmployee(emp({ salaryValues: { ...vals, B2: '10.004' } }), comps, [], settings, {});
    const total = calculateEmployee(emp({ salaryValues: { ...vals, B2: '10.004' } }), comps, [], { ...settings, rounding: { scale: 2, mode: 'HALF_UP', level: 'TOTAL' } }, {});
    expect(line.gross).toBe('20.00'); // 10.00 + 10.00
    expect(total.gross).toBe('20.01'); // round(20.008)
  });

  it('reports missing mandatory and invalid inputs as blocking errors', () => {
    const defs: InputDef[] = [{ key: 'EXTRA_IN', label: 'Extra', dataType: 'NUMBER', mandatory: true, minValue: '0', maxValue: '5000' }];
    const missing = calculateEmployee(emp(), components, defs, settings, {});
    expect(missing.status).toBe('ERROR');
    expect(missing.exceptions[0]).toMatchObject({ code: 'MISSING_INPUT', field: 'EXTRA_IN' });
    const invalid = calculateEmployee(emp({ monthlyInputs: { EXTRA_IN: '12abc' } }), components, defs, settings, {});
    expect(invalid.exceptions[0].code).toBe('INVALID_INPUT');
    const tooBig = calculateEmployee(emp({ monthlyInputs: { EXTRA_IN: '9000' } }), components, defs, settings, {});
    expect(tooBig.exceptions[0].message).toMatch(/at most 5000/);
  });

  it('flags employees without an effective salary version', () => {
    const r = calculateEmployee(emp({ salaryValues: null }), components, inputDefs, settings, {});
    expect(r.status).toBe('ERROR');
    expect(r.exceptions.map((e) => e.code)).toContain('NO_SALARY_VERSION');
  });

  it('never invents amounts for unconfigured formulas', () => {
    const comps = [...components, comp({ code: 'F', type: 'DEDUCTION', basis: 'FORMULA', formulaRef: 'CLIENT_FORMULA_X' })];
    const r = calculateEmployee(emp({ salaryValues: { BASIC: '1000', F: '' } }), comps, inputDefs, settings, {});
    expect(r.status).toBe('ERROR');
    expect(r.exceptions[0].code).toBe('FORMULA_NOT_CONFIGURED');
    expect(r.lines.find((l) => l.componentCode === 'F')).toBeUndefined();
  });

  it('evaluates a registered formula with dependency resolution', () => {
    const registry: FormulaRegistry = {
      HALF_BASIC: { label: 'test', description: 'test only', workbookReference: 'test', dependsOn: ['BASIC'], evaluate: (ctx) => ctx.component('BASIC').div(2) },
    };
    const comps = [comp({ code: 'F', type: 'EARNING', basis: 'FORMULA', formulaRef: 'HALF_BASIC', sortOrder: 0 }), ...components];
    const r = calculateEmployee(emp({ salaryValues: { BASIC: '1000', F: '' } }), comps, inputDefs, settings, registry);
    expect(r.lines.find((l) => l.componentCode === 'F')?.amount).toBe('500.00');
  });

  it('detects circular percentage dependencies', () => {
    const comps = [
      comp({ code: 'A', type: 'EARNING', basis: 'PERCENTAGE', percentOfCode: 'B' }),
      comp({ code: 'B', type: 'EARNING', basis: 'PERCENTAGE', percentOfCode: 'A' }),
    ];
    const r = calculateEmployee(emp({ salaryValues: { A: '10', B: '10' } }), comps, [], settings, {});
    expect(r.exceptions.map((e) => e.code)).toContain('CIRCULAR_DEPENDENCY');
  });

  it('warns on negative net pay and unusual month-on-month change', () => {
    const neg = calculateEmployee(emp({ salaryValues: { BASIC: '100', DED: '500' } }), components, inputDefs, settings, {});
    expect(neg.status).toBe('WARNING');
    expect(neg.exceptions[0].code).toBe('NEGATIVE_NET');
    const jump = calculateEmployee(emp({ previousNet: '10000' }), components, inputDefs, { ...settings, unusualChangeThresholdPercent: 25 }, {});
    expect(jump.exceptions.map((e) => e.code)).toContain('UNUSUAL_CHANGE');
  });

  it('is deterministic: identical inputs give identical results and hash', () => {
    const emps = [emp(), emp({ employeeId: 'e2', employeeCode: 'E2', salaryValues: { BASIC: '15000.55' } })];
    const a = calculateRun(emps, components, inputDefs, settings, {});
    const b = calculateRun([...emps].reverse(), [...components].reverse(), inputDefs, settings, {});
    expect(a).toEqual(b);
    expect(a.totals.net).toBe(new Dec('22500').add('15000.55').toFixed(2));
    const c = calculateRun([emp({ salaryValues: { BASIC: '20000.01', ALLOW: '15', DED: '500' } }), emps[1]], components, inputDefs, settings, {});
    expect(c.hash).not.toBe(a.hash);
  });
});

describe('salary version selection and eligibility', () => {
  const d = (s: string) => new Date(s + 'T00:00:00Z');
  const versions = [
    { id: 'v1', effectiveFrom: d('2025-01-01'), effectiveTo: d('2026-09-14') },
    { id: 'v2', effectiveFrom: d('2026-09-15'), effectiveTo: null },
  ];
  it('selects by month end or month start according to the rule', () => {
    expect(selectSalaryVersion(versions, 2026, 9, 'MONTH_END')?.id).toBe('v2');
    expect(selectSalaryVersion(versions, 2026, 9, 'MONTH_START')?.id).toBe('v1');
    expect(selectSalaryVersion(versions, 2026, 8, 'MONTH_END')?.id).toBe('v1');
    expect(selectSalaryVersion(versions, 2024, 12, 'MONTH_END')).toBeNull();
  });
  it('treats employees as eligible only if employed during the month', () => {
    expect(isEligible({ joiningDate: d('2026-09-20'), exitDate: null, status: 'ACTIVE' }, 2026, 9)).toBe(true);
    expect(isEligible({ joiningDate: d('2026-10-01'), exitDate: null, status: 'ACTIVE' }, 2026, 9)).toBe(false);
    expect(isEligible({ joiningDate: d('2020-01-01'), exitDate: d('2026-09-05'), status: 'EXITED' }, 2026, 9)).toBe(true);
    expect(isEligible({ joiningDate: d('2020-01-01'), exitDate: d('2026-08-31'), status: 'EXITED' }, 2026, 9)).toBe(false);
    expect(isEligible({ joiningDate: d('2020-01-01'), exitDate: null, status: 'INACTIVE' }, 2026, 9)).toBe(false);
  });
});
