import { z } from 'zod';

export const paginationQuery = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
};

/** Builds a list-query schema with a whitelisted sort field. */
export function listQuery<const S extends readonly [string, ...string[]], E extends z.ZodRawShape>(sortFields: S, defaultSort: S[number], extra: E) {
  return z.object({
    ...paginationQuery,
    sortBy: z.enum(sortFields).default(defaultSort as never),
    search: z.string().trim().max(100).optional(),
    ...extra,
  });
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function toPage<T>(items: T[], total: number, page: number, pageSize: number): Page<T> {
  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export const skipTake = (page: number, pageSize: number) => ({ skip: (page - 1) * pageSize, take: pageSize });

/** Optional boolean query param that accepts "true"/"false". */
export const queryBool = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === 'true'));

/** ISO date (YYYY-MM-DD) parsed as a UTC midnight Date. */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD.')
  .refine((s) => !Number.isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().startsWith(s), 'Enter a valid date.')
  .transform((s) => new Date(s + 'T00:00:00Z'));

export const idParam = z.object({ id: z.string().uuid('Invalid identifier.') });

export const toIsoDate = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
