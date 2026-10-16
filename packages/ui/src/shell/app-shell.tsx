'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { Bell, ChevronsLeft, ChevronsRight, KeyRound, LogOut, Menu, ShieldX, X } from 'lucide-react';
import { get } from '../lib/api';
import { cn } from '../lib/format';
import { Spinner } from '../components/primitives';
import { EmptyState } from '../components/data';
import { AmbientBackground } from '../components/effects';
import { useAuth } from './auth';

export interface NavItem {
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  /** Shown when the user has any of these permissions (omit = everyone). */
  permission?: string | string[];
  section?: string;
}

interface Brand {
  appName: string;
  company: string;
  logo: ReactNode;
}

function useClickOutside(onOutside: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onOutside();
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onOutside]);
  return ref;
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(() => setOpen(false));
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => get<{ items: { id: string; message: string; href: string }[] }>('/notifications'), refetchInterval: 60_000 });
  const count = q.data?.items.length ?? 0;
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="fx-btn relative rounded-lg p-2 text-primary hover:bg-mist" aria-label={`Notifications (${count})`} aria-expanded={open}>
        <Bell className="h-5 w-5" />
        {count > 0 && <span className="fx-live-dot absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-white">{count}</span>}
      </button>
      {open && (
        <div className="fx-pop absolute right-0 z-40 mt-2 w-80 overflow-hidden rounded-xl border border-line bg-white shadow-[0_24px_48px_-20px_rgb(15_23_42/0.35)]">
          <p className="border-b border-line px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted">Pending actions</p>
          {count === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted">Nothing needs your attention.</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {q.data!.items.map((n) => (
                <li key={n.id}>
                  <Link href={n.href} onClick={() => setOpen(false)} className="fx-option block border-b border-line/70 px-4 py-3 text-sm text-ink last:border-0 hover:bg-mist/60">
                    {n.message}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(() => setOpen(false));
  if (!user) return null;
  const initials = user.name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="fx-btn flex items-center gap-2 rounded-xl py-1 pl-1 pr-2 hover:bg-mist" aria-expanded={open} aria-haspopup="menu">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-secondary via-primary to-navy text-xs font-semibold text-white shadow-[0_0_0_3px_rgb(12_184_132/0.35)] ring-2 ring-white">{initials}</span>
        <span className="hidden text-left leading-tight md:block">
          <span className="block text-sm font-medium text-ink">{user.name}</span>
          <span className="block text-xs text-muted">{user.roleName}</span>
        </span>
      </button>
      {open && (
        <div role="menu" className="fx-pop absolute right-0 z-40 mt-2 w-60 overflow-hidden rounded-xl border border-line bg-white py-1 shadow-[0_24px_48px_-20px_rgb(15_23_42/0.35)]">
          <div className="border-b border-line px-4 py-2.5">
            <p className="text-sm font-medium text-ink">{user.name}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
          </div>
          <Link role="menuitem" href="/change-password" onClick={() => setOpen(false)} className="fx-option flex items-center gap-2 px-4 py-2 text-sm text-ink hover:bg-mist/70">
            <KeyRound className="h-4 w-4 text-secondary" /> Change password
          </Link>
          <button role="menuitem" onClick={() => void logout()} className="fx-option flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-ink hover:bg-mist/70">
            <LogOut className="h-4 w-4 text-secondary" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/** Protected application frame: collapsible sidebar, top bar, breadcrumbs area, user menu. */
export function AppShell({ brand, nav, children, banner, notifications = true }: { brand: Brand; nav: NavItem[]; children: ReactNode; banner?: ReactNode; notifications?: boolean }) {
  const { user, loading, canAny } = useAuth();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem('nx.sidebar') === '1');
    } catch {
      /* storage unavailable */
    }
  }, []);
  useEffect(() => setMobileOpen(false), [pathname]);
  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem('nx.sidebar', c ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !c;
    });
  };

  if (loading || !user) return <Spinner label="Loading your workspace…" className="min-h-screen" />;
  if (user.mustChangePassword && pathname !== '/change-password') return <Spinner className="min-h-screen" />;

  const visible = nav.filter((n) => !n.permission || canAny(...(Array.isArray(n.permission) ? n.permission : [n.permission])));
  // Only the most specific matching item is highlighted (e.g. /employees/import over /employees).
  const matches = (href: string) => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/'));
  const activeHref = visible.filter((n) => matches(n.href)).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  const isActive = (href: string) => href === activeHref;
  const sections = [...new Set(visible.map((n) => n.section ?? ''))];

  const sidebar = (
    <nav aria-label="Main navigation" className="flex h-full flex-col">
      <div className={cn('flex h-16 items-center gap-3 border-b border-white/10 px-4', collapsed && 'justify-center px-2')}>
        <span className="shrink-0">{brand.logo}</span>
        {!collapsed && (
          <span className="leading-tight">
            <span className="block text-[15px] font-semibold text-white">{brand.appName}</span>
            <span className="block text-[11px] uppercase tracking-[0.12em] text-accent/90">{brand.company}</span>
          </span>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-4">
        {sections.map((s) => (
          <div key={s} className="mb-4">
            {s && !collapsed && <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-haze/70">{s}</p>}
            <ul className="space-y-0.5">
              {visible
                .filter((n) => (n.section ?? '') === s)
                .map((n) => {
                  const active = isActive(n.href);
                  return (
                    <li key={n.href}>
                      <Link
                        href={n.href}
                        title={collapsed ? n.label : undefined}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'fx-nav flex items-center gap-3 rounded-lg px-3 py-2 text-sm',
                          active ? 'bg-gradient-to-r from-white/[0.16] to-white/[0.04] font-medium text-white ring-1 ring-white/15' : 'text-haze hover:bg-white/[0.07] hover:text-white',
                          collapsed && 'justify-center px-2',
                        )}
                      >
                        <n.icon className={cn('h-[18px] w-[18px] shrink-0', active ? 'text-accent' : 'text-haze/80')} />
                        {!collapsed && <span className="truncate">{n.label}</span>}
                      </Link>
                    </li>
                  );
                })}
            </ul>
          </div>
        ))}
      </div>
      <button onClick={toggle} className="hidden items-center gap-2 border-t border-white/10 px-4 py-3 text-xs text-haze transition-colors hover:text-white lg:flex" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
        {collapsed ? <ChevronsRight className="mx-auto h-4 w-4" /> : <><ChevronsLeft className="h-4 w-4" /> Collapse</>}
      </button>
    </nav>
  );

  return (
    <div className="relative min-h-screen">
      <AmbientBackground />
      <aside className={cn('fx-sidebar no-print fixed inset-y-0 left-0 z-30 hidden transition-[width] duration-300 lg:block', collapsed ? 'w-[68px]' : 'w-64')}>{sidebar}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="fx-enter absolute inset-0 bg-navy/50 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="fx-sidebar fx-slide-in absolute inset-y-0 left-0 w-64 shadow-2xl">
            <button className="absolute right-2 top-4 rounded p-1 text-haze hover:text-white" onClick={() => setMobileOpen(false)} aria-label="Close navigation">
              <X className="h-5 w-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}
      <div className={cn('relative transition-[padding] duration-300', collapsed ? 'lg:pl-[68px]' : 'lg:pl-64')}>
        <header className="no-print sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-white/60 bg-white/70 px-4 shadow-[0_1px_0_rgb(30_64_175/0.06)] backdrop-blur-xl sm:px-6">
          <button className="fx-btn rounded-lg p-2 text-primary hover:bg-mist lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex-1" />
          {notifications && <Notifications />}
          <UserMenu />
        </header>
        {banner}
        <main key={pathname} className="fx-enter mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

/** Renders children only for users holding one of the permissions; otherwise an access-denied view. */
export function RequirePermission({ permission, children }: { permission: string | string[]; children: ReactNode }) {
  const { canAny, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!canAny(...(Array.isArray(permission) ? permission : [permission]))) return <AccessDenied />;
  return <>{children}</>;
}

export function AccessDenied() {
  return (
    <div className="fx-enter rounded-[var(--radius-card)] border border-line bg-white">
      <EmptyState
        icon={<ShieldX className="h-6 w-6" />}
        title="Access denied"
        hint="Your role does not include permission for this page. If you need access, ask an administrator."
        action={
          <Link href="/" className="text-sm font-medium text-cobalt hover:underline">
            Back to dashboard
          </Link>
        }
      />
    </div>
  );
}

export function BrandMark({ letter }: { letter: string }) {
  return (
    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-secondary to-primary shadow-[0_6px_18px_-6px_rgb(59_134_209/0.8)] ring-1 ring-white/25">
      <span className="text-base font-bold text-white">{letter}</span>
    </span>
  );
}

