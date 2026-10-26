import { AuthService, SignupService, createBaseApp, createLogger, registerSignupRoutes } from '@nexzi/server-core';
import { mailer } from './mail';
import { signupStore } from './signup-store';
import { authStore } from './auth-store';
import { audit } from './audit';
import { config, COOKIE_NAME } from './config';
import { prisma } from './db';
import { prepareDatabase } from './database-bootstrap';
import { registerUserRoutes } from './modules/users';
import { registerMasterRoutes } from './modules/masters';
import { registerEmployeeRoutes } from './modules/employees';
import { registerSalaryRoutes } from './modules/salary';
import { registerPayrollRoutes } from './payroll/routes';
import { registerOutputRoutes } from './output/routes';
import { registerAnomalyRoutes } from './anomalies/routes';
import { registerReconciliationRoutes } from './reconciliation/routes';
import { registerKnowledgeRoutes } from './knowledge/routes';
import { registerInputToolRoutes } from './payroll/input-tools';
import { registerLeaveRoutes } from './leave/routes';
import { registerLoanRoutes } from './loans/routes';
import { registerBonusRoutes } from './bonuses/routes';
import { registerSelfServiceRoutes } from './self-service/routes';
import { registerStatutoryRoutes } from './statutory/routes';
import { registerBankRoutes } from './bank/routes';
import { registerAttendanceRoutes } from './attendance/routes';
import { registerAttendanceSessionRoutes } from './attendance/sessions';
import { registerWorkforceRoutes } from './workforce/routes';
import { registerCalendarNotificationRoutes } from './calendar/routes';
import { registerEmployeeWorkforceDetailsRoutes } from './workforce/details';
import { registerClientRoutes } from './clients/routes';
import { registerAnalyticsRoutes } from './analytics/routes';

export const logger = createLogger('payroll-api', config.LOG_LEVEL);

export function createApp() {
  const auth = new AuthService(
    authStore,
    {
      cookieName: COOKIE_NAME,
      cookieSecure: config.COOKIE_SECURE,
      idleTimeoutMinutes: config.SESSION_IDLE_MINUTES,
      absoluteTimeoutHours: config.SESSION_ABSOLUTE_HOURS,
      maxFailedAttempts: config.LOGIN_MAX_FAILED_ATTEMPTS,
      lockoutMinutes: config.LOGIN_LOCKOUT_MINUTES,
    },
    audit,
  );
  const signupConfig = {
    appName: 'Payroll Management',
    enabled: config.SIGNUP_ENABLED,
    requireApproval: config.SIGNUP_REQUIRE_APPROVAL,
    allowedDomains: config.SIGNUP_ALLOWED_DOMAINS,
    adminSignup: config.ADMIN_SIGNUP,
    // Self-registered accounts get the Payroll User role; Administrator requests wait for approval.
    roles: { user: 'PAYROLL_USER', admin: 'ADMIN' },
  };
  const signup = new SignupService(signupStore, mailer, audit, signupConfig);
  return createBaseApp({
    name: 'Payroll Management',
    version: '0.1.0',
    description:
      'REST API for the NexziByte Payroll Management application. All endpoints except /auth/login, sign-up, /health and /ready require the session cookie, and permissions are enforced on every request.',
    logger,
    allowedOrigins: config.ALLOWED_ORIGINS,
    beforeRequest: process.env.VERCEL ? () => prepareDatabase(logger) : undefined,
    auth,
    cookieName: COOKIE_NAME,
    publicApiPrefix: config.PUBLIC_API_PREFIX,
    readiness: async () => {
      await prisma.$queryRaw`SELECT 1`;
    },
    loginRateLimit: config.NODE_ENV === 'test' ? { windowMs: 60_000, max: 1000 } : undefined,
    register: (r) => {
      registerSignupRoutes(r, signup, signupConfig, mailer);
      registerUserRoutes(r);
      registerMasterRoutes(r);
      registerEmployeeRoutes(r);
      registerSalaryRoutes(r);
      registerPayrollRoutes(r);
      registerOutputRoutes(r);
      registerAnomalyRoutes(r);
      registerReconciliationRoutes(r);
      registerKnowledgeRoutes(r);
      registerInputToolRoutes(r);
      registerLeaveRoutes(r);
      registerLoanRoutes(r);
      registerBonusRoutes(r);
      registerSelfServiceRoutes(r);
      registerStatutoryRoutes(r);
      registerBankRoutes(r);
      registerAttendanceRoutes(r);
      registerAttendanceSessionRoutes(r);
      registerWorkforceRoutes(r);
      registerEmployeeWorkforceDetailsRoutes(r);
      registerClientRoutes(r);
      registerCalendarNotificationRoutes(r);
      registerAnalyticsRoutes(r);
    },
    meExtras: async (userId) => ({
      app: 'payroll',
      rulesApproved: config.PAYROLL_RULES_APPROVED,
      // Self-service menu items are shown only to accounts linked to an employee record.
      employeeLinked: Boolean((await prisma.user.findUnique({ where: { id: userId }, select: { employeeId: true } }))?.employeeId),
    }),
  });
}
