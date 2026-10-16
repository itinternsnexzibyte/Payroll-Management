/**
 * Permission catalogue. Roles are permission sets stored in the database, so the client's final
 * matrix (Phase 1) is applied by editing role permissions in the admin UI — not by code changes.
 */
export const PERMISSIONS = {
  'users.manage': 'Manage users and roles',
  'audit.view': 'View the audit log',
  'settings.manage': 'Manage payroll settings, departments, designations and input columns',
  'employees.view': 'View employees',
  'employees.manage': 'Create, edit, import and deactivate employees',
  'salary.view': 'View salary structures and amounts',
  'salary.manage': 'Change salary components and employee salary versions',
  'payroll.view': 'View payroll runs, status and exceptions',
  'payroll.view_amounts': 'View payroll amounts (earnings, deductions, net pay, totals)',
  'payroll.input': 'Create payroll runs and enter monthly inputs',
  'payroll.calculate': 'Calculate payroll and submit for review',
  'payroll.approve': 'Approve payroll runs',
  'payroll.finalise': 'Finalise payroll runs',
  'payroll.reopen': 'Re-open finalised payroll (reason required)',
  'payslips.generate': 'Generate and download payslips',
  'reports.view': 'View and export payroll reports',
  'knowledge.manage': 'Edit the knowledge & handover centre and the monthly checklist',
  'leave.view': 'View leave requests and balances',
  'leave.manage': 'Record leave requests for employees and manage leave types and allowances',
  'leave.approve': 'Approve or reject leave requests',
  'loans.manage': 'Record and close loans and salary advances',
  'bonuses.manage': 'Propose bonuses and incentives (approval needs Approve payroll)',
  'self.service': 'Employee self-service: own payslips, own details and own leave requests',
  'bank.view': 'View employee bank details (account numbers masked)',
  'bank.manage': 'Add and change employee bank details',
  'bank.export': 'Generate the bank salary file for finalised payroll',
  'integrations.manage': 'Manage the attendance application connection, its API keys and received attendance',
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ROLE_DEFAULTS: Record<string, { name: string; description: string; permissions: Permission[]; enabledByDefault: boolean }> = {
  ADMIN: {
    name: 'Administrator',
    description: 'Full access including users, salary structures, approval, finalisation, re-opening and audit log.',
    permissions: Object.keys(PERMISSIONS) as Permission[],
    enabledByDefault: true,
  },
  PAYROLL_USER: {
    name: 'Payroll User',
    // Starting matrix from the specification. "Create/edit employees", "change salary" and
    // "approve/finalise" are pending the client's decision; grant them via Roles if confirmed.
    description: 'Enters monthly inputs, calculates payroll, reviews results, generates payslips and reports.',
    permissions: ['employees.view', 'salary.view', 'payroll.view', 'payroll.view_amounts', 'payroll.input', 'payroll.calculate', 'payslips.generate', 'reports.view', 'leave.view', 'leave.manage', 'loans.manage', 'bonuses.manage'],
    enabledByDefault: true,
  },
  EMPLOYEE: {
    name: 'Employee',
    description: 'Employee self-service: sees only their own payslips and details, and requests their own leave. The account must be linked to an employee record.',
    permissions: ['self.service'],
    enabledByDefault: true,
  },
  VIEWER: {
    name: 'Viewer / Management',
    description: 'Optional read-only role. Disabled until the client confirms it is required. Sees no salary amounts unless granted.',
    permissions: ['employees.view', 'payroll.view'],
    enabledByDefault: false,
  },
};
