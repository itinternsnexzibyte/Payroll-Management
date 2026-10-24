import { z } from 'zod';
import type { RoundingRule } from './payroll/engine';
import { prisma, type Tx } from './db';
import { DEFAULT_ANOMALY_RULES } from './anomalies/rules';
import { DEFAULT_STATUTORY, statutorySchema } from './statutory/rules';

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
    attendanceAlerts: z.boolean().default(false),
  }),
  /** Statutory deductions (PF, ESI, TDS) — every figure entered and confirmed by the payroll team. */
  statutory: statutorySchema,
  /**
   * Bank salary file layout. The default is a generic layout only: replace the columns with the
   * bank's published bulk-payment format before sending a file to the bank.
   */
  bankExport: z.object({
    format: z.enum(['CSV', 'XLSX']),
    includeHeader: z.boolean(),
    columns: z
      .array(
        z.object({
          header: z.string().trim().min(1).max(60),
          field: z.enum(['EMPLOYEE_CODE', 'EMPLOYEE_NAME', 'ACCOUNT_HOLDER', 'ACCOUNT_NUMBER', 'IFSC', 'BANK_NAME', 'NET_PAY', 'PAYMENT_DATE', 'PERIOD', 'FIXED']),
          /** For FIXED: the text written in every row (e.g. a transaction type the bank requires). */
          value: z.string().max(60).nullable(),
        }),
      )
      .min(1)
      .max(30),
    /** Date format for PAYMENT_DATE. */
    dateFormat: z.enum(['DD/MM/YYYY', 'DD-MM-YYYY', 'YYYY-MM-DD', 'DDMMYYYY']),
  }),
  /** Live attendance sync: maps the attendance application's fields to monthly input columns. */
  attendanceSync: z.object({
    enabled: z.boolean(),
    /** Apply received data to the payroll run immediately (Draft/Calculated runs only). */
    autoApply: z.boolean(),
    fieldMap: z.array(z.object({ source: z.string().trim().min(1).max(60), inputKey: z.string().trim().min(1).max(40) })).max(30),
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
  statutory: DEFAULT_STATUTORY,
  bankExport: {
    format: 'CSV',
    includeHeader: true,
    dateFormat: 'DD/MM/YYYY',
    columns: [
      { header: 'Employee ID', field: 'EMPLOYEE_CODE', value: null },
      { header: 'Beneficiary Name', field: 'ACCOUNT_HOLDER', value: null },
      { header: 'Account Number', field: 'ACCOUNT_NUMBER', value: null },
      { header: 'IFSC', field: 'IFSC', value: null },
      { header: 'Amount', field: 'NET_PAY', value: null },
      { header: 'Payment Date', field: 'PAYMENT_DATE', value: null },
      { header: 'Narration', field: 'PERIOD', value: null },
    ],
  },
  attendanceSync: { enabled: false, autoApply: false, fieldMap: [] },
  inputMappings: { unpaidLeaveDays: null, advanceRecovery: null, bonus: null, incentive: null },
  emailNotifications: { reviewRequests: true, readyToFinalise: true, payslipsAvailable: true, leaveDecisions: true, attendanceAlerts: false },
};

export async function getSettings(db: Tx | typeof prisma = prisma): Promise<PayrollSettings> {
  const rows = await db.payrollSetting.findMany();
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) merged[r.key] = r.value;
  const parsed = settingsSchema.safeParse(merged);
  return parsed.success ? (parsed.data as PayrollSettings) : DEFAULT_SETTINGS;
}
