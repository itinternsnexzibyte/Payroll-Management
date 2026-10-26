/**
 * Payroll fraud investigation: connects employee records, bank accounts, salary revisions,
 * approvals and payment history to surface suspicious patterns before salary is disbursed — each
 * finding with the evidence behind it and the related audit-log entries. Read-only.
 */
import { z } from 'zod';
import { Dec, dec, money, notFound, toIsoDate, type ApiRegistry } from '@nexzi/server-core';
import { prisma } from '../db';
import { audit } from '../audit';
import { periodLabel } from '../payroll/service';
import { bankKeyConfigured, decryptAccount } from '../bank/crypto';

type Severity = 'HIGH' | 'MEDIUM' | 'LOW';
interface Finding {
  rule: string;
  severity: Severity;
  title: string;
  employees: { id: string; employeeCode: string; fullName: string }[];
  evidence: { label: string; value: string }[];
}

export const FRAUD_RULES: Record<string, string> = {
  SHARED_BANK_ACCOUNT: 'Two or more employees are paid into the same bank account',
  BANK_CHANGED_BEFORE_PAYROLL: 'Bank details changed shortly before the payroll was calculated or paid',
  SALARY_JUMP_BEFORE_PAYROLL: 'Large salary revision shortly before the payroll',
  SELF_SERVICE_SEGREGATION: 'The same person changed the salary and calculated or approved the payroll',
  PAID_AFTER_EXIT: 'Paid for a month that starts after the exit date, or while inactive',
  DUPLICATE_IDENTITY: 'Employees share a PAN, UAN, email or phone number',
  NET_SPIKE: 'Net pay far above the employee’s own history',
  REPEATED_BANK_FILE: 'The bank salary file was generated more than once for the same month',
  BONUS_SELF_APPROVED: 'A bonus was approved by the person who proposed it',
};

const DAY = 86_400_000;
const groupBy = <T>(list: T[], key: (x: T) => string) => {
  const out: Record<string, T[]> = {};
  for (const x of list) (out[key(x)] ??= []).push(x);
  return out;
};
const median = (xs: Dec[]) => {
  const s = [...xs].sort((a, b) => a.cmp(b));
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : s[s.length / 2 - 1].add(s[s.length / 2]).div(2)) : null;
};

export async function scan(runId: string | undefined, windowDays: number, jumpPercent: number) {
  const run = runId
    ? await prisma.payrollRun.findUnique({ where: { id: runId } })
    : await prisma.payrollRun.findFirst({ where: { status: { not: 'DRAFT' } }, orderBy: [{ year: 'desc' }, { month: 'desc' }] });
  if (!run) throw notFound('Calculated payroll run');
  const members = await prisma.payrollRunEmployee.findMany({ where: { payrollRunId: run.id } });
  const ids = members.map((m) => m.employeeId);
  const [employees, accounts, versions, exports, bonuses, history] = await Promise.all([
    prisma.employee.findMany({ where: { status: { not: 'EXITED' } } }),
    prisma.employeeBankAccount.findMany({ include: { employee: { select: { id: true, employeeCode: true, fullName: true, status: true } } } }),
    prisma.salaryVersion.findMany({ where: { employeeId: { in: ids } }, include: { values: { include: { component: true } } }, orderBy: { effectiveFrom: 'asc' } }),
    prisma.bankExport.findMany({ where: { payrollRunId: run.id }, orderBy: { createdAt: 'asc' } }),
    prisma.bonusEntry.findMany({ where: { year: run.year, month: run.month, status: 'APPROVED' } }),
    prisma.payrollRunEmployee.findMany({ where: { employeeId: { in: ids }, payrollRun: { status: 'FINALISED', id: { not: run.id } } }, include: { payrollRun: { select: { year: true, month: true } } } }),
  ]);
  const allEmployees = await prisma.employee.findMany({ where: { id: { in: [...new Set([...ids, ...employees.map((e) => e.id)])] } } });
  const empById = new Map(allEmployees.map((e) => [e.id, e]));
  const who = (id: string) => {
    const e = empById.get(id);
    return { id, employeeCode: e?.employeeCode ?? '?', fullName: e?.fullName ?? 'Unknown' };
  };
  const findings: Finding[] = [];
  const anchor = run.finalisedAt ?? run.calculatedAt ?? run.updatedAt;
  const period = periodLabel(run.year, run.month);

  // 1. Shared bank accounts (compares full decrypted numbers when the key is configured)
  const groups = new Map<string, typeof accounts>();
  const canDecrypt = bankKeyConfigured();
  for (const a of accounts) {
    let key = `${a.ifsc.toUpperCase()}|${a.accountLast4}|${a.accountHolder.trim().toLowerCase()}`;
    if (canDecrypt) {
      try {
        key = `${a.ifsc.toUpperCase()}|${decryptAccount(a.accountNumberEnc)}`;
      } catch {
        /* undecryptable: fall back to the masked comparison */
      }
    }
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    findings.push({
      rule: 'SHARED_BANK_ACCOUNT',
      severity: 'HIGH',
      title: `${g.length} employees are paid into the same account (•••• ${g[0].accountLast4}, ${g[0].ifsc})`,
      employees: g.map((a) => who(a.employeeId)),
      evidence: [
        { label: 'Comparison', value: canDecrypt ? 'Full account number and IFSC match' : 'IFSC, last four digits and holder name match (bank key not configured)' },
        ...g.map((a) => ({ label: `${a.employee.employeeCode} account holder`, value: `${a.accountHolder} · updated ${toIsoDate(a.updatedAt)}` })),
      ],
    });
  }

  // 2. Bank details changed shortly before this payroll
  const bankAudit = await prisma.auditLog.findMany({ where: { entity: 'employee', entityId: { in: ids }, action: { in: ['bank_account.created', 'bank_account.updated'] }, occurredAt: { gte: new Date(anchor.getTime() - windowDays * DAY), lte: anchor } }, orderBy: { occurredAt: 'desc' } });
  for (const [employeeId, entries] of Object.entries(groupBy(bankAudit, (a) => a.entityId ?? ''))) {
    if (!employeeId || !entries.length) continue;
    const changedBefore = entries.some((e) => e.action === 'bank_account.updated');
    findings.push({
      rule: 'BANK_CHANGED_BEFORE_PAYROLL',
      severity: changedBefore ? 'HIGH' : 'MEDIUM',
      title: `Bank details ${changedBefore ? 'changed' : 'added'} ${Math.max(0, Math.round((anchor.getTime() - entries[0].occurredAt.getTime()) / DAY))} day(s) before the ${period} payroll`,
      employees: [who(employeeId)],
      evidence: entries.map((e) => ({ label: e.action.replace('bank_account.', 'Bank account '), value: `${e.occurredAt.toISOString().slice(0, 16).replace('T', ' ')} UTC by ${e.actorEmail ?? 'unknown'}` })),
    });
  }

  // 3. Large salary revision shortly before the payroll, and 4. segregation of duties
  const byEmployee = groupBy(versions, (v) => v.employeeId);
  const fixedTotal = (v: (typeof versions)[number]) => (v.monthlyGross ? dec(v.monthlyGross.toString()) : v.values.filter((x) => x.component.type === 'EARNING' && x.component.basis === 'FIXED').reduce((acc, x) => acc.add(dec(x.value.toString())), new Dec(0)));
  const approvers = new Set([run.calculatedById, run.approvedById, run.finalisedById].filter(Boolean) as string[]);
  const actorNames = new Map((await prisma.user.findMany({ where: { id: { in: [...approvers, ...versions.map((v) => v.createdById).filter(Boolean) as string[]] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  for (const [employeeId, list] of Object.entries(byEmployee)) {
    list.forEach((v, i) => {
      const recent = v.createdAt.getTime() >= anchor.getTime() - windowDays * DAY && v.createdAt <= anchor;
      if (i > 0 && recent) {
        const before = fixedTotal(list[i - 1]);
        const after = fixedTotal(v);
        const change = before.isZero() ? null : after.sub(before).div(before).mul(100);
        if (change && change.gte(jumpPercent)) {
          findings.push({
            rule: 'SALARY_JUMP_BEFORE_PAYROLL',
            severity: change.gte(jumpPercent * 2) ? 'HIGH' : 'MEDIUM',
            title: `Salary raised ${change.toFixed(1)}% ${Math.round((anchor.getTime() - v.createdAt.getTime()) / DAY)} day(s) before the ${period} payroll`,
            employees: [who(employeeId)],
            evidence: [
              { label: `Version ${list[i - 1].versionNo}`, value: `₹${money(before)} from ${toIsoDate(list[i - 1].effectiveFrom)}` },
              { label: `Version ${v.versionNo}`, value: `₹${money(after)} from ${toIsoDate(v.effectiveFrom)}` },
              { label: 'Reason given', value: v.changeReason ?? '—' },
              { label: 'Changed by', value: (v.createdById && actorNames.get(v.createdById)) || 'unknown' },
            ],
          });
        }
      }
      if (recent && v.createdById && approvers.has(v.createdById)) {
        findings.push({
          rule: 'SELF_SERVICE_SEGREGATION',
          severity: 'MEDIUM',
          title: `${actorNames.get(v.createdById) ?? 'The same user'} changed this salary and also calculated or approved the ${period} payroll`,
          employees: [who(employeeId)],
          evidence: [
            { label: 'Salary version', value: `v${v.versionNo} created ${v.createdAt.toISOString().slice(0, 10)}` },
            { label: 'Calculated by', value: (run.calculatedById && actorNames.get(run.calculatedById)) || '—' },
            { label: 'Approved / finalised by', value: [run.approvedById, run.finalisedById].map((x) => (x && actorNames.get(x)) || '—').join(' / ') },
          ],
        });
      }
    });
  }

  // 5. Paid after exit or while inactive
  const monthStart = new Date(Date.UTC(run.year, run.month - 1, 1));
  for (const m of members) {
    const e = empById.get(m.employeeId);
    if (!e || !m.net || !dec(m.net.toString()).gt(0)) continue;
    if ((e.exitDate && e.exitDate < monthStart) || e.status === 'INACTIVE') {
      findings.push({
        rule: 'PAID_AFTER_EXIT',
        severity: 'HIGH',
        title: `Net pay ₹${money(dec(m.net.toString()))} for ${period} although the employee is ${e.status === 'INACTIVE' ? 'inactive' : `exited on ${toIsoDate(e.exitDate)}`}`,
        employees: [who(e.id)],
        evidence: [
          { label: 'Status', value: e.status },
          { label: 'Exit date', value: toIsoDate(e.exitDate) ?? '—' },
          { label: 'Net pay this month', value: `₹${money(dec(m.net.toString()))}` },
        ],
      });
    }
  }

  // 6. Duplicate identity fields
  const identity: [string, (e: (typeof employees)[number]) => string | null][] = [
    ['PAN', (e) => e.panNumber?.toUpperCase() ?? null],
    ['UAN', (e) => e.uanNumber ?? null],
    ['Email', (e) => e.contactEmail?.toLowerCase() ?? null],
    ['Phone', (e) => e.contactPhone?.replace(/\D/g, '').slice(-10) || null],
  ];
  for (const [label, key] of identity) {
    const seen = new Map<string, typeof employees>();
    for (const e of employees) {
      const k = key(e);
      if (k) seen.set(k, [...(seen.get(k) ?? []), e]);
    }
    for (const [value, list] of seen) {
      if (list.length < 2) continue;
      findings.push({
        rule: 'DUPLICATE_IDENTITY',
        severity: label === 'PAN' || label === 'UAN' ? 'HIGH' : 'LOW',
        title: `${list.length} active employee records share the same ${label}`,
        employees: list.map((e) => who(e.id)),
        evidence: [{ label, value: label === 'PAN' || label === 'UAN' ? `${value.slice(0, 3)}•••${value.slice(-2)}` : value }],
      });
    }
  }

  // 7. Net pay spikes against the employee's own finalised history
  for (const m of members) {
    if (!m.net) continue;
    const past = history.filter((h) => h.employeeId === m.employeeId && h.net).map((h) => dec(h.net!.toString()));
    const med = past.length >= 2 ? median(past) : null;
    const net = dec(m.net.toString());
    if (med && med.gt(0) && net.gt(med.mul(2))) {
      findings.push({
        rule: 'NET_SPIKE',
        severity: net.gt(med.mul(4)) ? 'HIGH' : 'MEDIUM',
        title: `Net pay ₹${money(net)} is ${net.div(med).toFixed(1)}× the usual ₹${money(med)}`,
        employees: [who(m.employeeId)],
        evidence: [
          { label: 'This month', value: `₹${money(net)}` },
          { label: `Median of ${past.length} finalised month(s)`, value: `₹${money(med)}` },
        ],
      });
    }
  }

  // 8. Repeated bank salary files (possible duplicate disbursement)
  if (exports.length > 1) {
    findings.push({
      rule: 'REPEATED_BANK_FILE',
      severity: 'HIGH',
      title: `The bank salary file for ${period} was generated ${exports.length} times — check it was uploaded only once`,
      employees: [],
      evidence: exports.map((x) => ({ label: x.createdAt.toISOString().slice(0, 16).replace('T', ' ') + ' UTC', value: `${x.createdByName} · ${x.employeeCount} payments · ${x.fileSha256.slice(0, 12)}…` })),
    });
  }

  // 9. Bonuses approved by their proposer
  for (const b of bonuses.filter((x) => x.proposedById && x.proposedById === x.decidedById)) {
    findings.push({
      rule: 'BONUS_SELF_APPROVED',
      severity: 'MEDIUM',
      title: `${b.kind === 'BONUS' ? 'Bonus' : 'Incentive'} of ₹${money(dec(b.amount.toString()))} approved by the person who proposed it`,
      employees: [who(b.employeeId)],
      evidence: [
        { label: 'Proposed and approved by', value: b.proposedByName ?? '—' },
        { label: 'Reason', value: b.reason },
      ],
    });
  }

  const order: Record<Severity, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity] || a.rule.localeCompare(b.rule));
  return {
    run: { id: run.id, period, status: run.status },
    windowDays,
    jumpPercent,
    bankComparison: canDecrypt ? 'FULL' : 'MASKED',
    summary: { high: findings.filter((f) => f.severity === 'HIGH').length, medium: findings.filter((f) => f.severity === 'MEDIUM').length, low: findings.filter((f) => f.severity === 'LOW').length, employeesChecked: members.length },
    rules: FRAUD_RULES,
    findings: findings.map((f, i) => ({ id: `${f.rule}-${i}`, ...f, description: FRAUD_RULES[f.rule] })),
  };
}

export function registerFraudRoutes(r: ApiRegistry) {
  r.add({
    method: 'get',
    path: '/fraud/scan',
    tag: 'Fraud investigation',
    summary: 'Scan a payroll run (default: the latest calculated one) for suspicious patterns, with supporting evidence',
    permission: 'payroll.view_amounts',
    query: z.object({ runId: z.string().uuid().optional(), windowDays: z.coerce.number().int().min(1).max(90).default(10), jumpPercent: z.coerce.number().min(5).max(500).default(25) }),
    handler: async ({ query, user, ip }) => {
      const out = await scan(query.runId, query.windowDays, query.jumpPercent);
      await audit.write({ actorId: user.id, action: 'fraud.scanned', entity: 'payroll_run', entityId: out.run.id, metadata: { findings: out.findings.length, high: out.summary.high }, ip });
      return out;
    },
  });

  r.add({
    method: 'get',
    path: '/fraud/employees/:id/timeline',
    tag: 'Fraud investigation',
    summary: 'Investigation timeline for one employee: record, bank, salary and payroll events in date order',
    permission: 'payroll.view_amounts',
    params: z.object({ id: z.string().uuid() }),
    handler: async ({ params }) => {
      const e = await prisma.employee.findUnique({ where: { id: params.id }, include: { bankAccount: true } });
      if (!e) throw notFound('Employee');
      const [logs, versions, paid] = await Promise.all([
        prisma.auditLog.findMany({ where: { entity: 'employee', entityId: e.id }, orderBy: { occurredAt: 'desc' }, take: 100 }),
        prisma.salaryVersion.findMany({ where: { employeeId: e.id }, orderBy: { createdAt: 'desc' } }),
        prisma.payrollRunEmployee.findMany({ where: { employeeId: e.id, payrollRun: { status: { not: 'DRAFT' } } }, include: { payrollRun: true } }),
      ]);
      const events = [
        ...logs.map((l) => ({ at: l.occurredAt, kind: 'AUDIT', title: l.action, detail: `by ${l.actorEmail ?? 'system'}` })),
        ...versions.map((v) => ({ at: v.createdAt, kind: 'SALARY', title: `Salary version ${v.versionNo} (from ${toIsoDate(v.effectiveFrom)})`, detail: v.changeReason ?? '' })),
        ...paid.map((p) => ({ at: p.payrollRun.finalisedAt ?? p.payrollRun.calculatedAt ?? p.payrollRun.createdAt, kind: 'PAYROLL', title: `${periodLabel(p.payrollRun.year, p.payrollRun.month)} — ${p.payrollRun.status.toLowerCase()}`, detail: p.net ? `net ₹${money(dec(p.net.toString()))}` : '' })),
      ].sort((a, b) => b.at.getTime() - a.at.getTime());
      return {
        employee: { id: e.id, employeeCode: e.employeeCode, fullName: e.fullName, status: e.status, joiningDate: toIsoDate(e.joiningDate), exitDate: toIsoDate(e.exitDate), bank: e.bankAccount ? { last4: e.bankAccount.accountLast4, ifsc: e.bankAccount.ifsc, holder: e.bankAccount.accountHolder, updatedAt: e.bankAccount.updatedAt } : null },
        events,
      };
    },
  });
}
