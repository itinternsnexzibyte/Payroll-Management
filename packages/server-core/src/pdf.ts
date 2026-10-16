import { existsSync } from 'node:fs';
import Handlebars from 'handlebars';
import puppeteer, { type Browser } from 'puppeteer-core';
import { AppError } from './errors';

const CANDIDATES = [
  process.env.PDF_BROWSER_PATH,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

export function findBrowser(): string | null {
  for (const c of CANDIDATES) if (c && existsSync(c)) return c;
  return null;
}

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    if (b && b.connected) return b;
  }
  const executablePath = findBrowser();
  if (!executablePath) {
    throw new AppError('CONFIGURATION_MISSING', 'PDF generation is not configured on the server (no Chromium/Chrome/Edge found). Set PDF_BROWSER_PATH.');
  }
  browserPromise = puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-extensions', '--no-first-run'],
  });
  return browserPromise;
}

export async function closePdfBrowser(): Promise<void> {
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    browserPromise = null;
    await b?.close().catch(() => undefined);
  }
}

export interface PdfOptions {
  format?: 'A4' | 'Letter';
  landscape?: boolean;
  margin?: { top: string; right: string; bottom: string; left: string };
  footerText?: string;
}

/**
 * Renders trusted, server-produced HTML to PDF. JavaScript is disabled and all network
 * requests except inline data: URIs are blocked, so templates cannot fetch remote content.
 */
export async function renderPdf(html: string, opts: PdfOptions = {}): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url();
      if (url.startsWith('data:') || url === 'about:blank') req.continue();
      else req.abort();
    });
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });
    const pdf = await page.pdf({
      format: opts.format ?? 'A4',
      landscape: opts.landscape ?? false,
      printBackground: true,
      margin: opts.margin ?? { top: '14mm', right: '12mm', bottom: '16mm', left: '12mm' },
      displayHeaderFooter: Boolean(opts.footerText),
      headerTemplate: '<span></span>',
      footerTemplate: opts.footerText
        ? `<div style="font-size:7px;width:100%;padding:0 12mm;color:#555;display:flex;justify-content:space-between;"><span>${Handlebars.escapeExpression(opts.footerText)}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`
        : '<span></span>',
    });
    return Buffer.from(pdf);
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** Groups an integer-string Indian style (12,34,567). Works on strings so no float conversion happens. */
export function formatIndianAmount(value: string | number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || value === '') return '';
  const s = typeof value === 'number' ? value.toFixed(decimals) : value;
  const neg = s.startsWith('-');
  const [intPartRaw, fracRaw = ''] = (neg ? s.slice(1) : s).split('.');
  const frac = decimals > 0 ? '.' + (fracRaw + '0'.repeat(decimals)).slice(0, decimals) : '';
  const intPart = intPartRaw.replace(/^0+(?=\d)/, '');
  let grouped = intPart;
  if (intPart.length > 3) {
    const last3 = intPart.slice(-3);
    const rest = intPart.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    grouped = `${rest},${last3}`;
  }
  return `${neg ? '-' : ''}${grouped}${frac}`;
}

/** Creates an isolated Handlebars environment with safe formatting helpers. */
export function createTemplateEngine() {
  const hb = Handlebars.create();
  hb.registerHelper('money', (v: unknown) => formatIndianAmount(v === null || v === undefined ? '' : String(v)));
  hb.registerHelper('qty', (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
  });
  hb.registerHelper('date', (v: unknown) => {
    if (!v) return '';
    const d = new Date(String(v));
    if (Number.isNaN(d.getTime())) return String(v);
    return `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()}`;
  });
  hb.registerHelper('inc', (v: unknown) => Number(v) + 1);
  hb.registerHelper('eq', (a: unknown, b: unknown) => a === b);
  hb.registerHelper('nl2br', (v: unknown) => new hb.SafeString(hb.escapeExpression(String(v ?? '')).replace(/\r?\n/g, '<br/>')));
  return hb;
}
