/**
 * Employee self-service. Every endpoint is scoped by the employee record linked to the signed-in
 * account (users.employeeId) — never by an id taken from the request — so one employee can never
 * reach another employee's data.
 */
import { z } from 'zod';
import { AppError, idParam, notFound, renderPdf, toIsoDate, type ApiRegistry, type AuthUser } from '@nexzi/server-core';
import { prisma } from '../db';
import { audit } from '../audit';
import { periodLabel } from '../payroll/service';
import { payslipData, storage } from '../output/routes';
import { renderPayslipHtml } from '../output/templates';
import { sendPdf } from '../output/report-export';
import { balancesFor, createLeaveRequest, requestBody, serializeLeave } from '../leave/routes';
import { bankBody, saveBankAccount, serializeBank } from '../bank/routes';
import { bankKeyConfigured } from '../bank/crypto';

async function myEmployee(user: AuthUser) {
  const u = await prisma.user.findUnique({ where: { id: user.id }, select: { employeeId: true } });
  if (!u?.employeeId) throw new AppError('INVALID_STATE', 'Your account is not linked to an employee record yet. Ask an administrator to link it in Users.');
  const emp = await prisma.employee.findUnique({ where: { id: u.employeeId }, include: { department: true, designation: true } });
  if (!emp) throw notFound('Employee');
  return emp;
}

const optional = <T extends z.ZodTypeAny>(schema: T) => schema.nullable().optional().or(z.literal('').transform(() => null));
const meBody = z.object({
  fullName: z.string().trim().min(2, 'Enter your name.').max(120),
  departmentId: z.string().uuid().nullable().optional(),
  designationId: z.string().uuid().nullable().optional(),
  contactEmail: optional(z.string().trim().toLowerCase().email('Enter a valid email address.').max(200)),
  contactPhone: optional(z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/, 'Enter a phone number with 7–20 digits (spaces, +, - and brackets allowed).')),
  panNumber: optional(z.string().trim().toUpperCase().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'Enter a 10-character PAN like ABCDE1234F.')),
  uanNumber: optional(z.string().trim().regex(/^\d{12}$/, 'The UAN has 12 digits.')),
  pfNumber: optional(z.string().trim().toUpperCase().regex(/^[A-Z0-9/]{5,30}$/, 'Use letters, digits and "/" (5–30 characters).')),
});

type MyEmployee = Awaited<ReturnType<typeof myEmployee>>;
const serializeMe = (e: MyEmployee) => ({
  id: e.id,
  employeeCode: e.employeeCode,
  fullName: e.fullName,
  departmentId: e.departmentId,
  department: e.department?.name ?? null,
  designationId: e.designationId,
  designation: e.designation?.name ?? null,
  joiningDate: toIsoDate(e.joiningDate),
  status: e.status,
  contactEmail: e.contactEmail,
  contactPhone: e.contactPhone,
  panNumber: e.panNumber,
  uanNumber: e.uanNumber,
  pfNumber: e.pfNumber,
});

export function registerSelfServiceRoutes(r: ApiRegistry) {
  r.add({
    method: 'get',
    path: '/me/employee',
    tag: 'Self-service',
    summary: 'My employee details',
    permission: 'self.service',
    handler: async ({ user }) => {
      const e = await myEmployee(user);
      return serializeMe(e);
    },
  });

  r.add({
    method: 'put',
    path: '/me/employee',
    tag: 'Self-service',
    summary: 'Update my own employee details (employee code, joining date and status stay with the payroll team)',
    permission: 'self.service',
    body: meBody,
    handler: async ({ body, user, ip }) => {
      const e = await myEmployee(user);
      const [dept, desig] = await Promise.all([
        body.departmentId ? prisma.department.findUnique({ where: { id: body.departmentId }, select: { id: true } }) : null,
        body.designationId ? prisma.designation.findUnique({ where: { id: body.designationId }, select: { id: true } }) : null,
      ]);
      if (body.departmentId && !dept) throw notFound('Department');
      if (body.designationId && !desig) throw notFound('Designation');
      const data = {
        fullName: body.fullName,
        departmentId: body.departmentId ?? null,
        designationId: body.designationId ?? null,
        contactEmail: body.contactEmail ?? null,
        contactPhone: body.contactPhone ?? null,
        panNumber: body.panNumber ?? null,
        uanNumber: body.uanNumber ?? null,
        pfNumber: body.pfNumber ?? null,
      };
      const updated = await prisma.employee.update({ where: { id: e.id }, data: { ...data, updatedById: user.id }, include: { department: true, designation: true } });
      const before = Object.fromEntries(Object.keys(data).map((k) => [k, e[k as keyof typeof data]]));
      await audit.write({ actorId: user.id, action: 'self.details_updated', entity: 'employee', entityId: e.id, before, after: data, ip });
      return serializeMe(updated);
    },
  });

  r.add({
    method: 'get',
    path: '/me/payslips',
    tag: 'Self-service',
    summary: 'My issued payslips (finalised months only)',
    permission: 'self.service',
    handler: async ({ user }) => {
      const e = await myEmployee(user);
      const slips = await prisma.payslip.findMany({ where: { employeeId: e.id, supersededAt: null, payrollRun: { status: 'FINALISED' } }, include: { payrollRun: { select: { year: true, month: true } } }, orderBy: [{ payrollRun: { year: 'desc' } }, { payrollRun: { month: 'desc' } }] });
      return slips.map((s) => ({ id: s.id, period: periodLabel(s.payrollRun.year, s.payrollRun.month), year: s.payrollRun.year, month: s.payrollRun.month, generatedAt: s.generatedAt }));
    },
  });

  r.add({
    method: 'get',
    path: '/me/payslips/:id',
    tag: 'Self-service',
    summary: 'Download one of my payslips (PDF)',
    permission: 'self.service',
    produces: 'pdf',
    params: idParam,
    query: z.object({ disposition: z.enum(['inline', 'attachment']).default('attachment') }),
    handler: async ({ params, query, user, res, ip }) => {
      const e = await myEmployee(user);
      // Ownership is part of the query: someone else's payslip id simply is not found.
      const slip = await prisma.payslip.findFirst({ where: { id: params.id, employeeId: e.id, supersededAt: null, payrollRun: { status: 'FINALISED' } }, include: { payrollRun: true } });
      if (!slip) throw notFound('Payslip');
      // Rendered in the current approved layout so every month looks the same; the stored copy
      // issued at finalisation is the fallback if rendering is unavailable.
      const period = periodLabel(slip.payrollRun.year, slip.payrollRun.month);
      const pdf = await renderPdf(renderPayslipHtml(await payslipData(slip.payrollRunId, [e.id])), { footerText: `Payslip ${period} · ${e.employeeCode}` }).catch(() => storage.read(slip.fileKey));
      if (!pdf) throw new AppError('NOT_FOUND', 'This payslip file is not available. Ask the payroll team to generate it again.');
      await audit.write({ actorId: user.id, action: 'self.payslip_downloaded', entity: 'payslip', entityId: slip.id, metadata: { period }, ip });
      sendPdf(res, pdf, `payslip-${e.employeeCode}-${slip.payrollRun.year}-${String(slip.payrollRun.month).padStart(2, '0')}.pdf`, query.disposition === 'inline');
    },
  });

  r.add({
    method: 'get',
    path: '/me/leave',
    tag: 'Self-service',
    summary: 'My leave requests and balances',
    permission: 'self.service',
    query: z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() }),
    handler: async ({ query, user }) => {
      const e = await myEmployee(user);
      const year = query.year ?? new Date().getUTCFullYear();
      const requests = await prisma.leaveRequest.findMany({ where: { employeeId: e.id }, include: { leaveType: true, employee: { select: { id: true, employeeCode: true, fullName: true } } }, orderBy: { startDate: 'desc' }, take: 100 });
      return { year, balances: await balancesFor(e.id, year), requests: requests.map(serializeLeave) };
    },
  });

  r.add({
    method: 'post',
    path: '/me/leave',
    tag: 'Self-service',
    summary: 'Request leave for myself',
    permission: 'self.service',
    status: 201,
    body: requestBody,
    handler: async ({ body, user, ip }) => createLeaveRequest(user, (await myEmployee(user)).id, body, ip),
  });

  r.add({
    method: 'post',
    path: '/me/leave/:id/cancel',
    tag: 'Self-service',
    summary: 'Cancel one of my pending leave requests',
    permission: 'self.service',
    params: idParam,
    handler: async ({ params, user, ip }) => {
      const e = await myEmployee(user);
      const res = await prisma.leaveRequest.updateMany({ where: { id: params.id, employeeId: e.id, status: 'REQUESTED' }, data: { status: 'CANCELLED', decidedById: user.id, decidedByName: user.name, decidedAt: new Date() } });
      if (res.count !== 1) throw new AppError('CONFLICT', 'Only your own pending requests can be cancelled.');
      await audit.write({ actorId: user.id, action: 'leave.cancelled', entity: 'leave_request', entityId: params.id, before: { status: 'REQUESTED' }, after: { status: 'CANCELLED' }, ip });
      return { status: 'CANCELLED' };
    },
  });

  r.add({
    method: 'get',
    path: '/me/bank',
    tag: 'Self-service',
    summary: 'My salary bank account (account number masked)',
    permission: 'self.service',
    handler: async ({ user }) => {
      const e = await myEmployee(user);
      const account = await prisma.employeeBankAccount.findUnique({ where: { employeeId: e.id } });
      return { keyConfigured: bankKeyConfigured(), bank: serializeBank(account) };
    },
  });

  r.add({
    method: 'put',
    path: '/me/bank',
    tag: 'Self-service',
    summary: 'Add or replace my salary bank account (account number stored encrypted; the payroll team sees it masked)',
    permission: 'self.service',
    body: bankBody,
    handler: async ({ body, user, ip }) => {
      const e = await myEmployee(user);
      return { keyConfigured: true, bank: serializeBank(await saveBankAccount(e.id, body, user, ip)) };
    },
  });
}
