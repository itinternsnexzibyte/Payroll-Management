'use client';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, get, post, setUnauthenticatedHandler } from '../lib/api';
import { ToastProvider } from '../components/feedback';

export interface Me {
  id: string;
  email: string;
  name: string;
  role: string;
  roleName: string;
  permissions: string[];
  mustChangePassword: boolean;
  [k: string]: unknown;
}

interface AuthCtx {
  user: Me | null;
  loading: boolean;
  can: (perm: string) => boolean;
  canAny: (...perms: string[]) => boolean;
  logout: () => Promise<void>;
  refresh: () => Promise<unknown>;
}

const Ctx = createContext<AuthCtx>({ user: null, loading: true, can: () => false, canAny: () => false, logout: async () => undefined, refresh: async () => undefined });
export const useAuth = () => useContext(Ctx);

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2, refetchOnWindowFocus: false, staleTime: 15_000 },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

const PUBLIC_PATHS = ['/login'];

/** Loads the signed-in user and enforces sign-in / forced password change on every protected page. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const isPublic = PUBLIC_PATHS.includes(pathname);
  const me = useQuery({ queryKey: ['me'], queryFn: () => get<Me>('/auth/me'), enabled: !isPublic, retry: false, staleTime: 60_000 });

  useEffect(() => {
    setUnauthenticatedHandler((code) => {
      qc.clear();
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      router.replace(`/login?next=${next}${code === 'SESSION_EXPIRED' ? '&expired=1' : ''}`);
    });
  }, [qc, router]);

  useEffect(() => {
    if (isPublic) return;
    if (me.error instanceof ApiError && me.error.status === 401) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    } else if (me.data?.mustChangePassword && pathname !== '/change-password') {
      router.replace('/change-password');
    }
  }, [me.error, me.data, pathname, router, isPublic]);

  const value = useMemo<AuthCtx>(() => {
    const perms = new Set(me.data?.permissions ?? []);
    return {
      user: me.data ?? null,
      loading: me.isLoading,
      can: (p) => perms.has(p),
      canAny: (...ps) => ps.some((p) => perms.has(p)),
      logout: async () => {
        try {
          await post('/auth/logout');
        } finally {
          qc.clear();
          router.replace('/login');
        }
      },
      refresh: () => me.refetch(),
    };
  }, [me, qc, router]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
