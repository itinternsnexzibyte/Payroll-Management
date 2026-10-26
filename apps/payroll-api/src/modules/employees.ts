import { z } from 'zod';
import {
  AppError,
  XLSX_MIME,
  attachment,
  buildCsv,
  buildXlsx,
  diff,
  idParam,
  isoDate,
  listQuery,
  notFound,
  parseSpreadsheet,
  skipTake,
  toIsoDate,
  toPage,
  type ApiRegistry,
  type SheetColumn,
} from '@nexzi/server-core';
import { prisma, Prisma } from '../db';
import { audit } from '../audit';
import { assertValidManager } from '../organization/routes';
import { EMPLOYEE_CODE_RE, IMPORT_FIELDS, suggestMapping, validateImportRows, type ColumnMapping } from './employee-import';

const employeeInclude = { department: { select: { id: true, name: true } }, designation: { select: { id: true, name: true } }, manager: { select: { id: true, fullName: true, employeeCode: true } } } satisfies Prisma.EmployeeInclude;
type EmployeeRow = Prisma.EmployeeGetPayload<{ include: typeof employeeInclude }>;

export function serializeEmployee(e: EmployeeRow) {
  return {
    id: e.id,
    employeeCode: e.employeeCode,
    fullName: e.fullName,
    department: e.department,
    designation: e.designation,
    joiningDate: toIsoDate(e.joiningDate),
    exitDate: toIsoDate(e.exitDate),
    status: e.status,
    contactEmail: e.contactEmail,
    contactPhone: e.contactPhone,
    manager: e.manager,
    panNumber: e.panNumber,
    uanNumber: e.uanNumber,
    pfNumber: e.pfNumber,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

const employeeBody = z
  .object({
    employeeCode: z.string().trim().regex(EMPLOYEE_CODE_RE, 'Use letters, digits, "-", "_" or "/" (max 30).'),
    fullName: z.string().trim().min(2, 'Enter the employee name.').max(120),
    departmentId: z.string().uuid().nullable().optional(),
    designationId: z.string().uuid().nullable().optional(),
    joiningDate: isoDate,
    exitDate: isoDate.nullable().optional(),
    status: z.enum(['ACTIVE', 'INACTIVE', 'EXITED']).default('ACTIVE'),
    contactEmail: z.string().trim().toLowerCase().email('Enter a valid email address.').max(200).nullable().optional().or(z.literal('').transform(() => null)),
    contactPhone: z
      .string()
      .trim()
      .regex(/^\+?[0-9 ()-]{7,20}$/, 'Enter a phone number with 7–20 digits (spaces, +, - and brackets allowed).')
      .nullable()
      .optional()
      .or(z.literal('').transform(() => null)),
    managerId: z.string().uuid().nullable().optional(),
    panNumber: z.string().trim().toUpperCase().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'Enter a 10-character PAN like ABCDE1234F.').nullable().optional().or(z.literal('').transform(() => null)),
    uanNumber: z.string().trim().regex(/^\d{12}$/, 'The UAN has 12 digits.').nullable().optional().or(z.literal('').transform(() => null)),
    pfNumber: z.string().trim().toUpperCase().regex(/^[A-Z0-9/]{5,30}$/, 'Use letters, digits and "/" (5–30 characters).').nullable().optional().or(z.literal('').transform(() => null)),
  })
  .superRefine((v, ctx) => {
    if (v.exitDate && v.exitDate < v.joiningDate) ctx.addIssue({ code: 'custom', path: ['exitDate'], message: 'Exit date cannot be before the joining date.' });
    if (v.status === 'EXITED' && !v.exitDate) ctx.addIssue({ code: 'custom', path: ['exitDate'], message: 'Exit date is required for exited employees.' });
  });

const listFilters = {
  status: z.enum(['ACTIVE', 'INACTIVE', 'EXITED']).optional(),
  departmentId: z.string().uuid().optional(),
  designationId: z.string().uuid().optional(),
};

function buildWhere(q: { search?: string; status?: 'ACTIVE' | 'INACTIVE' | 'EXITED'; departmentId?: string; designationId?: string }): Prisma.EmployeeWhereInput {
  return {
    ...(q.status ? { status: q.status } : {}),
    ...(q.departmentId ? { departmentId: q.departmentId } : {}),
    ...(q.designationId ? { designationId: q.designationId } : {}),
    ...(q.search ? { OR: [{ fullName: { contains: q.search, mode: 'insensitive' } }, { employeeCode: { contains: q.search, mode: 'insensitive' } }] } : {}),
  };
}

const EXPORT_COLUMNS: SheetColumn[] = [
  { header: 'Employee ID', key: 'employeeCode', width: 16 },
  { header: 'Employee Name', key: 'fullName', width: 30 },
  { header: 'Department', key: 'department', width: 20 },
  { header: 'Designation', key: 'designation', width: 20 },
  { header: 'Joining Date', key: 'joiningDate', width: 14 },
  { header: 'Exit Date', key: 'exitDate', width: 14 },
  { header: 'Status', key: 'status', width: 12 },
];

async function importLookups() {
  const [departments, designations, existing] = await Promise.all([
    prisma.department.findMany({ where: { active: true } }),
    prisma.designation.findMany({ where: { active: true } }),
    prisma.employee.findMany({ select: { employeeCode: true } }),
  ]);
  return {
    departments: new Map(departments.map((d) => [d.name.toLowerCase(), d.id])),
    designations: new Map(designations.map((d) => [d.name.toLowerCase(), d.id])),
    existingCodes: new Set(existing.map((e) => e.employeeCode.toLowerCase())),
  };
}

export function registerEmployeeRoutes(r: ApiRegistry) {
  r.add({
    method: 'get',
    path: '/employees',
    tag: 'Employees',
    summary: 'List and search employees',
    permission: 'employees.view',
    query: listQuery(['employeeCode', 'fullName', 'joiningDate', 'status', 'createdAt'], 'employeeCode', listFilters),
    handler: async ({ query }) => {
      const where = buildWhere(query);
      const [items, total] = await Promise.all([
        prisma.employee.findMany({ where, include: employeeInclude, orderBy: { [query.sortBy]: query.sortDir }, ...skipTake(query.page, query.pageSize) }),
        prisma.employee.count({ where }),
      ]);
      return toPage(items.map(serializeEmployee), total, query.page, query.pageSize);
    },
  });

  r.add({
    method: 'get',
    path: '/employees/export',
    tag: 'Employees',
    summary: 'Export employees (current filters) as CSV or XLSX',
    permission: 'employees.view',
    produces: 'xlsx',
    query: z.object({ format: z.enum(['csv', 'xlsx']).default('xlsx'), search: z.string().max(100).optional(), ...listFilters }),
    handler: async ({ query, res, user, ip }) => {
      const items = await prisma.employee.findMany({ where: buildWhere(query), include: employeeInclude, orderBy: { employeeCode: 'asc' } });
      const rows = items.map((e) => ({ ...serializeEmployee(e), department: e.department?.name ?? '', designation: e.designation?.name ?? '' }));
      await audit.write({ actorId: user.id, action: 'employee.exported', entity: 'employee', entityId: null, metadata: { count: rows.length, format: query.format }, ip });
      const stamp = new Date().toISOString().slice(0, 10);
      if (query.format === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', attachment(`employees-${stamp}.csv`));
        res.send(buildCsv(EXPORT_COLUMNS, rows));
      } else {
        res.setHeader('Content-Type', XLSX_MIME);
        res.setHeader('Content-Disposition', attachment(`employees-${stamp}.xlsx`));
        res.send(await buildXlsx([{ name: 'Employees', columns: EXPORT_COLUMNS, rows }]));
      }
    },
  });

  r.add({
    method: 'get',
    path: '/employees/import/template',
    tag: 'Employees',
    summary: 'Download a blank import template',
    permission: 'employees.manage',
    produces: 'xlsx',
    query: z.object({ format: z.enum(['csv', 'xlsx']).default('xlsx') }),
    handler: async ({ query, res }) => {
      const cols = IMPORT_FIELDS.map((f) => ({ header: f.label, key: f.key, width: 18 }));
      if (query.format === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', attachment('employee-import-template.csv'));
        res.send(buildCsv(cols, []));
      } else {
        res.setHeader('Content-Type', XLSX_MIME);
        res.setHeader('Content-Disposition', attachment('employee-import-template.xlsx'));
        res.send(await buildXlsx([{ name: 'Employees', columns: cols, rows: [] }]));
      }
    },
  });

  r.add({
    method: 'post',
    path: '/employees/import/preview',
    tag: 'Employees',
    summary: 'Upload a CSV/XLSX file and preview validation results (nothing is saved yet)',
    permission: 'employees.manage',
    status: 201,
    upload: { field: 'file', maxBytes: 5 * 1024 * 1024, extensions: ['csv', 'xlsx'] },
    handler: async ({ file, user }) => {
      const sheet = await parseSpreadsheet(file!);
      const mapping = suggestMapping(sheet.headers);
      const results = validateImportRows(sheet.rows, mapping, await importLookups());
      const job = await prisma.importJob.create({
        data: {
          type: 'EMPLOYEES',
          fileName: file!.originalName.slice(0, 200),
          status: 'PREVIEWED',
          totalRows: sheet.rows.length,
          errorRows: results.filter((x) => x.errors.length).length,
          headers: sheet.headers,
          mapping,
          rows: sheet.rows,
          createdById: user.id,
        },
      });
      return {
        jobId: job.id,
        fileName: job.fileName,
        headers: sheet.headers,
        fields: IMPORT_FIELDS.map(({ key, label, required }) => ({ key, label, required })),
        mapping,
        totalRows: sheet.rows.length,
        validRows: results.filter((x) => !x.errors.length).length,
        rows: results.slice(0, 500).map((x) => ({ rowNumber: x.rowNumber, raw: x.raw, errors: x.errors })),
      };
    },
  });

  const mappingSchema = z.object(Object.fromEntries(IMPORT_FIELDS.map((f) => [f.key, z.string().max(100).optional()])) as Record<string, z.ZodOptional<z.ZodString>>);

  r.add({
    method: 'post',
    path: '/employees/import/:id/validate',
    tag: 'Employees',
    summary: 'Re-validate a previewed import with a different column mapping',
    permission: 'employees.manage',
    params: idParam,
    body: z.object({ mapping: mappingSchema }),
    handler: async ({ params, body, user }) => {
      const job = await prisma.importJob.findUnique({ where: { id: params.id } });
      if (!job || job.createdById !== user.id) throw notFound('Import');
      if (job.status !== 'PREVIEWED') throw new AppError('INVALID_STATE', 'This import has already been processed.');
      const results = validateImportRows(job.rows as Record<string, string>[], body.mapping as ColumnMapping, await importLookups());
      await prisma.importJob.update({ where: { id: job.id }, data: { mapping: body.mapping, errorRows: results.filter((x) => x.errors.length).length } });
      return {
        jobId: job.id,
        mapping: body.mapping,
        totalRows: results.length,
        validRows: results.filter((x) => !x.errors.length).length,
        rows: results.slice(0, 500).map((x) => ({ rowNumber: x.rowNumber, raw: x.raw, errors: x.errors })),
      };
    },
  });

  r.add({
    method: 'post',
    path: '/employees/import/:id/commit',
    tag: 'Employees',
    summary: 'Import all valid rows; invalid rows are kept in a downloadable error report',
    permission: 'employees.manage',
    params: idParam,
    body: z.object({ mapping: mappingSchema }),
    handler: async ({ params, body, user, ip }) => {
      const job = await prisma.importJob.findUnique({ where: { id: params.id } });
      if (!job || job.createdById !== user.id) throw notFound('Import');
      if (job.status !== 'PREVIEWED') throw new AppError('INVALID_STATE', 'This import has already been processed.');
      const rows = job.rows as Record<string, string>[];
      const result = await prisma.$transaction(
        async (tx) => {
          // Re-validate inside the transaction so concurrent changes cannot create duplicates.
          const results = validateImportRows(rows, body.mapping as ColumnMapping, await importLookups());
          const valid = results.filter((x) => x.value);
          if (valid.length) {
            await tx.employee.createMany({ data: valid.map((x) => ({ ...x.value!, createdById: user.id, updatedById: user.id })) });
          }
          const errors = results.filter((x) => x.errors.length).map((x) => ({ rowNumber: x.rowNumber, raw: x.raw, errors: x.errors }));
          const status = errors.length === 0 ? 'COMPLETED' : valid.length === 0 ? 'FAILED' : 'PARTIAL';
          await tx.importJob.update({
            where: { id: job.id },
            data: { status, mapping: body.mapping, successRows: valid.length, errorRows: errors.length, errors, rows: [], completedAt: new Date() },
          });
          return { status, imported: valid.length, failed: errors.length };
        },
        { timeout: 60_000 },
      );
      await audit.write({ actorId: user.id, action: 'employee.imported', entity: 'import_job', entityId: job.id, metadata: { fileName: job.fileName, ...result }, ip });
      return { jobId: job.id, ...result };
    },
  });

  r.add({
    method: 'get',
    path: '/import-jobs',
    tag: 'Employees',
    summary: 'Recent import jobs',
    permission: 'employees.manage',
    handler: async () =>
      prisma.importJob.findMany({
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, type: true, fileName: true, status: true, totalRows: true, successRows: true, errorRows: true, createdAt: true, completedAt: true },
      }),
  });

  r.add({
    method: 'get',
    path: '/import-jobs/:id/errors',
    tag: 'Employees',
    summary: 'Download failed rows with error messages (correct and re-import this file)',
    permission: 'employees.manage',
    produces: 'csv',
    params: idParam,
    handler: async ({ params, res }) => {
      const job = await prisma.importJob.findUnique({ where: { id: params.id } });
      if (!job) throw notFound('Import');
      const errors = (job.errors as { rowNumber: number; raw: Record<string, string>; errors: string[] }[]) ?? [];
      const headers = (job.headers as string[]) ?? [];
      const cols: SheetColumn[] = [...headers.map((h) => ({ header: h, key: `c:${h}` })), { header: 'Source Row', key: 'rowNumber' }, { header: 'Errors', key: 'errors' }];
      const rows = errors.map((e) => ({ ...Object.fromEntries(headers.map((h) => [`c:${h}`, e.raw[h] ?? ''])), rowNumber: e.rowNumber, errors: e.errors.join(' | ') }));
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', attachment(`import-errors-${job.id.slice(0, 8)}.csv`));
      res.send(buildCsv(cols, rows));
    },
  });

  r.add({
    method: 'post',
    path: '/employees',
    tag: 'Employees',
    summary: 'Create an employee',
    permission: 'employees.manage',
    status: 201,
    body: employeeBody,
    handler: async ({ body, user, ip }) => {
      const dup = await prisma.employee.findFirst({ where: { employeeCode: { equals: body.employeeCode, mode: 'insensitive' } } });
      if (dup) throw new AppError('CONFLICT', `Employee ID "${body.employeeCode}" already exists.`, { fields: [{ path: 'employeeCode', message: 'This Employee ID is already used.' }] });
      await assertValidManager(null, body.managerId);
      const created = await prisma.employee.create({ data: { ...body, createdById: user.id, updatedById: user.id }, include: employeeInclude });
      const out = serializeEmployee(created);
      await audit.write({ actorId: user.id, action: 'employee.created', entity: 'employee', entityId: created.id, after: out, ip });
      return out;
    },
  });

  r.add({
    method: 'get',
    path: '/employees/:id',
    tag: 'Employees',
    summary: 'Employee details',
    permission: 'employees.view',
    params: idParam,
    handler: async ({ params }) => {
      const e = await prisma.employee.findUnique({ where: { id: params.id }, include: employeeInclude });
      if (!e) throw notFound('Employee');
      const runCount = await prisma.payrollRunEmployee.count({ where: { employeeId: e.id } });
      return { ...serializeEmployee(e), payrollRunCount: runCount };
    },
  });

  r.add({
    method: 'put',
    path: '/employees/:id',
    tag: 'Employees',
    summary: 'Update an employee (Employee ID is fixed once used in payroll)',
    permission: 'employees.manage',
    params: idParam,
    body: employeeBody,
    handler: async ({ params, body, user, ip }) => {
      const existing = await prisma.employee.findUnique({ where: { id: params.id }, include: employeeInclude });
      if (!existing) throw notFound('Employee');
      if (body.employeeCode.toLowerCase() !== existing.employeeCode.toLowerCase()) {
        const used = await prisma.payrollRunEmployee.count({ where: { employeeId: existing.id } });
        if (used) throw new AppError('INVALID_STATE', 'The Employee ID cannot be changed after the employee has been included in payroll.', { fields: [{ path: 'employeeCode', message: 'Locked (used in payroll).' }] });
        const dup = await prisma.employee.findFirst({ where: { employeeCode: { equals: body.employeeCode, mode: 'insensitive' }, id: { not: existing.id } } });
        if (dup) throw new AppError('CONFLICT', `Employee ID "${body.employeeCode}" already exists.`, { fields: [{ path: 'employeeCode', message: 'This Employee ID is already used.' }] });
      }
      await assertValidManager(existing.id, body.managerId);
      const updated = await prisma.employee.update({ where: { id: params.id }, data: { ...body, exitDate: body.exitDate ?? null, updatedById: user.id }, include: employeeInclude });
      const out = serializeEmployee(updated);
      await audit.write({ actorId: user.id, action: 'employee.updated', entity: 'employee', entityId: params.id, ...diff(serializeEmployee(existing), out), ip });
      return out;
    },
  });

  r.add({
    method: 'post',
    path: '/employees/:id/deactivate',
    tag: 'Employees',
    summary: 'Deactivate or mark an employee as exited (records are never hard-deleted)',
    permission: 'employees.manage',
    params: idParam,
    body: z.object({ status: z.enum(['INACTIVE', 'EXITED']), exitDate: isoDate.nullable().optional(), reason: z.string().trim().min(3).max(500) }),
    handler: async ({ params, body, user, ip }) => {
      const existing = await prisma.employee.findUnique({ where: { id: params.id } });
      if (!existing) throw notFound('Employee');
      if (body.status === 'EXITED' && !body.exitDate) throw new AppError('VALIDATION_ERROR', 'Exit date is required.', { fields: [{ path: 'exitDate', message: 'Required.' }] });
      if (body.exitDate && body.exitDate < existing.joiningDate) throw new AppError('VALIDATION_ERROR', 'Exit date cannot be before the joining date.', { fields: [{ path: 'exitDate', message: 'Before joining date.' }] });
      const updated = await prisma.employee.update({
        where: { id: params.id },
        data: { status: body.status, exitDate: body.exitDate ?? existing.exitDate, updatedById: user.id },
        include: employeeInclude,
      });
      await audit.write({ actorId: user.id, action: 'employee.deactivated', entity: 'employee', entityId: params.id, before: { status: existing.status }, after: { status: updated.status, exitDate: toIsoDate(updated.exitDate) }, metadata: { reason: body.reason }, ip });
      return serializeEmployee(updated);
    },
  });

  r.add({
    method: 'post',
    path: '/employees/:id/reactivate',
    tag: 'Employees',
    summary: 'Reactivate an inactive employee',
    permission: 'employees.manage',
    params: idParam,
    body: z.object({ reason: z.string().trim().min(3).max(500) }),
    handler: async ({ params, body, user, ip }) => {
      const existing = await prisma.employee.findUnique({ where: { id: params.id } });
      if (!existing) throw notFound('Employee');
      const updated = await prisma.employee.update({ where: { id: params.id }, data: { status: 'ACTIVE', exitDate: null, updatedById: user.id }, include: employeeInclude });
      await audit.write({ actorId: user.id, action: 'employee.reactivated', entity: 'employee', entityId: params.id, before: { status: existing.status }, after: { status: 'ACTIVE' }, metadata: { reason: body.reason }, ip });
      return serializeEmployee(updated);
    },
  });
}
