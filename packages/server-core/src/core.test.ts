import { describe, expect, it } from 'vitest';
import { sanitizeCell, buildCsv } from './spreadsheet';
import { formatIndianAmount } from './pdf';
import { redact, diff } from './audit';
import { dec, roundTo } from './money';
import { isoDate } from './pagination';
import { parseTrustProxy } from './app';
import { createMailer, parseAddress } from './mailer';
import { SignupService } from './signup';

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

describe('deployment configuration', () => {
  it('treats numeric TRUST_PROXY values as hop counts', () => {
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy(' 2 ')).toBe(2);
    expect(parseTrustProxy(undefined)).toBe('loopback');
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('10.0.0.0/8')).toBe('10.0.0.0/8');
  });
  it('refuses an email address as SMTP_HOST instead of failing on every send', async () => {
    const silent = { info() {}, warn() {}, error() {} };
    const m = createMailer({ NODE_ENV: 'production', STORAGE_DIR: '.', SMTP_HOST: 'someone@gmail.com', SMTP_PORT: 587, SMTP_SECURE: false, MAIL_FROM: 'x@y.z' }, silent);
    expect(m.mode).toBe('disabled');
    await expect(m.send({ to: 'a@b.c', subject: 's', text: 't', html: 'h' })).rejects.toMatchObject({ code: 'CONFIGURATION_MISSING' });
  });
  it('parses sender addresses', () => {
    expect(parseAddress('NexziByte <we@nexzibyte.com>')).toEqual({ name: 'NexziByte', email: 'we@nexzibyte.com' });
    expect(parseAddress('we@nexzibyte.com')).toEqual({ email: 'we@nexzibyte.com' });
  });
});

describe('administrator sign-up switch', () => {
  it('refuses Administrator requests when ADMIN_SIGNUP is off, before touching any token', async () => {
    const untouched = new Proxy({}, { get: () => () => { throw new Error('store must not be used'); } });
    const service = new SignupService(untouched as never, untouched as never, untouched as never, {
      appName: 'Test',
      enabled: true,
      requireApproval: false,
      allowedDomains: [],
      adminSignup: 'off',
      roles: { user: 'PAYROLL_USER', admin: 'ADMIN' },
    });
    await expect(service.complete('x'.repeat(40), 'Name', 'Strong-Pass-99', null, 'ADMIN')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
