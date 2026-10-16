import { describe, expect, it } from 'vitest';
import { parseImportDate, suggestMapping, validateImportRows } from '../../src/modules/employee-import';

const lookups = () => ({
  departments: new Map([['sales', 'd1']]),
  designations: new Map([['officer', 'g1']]),
  existingCodes: new Set(['e-100']),
});
const headers = ['Employee ID', 'Employee Name', 'Department', 'Designation', 'Joining Date', 'Exit Date', 'Status'];
const mapping = suggestMapping(headers);

describe('employee import validation', () => {
  it('suggests a column mapping from common headings', () => {
    expect(mapping).toEqual({ employeeCode: 'Employee ID', fullName: 'Employee Name', department: 'Department', designation: 'Designation', joiningDate: 'Joining Date', exitDate: 'Exit Date', status: 'Status' });
    expect(suggestMapping(['Emp Code', 'Name', 'DOJ'])).toMatchObject({ employeeCode: 'Emp Code', fullName: 'Name', joiningDate: 'DOJ' });
  });

  it('parses ISO and day-first dates and rejects impossible ones', () => {
    expect(parseImportDate('2024-02-29')?.toISOString().slice(0, 10)).toBe('2024-02-29');
    expect(parseImportDate('05/03/2024')?.toISOString().slice(0, 10)).toBe('2024-03-05');
    expect(parseImportDate('31-04-2024')).toBeNull();
    expect(parseImportDate('2023-02-29')).toBeNull();
    expect(parseImportDate('yesterday')).toBeNull();
  });

  it('accepts valid rows and reports row-level errors', () => {
    const rows = [
      { 'Employee ID': 'E-1', 'Employee Name': 'Valid Person', Department: 'Sales', Designation: 'Officer', 'Joining Date': '2024-01-10', 'Exit Date': '', Status: '' },
      { 'Employee ID': 'E-100', 'Employee Name': 'Existing', Department: '', Designation: '', 'Joining Date': '2024-01-10', 'Exit Date': '', Status: '' },
      { 'Employee ID': 'E-1', 'Employee Name': 'Duplicate In File', Department: '', Designation: '', 'Joining Date': '2024-01-10', 'Exit Date': '', Status: '' },
      { 'Employee ID': 'E-3', 'Employee Name': '', Department: 'Unknown', Designation: '', 'Joining Date': '10/13/2024', 'Exit Date': '', Status: 'Maybe' },
      { 'Employee ID': 'E-4', 'Employee Name': 'Exit Before Join', Department: '', Designation: '', 'Joining Date': '2024-05-01', 'Exit Date': '2024-04-01', Status: '' },
    ];
    const res = validateImportRows(rows, mapping, lookups());
    expect(res[0].errors).toEqual([]);
    expect(res[0].value).toMatchObject({ employeeCode: 'E-1', departmentId: 'd1', designationId: 'g1', status: 'ACTIVE' });
    expect(res[1].errors[0]).toMatch(/already exists/);
    expect(res[2].errors[0]).toMatch(/duplicated in the file \(also row 2\)/);
    expect(res[3].errors).toEqual(expect.arrayContaining([expect.stringMatching(/Name is required/), expect.stringMatching(/Unknown department/), expect.stringMatching(/not a valid date/), expect.stringMatching(/Status/)]));
    expect(res[4].errors[0]).toMatch(/Exit Date cannot be before/);
    expect(res[4].rowNumber).toBe(6);
  });

  it('reports unmapped required columns on every row', () => {
    const res = validateImportRows([{ Name: 'x' }], { fullName: 'Name' }, lookups());
    expect(res[0].errors[0]).toMatch(/Required column\(s\) not mapped: Employee ID, Joining Date/);
  });
});
