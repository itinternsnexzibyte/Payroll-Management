import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

/** Loads `.env` from the working directory (if present) without overriding real environment variables. */
export function loadDotEnv(file = '.env'): void {
  const path = resolve(process.cwd(), file);
  if (existsSync(path) && typeof process.loadEnvFile === 'function') process.loadEnvFile(path);
}

export const envBool = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((v) => v === 'true' || v === '1');

export const commonEnvShape = {
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive(),
  DATABASE_URL: z.string().min(1),
  ALLOWED_ORIGINS: z.string().min(1).transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean)),
  PUBLIC_API_PREFIX: z.string().default('/api'),
  COOKIE_SECURE: envBool,
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(240).default(30),
  SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).max(24).default(8),
  LOGIN_MAX_FAILED_ATTEMPTS: z.coerce.number().int().min(3).max(20).default(5),
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  STORAGE_DIR: z.string().default('./storage'),
  LOG_LEVEL: z.string().default('info'),
};

export function parseEnv<S extends z.ZodRawShape>(shape: S): z.output<z.ZodObject<S>> {
  const result = z.object(shape).safeParse(process.env);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  const env = result.data as z.output<z.ZodObject<S>> & { NODE_ENV?: string; COOKIE_SECURE?: boolean };
  if (env.NODE_ENV === 'production' && env.COOKIE_SECURE === false) {
    throw new Error('COOKIE_SECURE must be true in production (HTTPS is required).');
  }
  return env;
}
