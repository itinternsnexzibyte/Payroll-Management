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
  /**
   * Which monthly input column receives amounts from other modules when "Fill from leave, advances
   * and bonuses" is used on a payroll run. null = not mapped (that module is not filled).
   */
  inputMappings: z.object({
    unpaidLeaveDays: z.string().max(40).nullable(),
    advanceRecovery: z.string().max(40).nullable(),
    bonus: z.string().max(40).nullable(),
    incentive: z.string().max(40).nullable(),
  }),
  /** Email notifications (no amounts are ever included in emails). */
  emailNotifications: z.object({
    reviewRequests: z.boolean(),
    readyToFinalise: z.boolean(),
    payslipsAvailable: z.boolean(),
    leaveDecisions: z.boolean(),
  }),
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
  inputMappings: { unpaidLeaveDays: null, advanceRecovery: null, bonus: null, incentive: null },
  emailNotifications: { reviewRequests: true, readyToFinalise: true, payslipsAvailable: true, leaveDecisions: true },
};

export async function getSettings(db: Tx | typeof prisma = prisma): Promise<PayrollSettings> {
  const rows = await db.payrollSetting.findMany();
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) merged[r.key] = r.value;
  const parsed = settingsSchema.safeParse(merged);
  return parsed.success ? (parsed.data as PayrollSettings) : DEFAULT_SETTINGS;
}
