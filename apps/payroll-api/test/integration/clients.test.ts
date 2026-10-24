import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Agent } from 'supertest';
import { prisma } from '../../src/db';
import { createUser } from '../../src/bootstrap';
import { setClientDataKeyForTests } from '../../src/clients/crypto';
import { app, login, ORIGIN, PASSWORD, resetDb } from '../helpers';

let admin: Agent;
let manager: Agent;
let clientId: string;

beforeAll(async () => {
  setClientDataKeyForTests(randomBytes(32));
  await resetDb();
  admin = await login('admin@test.local');

  const role = await prisma.role.create({ data: { code: 'CLIENT_MANAGER', name: 'Client Manager', enabled: true, isSystem: false } });
  await prisma.rolePermission.createMany({ data: [
    { roleId: role.id, permissionCode: 'clients.view' },
    { roleId: role.id, permissionCode: 'clients.manage' },
  ] });
  await createUser('client.manager@test.local', 'Client Manager', 'CLIENT_MANAGER', PASSWORD, false);
  manager = await login('client.manager@test.local');
});

describe('Private client profiles and documents', () => {
  it('creates, updates, and validates availability windows', async () => {
    const created = await admin.post('/clients').set('Origin', ORIGIN).send({
      clientName: 'Example Client',
      country: 'United States',
      city: 'Boston',
      availability: 'AVAILABLE',
      availableFrom: '09:00',
      availableTo: '17:00',
      referenceEmail: 'reference@example.test',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    clientId = created.body.id;
    expect(created.body).toMatchObject({ clientName: 'Example Client', availability: 'AVAILABLE', availableFrom: '09:00' });

    const invalid = await admin.put(`/clients/${clientId}`).set('Origin', ORIGIN).send({
      clientName: 'Example Client',
      availability: 'AVAILABLE',
      availableFrom: '09:00',
      availableTo: null,
    });
    expect(invalid.status).toBe(400);
    const invalidRange = await admin.put(`/clients/${clientId}`).set('Origin', ORIGIN).send({
      clientName: 'Example Client',
      availability: 'AVAILABLE',
      availableFrom: '21:00',
      availableTo: '09:00',
    });
    expect(invalidRange.status).toBe(400);

    const updated = await admin.put(`/clients/${clientId}`).set('Origin', ORIGIN).send({
      clientName: 'Example Client Updated',
      availability: 'UNAVAILABLE',
      availableFrom: '09:00',
      availableTo: '17:00',
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ clientName: 'Example Client Updated', availability: 'UNAVAILABLE', availableFrom: null, availableTo: null });
    expect((await manager.get('/clients')).body).toMatchObject([{ id: clientId, clientName: 'Example Client Updated' }]);
  });

  it('encrypts identity/agreement files at rest and requires the dedicated sensitive permission', async () => {
    const identity = Buffer.from('%PDF-1.4\nprivate identity material\n%%EOF');
    const uploaded = await admin
      .post(`/clients/${clientId}/documents`)
      .set('Origin', ORIGIN)
      .field('category', 'AADHAAR')
      .attach('file', identity, { filename: 'identity.pdf', contentType: 'application/pdf' });
    expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(201);
    expect(uploaded.body).toMatchObject({ clientId, category: 'AADHAAR', contentType: 'application/pdf' });

    const row = await prisma.clientDocument.findUniqueOrThrow({ where: { id: uploaded.body.id }, select: { storedName: true } });
    const stored = await readFile(path.join(process.cwd(), '.data', 'private-client-files', row.storedName));
    expect(stored.toString()).not.toContain('private identity material');

    expect((await manager.get(`/clients/${clientId}/documents`)).body).toEqual([]);
    expect((await manager.get(`/client-documents/${uploaded.body.id}/download`)).status).toBe(403);
    const downloaded = await admin.get(`/client-documents/${uploaded.body.id}/download`);
    expect(downloaded.status).toBe(200);
    expect(downloaded.body.toString()).toContain('private identity material');

    expect((await admin.delete(`/client-documents/${uploaded.body.id}`).set('Origin', ORIGIN)).status).toBe(200);
  });

  it('rejects unsupported document signatures and deletes client records', async () => {
    const invalid = await admin
      .post(`/clients/${clientId}/documents`)
      .set('Origin', ORIGIN)
      .field('category', 'MOU')
      .attach('file', Buffer.from('not a pdf'), { filename: 'agreement.pdf', contentType: 'application/pdf' });
    expect(invalid.status).toBe(415);
    expect((await admin.delete(`/clients/${clientId}`).set('Origin', ORIGIN)).status).toBe(200);
    expect((await admin.get(`/clients/${clientId}/documents`)).status).toBe(404);
  });
});
