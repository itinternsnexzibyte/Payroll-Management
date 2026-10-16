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
  contactEmail?: string | null;
  contactPhone?: string | null;
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
  formulaStatus: 'CONFIGURED' | 'STATUTORY' | 'AWAITING_CLIENT_WORKBOOK' | null;
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
  anomalyRules: AnomalyRules;
  inputMappings: { unpaidLeaveDays: string | null; advanceRecovery: string | null; bonus: string | null; incentive: string | null };
  emailNotifications: { reviewRequests: boolean; readyToFinalise: boolean; payslipsAvailable: boolean; leaveDecisions: boolean };
  rulesApproved: boolean;
  viewerRoleEnabled: boolean;
  payslipCompanyName: string;
}

export interface AnomalyRules {
  enabled: boolean;
  netChangePercent: number;
  componentChangePercent: number;
  minAbsoluteChange: number;
  historyMonths: number;
  minHistoryMonths: number;
  outlierMultiplier: number;
}

export type Severity = 'LOW' | 'MEDIUM' | 'HIGH';

export interface Anomaly {
  id: string;
  runId: string;
  period: string;
  runStatus: RunStatus;
  employeeId: string | null;
  employeeCode: string | null;
  employeeName: string | null;
  componentCode: string | null;
  rule: string;
  ruleLabel: string;
  severity: Severity;
  status: 'OPEN' | 'REVIEWED' | 'CLEARED';
  message: string;
  details: Record<string, unknown>;
  reviewOutcome: string | null;
  reviewOutcomeLabel: string | null;
  reviewComment: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  detectedAt: string;
  lastDetectedAt: string;
  clearedAt: string | null;
}

export interface AnomalyCounts {
  open: number;
  reviewed: number;
  cleared: number;
  openHigh: number;
  openMedium: number;
  openLow: number;
}

export type ChangeKind = 'NEW' | 'MISSING' | 'CHANGED' | 'UNCHANGED';
export type Explanation = 'UNEXPLAINED' | 'EXPECTED' | 'DISCREPANCY' | 'RESOLVED';
export interface Amounts {
  gross: string;
  deductions: string;
  net: string;
}
export interface ReconNote {
  id: string;
  classification: 'EXPECTED' | 'DISCREPANCY' | 'RESOLVED';
  note: string;
  updatedByName: string | null;
  updatedAt: string;
}
export interface ReconEmployee {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  departmentName: string | null;
  change: ChangeKind;
  base: Amounts | null;
  compare: Amounts | null;
  difference: Amounts;
  netChangePercent: string | null;
  explanation: Explanation | null;
  note: ReconNote | null;
  components: { code: string; name: string; type: 'EARNING' | 'DEDUCTION'; base: string | null; compare: string | null; difference: string; changePercent: string | null; change: ChangeKind; note: ReconNote | null }[];
}
export interface Reconciliation {
  base: { runId: string; period: string; status: RunStatus; rulesApproved: boolean; employees: number };
  compare: { runId: string; period: string; status: RunStatus; rulesApproved: boolean; employees: number };
  totals: { base: Amounts; compare: Amounts; difference: Amounts; netChangePercent: string | null };
  components: { code: string; name: string; type: 'EARNING' | 'DEDUCTION'; base: string; compare: string; difference: string; changePercent: string | null }[];
  counts: Record<ChangeKind, number>;
  summary: { expected: number; unresolved: number; discrepancies: number; resolved: number; unexplained: number };
  departments: string[];
  employees: ReconEmployee[];
  canExplain: boolean;
}

export type KnowledgeCategory = 'PROCEDURE' | 'COMPONENT' | 'BUSINESS_RULE' | 'VALIDATION_ERROR' | 'ONBOARDING';
export interface ArticleSummary {
  id: string;
  slug: string;
  category: KnowledgeCategory;
  title: string;
  excerpt: string;
  componentCode: string | null;
  errorCode: string | null;
  status: 'DRAFT' | 'PUBLISHED';
  clientConfirmed: boolean;
  ownerId: string | null;
  ownerName: string | null;
  reviewDueAt: string | null;
  reviewOverdue: boolean;
  lastReviewedAt: string | null;
  lastReviewedBy: string | null;
  currentVersion: number;
  archived: boolean;
  updatedAt: string;
}
export interface ArticleDetail extends ArticleSummary {
  body: string;
  versions: { version: number; title: string; changeNote: string; createdAt: string; createdByName: string | null }[];
  canManage: boolean;
}

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
