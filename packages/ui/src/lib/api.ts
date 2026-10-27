/**
 * Typed fetch client. All calls go to `/api/*` on the web app's own origin, which Next.js proxies
 * to the backend — so the httpOnly session cookie stays first-party and SameSite=Strict.
 */
export interface FieldIssue {
  path: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: FieldIssue[] = [],
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
  fieldMap(): Record<string, string> {
    return Object.fromEntries(this.fields.map((f) => [f.path, f.message]));
  }
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

type QueryValue = string | number | boolean | null | undefined;
export function qs(params: Record<string, QueryValue>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

let onUnauthenticated: ((code: string) => void) | null = null;
export const setUnauthenticatedHandler = (fn: (code: string) => void) => {
  onUnauthenticated = fn;
};

async function toError(res: Response): Promise<ApiError> {
  let body: { error?: { code?: string; message?: string; fields?: FieldIssue[]; [k: string]: unknown } } = {};
  try {
    body = await res.json();
  } catch {
    /* non-JSON */
  }
  const e = body.error ?? {};
  const { code, message, fields, ...rest } = e;
  return new ApiError(res.status, code ?? `HTTP_${res.status}`, message ?? (res.status >= 500 ? 'The server could not complete the request. Please try again.' : 'The request failed.'), fields ?? [], rest);
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? 'GET',
      credentials: 'same-origin',
      headers: init.body !== undefined && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
      body: init.body === undefined ? undefined : init.body instanceof FormData ? init.body : JSON.stringify(init.body),
      signal: init.signal,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection and try again.');
  }
  if (!res.ok) {
    const err = await toError(res);
    if (res.status === 401 && onUnauthenticated && !path.startsWith('/auth/login')) onUnauthenticated(err.code);
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const get = <T>(path: string, signal?: AbortSignal) => api<T>(path, { signal });

/**
 * The API is unreachable (asleep, restarting or mid-deploy) rather than refusing the request.
 * A bare 500 with no API error code comes from the web proxy failing to reach the API at all.
 */
export const isServerUnavailable = (e: unknown) =>
  e instanceof ApiError && (e.status === 0 || e.status === 502 || e.status === 503 || e.status === 504 || (e.status === 500 && e.code === 'HTTP_500'));

/**
 * Polls the API's readiness check until it answers, for hosts that put an idle server to sleep.
 * Resolves true once ready, false after `timeoutMs`.
 */
export async function waitForServer(timeoutMs = 120_000, signal?: AbortSignal): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !signal?.aborted) {
    try {
      const res = await fetch('/api/ready', { cache: 'no-store', signal });
      if (res.ok) return true;
    } catch {
      /* still waking up */
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
}
export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: body ?? {} });
export const put = <T>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body });
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });

/** Downloads a file from an authenticated endpoint and saves it with the server-provided name. */
export async function download(path: string, fallbackName = 'download'): Promise<void> {
  const res = await fetch(`/api${path}`, { credentials: 'same-origin' });
  if (!res.ok) throw await toError(res);
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const name = /filename="?([^";]+)"?/.exec(cd)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Opens an authenticated PDF in a new tab for viewing/printing. */
export async function openPdf(path: string): Promise<void> {
  const win = window.open('', '_blank');
  const res = await fetch(`/api${path}`, { credentials: 'same-origin' });
  if (!res.ok) {
    win?.close();
    throw await toError(res);
  }
  const url = URL.createObjectURL(await res.blob());
  if (win) win.location.href = url;
  else window.location.href = url;
}

export const errorMessage = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Something went wrong.');
