import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import { AppError } from './errors';
import type { UploadedFile } from './registry';

export const MAX_IMPORT_ROWS = 5000;

/**
 * Neutralises spreadsheet formula injection (CWE-1236): text that a spreadsheet
 * application would interpret as a formula is prefixed with an apostrophe.
 */
export function sanitizeCell(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export interface ParsedSheet {
  headers: string[];
  rows: Record<string, string>[];
}

function cellToText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('richText' in value) return value.richText.map((r) => r.text).join('');
    if ('result' in value) return cellToText((value as { result?: ExcelJS.CellValue }).result ?? null); // cached result only; formulas are never evaluated
    if ('text' in value) return String((value as { text: unknown }).text);
    if ('error' in value) return '';
    return '';
  }
  return String(value);
}

/** Safely parses an uploaded CSV or XLSX file into header-keyed string rows. */
export async function parseSpreadsheet(file: UploadedFile): Promise<ParsedSheet> {
  const ext = file.originalName.toLowerCase().split('.').pop();
  let headers: string[] = [];
  let rows: Record<string, string>[] = [];
  if (ext === 'xlsx') {
    const isZip = file.buffer.length > 4 && file.buffer[0] === 0x50 && file.buffer[1] === 0x4b && file.buffer[2] === 0x03 && file.buffer[3] === 0x04;
    if (!isZip) throw new AppError('UNSUPPORTED_FILE', 'The file is not a valid .xlsx workbook.');
    const wb = new ExcelJS.Workbook();
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await wb.xlsx.load(file.buffer as any);
    } catch {
      throw new AppError('UNSUPPORTED_FILE', 'The workbook could not be read. Save it again as .xlsx and retry.');
    }
    const ws = wb.worksheets[0];
    if (!ws) throw new AppError('VALIDATION_ERROR', 'The workbook has no worksheets.');
    const headerRow = ws.getRow(1);
    const colCount = ws.actualColumnCount;
    for (let c = 1; c <= colCount; c++) headers.push(cellToText(headerRow.getCell(c).value).trim());
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const rec: Record<string, string> = {};
      let any = false;
      headers.forEach((h, i) => {
        if (!h) return;
        const t = cellToText(row.getCell(i + 1).value).trim();
        if (t) any = true;
        rec[h] = t;
      });
      if (any) rows.push(rec);
    });
  } else if (ext === 'csv') {
    const text = file.buffer.toString('utf8').replace(/^﻿/, '');
    const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: 'greedy', transformHeader: (h) => h.trim() });
    headers = parsed.meta.fields ?? [];
    rows = parsed.data.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v ?? '').trim()])));
  } else {
    throw new AppError('UNSUPPORTED_FILE', 'Only .csv and .xlsx files are accepted.');
  }
  headers = headers.filter(Boolean);
  if (headers.length === 0) throw new AppError('VALIDATION_ERROR', 'The first row must contain column headings.');
  if (rows.length > MAX_IMPORT_ROWS) throw new AppError('VALIDATION_ERROR', `The file has ${rows.length} rows; the maximum per import is ${MAX_IMPORT_ROWS}.`);
  return { headers, rows };
}

export interface SheetColumn {
  header: string;
  key: string;
  width?: number;
  /** Excel number format, e.g. '#,##0.00' for money. */
  numFmt?: string;
}

export interface SheetSpec {
  name: string;
  title?: string[];
  columns: SheetColumn[];
  rows: Record<string, unknown>[];
}

/** Builds an XLSX workbook with sanitised text cells. */
export async function buildXlsx(sheets: SheetSpec[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'NexziByte';
  wb.created = new Date();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31));
    let start = 1;
    for (const line of s.title ?? []) {
      ws.getRow(start).getCell(1).value = String(sanitizeCell(line));
      ws.getRow(start).font = { bold: start === 1 };
      start++;
    }
    if (s.title?.length) start++;
    const headerRow = ws.getRow(start);
    s.columns.forEach((c, i) => {
      headerRow.getCell(i + 1).value = c.header;
      ws.getColumn(i + 1).width = c.width ?? Math.max(12, c.header.length + 2);
      if (c.numFmt) ws.getColumn(i + 1).numFmt = c.numFmt;
    });
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF401018' } };
    s.rows.forEach((r, idx) => {
      const row = ws.getRow(start + 1 + idx);
      s.columns.forEach((c, i) => {
        const v = r[c.key];
        row.getCell(i + 1).value = (v === undefined || v === null ? null : (sanitizeCell(v) as ExcelJS.CellValue));
      });
    });
  }
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

export function buildCsv(columns: SheetColumn[], rows: Record<string, unknown>[]): Buffer {
  const data = rows.map((r) => columns.map((c) => sanitizeCell(r[c.key] ?? '')));
  return Buffer.from('﻿' + Papa.unparse({ fields: columns.map((c) => c.header), data }), 'utf8');
}

/** Content-Disposition header with a safe ASCII filename. */
export function attachment(filename: string): string {
  const safe = filename.replace(/[^\w.\-]+/g, '_');
  return `attachment; filename="${safe}"`;
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
