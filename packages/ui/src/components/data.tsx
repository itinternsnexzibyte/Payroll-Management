'use client';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
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
    <div className="mb-6 space-y-2">
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
            <h1 className="text-[22px] font-semibold tracking-tight text-primary">{title}</h1>
            {badge}
          </div>
          {description && <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p>}
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
      <div className="mb-1 rounded-full bg-mist/60 p-3 text-cobalt">{icon ?? <FileX2 className="h-6 w-6" aria-hidden />}</div>
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
          <tr className="border-b border-line bg-surface text-left">
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
                    <div className="h-3.5 w-full max-w-[160px] animate-pulse rounded bg-mist/60" />
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
            rows?.map((row) => {
              const key = rowKey(row);
              const href = rowHref?.(row);
              return (
                <tr
                  key={key}
                  className={cn('fx-row border-b border-line/70 last:border-0 hover:bg-mist/50', href && 'cursor-pointer', selectedKey === key && 'bg-mist/50')}
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

export function StatCard({ label, value, hint, href, icon, tone = 'default' }: { label: string; value: ReactNode; hint?: ReactNode; href?: string; icon?: ReactNode; tone?: 'default' | 'attention' }) {
  const body = (
    <div className={cn('fx-card fx-enter group h-full rounded-[var(--radius-card)] border bg-white/95 p-4 shadow-[var(--shadow-card)] backdrop-blur-sm', tone === 'attention' ? 'border-cobalt/40' : 'border-line', href && 'hover:-translate-y-0.5 hover:border-secondary/50')}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
        {icon && <span className="rounded-md bg-mist/60 p-1.5 text-cobalt">{icon}</span>}
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-primary">{value}</p>
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
  return (
    <div role="tablist" className="no-print mb-4 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line">
      {tabs
        .filter((t) => !t.hidden)
        .map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={value === t.id}
            onClick={() => onChange(t.id)}
            className={cn('-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition-colors', value === t.id ? 'border-primary text-primary' : 'border-transparent text-muted hover:border-haze/60 hover:text-cobalt')}
          >
            {t.label}
          </button>
        ))}
    </div>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="no-print flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">{children}</div>;
}
