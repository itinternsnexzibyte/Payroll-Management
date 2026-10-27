import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { AppError, idParam, isoDate, notFound, toIsoDate, type ApiRegistry, type AuthUser } from '@nexzi/server-core';
import { prisma } from '../db';
import { audit } from '../audit';

const maxDocumentBytes = 5 * 1024 * 1024;
const storageRoot = path.resolve(process.env.PRIVATE_EMPLOYEE_STORAGE_DIR ?? path.join(process.cwd(), '.data', 'private-employee-files'));
const employeeParam = z.object({ id: z.string().uuid() });
const profileBody = z.object({
  teamsId: z.string().trim().max(150).nullable().optional(),
  college: z.string().trim().max(200).nullable().optional(),
  course: z.string().trim().max(150).nullable().optional(),
  internshipRole: z.string().trim().max(150).nullable().optional(),
  durationMonths: z.number().int().min(1).max(60).nullable().optional(),
});
const ratingBody = z.object({
  ratingDate: isoDate,
  rating: z.number().int().min(1).max(5),
  feedback: z.string().trim().max(5000).nullable().optional().or(z.literal('').transform(() => null)),
});
const documentBody = z.object({ category: z.enum(['OFFER_LETTER', 'PROFILE_PHOTO', 'OTHER']) });

async function canAccessEmployee(user: AuthUser, employeeId: string) {
  if (user.permissions.has('employees.view')) return true;
  if (!user.permissions.has('self.service')) return false;
  const linked = await prisma.user.findUnique({ where: { id: user.id }, select: { employeeId: true } });
  return linked?.employeeId === employeeId;
}

/** The payroll team edits any employee; a self-service account edits only its own linked record. */
async function canEditEmployee(user: AuthUser, employeeId: string) {
  if (user.permissions.has('employees.manage')) return true;
  if (!user.permissions.has('self.service')) return false;
  const linked = await prisma.user.findUnique({ where: { id: user.id }, select: { employeeId: true } });
  return linked?.employeeId === employeeId;
}

function actualFileType(buffer: Buffer, extension: string) {
  if (extension === 'pdf' && buffer.subarray(0, 5).toString('ascii') === '%PDF-') return { extension: 'pdf', contentType: 'application/pdf' };
  if (extension === 'png' && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { extension: 'png', contentType: 'image/png' };
  if ((extension === 'jpg' || extension === 'jpeg') && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { extension: 'jpg', contentType: 'image/jpeg' };
  if (extension === 'webp' && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return { extension: 'webp', contentType: 'image/webp' };
  throw new AppError('UNSUPPORTED_FILE', 'The file content does not match a supported PDF or image type.');
}

function safeOriginalName(value: string) {
  const name = path.basename(value).replace(/[^\w.-]/g, '_').slice(-180);
  return name || 'employee-document';
}

function storedFilePath(storedName: string) {
  if (!/^[0-9a-f-]{36}\.(pdf|png|jpg|webp)$/.test(storedName)) throw new AppError('INVALID_STATE', 'Stored document reference is invalid.');
  return path.join(storageRoot, storedName);
}

function serializeDocument(document: {
  id: string;
  employeeId: string;
  category: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: Date;
}) {
  return {
    id: document.id,
    employeeId: document.employeeId,
    category: document.category,
    originalName: document.originalName,
    contentType: document.contentType,
    sizeBytes: document.sizeBytes,
    createdAt: document.createdAt,
  };
}

export function registerEmployeeWorkforceDetailsRoutes(r: ApiRegistry) {
  r.add({
    method: 'get',
    path: '/employees/:id/workforce-profile',
    tag: 'Workforce',
    summary: 'View an employee workforce profile',
    permission: ['employees.view', 'self.service'],
    params: employeeParam,
    handler: async ({ params, user }) => {
      if (!(await canAccessEmployee(user, params.id))) throw new AppError('FORBIDDEN', 'You can only view your own workforce profile.');
      const employee = await prisma.employee.findUnique({ where: { id: params.id }, select: { id: true } });
      if (!employee) throw notFound('Employee');
      return prisma.employeeWorkforceProfile.findUnique({ where: { employeeId: employee.id } });
    },
  });

  r.add({
    method: 'put',
    path: '/employees/:id/workforce-profile',
    tag: 'Workforce',
    summary: 'Create or update an employee workforce profile (employees may edit their own)',
    permission: ['employees.manage', 'self.service'],
    params: employeeParam,
    body: profileBody,
    handler: async ({ params, body, user, ip }) => {
      if (!(await canEditEmployee(user, params.id))) throw new AppError('FORBIDDEN', 'You can only edit your own workforce profile.');
      if (!(await prisma.employee.findUnique({ where: { id: params.id }, select: { id: true } }))) throw notFound('Employee');
      const profile = await prisma.employeeWorkforceProfile.upsert({
        where: { employeeId: params.id },
        create: {
          employeeId: params.id,
          teamsId: body.teamsId || null,
          college: body.college || null,
          course: body.course || null,
          internshipRole: body.internshipRole || null,
          durationMonths: body.durationMonths ?? null,
        },
        update: {
          teamsId: body.teamsId ?? null,
          college: body.college ?? null,
          course: body.course ?? null,
          internshipRole: body.internshipRole ?? null,
          durationMonths: body.durationMonths ?? null,
        },
      });
      await audit.write({ actorId: user.id, action: 'workforce.profile_updated', entity: 'employee_workforce_profile', entityId: params.id, ip });
      return profile;
    },
  });

  r.add({
    method: 'get',
    path: '/employees/:id/ratings',
    tag: 'Workforce',
    summary: 'List employee evaluations',
    permission: ['employees.view', 'self.service'],
    params: employeeParam,
    handler: async ({ params, user }) => {
      if (!(await canAccessEmployee(user, params.id))) throw new AppError('FORBIDDEN', 'You can only view your own evaluations.');
      const employee = await prisma.employee.findUnique({ where: { id: params.id }, select: { id: true } });
      if (!employee) throw notFound('Employee');
      return prisma.employeeRating.findMany({ where: { employeeId: employee.id }, orderBy: [{ ratingDate: 'desc' }, { createdAt: 'desc' }] });
    },
  });

  r.add({
    method: 'put',
    path: '/employees/:id/ratings',
    tag: 'Workforce',
    summary: 'Record or update an employee evaluation for a date',
    permission: 'workforce.manage',
    params: employeeParam,
    body: ratingBody,
    handler: async ({ params, body, user, ip }) => {
      if (!(await prisma.employee.findUnique({ where: { id: params.id }, select: { id: true } }))) throw notFound('Employee');
      const ratingDate = toIsoDate(body.ratingDate)!;
      const previous = await prisma.employeeRating.findUnique({
        where: { employeeId_ratingDate: { employeeId: params.id, ratingDate: body.ratingDate } },
      });
      const rating = await prisma.employeeRating.upsert({
        where: { employeeId_ratingDate: { employeeId: params.id, ratingDate: body.ratingDate } },
        create: { employeeId: params.id, ratingDate: body.ratingDate, rating: body.rating, feedback: body.feedback ?? null, createdById: user.id, updatedById: user.id },
        update: { rating: body.rating, feedback: body.feedback ?? null, updatedById: user.id },
      });
      await audit.write({
        actorId: user.id,
        action: previous ? 'workforce.rating_updated' : 'workforce.rating_created',
        entity: 'employee_rating',
        entityId: rating.id,
        before: previous ? { rating: previous.rating, feedback: previous.feedback, ratingDate } : undefined,
        after: { rating: rating.rating, feedback: rating.feedback, ratingDate },
        ip,
      });
      return rating;
    },
  });

  r.add({
    method: 'get',
    path: '/employees/:id/documents',
    tag: 'Workforce',
    summary: 'List private employee documents',
    permission: ['employees.view', 'self.service'],
    params: employeeParam,
    handler: async ({ params, user }) => {
      if (!(await canAccessEmployee(user, params.id))) throw new AppError('FORBIDDEN', 'You can only view your own documents.');
      const employee = await prisma.employee.findUnique({ where: { id: params.id }, select: { id: true } });
      if (!employee) throw notFound('Employee');
      const documents = await prisma.employeeDocument.findMany({ where: { employeeId: employee.id }, orderBy: { createdAt: 'desc' } });
      return documents.map(serializeDocument);
    },
  });

  r.add({
    method: 'post',
    path: '/employees/:id/documents',
    tag: 'Workforce',
    summary: 'Upload a private employee document or profile photo (employees may upload their own)',
    permission: ['employees.manage', 'self.service'],
    params: employeeParam,
    body: documentBody,
    upload: { field: 'file', maxBytes: maxDocumentBytes, extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp'] },
    status: 201,
    handler: async ({ params, body, user, ip, file }) => {
      if (!(await canEditEmployee(user, params.id))) throw new AppError('FORBIDDEN', 'You can only upload your own documents.');
      if (!(await prisma.employee.findUnique({ where: { id: params.id }, select: { id: true } }))) throw notFound('Employee');
      if (!file || file.size > maxDocumentBytes) throw new AppError('PAYLOAD_TOO_LARGE', 'The document exceeds the 5 MB limit.');
      const extension = path.extname(file.originalName).slice(1).toLowerCase();
      const actualType = actualFileType(file.buffer, extension);
      if (body.category === 'PROFILE_PHOTO' && !actualType.contentType.startsWith('image/')) {
        throw new AppError('UNSUPPORTED_FILE', 'Profile photos must be PNG, JPEG or WebP images.');
      }
      const storedName = `${randomUUID()}.${actualType.extension}`;
      await mkdir(storageRoot, { recursive: true });
      await writeFile(storedFilePath(storedName), file.buffer, { flag: 'wx', mode: 0o600 });
      let document;
      try {
        document = await prisma.employeeDocument.create({
          data: {
            employeeId: params.id,
            category: body.category,
            originalName: safeOriginalName(file.originalName),
            storedName,
            contentType: actualType.contentType,
            sizeBytes: file.size,
            uploadedById: user.id,
          },
        });
      } catch (error) {
        await unlink(storedFilePath(storedName));
        throw error;
      }
      await audit.write({ actorId: user.id, action: 'workforce.document_uploaded', entity: 'employee_document', entityId: document.id, metadata: { employeeId: params.id, category: document.category, sizeBytes: document.sizeBytes }, ip });
      return serializeDocument(document);
    },
  });

  r.add({
    method: 'get',
    path: '/employee-documents/:id/download',
    tag: 'Workforce',
    summary: 'Download a private employee document',
    permission: ['employees.view', 'self.service'],
    params: idParam,
    handler: async ({ params, user, res, ip }) => {
      const document = await prisma.employeeDocument.findUnique({ where: { id: params.id } });
      if (!document) throw notFound('Employee document');
      if (!(await canAccessEmployee(user, document.employeeId))) throw new AppError('FORBIDDEN', 'You can only access your own documents.');
      let contents: Buffer;
      try {
        contents = await readFile(storedFilePath(document.storedName));
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') throw notFound('Stored document');
        throw error;
      }
      await audit.write({ actorId: user.id, action: 'workforce.document_downloaded', entity: 'employee_document', entityId: document.id, ip });
      const safeName = encodeURIComponent(document.originalName).replace(/['()]/g, escape => `%${escape.charCodeAt(0).toString(16).toUpperCase()}`);
      res.setHeader('Content-Type', document.contentType);
      res.setHeader('Content-Length', contents.length);
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${safeName}`);
      res.setHeader('Cache-Control', 'private, no-store');
      res.end(contents);
    },
  });

  r.add({
    method: 'delete',
    path: '/employee-documents/:id',
    tag: 'Workforce',
    summary: 'Delete a private employee document (employees may delete their own)',
    permission: ['employees.manage', 'self.service'],
    params: idParam,
    handler: async ({ params, user, ip }) => {
      const document = await prisma.employeeDocument.findUnique({ where: { id: params.id } });
      if (!document) throw notFound('Employee document');
      if (!(await canEditEmployee(user, document.employeeId))) throw new AppError('FORBIDDEN', 'You can only delete your own documents.');
      await unlink(storedFilePath(document.storedName)).catch((error: unknown) => {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return;
        throw error;
      });
      await prisma.employeeDocument.delete({ where: { id: document.id } });
      await audit.write({ actorId: user.id, action: 'workforce.document_deleted', entity: 'employee_document', entityId: document.id, metadata: { employeeId: document.employeeId, category: document.category }, ip });
      return { deleted: true };
    },
  });

  r.add({
    method: 'get',
    path: '/employee-documents/:id/preview',
    tag: 'Workforce',
    summary: 'Preview a private employee profile photo',
    permission: ['employees.view', 'self.service'],
    params: idParam,
    handler: async ({ params, user, res, ip }) => {
      const document = await prisma.employeeDocument.findUnique({ where: { id: params.id } });
      if (!document || document.category !== 'PROFILE_PHOTO') throw notFound('Profile photo');
      if (!(await canAccessEmployee(user, document.employeeId))) throw new AppError('FORBIDDEN', 'You can only access your own documents.');
      let contents: Buffer;
      try {
        contents = await readFile(storedFilePath(document.storedName));
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') throw notFound('Stored profile photo');
        throw error;
      }
      await audit.write({ actorId: user.id, action: 'workforce.profile_photo_viewed', entity: 'employee_document', entityId: document.id, ip });
      res.setHeader('Content-Type', document.contentType);
      res.setHeader('Content-Length', contents.length);
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.end(contents);
    },
  });
}
