import { XLSX_MIME, attachment, buildXlsx, renderPdf, type SheetColumn } from '@nexzi/server-core';
import type { Response } from 'express';
import { renderReportHtml, type ReportData } from './templates';

export function sendPdf(res: Response, pdf: Buffer, filename: string, inline: boolean) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', inline ? `inline; filename="${filename.replace(/[^\w.\-]+/g, '_')}"` : attachment(filename));
  res.send(pdf);
}

/** Returns the report as JSON, or streams it as PDF / XLSX. */
export async function sendReport(res: Response, format: 'json' | 'pdf' | 'xlsx', report: ReportData, filename: string) {
  if (format === 'json') return report;
  if (format === 'pdf') {
    const pdf = await renderPdf(renderReportHtml(report), { landscape: report.columns.length > 7, footerText: report.title });
    sendPdf(res, pdf, `${filename}.pdf`, false);
    return;
  }
  const cols: SheetColumn[] = report.columns.map((c) => ({ header: c.header, key: c.key, width: c.numeric ? 14 : 22, numFmt: c.numeric ? '#,##0.00' : undefined }));
  const toCell = (row: Record<string, string | number | null>) =>
    Object.fromEntries(report.columns.map((c) => [c.key, c.numeric && row[c.key] !== null && row[c.key] !== '' ? Number(row[c.key]) : row[c.key]]));
  const rows = report.rows.map(toCell);
  if (report.totals) rows.push(toCell(report.totals));
  const buf = await buildXlsx([{ name: report.title.slice(0, 31), title: [report.title, report.subtitle, ...report.banners], columns: cols, rows }]);
  res.setHeader('Content-Type', XLSX_MIME);
  res.setHeader('Content-Disposition', attachment(`${filename}.xlsx`));
  res.send(buf);
}
