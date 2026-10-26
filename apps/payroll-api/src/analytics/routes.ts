import { z } from 'zod';
import { AppError, notFound, type ApiRegistry, type AuthUser } from '@nexzi/server-core';
import { prisma } from '../db';
import { audit } from '../audit';
import { getSettings } from '../settings';
import { periodLabel, saveInputs, type InputEntry } from '../payroll/service';

const canSeeAmounts = (u: AuthUser) => u.permissions.has('payroll.view_amounts');
const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const STANDARD_MINUTES = 8 * 60;

/** Monthly attendance figures per employee, derived from the daily attendance register. */
async function monthlyAttendance(year: number, month: number, lateAfter: string) {
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 0));
  const rows = await prisma.attendanceRecord.findMany({
    where: { attendanceDate: { gte: from, lte: to } },
    select: { employeeId: true, status: true, loginTime: true, workingMinutes: true },
  });
  const by = new Map<string, { present_days: number; absent_days: number; leave_days: number; late_days: number; worked_hours: number; overtime_hours: number }>();
  for (const r of rows) {
    const t = by.get(r.employeeId) ?? { present_days: 0, absent_days: 0, leave_days: 0, late_days: 0, worked_hours: 0, overtime_hours: 0 };
    if (r.status === 'PRESENT') {
      t.present_days += 1;
      if (r.loginTime && r.loginTime > lateAfter) t.late_days += 1;
      const mins = r.workingMinutes ?? 0;
      t.worked_hours += mins / 60;
      t.overtime_hours += Math.max(0, mins - STANDARD_MINUTES) / 60;
    } else if (r.status === 'ABSENT') t.absent_days += 1;
    else t.leave_days += 1;
    by.set(r.employeeId, t);
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  for (const t of by.values()) {
    t.worked_hours = round(t.worked_hours);
    t.overtime_hours = round(t.overtime_hours);
  }
  return by;
}

export function registerAnalyticsRoutes(r: ApiRegistry) {
  r.add({
    method: 'get',
    path: '/analytics/overview',
    tag: 'Analytics',
    summary: 'Headcount, hiring, payroll cost and attendance analytics from live data',
    permission: 'reports.view',
    handler: async ({ user }) => {
      const now = new Date();
      const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
      const attendanceFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 29));
      const [employees, runs, attendance, pendingLeave] = await Promise.all([
        prisma.employee.findMany({ select: { status: true, joiningDate: true, exitDate: true, department: { select: { name: true } } } }),
        prisma.payrollRun.findMany({ where: { status: 'FINALISED' }, orderBy: [{ year: 'desc' }, { month: 'desc' }], take: 12 }),
        prisma.attendanceRecord.findMany({ where: { attendanceDate: { gte: attendanceFrom } }, select: { attendanceDate: true, status: true, workingMinutes: true } }),
        prisma.leaveRequest.count({ where: { status: 'REQUESTED' } }),
      ]);

      const active = employees.filter((e) => e.status === 'ACTIVE');
      const deptCounts = new Map<string, number>();
      for (const e of active) deptCounts.set(e.department?.name ?? 'Unassigned', (deptCounts.get(e.department?.name ?? 'Unassigned') ?? 0) + 1);

      const months: string[] = [];
      for (let i = 0; i < 12; i++) months.push(monthKey(new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth() + i, 1))));
      const joiners = new Map(months.map((m) => [m, 0]));
      const leavers = new Map(months.map((m) => [m, 0]));
      for (const e of employees) {
        const j = monthKey(e.joiningDate);
        if (joiners.has(j)) joiners.set(j, joiners.get(j)! + 1);
        if (e.exitDate) {
          const x = monthKey(e.exitDate);
          if (leavers.has(x)) leavers.set(x, leavers.get(x)! + 1);
        }
      }

      const perDay = new Map<string, { present: number; absent: number; leave: number }>();
      let minutes = 0;
      let minuteRows = 0;
      for (const a of attendance) {
        const k = isoDay(a.attendanceDate);
        const d = perDay.get(k) ?? { present: 0, absent: 0, leave: 0 };
        if (a.status === 'PRESENT') d.present += 1;
        else if (a.status === 'ABSENT') d.absent += 1;
        else d.leave += 1;
        perDay.set(k, d);
        if (a.status === 'PRESENT' && a.workingMinutes) {
          minutes += a.workingMinutes;
          minuteRows += 1;
        }
      }
      const totals = [...perDay.values()].reduce((s, d) => ({ present: s.present + d.present, absent: s.absent + d.absent, leave: s.leave + d.leave }), { present: 0, absent: 0, leave: 0 });
      const marked = totals.present + totals.absent + totals.leave;

      const show = canSeeAmounts(user);
      return {
        headcount: { active: active.length, inactive: employees.filter((e) => e.status === 'INACTIVE').length, exited: employees.filter((e) => e.status === 'EXITED').length },
        byDepartment: [...deptCounts].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
        hiring: months.map((m) => ({ month: m, joined: joiners.get(m)!, left: leavers.get(m)! })),
        payrollCost: show
          ? runs.reverse().map((x) => ({
              period: `${x.year}-${String(x.month).padStart(2, '0')}`,
              label: `${periodLabel(x.year, x.month).slice(0, 3)} ${x.year}`,
              employees: x.employeeCount,
              earnings: x.totalEarnings?.toString() ?? '0',
              deductions: x.totalDeductions?.toString() ?? '0',
              net: x.totalNet?.toString() ?? '0',
            }))
          : null,
        attendance: {
          windowDays: 30,
          presentRate: marked ? Math.round((totals.present / marked) * 1000) / 10 : null,
          totals,
          averageWorkingHours: minuteRows ? Math.round((minutes / minuteRows / 60) * 100) / 100 : null,
          daily: [...perDay].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, ...v })),
        },
        pendingLeaveRequests: pendingLeave,
      };
    },
  });

  r.add({
    method: 'get',
    path: '/analytics/search',
    tag: 'Analytics',
    summary: 'Global search across employees, payroll months and knowledge articles the user may open',
    query: z.object({ q: z.string().trim().min(2).max(80) }),
    handler: async ({ query, user }) => {
      const p = user.permissions;
      const q = query.q;
      const results: { type: string; title: string; subtitle: string | null; href: string }[] = [];
      if (p.has('employees.view')) {
        const rows = await prisma.employee.findMany({
          where: { OR: [{ fullName: { contains: q, mode: 'insensitive' } }, { employeeCode: { contains: q, mode: 'insensitive' } }, { contactEmail: { contains: q, mode: 'insensitive' } }] },
          include: { department: { select: { name: true } } },
          orderBy: { fullName: 'asc' },
          take: 8,
        });
        for (const e of rows) results.push({ type: 'Employee', title: e.fullName, subtitle: `${e.employeeCode}${e.department ? ` · ${e.department.name}` : ''}`, href: `/employees/${e.id}` });
      }
      if (p.has('payroll.view')) {
        const wanted = q.toLowerCase();
        const runs = await prisma.payrollRun.findMany({ orderBy: [{ year: 'desc' }, { month: 'desc' }], take: 36 });
        for (const run of runs) {
          const label = periodLabel(run.year, run.month);
          if (label.toLowerCase().includes(wanted) || `${run.year}-${String(run.month).padStart(2, '0')}`.includes(wanted)) {
            results.push({ type: 'Payroll', title: label, subtitle: run.status.replace('_', ' ').toLowerCase(), href: `/payroll/${run.id}` });
          }
        }
      }
      if (p.has('clients.view')) {
        const clients = await prisma.clientRecord.findMany({ where: { clientName: { contains: q, mode: 'insensitive' } }, take: 5 });
        for (const c of clients) results.push({ type: 'Client', title: c.clientName, subtitle: null, href: '/clients' });
      }
      return { results: results.slice(0, 20) };
    },
  });

  r.add({
    method: 'get',
    path: '/analytics/activity',
    tag: 'Analytics',
    summary: 'Recent activity feed from the audit log',
    permission: 'audit.view',
    query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(25) }),
    handler: async ({ query }) => {
      const rows = await prisma.auditLog.findMany({ orderBy: { occurredAt: 'desc' }, take: query.limit });
      return rows.map((a) => ({ id: a.id.toString(), occurredAt: a.occurredAt, actor: a.actorEmail, action: a.action, entity: a.entity, entityId: a.entityId }));
    },
  });

  // ---------------------------------------------- Daily attendance -> monthly payroll inputs
  const periodQuery = z.object({ year: z.coerce.number().int().min(2000).max(2100), month: z.coerce.number().int().min(1).max(12), lateAfter: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('09:30') });

  r.add({
    method: 'get',
    path: '/attendance-records/payroll-summary',
    tag: 'Attendance',
    summary: 'Preview monthly attendance figures (present, absent, leave, late days, worked and overtime hours) for a payroll month',
    permission: 'attendance.view',
    query: periodQuery,
    handler: async ({ query }) => {
      const run = await prisma.payrollRun.findUnique({ where: { year_month: { year: query.year, month: query.month } } });
      const totals = await monthlyAttendance(query.year, query.month, query.lateAfter);
      const members = run
        ? await prisma.payrollRunEmployee.findMany({ where: { payrollRunId: run.id }, select: { employeeId: true, employeeCode: true, employeeName: true }, orderBy: { employeeCode: 'asc' } })
        : (await prisma.employee.findMany({ where: { status: 'ACTIVE' }, select: { id: true, employeeCode: true, fullName: true }, orderBy: { employeeCode: 'asc' } })).map((e) => ({ employeeId: e.id, employeeCode: e.employeeCode, employeeName: e.fullName }));
      const settings = (await getSettings()).attendanceSync;
      return {
        period: periodLabel(query.year, query.month),
        run: run ? { id: run.id, status: run.status } : null,
        fieldMap: settings.fieldMap,
        rows: members.map((m) => ({ ...m, ...(totals.get(m.employeeId) ?? { present_days: 0, absent_days: 0, leave_days: 0, late_days: 0, worked_hours: 0, overtime_hours: 0 }), hasRecords: totals.has(m.employeeId) })),
      };
    },
  });

  r.add({
    method: 'post',
    path: '/attendance-records/apply-to-payroll',
    tag: 'Attendance',
    summary: 'Write the monthly attendance figures into a Draft or Calculated payroll month using the Attendance sync field mapping',
    permission: 'integrations.manage',
    body: periodQuery,
    handler: async ({ body, user, ip }) => {
      if (!user.permissions.has('payroll.input')) throw new AppError('FORBIDDEN', 'Applying attendance also needs the Enter monthly inputs permission.');
      const run = await prisma.payrollRun.findUnique({ where: { year_month: { year: body.year, month: body.month } } });
      if (!run) throw notFound('Payroll run');
      const map = (await getSettings()).attendanceSync.fieldMap;
      if (!map.length) throw new AppError('INVALID_STATE', 'Map attendance fields (present_days, absent_days, leave_days, late_days, worked_hours, overtime_hours) to input columns in Attendance sync settings first.');
      const totals = await monthlyAttendance(body.year, body.month, body.lateAfter);
      const members = await prisma.payrollRunEmployee.findMany({ where: { payrollRunId: run.id }, select: { employeeId: true } });
      const entries: InputEntry[] = [];
      for (const m of members) {
        const t = totals.get(m.employeeId);
        if (!t) continue;
        for (const f of map) {
          const v = (t as Record<string, number>)[f.source];
          if (v !== undefined) entries.push({ employeeId: m.employeeId, inputKey: f.inputKey, value: String(v) });
        }
      }
      if (!entries.length) throw new AppError('INVALID_STATE', 'No daily attendance records match the mapped fields for this month.');
      const result = await saveInputs(user, run.id, entries, ip);
      await audit.write({ actorId: user.id, action: 'attendance.applied_from_register', entity: 'payroll_run', entityId: run.id, metadata: { cells: result.saved, errors: result.errors.length }, ip });
      return { saved: result.saved, errors: result.errors };
    },
  });
}
