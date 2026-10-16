import { z } from 'zod';
import { commonEnvShape, envBool, loadDotEnv, parseEnv } from '@nexzi/server-core';

loadDotEnv();

export const config = parseEnv({
  ...commonEnvShape,
  PORT: z.coerce.number().int().positive().default(4001),
  PAYROLL_RULES_APPROVED: envBool,
  VIEWER_ROLE_ENABLED: envBool,
  PAYSLIP_FORMAT_APPROVED: envBool,
  PAYSLIP_COMPANY_NAME: z.string().default('[Client company name — awaiting approved payslip format]'),
});

export const COOKIE_NAME = config.COOKIE_SECURE ? '__Host-payroll_session' : 'payroll_session';
