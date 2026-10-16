export interface AuditEntry {
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  metadata?: unknown;
}

export interface AuditWriter {
  write(entry: AuditEntry): Promise<void>;
}

const SECRET_KEY = /pass(word)?|token|secret|hash|cookie|authorization/i;

/**
 * Produces a JSON-safe copy of a value with secret-bearing keys removed.
 * Decimal/Date values are converted to strings so audit rows are stable and readable.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (depth > 6) return '[truncated]';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'object') {
    const v = value as { toFixed?: unknown; d?: unknown; s?: unknown; e?: unknown };
    // Decimal.js / Prisma.Decimal
    if (typeof v.toFixed === 'function' && 'd' in v && 'e' in v && 's' in v) return String(value);
    if (Array.isArray(value)) return value.slice(0, 200).map((x) => redact(x, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) ? '[REDACTED]' : redact(val, depth + 1);
    }
    return out;
  }
  return value;
}

/** Returns only the keys whose values differ, as {before, after} — used for change summaries. */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  const rb = redact(before) as Record<string, unknown>;
  const ra = redact(after) as Record<string, unknown>;
  for (const key of new Set([...Object.keys(rb), ...Object.keys(ra)])) {
    if (JSON.stringify(rb[key]) !== JSON.stringify(ra[key])) {
      b[key] = rb[key] ?? null;
      a[key] = ra[key] ?? null;
    }
  }
  return { before: b, after: a };
}
