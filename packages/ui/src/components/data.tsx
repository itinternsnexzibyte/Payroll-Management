'use client';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, ChevronRight as CrumbSep, FileX2, RefreshCw, Search, TriangleAlert } from 'lucide-react';
import { cn } from '../lib/format';
import { Button, Input, Select } from './primitives';

// ---------------------------------------------------------------- Page header & breadcrumbs

export interface Crumb {
  label: string;
  href?: string;
}

export function PageHeader({ title, description, breadcrumbs, actions, badge }: { title: ReactNode; description?: ReactNode; breadcrumbs?: Crumb[]; actions?: ReactNode; badge?: ReactNode }) {
  return (
    <div className="fx-enter mb-6 space-y-2">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="no-print">
          <ol className="flex flex-wrap items-center gap-1 text-xs text-muted">
            {breadcrumbs.map((c, i) => (
              <li key={i} className="flex items-center gap-1">
                {i > 0 && <CrumbSep className="h-3 w-3 text-haze" aria-hidden />}
                {c.href ? (
                  <Link href={c.href} className="hover:text-cobalt hover:underline">
                    {c.label}
                  </Link>
                ) : (
                  <span aria-current="page" className="text-ink">
                    {c.label}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-primary">{title}</h1>
            {badge}
          </div>
          <div className="fx-title-rule mt-2" aria-hidden />
          {description && <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">{description}</p>}
        </div>
        {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- States

export function EmptyState({ title, hint, action, icon }: { title: string; hint?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <div className="fx-bob mb-1 rounded-2xl bg-gradient-to-br from-mist to-white p-3.5 text-cobalt shadow-[0_8px_20px_-12px_rgb(30_64_175/0.45)] ring-1 ring-haze/40">{icon ?? <FileX2 className="h-6 w-6" aria-hidden />}</div>
      <p className="text-sm font-semibold text-ink">{title}</p>
      {hint && <p className="max-w-md text-sm text-muted">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center" role="alert">
      <TriangleAlert className="h-6 w-6 text-danger" aria-hidden />
      <p className="text-sm font-medium text-ink">{message}</p>
      {onRetry && (
        <Button size="sm" variant="secondary" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Data table

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  sortable?: boolean;
  align?: 'left' | 'right' | 'center';
  className?: string;
  headerClassName?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  error,
  onRetry,
  empty,
  sortBy,
  sortDir,
  onSort,
  rowHref,
  selectedKey,
  dense,
  caption,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  empty?: ReactNode;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  onSort?: (key: string) => void;
  rowHref?: (row: T) => string;
  selectedKey?: string | null;
  dense?: boolean;
  caption?: string;
}) {
  const router = useRouter();
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-line bg-gradient-to-b from-surface to-[#f1f4f9] text-left">
            {columns.map((c) => {
              const active = sortBy === c.key;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
                  className={cn('whitespace-nowrap px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-primary', c.align === 'right' && 'text-right', c.align === 'center' && 'text-center', c.headerClassName)}
                >
                  {c.sortable && onSort ? (
                    <button className={cn('inline-flex items-center gap-1 hover:text-cobalt', c.align === 'right' && 'flex-row-reverse')} onClick={() => onSort(c.key)}>
                      {c.header}
                      {active ? sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" /> : <ArrowUpDown className="h-3 w-3 text-haze" />}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading &&
            Array.from({ length: 5 }).map((_, i) => (
              <tr key={`sk${i}`} className="border-b border-line/70">
                {columns.map((c) => (
                  <td key={c.key} className="px-4 py-3">
                    <div className="fx-skeleton h-3.5 w-full rounded" style={{ maxWidth: `${90 + ((i * 37 + c.key.length * 13) % 90)}px` }} />
                  </td>
                ))}
              </tr>
            ))}
          {!loading && error && (
            <tr>
              <td colSpan={columns.length}>
                <ErrorState message={error} onRetry={onRetry} />
              </td>
            </tr>
          )}
          {!loading && !error && rows?.length === 0 && (
            <tr>
              <td colSpan={columns.length}>{empty ?? <EmptyState title="No records found" hint="Try changing the search or filters." />}</td>
            </tr>
          )}
          {!loading &&
            !error &&
            rows?.map((row, index) => {
              const key = rowKey(row);
              const href = rowHref?.(row);
              return (
                <tr
                  key={key}
                  style={index < 12 ? ({ ['--row-delay' as string]: `${index * 28}ms` } as CSSProperties) : undefined}
                  className={cn('fx-row fx-row-in border-b border-line/70 last:border-0 even:bg-surface/40 hover:bg-mist/50', href && 'cursor-pointer', selectedKey === key && 'bg-mist/60')}
                  onClick={(e) => {
                    if (!href) return;
                    const target = e.target as HTMLElement;
                    if (target.closest('a,button,input,select,textarea,label')) return;
                    router.push(href);
                  }}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={cn('px-4 align-middle text-ink', dense ? 'py-2' : 'py-3', c.align === 'right' && 'text-right tabular-nums', c.align === 'center' && 'text-center', c.className)}>
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({ page, totalPages, total, pageSize, onPage, onPageSize }: { page: number; totalPages: number; total: number; pageSize: number; onPage: (p: number) => void; onPageSize?: (n: number) => void }) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="no-print flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm text-muted">
      <span>
        {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-2">
        {onPageSize && (
          <label className="flex items-center gap-2">
            <span className="sr-only sm:not-sr-only">Rows</span>
            <Select className="h-8 w-20" value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} aria-label="Rows per page">
              {[10, 20, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </label>
        )}
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page" icon={<ChevronLeft className="h-4 w-4" />} />
        <span className="min-w-20 text-center text-ink">
          Page {page} / {Math.max(1, totalPages)}
        </span>
        <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => onPage(page + 1)} aria-label="Next page" icon={<ChevronRight className="h-4 w-4" />} />
      </div>
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search…', className, label = 'Search' }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; label?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (text === value) return;
    const t = setTimeout(() => onChange(text), 300);
    return () => clearTimeout(t);
  }, [text, value, onChange]);
  return (
    <div className={cn('relative w-full sm:w-72', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-haze" aria-hidden />
      <Input type="search" aria-label={label} placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} className="pl-9" />
    </div>
  );
}

/**
 * List state (page, size, sort, search, filters) stored in the URL so lists survive refresh and
 * back-navigation. Changing anything but the page resets to page 1.
 */
export function useListParams<F extends Record<string, string>>(defaults: { sortBy: string; sortDir: 'asc' | 'desc'; pageSize?: number; filters?: F }) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const filterKeys = useMemo(() => Object.keys(defaults.filters ?? {}), [defaults.filters]);
  const state = {
    page: Number(sp.get('page') ?? 1) || 1,
    pageSize: Number(sp.get('pageSize') ?? defaults.pageSize ?? 20) || 20,
    sortBy: sp.get('sortBy') ?? defaults.sortBy,
    sortDir: (sp.get('sortDir') as 'asc' | 'desc' | null) ?? defaults.sortDir,
    search: sp.get('search') ?? '',
    filters: Object.fromEntries(filterKeys.map((k) => [k, sp.get(k) ?? defaults.filters?.[k] ?? ''])) as F,
  };
  const set = useCallback(
    (patch: Record<string, string | number | undefined>, resetPage = true) => {
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === '') next.delete(k);
        else next.set(k, String(v));
      }
      if (resetPage && !('page' in patch)) next.delete('page');
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [sp, router, pathname],
  );
  return {
    ...state,
    setPage: (page: number) => set({ page }, false),
    setPageSize: (pageSize: number) => set({ pageSize }),
    setSearch: (search: string) => set({ search }),
    setFilter: (key: keyof F & string, value: string) => set({ [key]: value }),
    toggleSort: (key: string) => set({ sortBy: key, sortDir: state.sortBy === key && state.sortDir === 'asc' ? 'desc' : 'asc' }),
    query: { page: state.page, pageSize: state.pageSize, sortBy: state.sortBy, sortDir: state.sortDir, search: state.search, ...state.filters },
  };
}

// ---------------------------------------------------------------- Misc

/**
 * Animates a number up from zero, keeping its formatting (grouping, decimals, and any prefix or
 * suffix such as ₹, %, "+"). Values that are not a single number are shown as they are.
 */
export function CountUp({ value, duration = 900 }: { value: ReactNode; duration?: number }) {
  const parsed = useMemo(() => {
    if (typeof value === 'number') return { prefix: '', suffix: '', target: value, decimals: Number.isInteger(value) ? 0 : 2, grouping: false, indian: false };
    if (typeof value !== 'string') return null;
    const m = /^([^\d-]*)(-?[\d,]+(?:\.\d+)?)([^\d]*)$/.exec(value.trim());
    if (!m) return null;
    const digits = m[2];
    return {
      prefix: m[1],
      suffix: m[3],
      target: Number(digits.replace(/,/g, '')),
      decimals: digits.includes('.') ? digits.split('.')[1].length : 0,
      grouping: digits.includes(','),
      // 1,23,456 (Indian lakh grouping) rather than 123,456
      indian: /\d,\d\d,\d{3}/.test(digits),
    };
  }, [value]);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!parsed || !Number.isFinite(parsed.target)) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setShown(parsed.target);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setShown(parsed.target * (1 - Math.pow(1 - t, 4)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [parsed, duration]);
  if (!parsed || !Number.isFinite(parsed.target)) return <>{value}</>;
  const text = shown.toLocaleString(parsed.indian ? 'en-IN' : 'en-US', { minimumFractionDigits: parsed.decimals, maximumFractionDigits: parsed.decimals, useGrouping: parsed.grouping });
  return (
    <>
      {parsed.prefix}
      {text}
      {parsed.suffix}
    </>
  );
}

export function StatCard({ label, value, hint, href, icon, tone = 'default' }: { label: string; value: ReactNode; hint?: ReactNode; href?: string; icon?: ReactNode; tone?: 'default' | 'attention' }) {
  const body = (
    <div
      className={cn(
        'fx-card fx-enter fx-stat group h-full rounded-[var(--radius-card)] border bg-white/95 p-4 shadow-[var(--shadow-card)] backdrop-blur-sm',
        tone === 'attention' ? 'fx-stat--attention border-warning/30' : 'border-line',
        href && 'hover:-translate-y-0.5 hover:border-secondary/50',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{label}</p>
        {icon && <span className={cn('fx-stat-icon rounded-lg p-1.5 ring-1', tone === 'attention' ? 'bg-warning-bg text-warning ring-warning/20' : 'bg-gradient-to-br from-mist to-white text-cobalt ring-haze/40')}>{icon}</span>}
      </div>
      <p className="mt-2 text-[26px] font-semibold leading-tight tracking-tight tabular-nums text-primary">
        <CountUp value={value} />
      </p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
  return href ? (
    <Link href={href} className="block h-full focus-visible:rounded-[var(--radius-card)]">
      {body}
    </Link>
  ) : (
    body
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode; hidden?: boolean }[]; value: T; onChange: (v: T) => void }) {
  const listRef = useRef<HTMLDivElement>(null);
  const [bar, setBar] = useState<{ left: number; width: number } | null>(null);
  const shown = tabs.filter((t) => !t.hidden);
  const shownKey = shown.map((t) => t.id).join('|');
  // Measure the selected tab so the indicator can glide to it.
  useLayoutEffect(() => {
    const measure = () => {
      const el = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
      if (el) setBar({ left: el.offsetLeft, width: el.offsetWidth });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [value, shownKey]);
  return (
    <div ref={listRef} role="tablist" className="no-print relative mb-5 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line">
      {shown.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn('whitespace-nowrap rounded-t-lg px-4 py-2.5 text-sm font-medium transition-colors', value === t.id ? 'text-primary' : 'text-muted hover:bg-mist/40 hover:text-cobalt')}
        >
          {t.label}
        </button>
      ))}
      {bar && <span className="fx-tab-indicator left-0" style={{ width: bar.width, transform: `translateX(${bar.left}px)` }} aria-hidden />}
    </div>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="no-print flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">{children}</div>;
}
