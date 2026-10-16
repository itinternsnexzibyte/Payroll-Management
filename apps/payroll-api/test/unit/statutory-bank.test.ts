import { describe, expect, it } from 'vitest';
import { dec } from '@nexzi/server-core';
import { DEFAULT_STATUTORY, annualTax, buildStatutoryFormulas, statutoryProblems } from '../../src/statutory/rules';
import { buildBankFile, formatDate } from '../../src/bank/file';

const tds = { ...DEFAULT_STATUTORY.tds, enabled: true, taxableComponents: ['BASIC'], slabs: [{ upTo: 300000, ratePercent: 0 }, { upTo: 700000, ratePercent: 5 }, { upTo: null, ratePercent: 10 }], cessPercent: 4 };

describe('statutory rules', () => {
  it('taxes progressively by slab with cess', () => {
    expect(annualTax(dec('250000'), tds).toString()).toBe('0');
    expect(annualTax(dec('500000'), tds).toString()).toBe('10400'); // 5% × 200000 = 10000 + 4%
    expect(annualTax(dec('1150000'), tds).toString()).toBe('67600');
  });

  it('applies the rebate limit as zero tax up to the limit', () => {
    expect(annualTax(dec('500000'), { ...tds, rebateLimit: 500000 }).toString()).toBe('0');
    expect(annualTax(dec('500001'), { ...tds, rebateLimit: 500000 }).gt(0)).toBe(true);
  });

  it('has no rates by default and reports what is missing', () => {
    expect(statutoryProblems(DEFAULT_STATUTORY)).toEqual({ PF: [], ESI: [], TDS: [] });
    const p = statutoryProblems({ ...DEFAULT_STATUTORY, pf: { ...DEFAULT_STATUTORY.pf, enabled: true } });
    expect(p.PF).toEqual(expect.arrayContaining([expect.stringMatching(/confirmed/), 'Employee PF rate is required.', 'Employer PF rate is required.']));
  });

  it('blocks calculation with a clear message while a section is off', () => {
    const f = buildStatutoryFormulas(DEFAULT_STATUTORY);
    expect(f.STATUTORY_PF.appliesToAll).toBe(false);
    const ctx = { year: 2026, month: 4, daysInMonth: 30, parameter: null, component: () => dec(0), componentOrNull: () => null, input: () => null, note: () => undefined };
    expect(() => f.STATUTORY_PF.evaluate(ctx)).toThrow(/switched off/);
  });
});

describe('bank file', () => {
  it('formats payment dates', () => {
    expect(formatDate('2026-04-30', 'DD/MM/YYYY')).toBe('30/04/2026');
    expect(formatDate('2026-04-30', 'DDMMYYYY')).toBe('30042026');
    expect(formatDate('2026-04-30', 'YYYY-MM-DD')).toBe('2026-04-30');
  });

  it('quotes commas and neutralises spreadsheet formulas', async () => {
    const layout = { format: 'CSV' as const, includeHeader: false, dateFormat: 'DD/MM/YYYY' as const, columns: [{ header: 'Name', field: 'ACCOUNT_HOLDER' as const, value: null }, { header: 'Acct', field: 'ACCOUNT_NUMBER' as const, value: null }] };
    const buf = await buildBankFile(layout, [{ employeeCode: 'E', employeeName: 'E', accountHolder: '=HYPERLINK("x"), Rao', accountNumber: '000123', ifsc: 'ABCD0123456', bankName: null, netPay: '1.00' }], { paymentDate: '2026-04-30', period: 'April 2026' });
    expect(buf.toString()).toBe(`"'=HYPERLINK(""x""), Rao",000123\r\n`);
  });
});
