import clsx, { type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Teach tailwind-merge about the custom brand colour tokens so e.g. `bg-burgundy` overrides `bg-white`.
const twMerge = extendTailwindMerge({
  extend: { theme: { color: ['burgundy', 'wine', 'rose', 'blush', 'ink', 'muted', 'line', 'canvas', 'success', 'success-bg', 'warning', 'warning-bg', 'danger', 'danger-bg'] } },
});

/** Joins class names; later conflicting Tailwind utilities win (e.g. a caller's `w-48` over a default `w-full`). */
export const cn = (...v: ClassValue[]) => twMerge(clsx(v));

/** Indian digit grouping on decimal strings (no float conversion). */
export function formatMoney(value: string | number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || value === '') return '—';
  const s = typeof value === 'number' ? value.toFixed(decimals) : String(value);
  if (!/^-?\d+(\.\d+)?$/.test(s)) return s;
  const neg = s.startsWith('-');
  const [i, f = ''] = (neg ? s.slice(1) : s).split('.');
  const intPart = i.replace(/^0+(?=\d)/, '');
  const grouped = intPart.length > 3 ? `${intPart.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${intPart.slice(-3)}` : intPart;
  const frac = decimals > 0 ? '.' + (f + '0'.repeat(decimals)).slice(0, decimals) : '';
  return `${neg ? '-' : ''}${grouped}${frac}`;
}

export const formatQty = (v: string | null | undefined) => (v === null || v === undefined || v === '' ? '—' : v.includes('.') ? v.replace(/\.?0+$/, '') : v);

export function formatDate(v: string | Date | null | undefined): string {
  if (!v) return '—';
  const dateOnly = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const d = typeof v === 'string' ? new Date(dateOnly ? v + 'T00:00:00Z' : v) : v;
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', ...(dateOnly ? { timeZone: 'UTC' } : {}) });
}

export function formatDateTime(v: string | Date | null | undefined): string {
  if (!v) return '—';
  const d = typeof v === 'string' ? new Date(v) : v;
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const humanize = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
