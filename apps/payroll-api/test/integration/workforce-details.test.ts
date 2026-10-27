import { beforeAll, describe, expect, it } from 'vitest';
import type { Agent } from 'supertest';
import { prisma } from '../../src/db';
import { createUser } from '../../src/bootstrap';
import { app, login, ORIGIN, PASSWORD, resetDb } from '../helpers';

let admin: Agent;
let employee: Agent;
let employeeId: string;

beforeAll(async () => {
  await resetDb();
  admin = await login('admin@test.local');
  const row = await prisma.employee.create({
    data: { employeeCode: 'WF-001', fullName: 'Workforce Details Test', joiningDate: new Date('2024-01-01T00:00:00Z') },
  });
  employeeId = row.id;
  await createUser('workforce@test.local', 'Workforce Test', 'EMPLOYEE', PASSWORD, false);
  await prisma.user.update({ where: { email: 'workforce@test.local' }, data: { employeeId } });
  employee = await login('workforce@test.local');
});

describe('Payroll-native workforce details', () => {
  it('stores an extended profile and dated evaluations with employee-only visibility', async () => {
    const profile = await admin.put(`/employees/${employeeId}/workforce-profile`).set('Origin', ORIGIN).send({
      teamsId: 'nexzi-test',
      college: 'Example College',
      course: 'Computer Science',
      internshipRole: 'Software Engineer Intern',
      durationMonths: 6,
    });
    expect(profile.status).toBe(200);
    expect(profile.body).toMatchObject({ employeeId, teamsId: 'nexzi-test', course: 'Computer Science', durationMonths: 6 });

    expect((await employee.get(`/employees/${employeeId}/workforce-profile`)).body).toMatchObject({ teamsId: 'nexzi-test' });
    expect((await admin.put(`/employees/${employeeId}/ratings`).set('Origin', ORIGIN).send({
      ratingDate: '2026-10-01',
      rating: 5,
      feedback: 'Excellent delivery and communication.',
    })).status).toBe(200);
    expect((await employee.get(`/employees/${employeeId}/ratings`)).body).toMatchObject([
      { rating: 5, feedback: 'Excellent delivery and communication.', ratingDate: '2026-10-01T00:00:00.000Z' },
    ]);
    const own = await employee.put(`/employees/${employeeId}/workforce-profile`).set('Origin', ORIGIN).send({ college: 'Self-edited College', internshipRole: 'Web Developer' });
    expect(own.status).toBe(200);
    expect(own.body).toMatchObject({ college: 'Self-edited College', internshipRole: 'Web Developer' });
    const other = await prisma.employee.create({ data: { employeeCode: 'WF-004', fullName: 'Someone Else', joiningDate: new Date('2024-01-01T00:00:00Z') } });
    expect((await employee.put(`/employees/${other.id}/workforce-profile`).set('Origin', ORIGIN).send({ college: 'Not allowed' })).status).toBe(403);
    expect((await employee.put(`/employees/${employeeId}/ratings`).set('Origin', ORIGIN).send({
      ratingDate: '2026-10-02',
      rating: 4,
    })).status).toBe(403);
  });

  it('stores private documents outside the web root and enforces owner access', async () => {
    const uploaded = await admin
      .post(`/employees/${employeeId}/documents`)
      .set('Origin', ORIGIN)
      .field('category', 'OFFER_LETTER')
      .attach('file', Buffer.from('%PDF-1.4\nTest document\n%%EOF'), { filename: 'offer-letter.pdf', contentType: 'application/pdf' });
    expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(201);
    expect(uploaded.body).toMatchObject({ employeeId, category: 'OFFER_LETTER', contentType: 'application/pdf' });

    const metadata = await employee.get(`/employees/${employeeId}/documents`);
    expect(metadata.status).toBe(200);
    expect(metadata.body).toHaveLength(1);
    expect(metadata.body[0]).not.toHaveProperty('storedName');

    const file = await employee.get(`/employee-documents/${uploaded.body.id}/download`);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toContain('application/pdf');
    expect(file.headers['cache-control']).toContain('no-store');
    expect(Buffer.isBuffer(file.body)).toBe(true);
    expect(file.body.toString()).toContain('%PDF-1.4');

    const other = await prisma.employee.create({
      data: { employeeCode: 'WF-002', fullName: 'Other Workforce Employee', joiningDate: new Date('2024-01-01T00:00:00Z') },
    });
    expect((await employee.get(`/employees/${other.id}/documents`)).status).toBe(403);
    const otherUpload = await admin
      .post(`/employees/${other.id}/documents`)
      .set('Origin', ORIGIN)
      .field('category', 'OFFER_LETTER')
      .attach('file', Buffer.from('%PDF-1.4\nPrivate to another employee\n%%EOF'), { filename: 'other-offer.pdf', contentType: 'application/pdf' });
    expect(otherUpload.status).toBe(201);
    expect((await employee.get(`/employee-documents/${otherUpload.body.id}/download`)).status).toBe(403);
    expect((await employee.delete(`/employee-documents/${otherUpload.body.id}`).set('Origin', ORIGIN)).status).toBe(403);

    const deleted = await admin.delete(`/employee-documents/${uploaded.body.id}`).set('Origin', ORIGIN);
    expect(deleted.status).toBe(200);
    expect(await prisma.employeeDocument.count({ where: { id: uploaded.body.id } })).toBe(0);
    expect((await admin.delete(`/employee-documents/${otherUpload.body.id}`).set('Origin', ORIGIN)).status).toBe(200);
  });

  it('rejects files whose content does not match an allowed format', async () => {
    const invalid = await admin
      .post(`/employees/${employeeId}/documents`)
      .set('Origin', ORIGIN)
      .field('category', 'OFFER_LETTER')
      .attach('file', Buffer.from('not a pdf'), { filename: 'offer.pdf', contentType: 'application/pdf' });
    expect(invalid.status).toBe(415);
  });

  it('lets the employee upload, preview and delete their own profile photo privately', async () => {
    const photoBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=', 'base64');
    const before = (await employee.get(`/employees/${employeeId}/documents`)).body.length;
    const uploaded = await employee
      .post(`/employees/${employeeId}/documents`)
      .set('Origin', ORIGIN)
      .field('category', 'PROFILE_PHOTO')
      .attach('file', photoBytes, { filename: 'profile.png', contentType: 'image/png' });
    expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(201);
    expect(uploaded.body).toMatchObject({ employeeId, category: 'PROFILE_PHOTO', contentType: 'image/png' });
    const preview = await employee.get(`/employee-documents/${uploaded.body.id}/preview`);
    expect(preview.status).toBe(200);
    expect(preview.headers['content-type']).toContain('image/png');
    expect(preview.headers['content-disposition']).toBe('inline');
    expect(preview.headers['cache-control']).toContain('no-store');
    expect(preview.body).toEqual(photoBytes);
    expect((await employee.get(`/employees/${employeeId}/documents`)).body).toHaveLength(before + 1);
    const other = await prisma.employee.create({ data: { employeeCode: 'WF-003', fullName: 'Another Person', joiningDate: new Date('2024-01-01T00:00:00Z') } });
    const foreign = await employee
      .post(`/employees/${other.id}/documents`)
      .set('Origin', ORIGIN)
      .field('category', 'PROFILE_PHOTO')
      .attach('file', photoBytes, { filename: 'profile.png', contentType: 'image/png' });
    expect(foreign.status).toBe(403);
    expect((await employee.delete(`/employee-documents/${uploaded.body.id}`).set('Origin', ORIGIN)).status).toBe(200);
  });

  it('lets the employee edit their own details but not their code or joining date', async () => {
    const res = await employee.put('/me/employee').set('Origin', ORIGIN).send({ fullName: 'Workforce Renamed', contactPhone: '+91 98765 43210', panNumber: 'abcde1234f', uanNumber: '102242295762', employeeCode: 'HACK-1', joiningDate: '2020-01-01' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ fullName: 'Workforce Renamed', panNumber: 'ABCDE1234F', uanNumber: '102242295762', employeeCode: 'WF-001', joiningDate: '2024-01-01' });
    expect((await employee.put('/me/employee').set('Origin', ORIGIN).send({ fullName: 'X', panNumber: 'bad' })).status).toBe(400);
  });
});
