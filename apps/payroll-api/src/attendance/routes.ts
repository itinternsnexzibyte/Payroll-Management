import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { z } from 'zod';
import { AppError, clientIp, idParam, notFound, type ApiRegistry, type AuthUser } from '@nexzi/server-core';
import { prisma, Prisma } from '../db';
import { audit } from '../audit';
import { getSettings, settingsSchema, type PayrollSettings } from '../settings';
import { periodLabel, saveInputs, type InputEntry } from '../payroll/service';

/**
 * Live attendance sync. The attendance application pushes each month's figures to
 * POST /integrations/attendance with an API key (Authorization: Bearer …). Fields are mapped to
 * monthly input columns in Attendance sync settings and written through the same validation as
 * the input grid, so a sync can never change a submitted, approved or finalised payroll.
 * The payroll application makes no outbound calls to the attendance application.
 */

const KEY_PREFIX = 'nzatt_';
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

const pushBody = z.object({
  batchId: z.string().trim().min(1).max(100).optional(),
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  records: z
    .array(
      z.object({
        employeeCode: z.string().trim().min(1).max(40),
        values: z.record(z.string().max(60), z.union([z.string().max(100), z.number(), z.null()])),
      }),
    )
    .min(1)
    .max(5000),
});
type PushRecord = z.infer<typeof pushBody>['records'][number];
type BatchError = { employeeCode?: string; field?: string; message: string };

async function keyFromRequest(req: Request) {
  const m = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') ?? '');
  const token = m?.[1] ?? '';
  const prefix = token.startsWith(KEY_PREFIX) ? token.slice(0, KEY_PREFIX.length + 8) : '';
  const key = prefix ? await prisma.integrationKey.findUnique({ where: { prefix } }) : null;
  const ok = key && !key.revokedAt && timingSafeEqual(Buffer.from(sha256(token)), Buffer.from(key.keyHash));
  if (!ok) throw new AppError('UNAUTHENTICATED', 'Missing, unknown or revoked API key.');
  return key;
}

/** The values a batch would write, per employee and input column (used for preview and apply). */
function mapRecords(records: PushRecord[], map: PayrollSettings['attendanceSync']['fieldMap'], codeToId: Map<string, string>) {
  const entries: InputEntry[] = [];
  const errors: BatchError[] = [];
  const unmapped = new Set<string>();
  const mapped = new Set(map.map((f) => f.source));
  for (const rec of records) {
    const employeeId = codeToId.get(rec.employeeCode);
    if (!employeeId) {
      errors.push({ employeeCode: rec.employeeCode, message: 'Employee is not in this payroll month.' });
      continue;
    }
    for (const k of Object.keys(rec.values)) if (!mapped.has(k)) unmapped.add(k);
    for (const f of map) {
      const v = rec.values[f.source];
      if (v === undefined || v === null || v === '') continue;
      entries.push({ employeeId, inputKey: f.inputKey, value: String(v) });
    }
  }
  return { entries, errors, unmapped: [...unmapped] };
}

/** Applies a received batch to its payroll month. Leaves it RECEIVED (with the reason) if it cannot apply yet. */
async function applyBatch(batchId: string, actor: AuthUser, ip: string | null) {
  const batch = await prisma.attendanceBatch.findUniqueOrThrow({ where: { id: batchId } });
  const settings = (await getSettings()).attendanceSync;
  const fail = async (message: string) => {
    await prisma.attendanceBatch.update({ where: { id: batchId }, data: { errors: [{ message }] as Prisma.InputJsonValue } });
    return { applied: false, message };
  };
  if (!settings.fieldMap.length) return fail('No attendance fields are mapped to monthly input columns yet.');
  const run = await prisma.payrollRun.findUnique({ where: { year_month: { year: batch.year, month: batch.month } } });
  if (!run) return fail(`There is no payroll run for ${periodLabel(batch.year, batch.month)} yet. Create it, then apply this batch.`);
  if (!['DRAFT', 'CALCULATED'].includes(run.status)) return fail(`${periodLabel(batch.year, batch.month)} payroll is ${run.status.replace('_', ' ').toLowerCase()}; attendance can only be applied to a draft or calculated payroll.`);
  const members = await prisma.payrollRunEmployee.findMany({ where: { payrollRunId: run.id }, select: { employeeId: true, employeeCode: true } });
  const { entries, errors } = mapRecords(batch.records as PushRecord[], settings.fieldMap, new Map(members.map((m) => [m.employeeCode, m.employeeId])));
  const codeOf = new Map(members.map((m) => [m.employeeId, m.employeeCode]));
  const result = await saveInputs(actor, run.id, entries, ip);
  const allErrors: BatchError[] = [...errors, ...result.errors.map((e) => ({ employeeCode: codeOf.get(e.employeeId), field: e.inputKey, message: e.message }))];
  const status = allErrors.length === 0 ? 'APPLIED' : result.saved > 0 ? 'PARTIAL' : 'FAILED';
  await prisma.attendanceBatch.update({
    where: { id: batchId },
    data: { status, appliedCount: result.saved, errors: allErrors as Prisma.InputJsonValue, payrollRunId: run.id, appliedAt: new Date(), appliedById: actor.id },
  });
  await audit.write({ actorId: actor.id, action: 'attendance.applied', entity: 'attendance_batch', entityId: batchId, metadata: { payrollRunId: run.id, cells: result.saved, errors: allErrors.length }, ip });
  return { applied: true, status, saved: result.saved, errors: allErrors };
}

const serializeBatch = (b: Prisma.AttendanceBatchGetPayload<{ include: { key: true } }>) => ({
  id: b.id,
  externalId: b.externalId,
  source: b.key?.name ?? null,
  year: b.year,
  month: b.month,
  period: periodLabel(b.year, b.month),
  status: b.status,
  recordCount: b.recordCount,
  appliedCount: b.appliedCount,
  errors: b.errors as BatchError[],
  receivedAt: b.receivedAt,
  appliedAt: b.appliedAt,
});

export function registerAttendanceRoutes(r: ApiRegistry) {
  // ---------------------------------------------------------------- Inbound (attendance application)
  r.add({
    method: 'post',
    path: '/integrations/attendance',
    tag: 'Integrations',
    summary: 'Receive monthly attendance from the attendance application (API key: Authorization: Bearer nzatt_…)',
    description:
      'Body: `{ batchId?, year, month, records: [{ employeeCode, values: { <field>: number|string } }] }`. A `batchId` is accepted once per key; repeating it returns the original result. Fields are mapped to monthly input columns in Attendance sync settings.',
    auth: false,
    body: pushBody,
    status: 202,
    handler: async ({ req, body }) => {
      const key = await keyFromRequest(req);
      const ip = clientIp(req);
      const settings = (await getSettings()).attendanceSync;
      if (!settings.enabled) throw new AppError('INVALID_STATE', 'Attendance sync is switched off in the payroll application.');
      await prisma.integrationKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
      if (body.batchId) {
        const dup = await prisma.attendanceBatch.findUnique({ where: { keyId_externalId: { keyId: key.id, externalId: body.batchId } }, include: { key: true } });
        if (dup) return { duplicate: true, batch: serializeBatch(dup) };
      }
      const batch = await prisma.attendanceBatch.create({
        data: { keyId: key.id, externalId: body.batchId ?? null, year: body.year, month: body.month, recordCount: body.records.length, records: body.records as Prisma.InputJsonValue },
      });
      await audit.write({ actorId: key.createdById, action: 'attendance.received', entity: 'attendance_batch', entityId: batch.id, metadata: { key: key.name, year: body.year, month: body.month, records: body.records.length }, ip });
      if (settings.autoApply) {
        const owner = await prisma.user.findUnique({ where: { id: key.createdById } });
        if (owner) {
          const actor: AuthUser = { id: owner.id, email: owner.email, name: `${key.name} (attendance sync)`, roleCode: 'INTEGRATION', roleName: 'Integration', permissions: new Set(), mustChangePassword: false, sessionId: '', attributes: {} };
          await applyBatch(batch.id, actor, ip);
        }
      }
      const saved = await prisma.attendanceBatch.findUniqueOrThrow({ where: { id: batch.id }, include: { key: true } });
      return { duplicate: false, batch: serializeBatch(saved) };
    },
  });

  // ---------------------------------------------------------------- Administration
  r.add({
    method: 'get',
    path: '/attendance-sync',
    tag: 'Integrations',
    summary: 'Attendance sync settings, API keys and recent batches',
    permission: 'integrations.manage',
    handler: async () => {
      const [settings, keys, batches] = await Promise.all([
        getSettings(),
        prisma.integrationKey.findMany({ orderBy: { createdAt: 'desc' } }),
        prisma.attendanceBatch.findMany({ orderBy: { receivedAt: 'desc' }, take: 50, include: { key: true } }),
      ]);
      return {
        settings: settings.attendanceSync,
        keys: keys.map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt, revokedAt: k.revokedAt })),
        batches: batches.map(serializeBatch),
      };
    },
  });

  r.add({
    method: 'put',
    path: '/attendance-sync/settings',
    tag: 'Integrations',
    summary: 'Switch attendance sync on/off, choose auto-apply and map attendance fields to input columns',
    permission: 'integrations.manage',
    body: settingsSchema.shape.attendanceSync,
    handler: async ({ body, user, ip }) => {
      const keys = new Set((await prisma.payrollInputDefinition.findMany({ select: { key: true } })).map((d) => d.key));
      const fields = body.fieldMap.flatMap((f, i) => (keys.has(f.inputKey) ? [] : [{ path: `fieldMap.${i}.inputKey`, message: `Unknown input column ${f.inputKey}.` }]));
      const sources = body.fieldMap.map((f) => f.source);
      if (new Set(sources).size !== sources.length) fields.push({ path: 'fieldMap', message: 'Each attendance field can be mapped once.' });
      if (fields.length) throw new AppError('VALIDATION_ERROR', fields.map((f) => f.message).join(' '), { fields });
      const before = (await getSettings()).attendanceSync;
      await prisma.payrollSetting.upsert({ where: { key: 'attendanceSync' }, create: { key: 'attendanceSync', value: body, updatedById: user.id }, update: { value: body, updatedById: user.id } });
      await audit.write({ actorId: user.id, action: 'attendance_sync.updated', entity: 'payroll_settings', entityId: null, before, after: body, ip });
      return body;
    },
  });

  r.add({
    method: 'post',
    path: '/attendance-sync/keys',
    tag: 'Integrations',
    summary: 'Create an API key for the attendance application (the key is shown only once)',
    permission: 'integrations.manage',
    body: z.object({ name: z.string().trim().min(1).max(80) }),
    status: 201,
    handler: async ({ body, user, ip }) => {
      const prefix = KEY_PREFIX + randomBytes(4).toString('hex');
      const secret = `${prefix}.${randomBytes(32).toString('base64url')}`;
      const key = await prisma.integrationKey.create({ data: { name: body.name, prefix, keyHash: sha256(secret), createdById: user.id } });
      await audit.write({ actorId: user.id, action: 'integration_key.created', entity: 'integration_key', entityId: key.id, metadata: { name: key.name, prefix }, ip });
      return { id: key.id, name: key.name, prefix, key: secret };
    },
  });

  r.add({
    method: 'post',
    path: '/attendance-sync/keys/:id/revoke',
    tag: 'Integrations',
    summary: 'Revoke an attendance API key',
    permission: 'integrations.manage',
    params: idParam,
    handler: async ({ params, user, ip }) => {
      const key = await prisma.integrationKey.findUnique({ where: { id: params.id } });
      if (!key) throw notFound('API key');
      if (key.revokedAt) throw new AppError('INVALID_STATE', 'This key is already revoked.');
      await prisma.integrationKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } });
      await audit.write({ actorId: user.id, action: 'integration_key.revoked', entity: 'integration_key', entityId: key.id, metadata: { name: key.name, prefix: key.prefix }, ip });
      return { ok: true };
    },
  });

  r.add({
    method: 'get',
    path: '/attendance-sync/batches/:id',
    tag: 'Integrations',
    summary: 'A received batch with a preview of the values it writes (nothing is changed)',
    permission: 'integrations.manage',
    params: idParam,
    handler: async ({ params }) => {
      const batch = await prisma.attendanceBatch.findUnique({ where: { id: params.id }, include: { key: true } });
      if (!batch) throw notFound('Attendance batch');
      const settings = (await getSettings()).attendanceSync;
      const run = await prisma.payrollRun.findUnique({ where: { year_month: { year: batch.year, month: batch.month } } });
      const members = run ? await prisma.payrollRunEmployee.findMany({ where: { payrollRunId: run.id }, select: { employeeId: true, employeeCode: true, employeeName: true } }) : [];
      const preview = mapRecords(batch.records as PushRecord[], settings.fieldMap, new Map(members.map((m) => [m.employeeCode, m.employeeId])));
      const nameOf = new Map(members.map((m) => [m.employeeId, `${m.employeeCode} · ${m.employeeName}`]));
      return {
        batch: serializeBatch(batch),
        run: run ? { id: run.id, status: run.status } : null,
        fieldMap: settings.fieldMap,
        records: batch.records as PushRecord[],
        preview: { writes: preview.entries.map((e) => ({ employee: nameOf.get(e.employeeId) ?? e.employeeId, inputKey: e.inputKey, value: e.value })), problems: preview.errors, unmappedFields: preview.unmapped },
      };
    },
  });

  r.add({
    method: 'post',
    path: '/attendance-sync/batches/:id/apply',
    tag: 'Integrations',
    summary: 'Write a received batch into its payroll month (Draft or Calculated payroll only)',
    permission: 'integrations.manage',
    params: idParam,
    handler: async ({ params, user, ip }) => {
      if (!user.permissions.has('payroll.input')) throw new AppError('FORBIDDEN', 'Applying attendance also needs the Enter monthly inputs permission.');
      const batch = await prisma.attendanceBatch.findUnique({ where: { id: params.id } });
      if (!batch) throw notFound('Attendance batch');
      if (batch.status === 'APPLIED') throw new AppError('INVALID_STATE', 'This batch has already been applied.');
      const out = await applyBatch(batch.id, user, ip);
      if ('message' in out) throw new AppError('INVALID_STATE', out.message);
      return out;
    },
  });
}
