export type RunStatus = 'DRAFT' | 'CALCULATED' | 'UNDER_REVIEW' | 'APPROVED' | 'FINALISED';

export interface NamedRef {
  id: string;
  name: string;
}

export interface Employee {
  id: string;
  employeeCode: string;
  fullName: string;
  department: NamedRef | null;
  designation: NamedRef | null;
  joiningDate: string;
  exitDate: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'EXITED';
  payrollRunCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Master extends NamedRef {
  active: boolean;
  _count?: { employees: number };
}

export interface SalaryComponent {
  id: string;
  code: string;
  name: string;
  type: 'EARNING' | 'DEDUCTION';
  basis: 'FIXED' | 'PERCENTAGE' | 'INPUT' | 'FORMULA';
  percentOfCode: string | null;
  defaultPercentage: string | null;
  inputKey: string | null;
  formulaRef: string | null;
  sortOrder: number;
  active: boolean;
  showOnPayslip: boolean;
  description: string | null;
  formulaStatus: 'CONFIGURED' | 'AWAITING_CLIENT_WORKBOOK' | null;
}

export interface InputDefinition {
  id: string;
  key: string;
  label: string;
  dataType: 'NUMBER' | 'TEXT';
  mandatory: boolean;
  minValue: string | null;
  maxValue: string | null;
  sortOrder: number;
  active: boolean;
  description: string | null;
}

export interface SalaryVersion {
  id: string;
  versionNo: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  changeReason: string | null;
  createdAt: string;
  values: { componentId: string; code: string; name: string; type: string; basis: string; value: string }[];
  changes?: { code: string; name: string; from: string | null; to: string | null }[];
}

export interface RunSummary {
  id: string;
  year: number;
  month: number;
  period: string;
  status: RunStatus;
  employeeCount: number;
  totalEarnings: string | null;
  totalDeductions: string | null;
  totalNet: string | null;
  rulesApproved: boolean;
  calculatedAt: string | null;
  finalisedAt: string | null;
  reopenCount: number;
  createdAt: string;
}

export interface CalcException {
  code: string;
  severity: 'ERROR' | 'WARNING';
  message: string;
  field?: string;
}

export interface RunDetail extends RunSummary {
  canSeeAmounts: boolean;
  allowedActions: string[];
  requireApprovalStep: boolean;
  resultCounts: Record<string, number>;
  componentColumns: { code: string; name: string; type: 'EARNING' | 'DEDUCTION' }[];
  employees: {
    employeeId: string;
    employeeCode: string;
    employeeName: string;
    department: string | null;
    designation: string | null;
    hasSalaryVersion: boolean;
    resultStatus: string;
    exceptions: CalcException[];
    gross: string | null;
    deductions: string | null;
    net: string | null;
    lines: Record<string, string>;
  }[];
  events: { action: string; fromStatus: string | null; toStatus: string; reason: string | null; actorName: string | null; occurredAt: string }[];
}

export interface Settings {
  rounding: { scale: number; mode: string; level: 'LINE' | 'TOTAL' };
  salaryVersionRule: 'MONTH_END' | 'MONTH_START';
  requireApprovalStep: boolean;
  separateApprover: boolean;
  unusualChangeThresholdPercent: number | null;
  rulesApproved: boolean;
  viewerRoleEnabled: boolean;
  payslipCompanyName: string;
}

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
