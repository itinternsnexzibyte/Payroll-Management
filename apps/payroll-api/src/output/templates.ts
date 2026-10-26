import { createTemplateEngine } from '@nexzi/server-core';

const hb = createTemplateEngine();

/**
 * Payslip layout: company letterhead with logo and brand colours, employee and bank details,
 * pay days, earnings (A), statutory contributions (B), taxes and deductions (C), net pay
 * (A − B − C) in figures and words, and employer costs (PF, ESI, gratuity) that are not deducted.
 * Colours and logo come from Payroll settings → Payslip branding.
 */
const PAYSLIP_CSS = `
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, Helvetica, sans-serif; color: #1f2937; font-size: 11px; margin: 0; }
  .slip { page-break-after: always; padding: 2mm 1mm; position: relative; }
  .slip:last-child { page-break-after: auto; }
  .banner { border: 1px solid #b45309; background: #fff7ed; color: #7c2d12; padding: 5px 8px; font-size: 9.5px; margin-bottom: 6px; border-radius: 4px; }
  .bar { height: 6px; border-radius: 3px; background: linear-gradient(90deg, var(--p), var(--a)); margin-bottom: 14px; }
  .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
  .title { font-size: 28px; font-weight: 800; letter-spacing: .5px; color: var(--p); line-height: 1; }
  .title span { font-weight: 400; color: #4b5563; }
  .logo { max-height: 52px; max-width: 210px; object-fit: contain; }
  .company { margin-top: 12px; font-size: 13px; font-weight: 600; color: #111827; text-transform: uppercase; }
  .addr { font-size: 10px; color: #374151; white-space: pre-line; margin-top: 3px; text-transform: uppercase; line-height: 1.45; }
  .emp { margin-top: 18px; font-size: 14px; font-weight: 700; text-transform: uppercase; padding-bottom: 7px; border-bottom: 2px solid var(--p); }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); }
  .grid > div { padding: 7px 4px 8px 0; border-bottom: 1px solid #e5e7eb; }
  .grid.last > div { border-bottom: 2px solid var(--p); }
  .k { color: #6b7280; font-size: 9.5px; }
  .v { font-size: 11.5px; margin-top: 3px; color: #111827; word-break: break-all; }
  .section { margin-top: 18px; font-size: 12px; font-weight: 600; letter-spacing: .3px; padding-bottom: 6px; border-bottom: 2px solid var(--p); color: var(--p); }
  .cols { display: flex; margin-top: 12px; }
  .cols > div { flex: 1; padding: 0 14px 0 2px; }
  .cols > div + div { border-left: 1px solid #d1d5db; padding: 0 2px 0 14px; }
  h3 { font-size: 12px; margin: 0 0 6px; color: var(--p); text-transform: uppercase; letter-spacing: .3px; }
  h3.gap { margin-top: 14px; }
  .row { display: flex; justify-content: space-between; padding: 3px 0; font-size: 11.5px; }
  .row.tot { font-weight: 700; border-top: 1px solid #e5e7eb; margin-top: 3px; padding-top: 5px; }
  .num { font-variant-numeric: tabular-nums; text-align: right; }
  .muted { color: #9ca3af; font-style: italic; }
  .net { margin-top: 16px; background: #f4f3fb; border-left: 4px solid var(--a); border-radius: 4px; padding: 10px 16px; }
  .net .row { font-size: 12px; padding: 4px 0; }
  .net .big { font-size: 15px; font-weight: 800; color: var(--p); }
  .net .words { font-weight: 700; }
  .employer { margin-top: 12px; border: 1px dashed #c7cbe0; border-radius: 4px; padding: 8px 12px; }
  .employer .grid > div { border-bottom: 0; padding: 2px 4px 2px 0; }
  .employer h3 { font-size: 10.5px; margin-bottom: 4px; }
  .note { margin-top: 14px; font-size: 11px; }
  .foot { margin-top: 10px; font-size: 9px; color: #6b7280; font-style: italic; }
  .wm { position: absolute; top: 45%; left: 0; right: 0; text-align: center; font-size: 46px; color: rgba(120,120,160,0.16); transform: rotate(-18deg); font-weight: bold; pointer-events: none; }
`;

const AMOUNT_ROWS = `{{#each this}}<div class="row"><span>{{name}}</span><span class="num">{{money amount}}</span></div>{{/each}}`;

const PAYSLIP_BODY = `
{{#each slips}}
<section class="slip">
  {{#if ../watermark}}<div class="wm">{{../watermark}}</div>{{/if}}
  {{#each ../banners}}<div class="banner">{{this}}</div>{{/each}}
  <div class="bar"></div>
  <div class="top">
    <div>
      <div class="title">PAYSLIP <span>{{../periodShort}}</span></div>
      <div class="company">{{../companyName}}</div>
      {{#if ../companyAddress}}<div class="addr">{{../companyAddress}}</div>{{/if}}
    </div>
    {{#if ../logoDataUrl}}<img class="logo" src="{{../logoDataUrl}}" alt="">{{/if}}
  </div>
  <div class="emp">{{employeeName}}</div>
  <div class="grid">
    <div><div class="k">Employee Number</div><div class="v">{{employeeCode}}</div></div>
    <div><div class="k">Date Joined</div><div class="v">{{dateJoined}}</div></div>
    <div><div class="k">Department</div><div class="v">{{department}}</div></div>
    <div><div class="k">Reporting Manager</div><div class="v">{{manager}}</div></div>
  </div>
  <div class="grid">
    <div><div class="k">Designation</div><div class="v">{{designation}}</div></div>
    <div><div class="k">Payment Mode</div><div class="v">{{paymentMode}}</div></div>
    <div><div class="k">Bank</div><div class="v">{{bankName}}</div></div>
    <div><div class="k">Bank IFSC</div><div class="v">{{ifsc}}</div></div>
  </div>
  <div class="grid last">
    <div><div class="k">Bank Account</div><div class="v">{{bankAccount}}</div></div>
    <div><div class="k">UAN</div><div class="v">{{uan}}</div></div>
    <div><div class="k">PF Number</div><div class="v">{{pfNumber}}</div></div>
    <div><div class="k">PAN Number</div><div class="v">{{pan}}</div></div>
  </div>

  <div class="section">SALARY DETAILS</div>
  <div class="grid">
    <div><div class="k">Actual Payable Days</div><div class="v">{{days.daysInMonth}}</div></div>
    <div><div class="k">Total Working Days</div><div class="v">{{days.employedDays}}</div></div>
    <div><div class="k">Loss Of Pay Days</div><div class="v">{{days.lopDays}}</div></div>
    <div><div class="k">Days Payable</div><div class="v">{{days.payableDays}}</div></div>
  </div>

  <div class="cols">
    <div>
      <h3>Earnings</h3>
      {{#with earnings}}${AMOUNT_ROWS}{{/with}}
      <div class="row tot"><span>Total Earnings (A)</span><span class="num">{{money gross}}</span></div>
    </div>
    <div>
      <h3>Contributions</h3>
      {{#if contributions.length}}{{#with contributions}}${AMOUNT_ROWS}{{/with}}{{else}}<div class="row muted"><span>None this month</span><span></span></div>{{/if}}
      <div class="row tot"><span>Total Contributions (B)</span><span class="num">{{money totalContributions}}</span></div>
      <h3 class="gap">Taxes &amp; Deductions</h3>
      {{#if deductions.length}}{{#with deductions}}${AMOUNT_ROWS}{{/with}}{{else}}<div class="row muted"><span>None this month</span><span></span></div>{{/if}}
      <div class="row tot"><span>Total Taxes &amp; Deductions (C)</span><span class="num">{{money totalOtherDeductions}}</span></div>
    </div>
  </div>

  <div class="net">
    <div class="row"><span>Net Salary Payable ( A - B - C )</span><span class="num big">{{money net}}</span></div>
    <div class="row"><span>Net Salary in words</span><span class="words">{{netInWords}}</span></div>
  </div>

  {{#if employer.show}}
  <div class="employer">
    <h3>Employer contributions — paid by the company, not deducted from your pay</h3>
    <div class="grid">
      <div><div class="k">Employer PF</div><div class="v">{{money employer.pf}}</div></div>
      <div><div class="k">Employer ESI</div><div class="v">{{money employer.esi}}</div></div>
      <div><div class="k">Gratuity (accrued this month)</div><div class="v">{{money employer.gratuity}}</div></div>
      <div><div class="k">Cost to company (month)</div><div class="v">{{money employer.ctc}}</div></div>
    </div>
  </div>
  {{/if}}

  <div class="note"><b>**Note :</b> &nbsp;&nbsp;<i>All amounts displayed in this payslip are in <b>INR</b></i></div>
  <div class="foot">* This is computer generated statement, does not require signature. · Generated {{../generatedAt}} · Payroll status: {{../runStatus}}</div>
</section>
{{/each}}`;

const payslipTemplate = hb.compile(
  `<!doctype html><html><head><meta charset="utf-8"><style>${PAYSLIP_CSS}</style></head><body style="--p: {{primaryColor}}; --a: {{accentColor}};">${PAYSLIP_BODY}</body></html>`,
);

export interface PayslipAmount {
  name: string;
  amount: string;
}

export interface PayslipData {
  companyName: string;
  companyAddress: string | null;
  logoDataUrl: string | null;
  primaryColor: string;
  accentColor: string;
  period: string;
  /** e.g. "OCT 2025" */
  periodShort: string;
  runStatus: string;
  generatedAt: string;
  watermark: string | null;
  banners: string[];
  slips: {
    employeeCode: string;
    employeeName: string;
    department: string | null;
    designation: string | null;
    dateJoined: string;
    manager: string;
    paymentMode: string;
    bankName: string;
    ifsc: string;
    bankAccount: string;
    uan: string;
    pfNumber: string;
    pan: string;
    days: { daysInMonth: string; employedDays: string; lopDays: string; payableDays: string };
    earnings: PayslipAmount[];
    contributions: PayslipAmount[];
    deductions: PayslipAmount[];
    gross: string;
    totalContributions: string;
    totalOtherDeductions: string;
    totalDeductions: string;
    net: string;
    netInWords: string;
    employer: { show: boolean; pf: string; esi: string; gratuity: string; ctc: string };
  }[];
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const twoDigits = (n: number) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`);
const threeDigits = (n: number) => [n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred` : '', twoDigits(n % 100)].filter(Boolean).join(' ');

/** Whole number in the Indian system (crore, lakh, thousand). */
function indianWords(n: number): string {
  if (n === 0) return 'Zero';
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  if (crore) parts.push(`${indianWords(crore)} Crore`);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  const thousand = Math.floor((n % 100_000) / 1000);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  const rest = n % 1000;
  if (rest) parts.push(threeDigits(rest));
  return parts.join(' ');
}

/** "110000.00" → "One Lakh Ten Thousand Rupees only"; paise are added when present. */
export function amountInWords(amount: string): string {
  const negative = amount.trim().startsWith('-');
  const [rupeesRaw, paiseRaw = '0'] = amount.trim().replace(/^-/, '').split('.');
  const paise = Math.round(Number(`0.${paiseRaw}`) * 100);
  return `${negative ? 'Minus ' : ''}${indianWords(Number(rupeesRaw))} Rupees${paise ? ` and ${twoDigits(paise)} Paise` : ''} only`;
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
