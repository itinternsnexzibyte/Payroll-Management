import { z } from 'zod';
import { commonEnvShape, envBool, loadDotEnv, mailEnvShape, parseEnv, signupEnvShape } from '@nexzi/server-core';

loadDotEnv();

export const config = parseEnv({
  ...commonEnvShape,
  ...mailEnvShape,
  ...signupEnvShape,
  PORT: z.coerce.number().int().positive().default(4001),
  PAYROLL_RULES_APPROVED: envBool,
  VIEWER_ROLE_ENABLED: envBool,
  PAYSLIP_FORMAT_APPROVED: envBool,
  /**
   * 32-byte key (base64) that encrypts employee bank account numbers at rest. Without it, bank
   * details cannot be stored or exported. Losing it makes stored account numbers unreadable.
   */
  BANK_DATA_KEY: z
    .string()
    .optional()
    .refine((v) => !v || Buffer.from(v, 'base64').length === 32, 'BANK_DATA_KEY must be 32 bytes, base64-encoded'),
  /** Dedicated 32-byte AES-256-GCM key for private client identity and agreement documents. */
  CLIENT_DATA_KEY: z
    .string()
    .optional()
    .refine((v) => !v || Buffer.from(v, 'base64').length === 32, 'CLIENT_DATA_KEY must be 32 bytes, base64-encoded'),
  PAYSLIP_COMPANY_NAME: z.string().default('NexziByte Solutions Pvt Ltd'),
});

export const COOKIE_NAME = config.COOKIE_SECURE ? '__Host-payroll_session' : 'payroll_session';
