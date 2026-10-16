import { createTemplateEngine } from '@nexzi/server-core';

const hb = createTemplateEngine();

/**
 * INTERNAL PROVISIONAL PAYSLIP LAYOUT.
 * The client's approved payslip format has not been supplied. This layout only presents the
 * calculated snapshot clearly; replace it with the approved format (fixed wording, logo, field
 * order) once received, and obtain written approval of a rendered sample before go-live.
 */
const PAYSLIP_CSS = `
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1f1f1f; font-size: 11px; margin: 0; }
  .slip { page-break-after: always; padding: 4mm 0; position: relative; }
  .slip:last-child { page-break-after: auto; }
  .banner { border: 1px solid #b45309; background: #fff7ed; color: #7c2d12; padding: 6px 8px; font-size: 10px; margin-bottom: 8px; }
  .head { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #401018; padding-bottom: 6px; margin-bottom: 10px; }
  .company { font-size: 16px; font-weight: bold; color: #401018; }
  .title { font-size: 13px; font-weight: bold; text-align: right; }
  table { width: 100%; border-collapse: collapse; }
  .info td { padding: 3px 4px; border: 1px solid #d9c3c7; }
  .info td.k { background: #f8eef0; width: 18%; font-weight: bold; }
  .cols { display: flex; gap: 10px; margin-top: 10px; }
  .cols > div { flex: 1; }
  .amounts th, .amounts td { border: 1px solid #d9c3c7; padding: 4px 6px; }
  .amounts th { background: #401018; color: #fff; text-align: left; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .tot td { font-weight: bold; background: #f8eef0; }
  .net { margin-top: 10px; border: 2px solid #401018; padding: 8px; display: flex; justify-content: space-between; font-size: 13px; font-weight: bold; }
  .foot { margin-top: 14px; font-size: 9px; color: #555; }
  .wm { position: absolute; top: 45%; left: 0; right: 0; text-align: center; font-size: 46px; color: rgba(183,123,134,0.18); transform: rotate(-18deg); font-weight: bold; pointer-events: none; }
`;

const PAYSLIP_BODY = `
{{#each slips}}
<section class="slip">
  {{#if ../watermark}}<div class="wm">{{../watermark}}</div>{{/if}}
  {{#each ../banners}}<div class="banner">{{this}}</div>{{/each}}
  <div class="head">
    <div class="company">{{../companyName}}</div>
    <div class="title">Payslip for {{../period}}</div>
  </div>
  <table class="info">
    <tr><td class="k">Employee ID</td><td>{{employeeCode}}</td><td class="k">Employee Name</td><td>{{employeeName}}</td></tr>
    <tr><td class="k">Department</td><td>{{department}}</td><td class="k">Designation</td><td>{{designation}}</td></tr>
  </table>
  <div class="cols">
    <div>
      <table class="amounts">
        <tr><th>Earnings</th><th class="num">Amount</th></tr>
        {{#each earnings}}<tr><td>{{name}}</td><td class="num">{{money amount}}</td></tr>{{/each}}
        <tr class="tot"><td>Gross Earnings</td><td class="num">{{money gross}}</td></tr>
      </table>
    </div>
    <div>
      <table class="amounts">
        <tr><th>Deductions</th><th class="num">Amount</th></tr>
        {{#each deductions}}<tr><td>{{name}}</td><td class="num">{{money amount}}</td></tr>{{/each}}
        {{#unless deductions.length}}<tr><td colspan="2">—</td></tr>{{/unless}}
        <tr class="tot"><td>Total Deductions</td><td class="num">{{money totalDeductions}}</td></tr>
      </table>
    </div>
  </div>
  <div class="net"><span>Net Pay</span><span>{{money net}}</span></div>
  <div class="foot">Generated {{../generatedAt}} · Payroll run status: {{../runStatus}} · This is a system-generated document.</div>
</section>
{{/each}}`;

const payslipTemplate = hb.compile(`<!doctype html><html><head><meta charset="utf-8"><style>${PAYSLIP_CSS}</style></head><body>${PAYSLIP_BODY}</body></html>`);

export interface PayslipData {
  companyName: string;
  period: string;
  runStatus: string;
  generatedAt: string;
  watermark: string | null;
  banners: string[];
  slips: {
    employeeCode: string;
    employeeName: string;
    department: string | null;
    designation: string | null;
    earnings: { name: string; amount: string }[];
    deductions: { name: string; amount: string }[];
    gross: string;
    totalDeductions: string;
    net: string;
  }[];
}

export const renderPayslipHtml = (data: PayslipData) => payslipTemplate(data);

const REPORT_CSS = `
  body { font-family: Arial, Helvetica, sans-serif; color: #1f1f1f; font-size: 10px; margin: 0; }
  h1 { font-size: 15px; color: #401018; margin: 0 0 2px; }
  .sub { color: #555; margin-bottom: 8px; }
  .banner { border: 1px solid #b45309; background: #fff7ed; color: #7c2d12; padding: 5px 8px; margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #d9c3c7; padding: 3px 5px; }
  th { background: #401018; color: #fff; text-align: left; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  tfoot td { font-weight: bold; background: #f8eef0; }
`;

const reportTemplate = hb.compile(`<!doctype html><html><head><meta charset="utf-8"><style>${REPORT_CSS}</style></head><body>
<h1>{{title}}</h1><div class="sub">{{subtitle}}</div>
{{#each banners}}<div class="banner">{{this}}</div>{{/each}}
<table><thead><tr>{{#each columns}}<th class="{{#if numeric}}num{{/if}}">{{header}}</th>{{/each}}</tr></thead>
<tbody>{{#each rows}}<tr>{{#each this}}<td class="{{#if numeric}}num{{/if}}">{{#if numeric}}{{money value}}{{else}}{{value}}{{/if}}</td>{{/each}}</tr>{{/each}}</tbody>
{{#if totals}}<tfoot><tr>{{#each totals}}<td class="{{#if numeric}}num{{/if}}">{{#if numeric}}{{money value}}{{else}}{{value}}{{/if}}</td>{{/each}}</tr></tfoot>{{/if}}
</table></body></html>`);

export interface ReportColumn {
  header: string;
  key: string;
  numeric?: boolean;
}

export interface ReportData {
  title: string;
  subtitle: string;
  banners: string[];
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
  totals?: Record<string, string | number | null>;
}

export function renderReportHtml(d: ReportData): string {
  const cells = (row: Record<string, unknown>) => d.columns.map((c) => ({ value: row[c.key] ?? '', numeric: c.numeric }));
  return reportTemplate({ title: d.title, subtitle: d.subtitle, banners: d.banners, columns: d.columns, rows: d.rows.map(cells), totals: d.totals ? cells(d.totals) : null });
}
