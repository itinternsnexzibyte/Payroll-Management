import { buildXlsx, sanitizeCell } from '@nexzi/server-core';
import type { PayrollSettings } from '../settings';

export type BankLayout = PayrollSettings['bankExport'];

export interface BankRow {
  employeeCode: string;
  employeeName: string;
  accountHolder: string;
  accountNumber: string;
  ifsc: string;
  bankName: string | null;
  netPay: string;
}

export function formatDate(iso: string, format: BankLayout['dateFormat']): string {
  const [y, m, d] = iso.split('-');
  switch (format) {
    case 'DD/MM/YYYY':
      return `${d}/${m}/${y}`;
    case 'DD-MM-YYYY':
      return `${d}-${m}-${y}`;
    case 'DDMMYYYY':
      return `${d}${m}${y}`;
    default:
      return iso;
  }
}

/** Cell values for one row in the configured column order (all text, so leading zeros survive). */
export function rowCells(layout: BankLayout, row: BankRow, ctx: { paymentDate: string; period: string }): string[] {
  return layout.columns.map((c) => {
    switch (c.field) {
      case 'EMPLOYEE_CODE':
        return row.employeeCode;
      case 'EMPLOYEE_NAME':
        return row.employeeName;
      case 'ACCOUNT_HOLDER':
        return row.accountHolder;
      case 'ACCOUNT_NUMBER':
        return row.accountNumber;
      case 'IFSC':
        return row.ifsc;
      case 'BANK_NAME':
        return row.bankName ?? '';
      case 'NET_PAY':
        return row.netPay;
      case 'PAYMENT_DATE':
        return formatDate(ctx.paymentDate, layout.dateFormat);
      case 'PERIOD':
        return `Salary ${ctx.period}`;
      case 'FIXED':
        return c.value ?? '';
    }
  });
}

const csvField = (v: string) => {
  const s = String(sanitizeCell(v));
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Builds the bank file. CSV has no byte-order mark and uses CRLF, as bank upload portals expect. */
export async function buildBankFile(layout: BankLayout, rows: BankRow[], ctx: { paymentDate: string; period: string }): Promise<Buffer> {
  const body = rows.map((r) => rowCells(layout, r, ctx));
  if (layout.format === 'CSV') {
    const lines = [...(layout.includeHeader ? [layout.columns.map((c) => c.header)] : []), ...body];
    return Buffer.from(lines.map((l) => l.map(csvField).join(',')).join('\r\n') + '\r\n', 'utf8');
  }
  const columns = layout.columns.map((c, i) => ({ header: c.header, key: `c${i}`, width: Math.max(14, c.header.length + 2) }));
  return buildXlsx([{ name: 'Salary', columns, rows: body.map((cells) => Object.fromEntries(cells.map((v, i) => [`c${i}`, v]))) }]);
}
