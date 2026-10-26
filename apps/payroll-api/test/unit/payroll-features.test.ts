import { describe, expect, it } from 'vitest';
import { dec } from '@nexzi/server-core';
import { calculateEmployee, employedDaysInMonth, type CalcSettings, type ComponentDef, type EmployeeCalcInput } from '../../src/payroll/engine';
import { buildStatutoryFormulas, DEFAULT_STATUTORY, type StatutorySettings } from '../../src/statutory/rules';
import { applyTemplate, templateProblems } from '../../src/modules/salary-template';
import { amountInWords } from '../../src/output/templates';
import type { SalaryTemplate } from '../../src/settings';

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
  comp({ code: 'HRA', type: 'EARNING', basis: 'PERCENTAGE', percentOfCode: 'BASIC', defaultPercentage: '40', sortOrder: 2 }),
  comp({ code: 'SPECIAL', type: 'EARNING', basis: 'FIXED', sortOrder: 3 }),
  comp({ code: 'PF', type: 'DEDUCTION', basis: 'FORMULA', formulaRef: 'STATUTORY_PF', sortOrder: 10 }),
  comp({ code: 'ESI', type: 'DEDUCTION', basis: 'FORMULA', formulaRef: 'STATUTORY_ESI', sortOrder: 11 }),
];
const statutory: StatutorySettings = {
  ...DEFAULT_STATUTORY,
  confirmedBy: 'Test',
  confirmedOn: '2026-10-01',
  pf: { enabled: true, employeeRatePercent: 12, employerRatePercent: 12, wageComponents: ['BASIC'], wageCeiling: 15000, capAtCeiling: true },
  esi: { enabled: true, employeeRatePercent: 0.75, employerRatePercent: 3.25, wageComponents: ['BASIC', 'HRA', 'SPECIAL'], eligibilityLimit: 21000 },
  wageBand: { enabled: true, threshold: 20000 },
};
const settings: CalcSettings = { year: 2026, month: 10, rounding: { scale: 2, mode: 'HALF_UP', level: 'LINE' }, unusualChangeThresholdPercent: null };
const emp = (values: Record<string, string>, o: Partial<EmployeeCalcInput> = {}): EmployeeCalcInput => ({ employeeId: 'e1', employeeCode: 'E1', salaryValues: values, monthlyInputs: {}, previousNet: null, ...o });
const amount = (r: ReturnType<typeof calculateEmployee>, code: string) => r.lines.find((l) => l.componentCode === code)?.amount;

describe('PF / ESI wage band', () => {
  const formulas = buildStatutoryFormulas(statutory);
  it('deducts ESI and no PF at or below the threshold', () => {
    const r = calculateEmployee(emp({ BASIC: '10000', HRA: '40', SPECIAL: '6000' }), components, [], settings, formulas);
    expect(r.status).toBe('OK');
    expect(amount(r, 'PF')).toBe('0.00');
    expect(amount(r, 'ESI')).toBe('150.00'); // 0.75% of 20,000
    expect(r.summary.employerEsi).toBe('650.00');
    expect(r.summary.employerPf).toBe('0.00');
  });
  it('deducts PF and no ESI above the threshold', () => {
    const r = calculateEmployee(emp({ BASIC: '20000', HRA: '40', SPECIAL: '2000' }), components, [], settings, formulas);
    expect(amount(r, 'PF')).toBe('1800.00'); // 12% of the 15,000 ceiling
    expect(amount(r, 'ESI')).toBe('0.00');
    expect(r.summary.employerPf).toBe('1800.00');
  });
  it('falls back to the ESI eligibility limit when the band is off', () => {
    const off = buildStatutoryFormulas({ ...statutory, wageBand: { enabled: false, threshold: 20000 } });
    const r = calculateEmployee(emp({ BASIC: '10000', HRA: '40', SPECIAL: '6000' }), components, [], settings, off);
    expect(amount(r, 'PF')).toBe('1200.00');
    expect(amount(r, 'ESI')).toBe('150.00');
  });
});

describe('proration and gratuity', () => {
  const prorated: CalcSettings = { ...settings, proration: { enabled: true, lopInputKey: 'LOP' }, gratuity: { enabled: true, ratePercent: 4.81, baseComponents: ['BASIC'] } };
  const defs = [{ key: 'LOP', label: 'LOP', dataType: 'NUMBER' as const, mandatory: false, minValue: '0', maxValue: null }];
  it('pro-rates fixed earnings by days payable; percentage components follow their base', () => {
    const r = calculateEmployee(emp({ BASIC: '31000', HRA: '40', SPECIAL: '3100' }, { employedDays: 21, monthlyInputs: { LOP: '1' } }), components.slice(0, 3), defs, prorated, {});
    expect(r.summary).toMatchObject({ daysInMonth: 31, employedDays: 21, lopDays: '1', payableDays: '20', prorated: true });
    expect(amount(r, 'BASIC')).toBe('20000.00');
    expect(amount(r, 'HRA')).toBe('8000.00');
    expect(amount(r, 'SPECIAL')).toBe('2000.00');
    expect(r.summary.gratuity).toBe('962.00'); // 4.81% of the prorated basic
  });
  it('pays the full month when proration is off', () => {
    const r = calculateEmployee(emp({ BASIC: '31000' }, { employedDays: 10 }), components.slice(0, 1), [], settings, {});
    expect(amount(r, 'BASIC')).toBe('31000.00');
    expect(r.summary.gratuity).toBe('0.00');
  });
  it('counts days employed from the joining and exit dates', () => {
    expect(employedDaysInMonth({ joiningDate: new Date('2025-10-17'), exitDate: null }, 2025, 10)).toBe(15);
    expect(employedDaysInMonth({ joiningDate: new Date('2020-01-01'), exitDate: new Date('2026-02-10') }, 2026, 2)).toBe(10);
    expect(employedDaysInMonth({ joiningDate: new Date('2020-01-01'), exitDate: null }, 2026, 2)).toBe(28);
  });
});

describe('salary structure template', () => {
  const rows = [
    { id: 'b', code: 'BASIC', name: 'Basic', type: 'EARNING', basis: 'FIXED', percentOfCode: null, defaultPercentage: null, active: true, sortOrder: 1 },
    { id: 'h', code: 'HRA', name: 'HRA', type: 'EARNING', basis: 'PERCENTAGE', percentOfCode: 'BASIC', defaultPercentage: dec(40), active: true, sortOrder: 2 },
    { id: 's', code: 'SPECIAL', name: 'Special', type: 'EARNING', basis: 'FIXED', percentOfCode: null, defaultPercentage: null, active: true, sortOrder: 3 },
    { id: 'p', code: 'PT', name: 'Professional tax', type: 'DEDUCTION', basis: 'FIXED', percentOfCode: null, defaultPercentage: null, active: true, sortOrder: 9 },
  ] as unknown as Parameters<typeof applyTemplate>[1];
  const template: SalaryTemplate = {
    enabled: true,
    lines: [
      { code: 'BASIC', method: 'PERCENT_OF_GROSS', value: 50 },
      { code: 'HRA', method: 'RATE', value: null },
      { code: 'PT', method: 'AMOUNT', value: 200 },
      { code: 'SPECIAL', method: 'BALANCE', value: null },
    ],
  };
  it('splits a monthly gross so earnings add up exactly', () => {
    const r = applyTemplate(template, rows, dec('125000'));
    expect(r.problems).toEqual([]);
    expect(r.lines.map((l) => [l.code, l.value, l.amount])).toEqual([
      ['BASIC', '62500', '62500.00'],
      ['HRA', '40', '25000.00'],
      ['SPECIAL', '37500', '37500.00'],
      ['PT', '200', '200.00'],
    ]);
    expect(r.earnings).toBe('125000.00');
    expect(r.net).toBe('124800.00');
  });
  it('absorbs rounding in the balancing component', () => {
    const r = applyTemplate({ ...template, lines: template.lines.map((l) => (l.code === 'BASIC' ? { ...l, value: 46.6667 } : l)) }, rows, dec('33333.33'));
    expect(r.earnings).toBe('33333.33');
  });
  it('reports configuration problems instead of inventing values', () => {
    expect(templateProblems({ enabled: true, lines: [{ code: 'NOPE', method: 'AMOUNT', value: 1 }] }, rows)).toContain('Template component NOPE does not exist.');
    expect(templateProblems({ enabled: true, lines: [{ code: 'HRA', method: 'AMOUNT', value: 1 }] }, rows).join(' ')).toMatch(/only fixed components/);
    const over = applyTemplate({ enabled: true, lines: [{ code: 'BASIC', method: 'AMOUNT', value: 200000 }, { code: 'SPECIAL', method: 'BALANCE', value: null }] }, rows, dec('100000'));
    expect(over.problems[0]).toMatch(/exceed the gross/);
  });
});

describe('net pay in words', () => {
  it('uses the Indian numbering system', () => {
    expect(amountInWords('110000.00')).toBe('One Lakh Ten Thousand Rupees only');
    expect(amountInWords('12345678.50')).toBe('One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Rupees and Fifty Paise only');
    expect(amountInWords('0.00')).toBe('Zero Rupees only');
  });
});
