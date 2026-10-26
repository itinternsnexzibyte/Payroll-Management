/**
 * Automatic payroll: one action that creates the month's run for every eligible employee, fills
 * the monthly inputs from the attendance register and from approved leave, advances and bonuses,
 * and calculates. Salaries come from the employees' (template-generated) salary versions, so no
 * amount is typed by hand. Review, approval and finalisation stay manual.
 */
import { z } from 'zod';
import { AppError, type ApiRegistry } from '@nexzi/server-core';
import { prisma } from '../db';
import { audit } from '../audit';
import { getSettings } from '../settings';
import { calculate, createRun, periodLabel } from './service';
import { fillFromModules } from './input-tools';
import { applyAttendanceToPayroll } from '../analytics/routes';

interface Step {
  step: string;
  status: 'DONE' | 'SKIPPED' | 'FAILED';
  detail: string;
}

export function registerAutoPayrollRoutes(r: ApiRegistry) {
  r.add({
    method: 'post',
    path: '/payroll-runs/auto',
    tag: 'Payroll Runs',
    summary: 'Create (or reuse) the run for a month, fill inputs from attendance, leave, advances and bonuses, and calculate',
    permission: 'payroll.calculate',
    body: z.object({ year: z.number().int().min(2000).max(2100), month: z.number().int().min(1).max(12), lateAfter: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('09:30') }),
    handler: async ({ body, user, ip }) => {
      if (!user.permissions.has('payroll.input')) throw new AppError('FORBIDDEN', 'Running payroll automatically also needs the Create payroll runs and enter inputs permission.');
      const steps: Step[] = [];
      let run = await prisma.payrollRun.findUnique({ where: { year_month: { year: body.year, month: body.month } } });
      if (run && !['DRAFT', 'CALCULATED'].includes(run.status)) {
        throw new AppError('INVALID_STATE', `${periodLabel(body.year, body.month)} is already ${run.status.replace('_', ' ').toLowerCase()}; it can no longer be recalculated automatically.`);
      }
      if (!run) {
        run = await createRun(user, body.year, body.month, undefined, ip);
        steps.push({ step: 'Create payroll run', status: 'DONE', detail: `${run.employeeCount} eligible employee(s) included with their effective salary structures.` });
      } else {
        steps.push({ step: 'Create payroll run', status: 'SKIPPED', detail: `The ${periodLabel(body.year, body.month)} run already exists (${run.employeeCount} employees).` });
      }

      const settings = await getSettings();
      if (!settings.attendancePayrollMap.length) {
        steps.push({ step: 'Apply attendance', status: 'SKIPPED', detail: 'Attendance totals are not mapped to payroll inputs (Attendance to payroll).' });
      } else if (!user.permissions.has('attendance.view')) {
        steps.push({ step: 'Apply attendance', status: 'SKIPPED', detail: 'Needs the View attendance permission.' });
      } else {
        try {
          const res = await applyAttendanceToPayroll({ year: body.year, month: body.month, lateAfter: body.lateAfter }, user, ip);
          steps.push({ step: 'Apply attendance', status: res.errors.length ? 'FAILED' : 'DONE', detail: `${res.saved} input cell(s) filled from the attendance register${res.errors.length ? `, ${res.errors.length} rejected` : ''}.` });
        } catch (e) {
          steps.push({ step: 'Apply attendance', status: 'SKIPPED', detail: e instanceof AppError ? e.message : 'Attendance could not be applied.' });
        }
      }

      if (!Object.values(settings.inputMappings).some(Boolean)) {
        steps.push({ step: 'Fill leave, advances and bonuses', status: 'SKIPPED', detail: 'No input columns are mapped (Payroll settings → Input mappings).' });
      } else {
        try {
          const res = await fillFromModules(run.id, user, ip);
          const parts = Object.entries(res.summary).map(([k, v]) => `${k.replace(/([A-Z])/g, ' $1').toLowerCase()}: ${v.employees} employee(s)`);
          steps.push({ step: 'Fill leave, advances and bonuses', status: res.errors.length ? 'FAILED' : 'DONE', detail: parts.join('; ') || 'Nothing to fill.' });
        } catch (e) {
          steps.push({ step: 'Fill leave, advances and bonuses', status: 'FAILED', detail: e instanceof AppError ? e.message : 'Inputs could not be filled.' });
        }
      }

      const calc = await calculate(user, run.id, ip);
      steps.push({ step: 'Calculate', status: 'DONE', detail: `${calc.ok} OK, ${calc.warning} with warnings, ${calc.error} with errors.` });
      await audit.write({ actorId: user.id, action: 'payroll.auto_run', entity: 'payroll_run', entityId: run.id, metadata: { steps: steps.map((s) => `${s.step}: ${s.status}`) }, ip });
      return { runId: run.id, period: periodLabel(body.year, body.month), steps, result: calc };
    },
  });
}
