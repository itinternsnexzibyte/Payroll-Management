/**
 * Monthly input tools for a payroll run:
 *  - template download and CSV/XLSX import of monthly inputs (attendance, unpaid leave, working
 *    days or any other configured input column — the file import for attendance data);
 *  - "Fill from leave, advances and bonuses": writes amounts from those modules into the input
 *    columns mapped in Payroll settings.
 * Everything goes through saveInputs, so validation, locking and audit are the same as the grid.
 */
import { AppError, XLSX_MIME, attachment, buildXlsx, dec, idParam, money, notFound, parseSpreadsheet, type ApiRegistry } from '@nexzi/server-core';
import { prisma } from '../db';
import { audit } from '../audit';
import { getSettings } from '../settings';
import { periodLabel, saveInputs, type InputEntry } from './service';
import { unpaidLeaveDays } from '../leave/routes';
import { advanceInstalments } from '../loans/routes';
import { approvedBonuses } from '../bonuses/routes';

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

async function runContext(runId: string) {
  const run = await prisma.payrollRun.findUnique({ where: { id: runId } });
  if (!run) throw notFound('Payroll run');
  const [members, defs] = await Promise.all([
    prisma.payrollRunEmployee.findMany({ where: { payrollRunId: runId }, orderBy: { employeeCode: 'asc' } }),
    prisma.payrollInputDefinition.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }] }),
  ]);
  return { run, members, defs };
}

export function registerInputToolRoutes(r: ApiRegistry) {
  r.add({
    method: 'get',
    path: '/payroll-runs/:id/inputs/template',
    tag: 'Payroll Runs',
    summary: 'Download an XLSX template of this run’s employees and input columns (with current values)',
    permission: 'payroll.input',
    produces: 'xlsx',
    params: idParam,
    handler: async ({ params, res }) => {
      const { run, members, defs } = await runContext(params.id);
      const values = await prisma.payrollInput.findMany({ where: { payrollRunId: run.id } });
      const byKey = new Map(values.map((v) => [`${v.employeeId}:${v.inputKey}`, v.value]));
      const buf = await buildXlsx([
        {
          name: 'Inputs',
          title: [`Monthly inputs — ${periodLabel(run.year, run.month)}`, 'Fill the columns and import the file on the payroll run. Do not change the Employee ID column.'],
          columns: [{ header: 'Employee ID', key: '__code', width: 16 }, { header: 'Name', key: '__name', width: 26 }, ...defs.map((d) => ({ header: `${d.label} (${d.key})`, key: d.key, width: 18 }))],
          rows: members.map((m) => ({ __code: m.employeeCode, __name: m.employeeName, ...Object.fromEntries(defs.map((d) => [d.key, byKey.get(`${m.employeeId}:${d.key}`) ?? ''])) })),
        },
      ]);
      res.setHeader('Content-Type', XLSX_MIME);
      res.setHeader('Content-Disposition', attachment(`inputs-${run.year}-${String(run.month).padStart(2, '0')}.xlsx`));
      res.send(buf);
    },
  });

  r.add({
    method: 'post',
    path: '/payroll-runs/:id/inputs/import',
    tag: 'Payroll Runs',
    summary: 'Import monthly inputs (attendance, leave, working days…) from CSV/XLSX: an Employee ID column plus input columns',
    permission: 'payroll.input',
    params: idParam,
    upload: { field: 'file', maxBytes: 5 * 1024 * 1024, extensions: ['csv', 'xlsx'] },
    handler: async ({ params, file, user, ip }) => {
      const { run, members, defs } = await runContext(params.id);
      const sheet = await parseSpreadsheet(file!);
      // The template has two title lines; find the header row that contains "Employee ID".
      let headers = sheet.headers;
      let rows = sheet.rows;
      if (!headers.some((h) => norm(h) === 'employeeid')) {
        const idx = rows.findIndex((row) => Object.values(row).some((v) => norm(v) === 'employeeid'));
        if (idx === -1) throw new AppError('VALIDATION_ERROR', 'The file needs an "Employee ID" column.');
        const headerRow = rows[idx];
        headers = sheet.headers.map((h) => headerRow[h] ?? '');
        rows = rows.slice(idx + 1).map((row) => Object.fromEntries(sheet.headers.map((h, i) => [headers[i], row[h] ?? ''])));
      }
      const codeCol = headers.find((h) => norm(h) === 'employeeid')!;
      const colToKey = new Map<string, string>();
      const unknownColumns: string[] = [];
      for (const h of headers) {
        if (!h || h === codeCol || norm(h) === 'name') continue;
        const m = /\(([A-Z][A-Z0-9_]*)\)\s*$/.exec(h);
        const def = defs.find((d) => (m && d.key === m[1]) || norm(d.key) === norm(h) || norm(d.label) === norm(h));
        if (def) colToKey.set(h, def.key);
        else unknownColumns.push(h);
      }
      if (!colToKey.size) throw new AppError('VALIDATION_ERROR', 'No column matches an input column of this payroll. Download the template to see the expected columns.', { unknownColumns });
      const byCode = new Map(members.map((m) => [m.employeeCode.toLowerCase(), m]));
      const entries: InputEntry[] = [];
      const unmatched: { row: number; employeeCode: string }[] = [];
      rows.forEach((row, i) => {
        const code = (row[codeCol] ?? '').trim();
        if (!code) return;
        const m = byCode.get(code.toLowerCase());
        if (!m) {
          unmatched.push({ row: i + 2, employeeCode: code });
          return;
        }
        for (const [col, key] of colToKey) {
          const v = (row[col] ?? '').trim();
          if (v !== '') entries.push({ employeeId: m.employeeId, inputKey: key, value: v });
        }
      });
      const result = await saveInputs(user, run.id, entries, ip);
      const codeOf = new Map(members.map((m) => [m.employeeId, m.employeeCode]));
      await audit.write({ actorId: user.id, action: 'payroll.inputs_imported', entity: 'payroll_run', entityId: run.id, metadata: { file: file!.originalName.slice(0, 120), saved: result.saved, errors: result.errors.length, unmatched: unmatched.length }, ip });
      return {
        saved: result.saved,
        errors: result.errors.map((e) => ({ employeeCode: codeOf.get(e.employeeId) ?? '', inputKey: e.inputKey, message: e.message })),
        unmatchedEmployees: unmatched,
        unknownColumns,
        columns: [...colToKey.values()],
      };
    },
  });

  r.add({
    method: 'post',
    path: '/payroll-runs/:id/inputs/fill',
    tag: 'Payroll Runs',
    summary: 'Fill the mapped input columns from approved leave, active advances and approved bonuses (overwrites those columns only)',
    permission: 'payroll.input',
    params: idParam,
    handler: async ({ params, user, ip }) => {
      const { run, members, defs } = await runContext(params.id);
      const map = (await getSettings()).inputMappings;
      const numeric = new Set(defs.filter((d) => d.dataType === 'NUMBER').map((d) => d.key));
      const mapped = Object.entries(map).filter(([, key]) => key) as [keyof typeof map, string][];
      if (!mapped.length) throw new AppError('CONFIGURATION_MISSING', 'No input columns are mapped yet. An administrator can map them in Payroll settings → Input mappings.');
      const bad = mapped.filter(([, key]) => !numeric.has(key));
      if (bad.length) throw new AppError('CONFIGURATION_MISSING', `Mapped input column(s) ${bad.map(([, k]) => k).join(', ')} are missing, inactive or not numeric. Check Payroll settings → Input mappings.`);

      const ids = members.map((m) => m.employeeId);
      const sources = {
        unpaidLeaveDays: () => unpaidLeaveDays(run.year, run.month, ids),
        advanceRecovery: () => advanceInstalments(run.year, run.month, ids),
        bonus: async () => (await approvedBonuses(run.year, run.month, ids)).bonus,
        incentive: async () => (await approvedBonuses(run.year, run.month, ids)).incentive,
      };
      const entries: InputEntry[] = [];
      const summary: Record<string, { inputKey: string; employees: number; total: string }> = {};
      for (const [source, key] of mapped) {
        const values = await sources[source]();
        let total = dec(0);
        let count = 0;
        for (const m of members) {
          const v = values.get(m.employeeId);
          const has = v && !v.isZero();
          entries.push({ employeeId: m.employeeId, inputKey: key, value: has ? v.toString() : '' });
          if (has) {
            count++;
            total = total.add(dec(v));
          }
        }
        summary[source] = { inputKey: key, employees: count, total: money(total) };
      }
      const result = await saveInputs(user, run.id, entries, ip);
      await audit.write({ actorId: user.id, action: 'payroll.inputs_filled', entity: 'payroll_run', entityId: run.id, metadata: { sources: Object.keys(summary), saved: result.saved, errors: result.errors.length }, ip });
      return { summary, saved: result.saved, errors: result.errors };
    },
  });
}

