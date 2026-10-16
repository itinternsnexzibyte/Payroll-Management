import { describe, expect, it } from 'vitest';
import { sanitizeCell, buildCsv } from './spreadsheet';
import { formatIndianAmount } from './pdf';
import { redact, diff } from './audit';
import { dec, roundTo } from './money';
import { isoDate } from './pagination';

describe('spreadsheet safety', () => {
  it('neutralises formula injection', () => {
    for (const bad of ['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\tx']) expect(sanitizeCell(bad)).toBe(`'${bad}`);
    expect(sanitizeCell('Normal text')).toBe('Normal text');
    expect(sanitizeCell(-5)).toBe(-5);
    expect(buildCsv([{ header: 'Name', key: 'n' }], [{ n: '=HYPERLINK("x")' }]).toString('utf8')).toContain(`"'=HYPERLINK(""x"")"`);
  });
});

describe('formatting and money', () => {
  it('formats Indian grouping without floating point', () => {
    expect(formatIndianAmount('1234567.5')).toBe('12,34,567.50');
    expect(formatIndianAmount('999')).toBe('999.00');
    expect(formatIndianAmount('-100000')).toBe('-1,00,000.00');
    expect(formatIndianAmount('12345678901234.56')).toBe('1,23,45,67,89,01,234.56');
  });
  it('rounds decimals deterministically', () => {
    expect(roundTo(dec('2.675'), 2, 'HALF_UP').toFixed(2)).toBe('2.68');
    expect(roundTo(dec('2.665'), 2, 'HALF_EVEN').toFixed(2)).toBe('2.66');
    expect(dec('0.1').add('0.2').toString()).toBe('0.3');
  });
  it('validates ISO dates strictly', () => {
    expect(isoDate.safeParse('2024-02-29').success).toBe(true);
    expect(isoDate.safeParse('2023-02-29').success).toBe(false);
    expect(isoDate.safeParse('15/10/2026').success).toBe(false);
  });
});

describe('audit redaction', () => {
  it('removes secrets and produces change summaries', () => {
    expect(redact({ email: 'a@b.c', passwordHash: 'x', nested: { token: 't', ok: 1 } })).toEqual({ email: 'a@b.c', passwordHash: '[REDACTED]', nested: { token: '[REDACTED]', ok: 1 } });
    expect(diff({ a: 1, b: 2 }, { a: 1, b: 3 })).toEqual({ before: { b: 2 }, after: { b: 3 } });
  });
});
