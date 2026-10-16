import { describe, expect, it } from 'vitest';
import { DEFAULT_ANOMALY_RULES, detectAnomalies, normaliseName, type EmployeeResult, type LineSnapshot, type PeriodResult } from '../../src/anomalies/rules';

const line = (code: string, amount: string, basis: LineSnapshot['basis'] = 'FIXED', type: LineSnapshot['type'] = 'EARNING'): LineSnapshot => ({ code, name: code === 'BASIC' ? 'Basic' : code, type, basis, amount });
const emp = (id: string, net: string, lines: LineSnapshot[], extra: Partial<EmployeeResult> = {}): EmployeeResult => ({ employeeId: id, code: id.toUpperCase(), name: `Person ${id}`, salaryVersionId: 'v1', net, lines, ...extra });
const period = (label: string, employees: EmployeeResult[]): PeriodResult => ({ period: label, employees: new Map(employees.map((e) => [e.employeeId, e])) });
const rules = DEFAULT_ANOMALY_RULES;

describe('anomaly rules', () => {
  it('flags a large net-pay change and explains it with both amounts and the threshold', () => {
    const prev = period('Aug 2026', [emp('a', '40000', [line('BASIC', '40000')])]);
    const cur = period('Sep 2026', [emp('a', '52000', [line('BASIC', '40000'), line('BONUS', '12000', 'INPUT')])]);
    const found = detectAnomalies(cur, prev, [prev], rules).filter((d) => d.rule === 'NET_CHANGE');
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe('MEDIUM');
    expect(found[0].message).toContain('40,000.00 in Aug 2026');
    expect(found[0].message).toContain('52,000.00 (+30.0%)');
    expect(found[0].message).toContain('20% alert level');
    expect(found[0].details).toMatchObject({ previous: '40000.00', current: '52000.00', changePercent: '30.00', threshold: 20 });
  });

  it('is quiet when changes stay below the thresholds or the minimum amount', () => {
    const prev = period('Aug 2026', [emp('a', '40000', [line('BASIC', '40000')]), emp('b', '300', [line('BASIC', '300')])]);
    const cur = period('Sep 2026', [emp('a', '44000', [line('BASIC', '44000')]), emp('b', '360', [line('BASIC', '360')])]);
    // a: +10% (< 20% net, < 25% component); b: +20% net but only 60 in value (< minimum 100)
    expect(detectAnomalies(cur, prev, [prev], rules)).toEqual([]);
  });

  it('lowers severity and says why when the salary structure changed', () => {
    const prev = period('Aug 2026', [emp('a', '20000', [line('BASIC', '20000')], { salaryVersionId: 'v1' })]);
    const cur = period('Sep 2026', [emp('a', '30000', [line('BASIC', '30000')], { salaryVersionId: 'v2', salaryVersionNo: 2, salaryEffectiveFrom: '2026-09-01' })]);
    const found = detectAnomalies(cur, prev, [prev], rules);
    const net = found.find((d) => d.rule === 'NET_CHANGE')!;
    expect(net.severity).toBe('MEDIUM'); // +50% would be HIGH, lowered one level
    expect(net.message).toContain('salary structure changed since Aug 2026 (version 2, effective 2026-09-01)');
    expect(found.find((d) => d.rule === 'COMPONENT_CHANGE')!.severity).toBe('LOW');
  });

  it('detects new and missing structure components but not monthly-entered ones', () => {
    const prev = period('Aug 2026', [emp('a', '25000', [line('BASIC', '20000'), line('HRA', '5000'), line('BONUS', '1000', 'INPUT')])]);
    const cur = period('Sep 2026', [emp('a', '23000', [line('BASIC', '20000'), line('SPECIAL', '3000')])]);
    const rulesFound = detectAnomalies(cur, prev, [prev], rules).map((d) => `${d.rule}:${d.componentCode}`);
    expect(rulesFound).toContain('COMPONENT_NEW:SPECIAL');
    expect(rulesFound).toContain('COMPONENT_REMOVED:HRA');
    expect(rulesFound).not.toContain('COMPONENT_REMOVED:BONUS');
  });

  it('compares monthly amounts with the employee’s own history', () => {
    const hist = ['Aug', 'Jul', 'Jun', 'May'].map((m, i) => period(`${m} 2026`, [emp('a', '20000', [line('BASIC', '20000'), line('OT', String(1000 + i * 500), 'INPUT')])]));
    const cur = period('Sep 2026', [emp('a', '31000', [line('BASIC', '20000'), line('OT', '11000', 'INPUT')])]);
    const found = detectAnomalies(cur, hist[0], hist, rules).find((d) => d.rule === 'ADJUSTMENT_OUTLIER')!;
    expect(found.message).toContain('at most 2,500.00');
    expect(found.message).toContain('May 2026 – Aug 2026');
    expect(found.severity).toBe('HIGH'); // 11000 > 2 × (2 × 2500)
    expect(found.details).toMatchObject({ historicalMax: '2500.00', monthsChecked: 4 });
  });

  it('needs enough history before judging a monthly amount', () => {
    const hist = [period('Aug 2026', [emp('a', '20000', [line('BASIC', '20000'), line('OT', '100', 'INPUT')])])];
    const cur = period('Sep 2026', [emp('a', '29000', [line('BASIC', '20000'), line('OT', '9000', 'INPUT')])]);
    expect(detectAnomalies(cur, hist[0], hist, rules).some((d) => d.rule === 'ADJUSTMENT_OUTLIER')).toBe(false);
  });

  it('flags a first-time monthly amount and a repeated identical adjustment', () => {
    const hist = ['Aug', 'Jul', 'Jun'].map((m) => period(`${m} 2026`, [emp('a', '20000', [line('BASIC', '20000'), line('ADV', m === 'Aug' ? '2000' : '0', 'INPUT', 'DEDUCTION')]), emp('b', '20000', [line('BASIC', '20000')])]));
    const cur = period('Sep 2026', [emp('a', '18000', [line('BASIC', '20000'), line('ADV', '2000', 'INPUT', 'DEDUCTION')]), emp('b', '25000', [line('BASIC', '20000'), line('ADV', '5000', 'INPUT')])]);
    const found = detectAnomalies(cur, hist[0], hist, rules);
    expect(found.find((d) => d.rule === 'REPEATED_ADJUSTMENT')).toMatchObject({ employeeId: 'a', componentCode: 'ADV', severity: 'LOW' });
    expect(found.find((d) => d.rule === 'ADJUSTMENT_FIRST_TIME')).toMatchObject({ employeeId: 'b' });
  });

  it('flags possible duplicate employees by normalised name', () => {
    expect(normaliseName('  R. Chowdary ')).toBe(normaliseName('r chowdary'));
    const cur = period('Sep 2026', [emp('a', '1', [], { name: 'Ravi Kumar', code: 'E1' }), emp('b', '1', [], { name: 'ravi  kumar.', code: 'E2' }), emp('c', '1', [], { name: 'Someone Else', code: 'E3' })]);
    const dups = detectAnomalies(cur, null, [], rules).filter((d) => d.rule === 'DUPLICATE_EMPLOYEE');
    expect(dups.map((d) => d.employeeId).sort()).toEqual(['a', 'b']);
    expect(dups[0].severity).toBe('HIGH');
    expect(dups.find((d) => d.employeeId === 'a')!.message).toContain('ravi  kumar. (E2)');
  });

  it('is deterministic: same inputs give the same fingerprints and signatures', () => {
    const prev = period('Aug 2026', [emp('a', '40000', [line('BASIC', '40000')])]);
    const cur = period('Sep 2026', [emp('a', '60000', [line('BASIC', '60000')])]);
    const a = detectAnomalies(cur, prev, [prev], rules);
    const b = detectAnomalies(cur, prev, [prev], rules);
    expect(a.map((d) => d.fingerprint + d.signature)).toEqual(b.map((d) => d.fingerprint + d.signature));
    const changed = detectAnomalies(period('Sep 2026', [emp('a', '70000', [line('BASIC', '70000')])]), prev, [prev], rules);
    expect(changed[0].fingerprint).toBe(a[0].fingerprint);
    expect(changed[0].signature).not.toBe(a[0].signature);
  });

  it('can be switched off', () => {
    const prev = period('Aug 2026', [emp('a', '1000', [line('BASIC', '1000')])]);
    const cur = period('Sep 2026', [emp('a', '9000', [line('BASIC', '9000')])]);
    expect(detectAnomalies(cur, prev, [prev], { ...rules, enabled: false })).toEqual([]);
  });
});
