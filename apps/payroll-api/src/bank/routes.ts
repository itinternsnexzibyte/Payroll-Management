import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError, Dec, XLSX_MIME, attachment, dec, idParam, money, notFound, type ApiRegistry, type AuthUser } from '@nexzi/server-core';
import { prisma } from '../db';
import { audit } from '../audit';
import { getSettings, settingsSchema } from '../settings';
import { periodLabel } from '../payroll/service';
import { bankKeyConfigured, decryptAccount, encryptAccount, maskAccount } from './crypto';
import { buildBankFile, type BankRow } from './file';

export const bankBody = z.object({
  accountHolder: z.string().trim().min(1).max(100),
  accountNumber: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s-]/g, ''))
    .pipe(z.string().regex(/^[A-Za-z0-9]{6,34}$/, 'Enter 6–34 letters or digits.')),
  ifsc: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .pipe(z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter an 11-character IFSC (e.g. ABCD0123456).')),
  bankName: z.string().trim().max(100).nullable().optional(),
  branch: z.string().trim().max(100).nullable().optional(),
});

type AccountRow = { accountHolder: string; accountLast4: string; ifsc: string; bankName: string | null; branch: string | null; updatedAt: Date };
/** Only the masked form ever leaves the server, except inside the bank file. */
export const serializeBank = (a: AccountRow | null) =>
  a && { accountHolder: a.accountHolder, accountNumberMasked: maskAccount(a.accountLast4), ifsc: a.ifsc, bankName: a.bankName, branch: a.branch, updatedAt: a.updatedAt };

/** What the audit trail records: never the account number, only its last four digits. */
const auditView = (a: AccountRow | null) => a && { accountHolder: a.accountHolder, accountEnding: a.accountLast4, ifsc: a.ifsc, bankName: a.bankName, branch: a.branch };

/** Adds or replaces an employee's account. Used by the payroll team and by employee self-service. */
export async function saveBankAccount(employeeId: string, body: z.infer<typeof bankBody>, user: AuthUser, ip: string | null) {
  const existing = await prisma.employeeBankAccount.findUnique({ where: { employeeId } });
  const data = {
    accountHolder: body.accountHolder,
    accountNumberEnc: encryptAccount(body.accountNumber),
    accountLast4: body.accountNumber.slice(-4),
    ifsc: body.ifsc,
    bankName: body.bankName ?? null,
    branch: body.branch ?? null,
    updatedById: user.id,
  };
  const saved = await prisma.employeeBankAccount.upsert({ where: { employeeId }, create: { employeeId, ...data }, update: data });
  // The audit trail records the masked form only.
  await audit.write({ actorId: user.id, action: existing ? 'bank_account.updated' : 'bank_account.created', entity: 'employee', entityId: employeeId, before: auditView(existing), after: auditView(saved), ip });
  return saved;
}

/** Rows for the bank file plus the employees that cannot be paid by it. */
async function exportPlan(runId: string) {
  const run = await prisma.payrollRun.findUnique({ where: { id: runId } });
  if (!run) throw notFound('Payroll run');
  const members = await prisma.payrollRunEmployee.findMany({ where: { payrollRunId: runId }, orderBy: { employeeCode: 'asc' } });
  const accounts = new Map((await prisma.employeeBankAccount.findMany({ where: { employeeId: { in: members.map((m) => m.employeeId) } } })).map((a) => [a.employeeId, a]));
  const payable = members.filter((m) => m.net !== null && dec(m.net).gt(0));
  return {
    run,
    payable: payable.filter((m) => accounts.has(m.employeeId)).map((m) => ({ member: m, account: accounts.get(m.employeeId)! })),
    missing: payable.filter((m) => !accounts.has(m.employeeId)).map((m) => ({ employeeId: m.employeeId, employeeCode: m.employeeCode, employeeName: m.employeeName })),
    notPayable: members.filter((m) => m.net === null || !dec(m.net).gt(0)).map((m) => ({ employeeId: m.employeeId, employeeCode: m.employeeCode, employeeName: m.employeeName })),
  };
}

export function registerBankRoutes(r: ApiRegistry) {
  r.add({
    method: 'get',
    path: '/bank/accounts',
    tag: 'Bank',
    summary: 'Bank details of all employees (account numbers masked)',
    permission: ['bank.view', 'bank.manage'],
    handler: async () => {
      const [employees, linked] = await Promise.all([
        prisma.employee.findMany({ include: { bankAccount: true }, orderBy: { employeeCode: 'asc' } }),
        prisma.user.findMany({ where: { employeeId: { not: null } }, select: { id: true, employeeId: true } }),
      ]);
      // The employee's own account last saved the details (entered through self-service).
      const accountOf = new Map(linked.map((u) => [u.employeeId, u.id]));
      return {
        keyConfigured: bankKeyConfigured(),
        items: employees.map((e) => ({
          employeeId: e.id,
          employeeCode: e.employeeCode,
          fullName: e.fullName,
          status: e.status,
          bank: e.bankAccount && { ...serializeBank(e.bankAccount), enteredByEmployee: e.bankAccount.updatedById !== null && e.bankAccount.updatedById === accountOf.get(e.id) },
        })),
      };
    },
  });

  r.add({
    method: 'get',
    path: '/employees/:id/bank',
    tag: 'Bank',
    summary: "An employee's bank details (account number masked)",
    permission: ['bank.view', 'bank.manage'],
    params: idParam,
    handler: async ({ params }) => {
      const emp = await prisma.employee.findUnique({ where: { id: params.id }, include: { bankAccount: true } });
      if (!emp) throw notFound('Employee');
      return { keyConfigured: bankKeyConfigured(), bank: serializeBank(emp.bankAccount) };
    },
  });

  r.add({
    method: 'put',
    path: '/employees/:id/bank',
    tag: 'Bank',
    summary: "Add or replace an employee's bank details (account number stored encrypted)",
    permission: 'bank.manage',
    params: idParam,
    body: bankBody,
    handler: async ({ params, body, user, ip }) => {
      const emp = await prisma.employee.findUnique({ where: { id: params.id } });
      if (!emp) throw notFound('Employee');
      return { keyConfigured: true, bank: serializeBank(await saveBankAccount(emp.id, body, user, ip)) };
    },
  });

  r.add({
    method: 'delete',
    path: '/employees/:id/bank',
    tag: 'Bank',
    summary: "Remove an employee's bank details",
    permission: 'bank.manage',
    params: idParam,
    handler: async ({ params, user, ip }) => {
      const existing = await prisma.employeeBankAccount.findUnique({ where: { employeeId: params.id } });
      if (!existing) throw notFound('Bank details');
      await prisma.employeeBankAccount.delete({ where: { employeeId: params.id } });
      await audit.write({ actorId: user.id, action: 'bank_account.removed', entity: 'employee', entityId: params.id, before: auditView(existing), ip });
      return { keyConfigured: bankKeyConfigured(), bank: null };
    },
  });

  r.add({
    method: 'get',
    path: '/bank/layout',
    tag: 'Bank',
    summary: 'Bank salary file layout',
    permission: ['bank.export', 'settings.manage'],
    handler: async () => (await getSettings()).bankExport,
  });

  r.add({
    method: 'put',
    path: '/bank/layout',
    tag: 'Bank',
    summary: 'Change the bank salary file layout (columns, format, date format)',
    permission: 'settings.manage',
    body: settingsSchema.shape.bankExport,
    handler: async ({ body, user, ip }) => {
      const before = (await getSettings()).bankExport;
      await prisma.payrollSetting.upsert({ where: { key: 'bankExport' }, create: { key: 'bankExport', value: body, updatedById: user.id }, update: { value: body, updatedById: user.id } });
      await audit.write({ actorId: user.id, action: 'bank_layout.updated', entity: 'payroll_settings', entityId: null, before, after: body, ip });
      return body;
    },
  });

  r.add({
    method: 'get',
    path: '/payroll-runs/:id/bank-export/preview',
    tag: 'Bank',
    summary: 'Who will be in the bank salary file, who is missing bank details, and previous files',
    permission: 'bank.export',
    params: idParam,
    handler: async ({ params, user }) => {
      const plan = await exportPlan(params.id);
      const total = plan.payable.reduce((acc, p) => acc.add(dec(p.member.net)), new Dec(0));
      const history = await prisma.bankExport.findMany({ where: { payrollRunId: params.id }, orderBy: { createdAt: 'desc' } });
      return {
        runStatus: plan.run.status,
        ready: plan.run.status === 'FINALISED' && bankKeyConfigured(),
        keyConfigured: bankKeyConfigured(),
        employees: plan.payable.length,
        total: user.permissions.has('payroll.view_amounts') ? money(total) : null,
        missing: plan.missing,
        notPayable: plan.notPayable,
        history: history.map((h) => ({ id: h.id, format: h.format, fileName: h.fileName, employeeCount: h.employeeCount, skippedCount: h.skippedCount, createdByName: h.createdByName, createdAt: h.createdAt })),
      };
    },
  });

  r.add({
    method: 'get',
    path: '/payroll-runs/:id/bank-export',
    tag: 'Bank',
    summary: 'Download the bank salary file for a finalised payroll (net pay per employee)',
    permission: 'bank.export',
    produces: 'csv',
    params: idParam,
    query: z.object({
      paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      skipMissing: z.enum(['true', 'false']).default('false'),
    }),
    handler: async ({ params, query, res, user, ip }) => {
      const plan = await exportPlan(params.id);
      if (plan.run.status !== 'FINALISED') throw new AppError('INVALID_STATE', 'The bank salary file can only be generated for finalised payroll.');
      if (plan.missing.length && query.skipMissing !== 'true') {
        throw new AppError('VALIDATION_ERROR', `${plan.missing.length} employee(s) have no bank details: ${plan.missing.map((m) => m.employeeCode).join(', ')}. Add them, or choose to leave them out of the file.`, { missing: plan.missing });
      }
      if (!plan.payable.length) throw new AppError('VALIDATION_ERROR', 'Nobody in this payroll can be paid by bank transfer.');
      const layout = (await getSettings()).bankExport;
      const rows: BankRow[] = plan.payable.map(({ member, account }) => ({
        employeeCode: member.employeeCode,
        employeeName: member.employeeName,
        accountHolder: account.accountHolder,
        accountNumber: decryptAccount(account.accountNumberEnc),
        ifsc: account.ifsc,
        bankName: account.bankName,
        netPay: money(dec(member.net), 2),
      }));
      const period = periodLabel(plan.run.year, plan.run.month);
      const file = await buildBankFile(layout, rows, { paymentDate: query.paymentDate, period });
      const fileName = `bank-salary-${plan.run.year}-${String(plan.run.month).padStart(2, '0')}.${layout.format === 'CSV' ? 'csv' : 'xlsx'}`;
      const sha = createHash('sha256').update(file).digest('hex');
      await prisma.bankExport.create({ data: { payrollRunId: plan.run.id, format: layout.format, fileName, employeeCount: rows.length, skippedCount: plan.missing.length, fileSha256: sha, createdById: user.id, createdByName: user.name } });
      // No account numbers or amounts in the audit trail.
      await audit.write({ actorId: user.id, action: 'bank_file.generated', entity: 'payroll_run', entityId: plan.run.id, metadata: { format: layout.format, employees: rows.length, skipped: plan.missing.map((m) => m.employeeCode), sha256: sha }, ip });
      res.setHeader('Content-Type', layout.format === 'CSV' ? 'text/csv; charset=utf-8' : XLSX_MIME);
      res.setHeader('Content-Disposition', attachment(fileName));
      res.setHeader('Cache-Control', 'no-store');
      res.send(file);
    },
  });
}
