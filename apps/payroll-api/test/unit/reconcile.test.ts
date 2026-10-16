import { describe, expect, it } from 'vitest';
import { explanationStatus, reconcile } from '../../src/reconciliation/compare';
import type { RunEmployeeResult, RunResult } from '../../src/analysis/run-data';
import type { LineSnapshot } from '../../src/anomalies/rules';

const l = (code: string, amount: string, type: LineSnapshot['type'] = 'EARNING'): LineSnapshot => ({ code, name: code, type, basis: 'FIXED', amount });
const e = (id: string, dept: string, lines: LineSnapshot[]): RunEmployeeResult => {
  const gross = lines.filter((x) => x.type === 'EARNING').reduce((a, x) => a + Number(x.amount), 0);
  const ded = lines.filter((x) => x.type === 'DEDUCTION').reduce((a, x) => a + Number(x.amount), 0);
  return { employeeId: id, code: id.toUpperCase(), name: `Name ${id}`, departmentName: dept, salaryVersionId: 'v', gross: String(gross), deductions: String(ded), net: String(gross - ded), resultStatus: 'OK', lines };
};
const run = (period: string, emps: RunEmployeeResult[]): RunResult => ({ runId: period, year: 2026, month: 1, status: 'FINALISED', rulesApproved: false, period, employees: new Map(emps.map((x) => [x.employeeId, x])) });

describe('reconciliation', () => {
  const base = run('Aug 2026', [e('a', 'Sales', [l('BASIC', '20000'), l('PF', '2400', 'DEDUCTION')]), e('b', 'Ops', [l('BASIC', '15000')]), e('c', 'Ops', [l('BASIC', '10000')])]);
  const compare = run('Sep 2026', [e('a', 'Sales', [l('BASIC', '22000'), l('PF', '2640', 'DEDUCTION'), l('BONUS', '1000')]), e('b', 'Ops', [l('BASIC', '15000')]), e('d', 'Sales', [l('BASIC', '12000')])]);
  const rec = reconcile(base, compare);

  it('classifies employees as new, missing, changed or unchanged', () => {
    const by = Object.fromEntries(rec.employees.map((x) => [x.employeeId, x.change]));
    expect(by).toEqual({ a: 'CHANGED', b: 'UNCHANGED', c: 'MISSING', d: 'NEW' });
    expect(rec.counts).toEqual({ NEW: 1, MISSING: 1, CHANGED: 1, UNCHANGED: 1 });
  });

  it('shows absolute and percentage differences per employee and component', () => {
    const a = rec.employees.find((x) => x.employeeId === 'a')!;
    expect(a.difference).toEqual({ gross: '3000.00', deductions: '240.00', net: '2760.00' });
    expect(a.netChangePercent).toBe('15.68'); // 2760 / 17600
    expect(a.components.find((c) => c.code === 'BASIC')).toMatchObject({ base: '20000.00', compare: '22000.00', difference: '2000.00', changePercent: '10.00', change: 'CHANGED' });
    expect(a.components.find((c) => c.code === 'BONUS')).toMatchObject({ base: null, compare: '1000.00', change: 'NEW', changePercent: null });
    const c = rec.employees.find((x) => x.employeeId === 'c')!;
    expect(c.compare).toBeNull();
    expect(c.difference.net).toBe('-10000.00');
  });

  it('totals the runs and the components exactly (decimal arithmetic)', () => {
    expect(rec.totals.base).toEqual({ gross: '45000.00', deductions: '2400.00', net: '42600.00' });
    expect(rec.totals.compare).toEqual({ gross: '50000.00', deductions: '2640.00', net: '47360.00' });
    expect(rec.totals.difference.net).toBe('4760.00');
    expect(rec.components.find((x) => x.code === 'BASIC')).toMatchObject({ base: '45000.00', compare: '49000.00', difference: '4000.00' });
    expect(rec.components.map((x) => x.type)).toEqual(['EARNING', 'EARNING', 'DEDUCTION']);
  });

  it('treats differences as unresolved until explained', () => {
    expect(explanationStatus('CHANGED', undefined)).toBe('UNEXPLAINED');
    expect(explanationStatus('NEW', 'EXPECTED')).toBe('EXPECTED');
    expect(explanationStatus('CHANGED', 'DISCREPANCY')).toBe('DISCREPANCY');
    expect(explanationStatus('UNCHANGED', undefined)).toBeNull();
  });
});
