import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { AppError, idParam, notFound, type ApiRegistry } from '@nexzi/server-core';
import { prisma } from '../db';
import { audit } from '../audit';
import { decryptClientFile, encryptClientFile } from './crypto';

const maxFileBytes = 5 * 1024 * 1024;
const storageRoot = path.resolve(process.env.PRIVATE_CLIENT_STORAGE_DIR ?? path.join(process.cwd(), '.data', 'private-client-files'));
const clientParam = z.object({ id: z.string().uuid() });
const nullableText = (max: number) => z.string().trim().max(max).nullable().optional().or(z.literal('').transform(() => null));
const timeValue = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).nullable().optional();
const clientBody = z.object({
  clientName: z.string().trim().min(1).max(200),
  phoneCountryCode: nullableText(10),
  phoneNumber: nullableText(30),
  country: nullableText(100),
  stateRegion: nullableText(150),
  city: nullableText(150),
  address: nullableText(5000),
  availability: z.enum(['AVAILABLE', 'UNAVAILABLE']).default('AVAILABLE'),
  availableFrom: timeValue,
  availableTo: timeValue,
  referenceEmail: z.union([z.string().trim().email().max(255), z.literal(''), z.null()]).optional(),
  notes: nullableText(10000),
}).superRefine((body, context) => {
  if (body.availability === 'AVAILABLE' && Boolean(body.availableFrom) !== Boolean(body.availableTo)) {
    context.addIssue({ code: 'custom', path: ['availableTo'], message: 'Provide both availability times or leave both blank.' });
  }
  if (body.availability === 'AVAILABLE' && body.availableFrom && body.availableTo && body.availableFrom >= body.availableTo) {
    context.addIssue({ code: 'custom', path: ['availableTo'], message: 'Availability end time must be after the start time.' });
  }
});
const documentBody = z.object({ category: z.enum(['PHOTO', 'AADHAAR', 'MOU']) });

function safeName(value: string) {
  return path.basename(value).replace(/[^\w.-]/g, '_').slice(-180) || 'client-document';
}

function storedPath(name: string) {
  if (!/^[0-9a-f-]{36}\.enc$/.test(name)) throw new AppError('INVALID_STATE', 'Stored client document reference is invalid.');
  return path.join(storageRoot, name);
}

function actualFileType(buffer: Buffer, extension: string) {
  if (extension === 'pdf' && buffer.subarray(0, 5).toString('ascii') === '%PDF-') return { extension: 'pdf', contentType: 'application/pdf' };
  if (extension === 'png' && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { extension: 'png', contentType: 'image/png' };
  if ((extension === 'jpg' || extension === 'jpeg') && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { extension: 'jpg', contentType: 'image/jpeg' };
  if (extension === 'webp' && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return { extension: 'webp', contentType: 'image/webp' };
  throw new AppError('UNSUPPORTED_FILE', 'The file content does not match a supported PDF or image type.');
}

const serializeDocument = (document: {
  id: string;
  clientId: string;
  category: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: Date;
}) => ({
  id: document.id,
  clientId: document.clientId,
  category: document.category,
  originalName: document.originalName,
  contentType: document.contentType,
  sizeBytes: document.sizeBytes,
  createdAt: document.createdAt,
});

export function registerClientRoutes(r: ApiRegistry) {
  r.add({
    method: 'get',
    path: '/clients',
    tag: 'Workforce',
    summary: 'List client profiles and availability',
    permission: 'clients.view',
    handler: async () => prisma.clientRecord.findMany({ orderBy: [{ clientName: 'asc' }, { createdAt: 'desc' }], take: 500 }),
  });

  r.add({
    method: 'post',
    path: '/clients',
    tag: 'Workforce',
    summary: 'Create a client profile',
    permission: 'clients.manage',
    body: clientBody,
    status: 201,
    handler: async ({ body, user, ip }) => {
      const client = await prisma.clientRecord.create({
        data: {
          ...body,
          phoneCountryCode: body.phoneCountryCode || null,
          phoneNumber: body.phoneNumber || null,
          country: body.country || null,
          stateRegion: body.stateRegion || null,
          city: body.city || null,
          address: body.address || null,
          availableFrom: body.availability === 'AVAILABLE' ? body.availableFrom || null : null,
          availableTo: body.availability === 'AVAILABLE' ? body.availableTo || null : null,
          referenceEmail: body.referenceEmail || null,
          notes: body.notes || null,
          createdById: user.id,
          updatedById: user.id,
        },
      });
      await audit.write({ actorId: user.id, action: 'client.created', entity: 'client_record', entityId: client.id, ip });
      return client;
    },
  });

  r.add({
    method: 'put',
    path: '/clients/:id',
    tag: 'Workforce',
    summary: 'Update a client profile',
    permission: 'clients.manage',
    params: clientParam,
    body: clientBody,
    handler: async ({ params, body, user, ip }) => {
      const existing = await prisma.clientRecord.findUnique({ where: { id: params.id }, select: { id: true } });
      if (!existing) throw notFound('Client');
      const client = await prisma.clientRecord.update({
        where: { id: existing.id },
        data: {
          ...body,
          phoneCountryCode: body.phoneCountryCode || null,
          phoneNumber: body.phoneNumber || null,
          country: body.country || null,
          stateRegion: body.stateRegion || null,
          city: body.city || null,
          address: body.address || null,
          availableFrom: body.availability === 'AVAILABLE' ? body.availableFrom || null : null,
          availableTo: body.availability === 'AVAILABLE' ? body.availableTo || null : null,
          referenceEmail: body.referenceEmail || null,
          notes: body.notes || null,
          updatedById: user.id,
        },
      });
      await audit.write({ actorId: user.id, action: 'client.updated', entity: 'client_record', entityId: client.id, ip });
      return client;
    },
  });

  r.add({
    method: 'delete',
    path: '/clients/:id',
    tag: 'Workforce',
    summary: 'Delete a client profile and its private documents',
    permission: 'clients.manage',
    params: clientParam,
    handler: async ({ params, user, ip }) => {
      const client = await prisma.clientRecord.findUnique({ where: { id: params.id }, include: { documents: true } });
      if (!client) throw notFound('Client');
      const staged: Array<[string, string]> = [];
      const quarantine = path.join(storageRoot, `.deleting-${randomUUID()}`);
      let preserveQuarantine = false;
      await mkdir(quarantine, { recursive: true });
      try {
        for (const document of client.documents) {
          const from = storedPath(document.storedName);
          const to = path.join(quarantine, `${document.id}.enc`);
          try {
            await rename(from, to);
            staged.push([from, to]);
          } catch (error) {
            if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') continue;
            throw error;
          }
        }
        await prisma.clientRecord.delete({ where: { id: client.id } });
      } catch (error) {
        try {
          for (const [from, to] of staged) await rename(to, from);
        } catch (restoreError) {
          preserveQuarantine = true;
          throw new AggregateError([error, restoreError], 'Client deletion failed and private document recovery also failed.');
        }
        throw error;
      } finally {
        if (!preserveQuarantine) await rm(quarantine, { recursive: true, force: true });
      }
      await audit.write({ actorId: user.id, action: 'client.deleted', entity: 'client_record', entityId: client.id, metadata: { documentCount: client.documents.length }, ip });
      return { deleted: true };
    },
  });

  r.add({
    method: 'get',
    path: '/clients/:id/documents',
    tag: 'Workforce',
    summary: 'List private client document metadata',
    permission: ['clients.view', 'clients.sensitive.view'],
    params: clientParam,
    handler: async ({ params, user }) => {
      const client = await prisma.clientRecord.findUnique({ where: { id: params.id }, select: { id: true } });
      if (!client) throw notFound('Client');
      const documents = await prisma.clientDocument.findMany({ where: { clientId: client.id }, orderBy: { createdAt: 'desc' } });
      return documents
        .filter((document) => document.category === 'PHOTO' || user.permissions.has('clients.sensitive.view'))
        .map(serializeDocument);
    },
  });

  r.add({
    method: 'post',
    path: '/clients/:id/documents',
    tag: 'Workforce',
    summary: 'Upload an encrypted private client document',
    permission: 'clients.manage',
    params: clientParam,
    body: documentBody,
    upload: { field: 'file', maxBytes: maxFileBytes, extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp'] },
    status: 201,
    handler: async ({ params, body, user, ip, file }) => {
      if (!(await prisma.clientRecord.findUnique({ where: { id: params.id }, select: { id: true } }))) throw notFound('Client');
      if (!file || file.size > maxFileBytes) throw new AppError('PAYLOAD_TOO_LARGE', 'The document exceeds the 5 MB limit.');
      const extension = path.extname(file.originalName).slice(1).toLowerCase();
      const actualType = actualFileType(file.buffer, extension);
      if (body.category === 'PHOTO' && !actualType.contentType.startsWith('image/')) {
        throw new AppError('UNSUPPORTED_FILE', 'Client photos must be PNG, JPEG or WebP images.');
      }
      const storedName = `${randomUUID()}.enc`;
      await mkdir(storageRoot, { recursive: true });
      await writeFile(storedPath(storedName), encryptClientFile(file.buffer), { flag: 'wx', mode: 0o600 });
      let document;
      try {
        document = await prisma.clientDocument.create({
          data: {
            clientId: params.id,
            category: body.category,
            originalName: safeName(file.originalName),
            storedName,
            contentType: actualType.contentType,
            sizeBytes: file.size,
            uploadedById: user.id,
          },
        });
      } catch (error) {
        await unlink(storedPath(storedName));
        throw error;
      }
      await audit.write({ actorId: user.id, action: 'client.document_uploaded', entity: 'client_document', entityId: document.id, metadata: { clientId: params.id, category: document.category, sizeBytes: document.sizeBytes }, ip });
      return serializeDocument(document);
    },
  });

  r.add({
    method: 'get',
    path: '/client-documents/:id/download',
    tag: 'Workforce',
    summary: 'Download an encrypted private client document',
    permission: ['clients.view', 'clients.sensitive.view'],
    params: idParam,
    handler: async ({ params, user, res, ip }) => {
      const document = await prisma.clientDocument.findUnique({ where: { id: params.id } });
      if (!document) throw notFound('Client document');
      if (document.category !== 'PHOTO' && !user.permissions.has('clients.sensitive.view')) {
        throw new AppError('FORBIDDEN', 'Sensitive client documents require the dedicated view permission.');
      }
      let contents: Buffer;
      try {
        contents = decryptClientFile(await readFile(storedPath(document.storedName)));
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') throw notFound('Stored client document');
        throw error;
      }
      await audit.write({ actorId: user.id, action: 'client.document_downloaded', entity: 'client_document', entityId: document.id, metadata: { clientId: document.clientId, category: document.category }, ip });
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
    path: '/client-documents/:id',
    tag: 'Workforce',
    summary: 'Delete a private client document',
    permission: 'clients.manage',
    params: idParam,
    handler: async ({ params, user, ip }) => {
      const document = await prisma.clientDocument.findUnique({ where: { id: params.id } });
      if (!document) throw notFound('Client document');
      const original = storedPath(document.storedName);
      const quarantined = path.join(storageRoot, `.deleting-${randomUUID()}.enc`);
      let moved = false;
      try {
        await rename(original, quarantined);
        moved = true;
      } catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
      }
      try {
        await prisma.clientDocument.delete({ where: { id: document.id } });
      } catch (error) {
        if (moved) await rename(quarantined, original);
        throw error;
      }
      if (moved) await unlink(quarantined);
      await audit.write({ actorId: user.id, action: 'client.document_deleted', entity: 'client_document', entityId: document.id, metadata: { clientId: document.clientId, category: document.category }, ip });
      return { deleted: true };
    },
  });
}
