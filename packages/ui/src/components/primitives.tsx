'use client';
import Link from 'next/link';
import { useId, type ComponentProps, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from 'lucide-react';
import { cn } from '../lib/format';

// ---------------------------------------------------------------- Button

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
type Size = 'sm' | 'md';

const variants: Record<Variant, string> = {
  primary: 'fx-btn--primary bg-primary text-white disabled:opacity-55 disabled:shadow-none',
  secondary: 'border border-line bg-white text-primary shadow-[0_1px_2px_rgb(15_23_42/0.05)] hover:border-secondary/60 hover:bg-mist/50 hover:shadow-[0_6px_16px_-10px_rgb(30_64_175/0.4)] disabled:opacity-50',
  ghost: 'text-cobalt hover:bg-mist/70 disabled:opacity-50',
  subtle: 'bg-mist text-primary hover:bg-[#dce8f8] disabled:opacity-50',
  danger: 'bg-danger text-white shadow-[0_6px_16px_-8px_rgb(192_38_45/0.6)] hover:bg-danger/90 disabled:opacity-50',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  icon,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ComponentProps<'button'> & { variant?: Variant; size?: Size; loading?: boolean; icon?: ReactNode }) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cn(
        'fx-btn inline-flex select-none items-center justify-center gap-2 rounded-lg font-medium tracking-[0.01em] disabled:cursor-not-allowed',
        size === 'sm' ? 'h-8 px-3 text-sm' : 'h-10 px-4 text-sm',
        variants[variant],
        className,
      )}
      data-fx={variant === 'primary' ? 'primary' : undefined}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

/** A link styled as a button (avoids nesting <button> inside <a>). */
export function ButtonLink({ href, variant = 'primary', size = 'md', icon, className, children }: { href: string; variant?: Variant; size?: Size; icon?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      data-fx={variant === 'primary' ? 'primary' : undefined}
      className={cn('fx-btn inline-flex select-none items-center justify-center gap-2 rounded-lg font-medium tracking-[0.01em]', size === 'sm' ? 'h-8 px-3 text-sm' : 'h-10 px-4 text-sm', variants[variant], className)}
    >
      {icon}
      {children}
    </Link>
  );
}

// ---------------------------------------------------------------- Form fields

const fieldBase =
  'fx-field block w-full rounded-lg border border-line bg-white px-3 text-sm text-ink placeholder:text-muted/70 shadow-[0_1px_2px_rgb(15_23_42/0.04)] hover:border-[#cbd3e1] focus:border-secondary focus:outline-none disabled:bg-surface disabled:text-muted read-only:bg-surface';

export function Input({ className, invalid, ...rest }: ComponentProps<'input'> & { invalid?: boolean }) {
  return <input className={cn(fieldBase, 'h-10', invalid && 'border-danger focus:border-danger focus:ring-danger-bg', className)} aria-invalid={invalid || undefined} {...rest} />;
}

export function Textarea({ className, invalid, ...rest }: ComponentProps<'textarea'> & { invalid?: boolean }) {
  return <textarea className={cn(fieldBase, 'min-h-20 py-2', invalid && 'border-danger', className)} aria-invalid={invalid || undefined} {...rest} />;
}

export function Select({ className, invalid, children, ...rest }: ComponentProps<'select'> & { invalid?: boolean }) {
  return (
    <select className={cn(fieldBase, 'h-10 pr-8', invalid && 'border-danger', className)} aria-invalid={invalid || undefined} {...rest}>
      {children}
    </select>
  );
}

export function Checkbox({ label, className, ...rest }: ComponentProps<'input'> & { label: ReactNode }) {
  const id = useId();
  return (
    <label htmlFor={rest.id ?? id} className={cn('inline-flex cursor-pointer items-center gap-2 text-sm text-ink', className)}>
      <input id={rest.id ?? id} type="checkbox" className="fx-check" {...rest} />
      {label}
    </label>
  );
}

/** Label + control + hint/error. Pass the control as children; `htmlFor` should match its id. */
export function Field({ label, htmlFor, error, hint, required, locked, children, className }: { label: string; htmlFor?: string; error?: string; hint?: ReactNode; required?: boolean; locked?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="flex items-center gap-1 text-sm font-medium text-ink">
        {label}
        {required && <span className="text-accent-ink" aria-hidden>*</span>}
        {locked && (
          <span className="ml-1 rounded bg-mist/70 px-1.5 py-0.5 text-[11px] font-medium text-cobalt" title={locked}>
            Locked
          </span>
        )}
      </label>
      {children}
      {error ? (
        <p className="text-xs font-medium text-danger" role="alert">
          {error}
        </p>
      ) : locked ? (
        <p className="text-xs text-muted">{locked}</p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- Surfaces & status

export function Card({ className, children, title, actions, padded = true }: { className?: string; children: ReactNode; title?: ReactNode; actions?: ReactNode; padded?: boolean }) {
  return (
    <section className={cn('fx-card fx-enter rounded-[var(--radius-card)] border border-line bg-white/95 shadow-[var(--shadow-card)] backdrop-blur-sm', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line bg-gradient-to-r from-surface/80 to-white/0 px-5 py-3">
          <h2 className="fx-card-title text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={padded ? 'p-5' : ''}>{children}</div>
    </section>
  );
}

type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';
const tones: Record<Tone, string> = {
  neutral: 'bg-surface text-muted border-line',
  brand: 'bg-mist text-primary border-haze/50',
  success: 'bg-success-bg text-success border-success/20',
  warning: 'bg-warning-bg text-warning border-warning/20',
  danger: 'bg-danger-bg text-danger border-danger/20',
  info: 'bg-white text-cobalt border-haze/60',
};

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium', tones[tone], className)}>{children}</span>;
}

const STATUS_TONES: Record<string, Tone> = {
  ACTIVE: 'success',
  INACTIVE: 'neutral',
  DISABLED: 'neutral',
  EXITED: 'neutral',
  DRAFT: 'neutral',
  CALCULATED: 'info',
  UNDER_REVIEW: 'warning',
  APPROVED: 'brand',
  FINALISED: 'success',
  ISSUED: 'success',
  SUPERSEDED: 'neutral',
  CANCELLED: 'danger',
  OK: 'success',
  WARNING: 'warning',
  ERROR: 'danger',
  PENDING: 'neutral',
  PUBLISHED: 'success',
  RETIRED: 'neutral',
  AWAITING_CLIENT_ASSETS: 'warning',
  COMPLETED: 'success',
  PARTIAL: 'warning',
  FAILED: 'danger',
  PREVIEWED: 'neutral',
};

/** States that are waiting on someone get a pulsing dot. */
const LIVE_STATUSES = new Set(['UNDER_REVIEW', 'APPROVED', 'PENDING', 'CALCULATED']);

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <Badge tone={STATUS_TONES[status] ?? 'neutral'}>
      <span className={cn('fx-dot', LIVE_STATUSES.has(status) && 'fx-dot--live')} aria-hidden />
      {label ?? status.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}
    </Badge>
  );
}

const alertStyles = {
  info: { cls: 'border-haze/60 bg-mist/60 text-primary', Icon: Info },
  warning: { cls: 'border-warning/30 bg-warning-bg text-warning', Icon: AlertTriangle },
  danger: { cls: 'border-danger/30 bg-danger-bg text-danger', Icon: XCircle },
  success: { cls: 'border-success/30 bg-success-bg text-success', Icon: CheckCircle2 },
};

export function Alert({ tone = 'info', title, children, className }: { tone?: keyof typeof alertStyles; title?: ReactNode; children?: ReactNode; className?: string }) {
  const { cls, Icon } = alertStyles[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('fx-enter flex gap-3 rounded-lg border px-4 py-3 text-sm', cls, className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="space-y-0.5">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-[13px] leading-relaxed opacity-95">{children}</div>}
      </div>
    </div>
  );
}

export function Spinner({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return (
    <div className={cn('fx-enter flex items-center justify-center gap-3 py-10 text-sm text-muted', className)} role="status">
      <span className="relative flex h-6 w-6 items-center justify-center" aria-hidden>
        <span className="absolute inset-0 rounded-full border-2 border-mist" />
        <Loader2 className="h-6 w-6 animate-spin text-secondary" />
      </span>
      {label}
    </div>
  );
}

/** Shimmering placeholder block for content that is loading. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('fx-skeleton rounded-md', className)} aria-hidden />;
}

export function KeyValue({ items, columns = 2 }: { items: { label: string; value: ReactNode }[]; columns?: 1 | 2 | 3 }) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-3', columns === 1 ? 'grid-cols-1' : columns === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-3')}>
      {items.map((i) => (
        <div key={i.label} className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted">{i.label}</dt>
          <dd className="mt-0.5 break-words text-sm text-ink">{i.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
