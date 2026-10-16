import { z } from 'zod';
import type { RoundingRule } from './payroll/engine';
import { prisma, type Tx } from './db';
import { DEFAULT_ANOMALY_RULES } from './anomalies/rules';

export const settingsSchema = z.object({
  rounding: z.object({
    scale: z.number().int().min(0).max(4),
    mode: z.enum(['HALF_UP', 'HALF_EVEN', 'UP', 'DOWN', 'CEIL', 'FLOOR']),
    level: z.enum(['LINE', 'TOTAL']),
  }),
  salaryVersionRule: z.enum(['MONTH_END', 'MONTH_START']),
  requireApprovalStep: z.boolean(),
  separateApprover: z.boolean(),
  unusualChangeThresholdPercent: z.number().min(1).max(1000).nullable(),
  /** Anomaly alert thresholds (change request A). Placeholders until agreed with the client. */
  anomalyRules: z.object({
    enabled: z.boolean(),
    netChangePercent: z.number().min(1).max(1000),
    componentChangePercent: z.number().min(1).max(1000),
    minAbsoluteChange: z.number().min(0).max(10_000_000),
    historyMonths: z.number().int().min(2).max(24),
    minHistoryMonths: z.number().int().min(2).max(24),
    outlierMultiplier: z.number().min(1).max(20),
  }),
});

export type PayrollSettings = z.infer<typeof settingsSchema> & { rounding: RoundingRule };

/**
 * Defaults are PROVISIONAL placeholders (documented in docs/client-questions.md) and must be
 * replaced with the client's confirmed rules: rounding from the Excel, approval policy, etc.
 */
export const DEFAULT_SETTINGS: PayrollSettings = {
  rounding: { scale: 2, mode: 'HALF_UP', level: 'LINE' },
  salaryVersionRule: 'MONTH_END',
  requireApprovalStep: true,
  separateApprover: false,
  unusualChangeThresholdPercent: null,
  anomalyRules: DEFAULT_ANOMALY_RULES,
};

export async function getSettings(db: Tx | typeof prisma = prisma): Promise<PayrollSettings> {
  const rows = await db.payrollSetting.findMany();
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) merged[r.key] = r.value;
  const parsed = settingsSchema.safeParse(merged);
  return parsed.success ? (parsed.data as PayrollSettings) : DEFAULT_SETTINGS;
}
