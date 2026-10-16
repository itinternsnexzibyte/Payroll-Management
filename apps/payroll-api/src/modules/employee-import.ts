/**
 * Employee import validation — pure functions, unit tested.
 * Only the fields approved in the specification are importable; bank/identity fields are
 * deliberately absent until the client workbook confirms them.
 */

export const IMPORT_FIELDS = [
  { key: 'employeeCode', label: 'Employee ID', required: true, synonyms: ['employeeid', 'empid', 'employeecode', 'empcode', 'code', 'id'] },
  { key: 'fullName', label: 'Employee Name', required: true, synonyms: ['employeename', 'name', 'fullname', 'empname'] },
  { key: 'department', label: 'Department', required: false, synonyms: ['department', 'dept'] },
  { key: 'designation', label: 'Designation', required: false, synonyms: ['designation', 'title', 'jobtitle', 'role'] },
  { key: 'joiningDate', label: 'Joining Date', required: true, synonyms: ['joiningdate', 'dateofjoining', 'doj', 'joindate'] },
  { key: 'exitDate', label: 'Exit Date', required: false, synonyms: ['exitdate', 'dateofexit', 'doe', 'leavingdate', 'relievingdate'] },
  { key: 'status', label: 'Status', required: false, synonyms: ['status', 'employmentstatus'] },
] as const;

export type ImportFieldKey = (typeof IMPORT_FIELDS)[number]['key'];
export type ColumnMapping = Partial<Record<ImportFieldKey, string>>;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export function suggestMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  for (const f of IMPORT_FIELDS) {
    const match = headers.find((h) => (f.synonyms as readonly string[]).includes(norm(h)) || norm(h) === norm(f.label));
    if (match) mapping[f.key] = match;
  }
  return mapping;
}

/** Parses YYYY-MM-DD, DD-MM-YYYY or DD/MM/YYYY (day first, as used in India). */
export function parseImportDate(raw: string): Date | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s))) [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  if (y < 1950 || y > 2100) return null;
  return date;
}

export interface ValidatedEmployeeRow {
  employeeCode: string;
  fullName: string;
  departmentId: string | null;
  designationId: string | null;
  joiningDate: Date;
  exitDate: Date | null;
  status: 'ACTIVE' | 'INACTIVE' | 'EXITED';
}

export interface RowResult {
  rowNumber: number;
  raw: Record<string, string>;
  errors: string[];
  value?: ValidatedEmployeeRow;
}

export const EMPLOYEE_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9/_-]{0,29}$/;

export function validateImportRows(
  rows: Record<string, string>[],
  mapping: ColumnMapping,
  lookups: { departments: Map<string, string>; designations: Map<string, string>; existingCodes: Set<string> },
): RowResult[] {
  const missingRequired = IMPORT_FIELDS.filter((f) => f.required && !mapping[f.key]).map((f) => f.label);
  const seen = new Map<string, number>();
  return rows.map((raw, i) => {
    const rowNumber = i + 2; // header is row 1
    const errors: string[] = [];
    if (missingRequired.length) errors.push(`Required column(s) not mapped: ${missingRequired.join(', ')}.`);
    const get = (k: ImportFieldKey) => (mapping[k] ? (raw[mapping[k]!] ?? '').trim() : '');

    const employeeCode = get('employeeCode');
    if (!employeeCode) errors.push('Employee ID is required.');
    else if (!EMPLOYEE_CODE_RE.test(employeeCode)) errors.push(`Employee ID "${employeeCode}" contains invalid characters.`);
    else {
      const key = employeeCode.toLowerCase();
      if (lookups.existingCodes.has(key)) errors.push(`Employee ID "${employeeCode}" already exists.`);
      if (seen.has(key)) errors.push(`Employee ID "${employeeCode}" is duplicated in the file (also row ${seen.get(key)}).`);
      else seen.set(key, rowNumber);
    }

    const fullName = get('fullName');
    if (!fullName) errors.push('Employee Name is required.');
    else if (fullName.length > 120) errors.push('Employee Name must be at most 120 characters.');

    let departmentId: string | null = null;
    const dept = get('department');
    if (dept) {
      departmentId = lookups.departments.get(dept.toLowerCase()) ?? null;
      if (!departmentId) errors.push(`Unknown department "${dept}". Add it under Settings first.`);
    }
    let designationId: string | null = null;
    const desig = get('designation');
    if (desig) {
      designationId = lookups.designations.get(desig.toLowerCase()) ?? null;
      if (!designationId) errors.push(`Unknown designation "${desig}". Add it under Settings first.`);
    }

    const joiningRaw = get('joiningDate');
    const joiningDate = joiningRaw ? parseImportDate(joiningRaw) : null;
    if (!joiningRaw) errors.push('Joining Date is required.');
    else if (!joiningDate) errors.push(`Joining Date "${joiningRaw}" is not a valid date (use YYYY-MM-DD or DD/MM/YYYY).`);

    const exitRaw = get('exitDate');
    const exitDate = exitRaw ? parseImportDate(exitRaw) : null;
    if (exitRaw && !exitDate) errors.push(`Exit Date "${exitRaw}" is not a valid date (use YYYY-MM-DD or DD/MM/YYYY).`);
    if (joiningDate && exitDate && exitDate < joiningDate) errors.push('Exit Date cannot be before Joining Date.');

    const statusRaw = get('status').toUpperCase();
    let status: ValidatedEmployeeRow['status'] = exitDate ? 'EXITED' : 'ACTIVE';
    if (statusRaw) {
      if (!['ACTIVE', 'INACTIVE', 'EXITED'].includes(statusRaw)) errors.push(`Status "${get('status')}" must be Active, Inactive or Exited.`);
      else status = statusRaw as ValidatedEmployeeRow['status'];
    }
    if (status === 'EXITED' && !exitDate) errors.push('Exit Date is required when Status is Exited.');

    if (errors.length) return { rowNumber, raw, errors };
    return { rowNumber, raw, errors, value: { employeeCode, fullName, departmentId, designationId, joiningDate: joiningDate!, exitDate, status } };
  });
}
