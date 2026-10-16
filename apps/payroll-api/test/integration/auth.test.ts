import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '../../src/db';
import { app, login, ORIGIN, PASSWORD, resetDb } from '../helpers';
import { createUser } from '../../src/bootstrap';

beforeAll(resetDb);

describe('authentication and session security', () => {
  it('signs in with valid credentials and returns permissions', async () => {
    const agent = await login('admin@test.local');
    const me = await agent.get('/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.role).toBe('ADMIN');
    expect(me.body.permissions).toContain('payroll.reopen');
    expect(me.body.passwordHash).toBeUndefined();
  });

  it('rejects invalid credentials with a generic message', async () => {
    const res = await request(app).post('/auth/login').set('Origin', ORIGIN).send({ email: 'admin@test.local', password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    const unknown = await request(app).post('/auth/login').set('Origin', ORIGIN).send({ email: 'nobody@test.local', password: 'x' });
    expect(unknown.body.error.message).toBe(res.body.error.message);
  });

  it('locks the account after repeated failures', async () => {
    await createUser('lockme@test.local', 'Lock Me', 'PAYROLL_USER', PASSWORD, false);
    for (let i = 0; i < 5; i++) await request(app).post('/auth/login').set('Origin', ORIGIN).send({ email: 'lockme@test.local', password: 'bad' });
    const res = await request(app).post('/auth/login').set('Origin', ORIGIN).send({ email: 'lockme@test.local', password: PASSWORD });
    expect(res.status).toBe(423);
    expect(res.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('blocks disabled accounts', async () => {
    await createUser('disabled@test.local', 'Disabled', 'PAYROLL_USER', PASSWORD, false);
    await prisma.user.update({ where: { email: 'disabled@test.local' }, data: { status: 'DISABLED' } });
    const res = await request(app).post('/auth/login').set('Origin', ORIGIN).send({ email: 'disabled@test.local', password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
  });

  it('logout revokes the session', async () => {
    const agent = await login('user@test.local');
    expect((await agent.post('/auth/logout').set('Origin', ORIGIN)).status).toBe(204);
    expect((await agent.get('/auth/me')).status).toBe(401);
  });

  it('expires idle sessions', async () => {
    const agent = await login('user@test.local');
    await prisma.session.updateMany({ where: { user: { email: 'user@test.local' }, revokedAt: null }, data: { lastSeenAt: new Date(Date.now() - 3 * 3600_000) } });
    const res = await agent.get('/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('forces a password change before other actions', async () => {
    await createUser('newbie@test.local', 'Newbie', 'PAYROLL_USER', PASSWORD, true);
    const agent = await login('newbie@test.local');
    expect((await agent.get('/employees')).body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    const weak = await agent.post('/auth/change-password').set('Origin', ORIGIN).send({ currentPassword: PASSWORD, newPassword: 'short' });
    expect(weak.status).toBe(400);
    const ok = await agent.post('/auth/change-password').set('Origin', ORIGIN).send({ currentPassword: PASSWORD, newPassword: 'Another-Strong-Pass9' });
    expect(ok.status).toBe(204);
    expect((await agent.get('/employees')).status).toBe(200);
  });

  it('rejects state-changing requests from foreign origins (CSRF)', async () => {
    const agent = await login('admin@test.local');
    const res = await agent.post('/departments').set('Origin', 'https://evil.example').send({ name: 'X' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_REJECTED');
    const noOrigin = await agent.post('/departments').send({ name: 'X' });
    expect(noOrigin.status).toBe(403);
  });

  it('keeps the optional Viewer role disabled until confirmed', async () => {
    await createUser('viewer@test.local', 'Viewer', 'VIEWER', PASSWORD, false);
    const res = await request(app).post('/auth/login').set('Origin', ORIGIN).send({ email: 'viewer@test.local', password: PASSWORD });
    expect(res.status).toBe(403);
  });

  it('records login events in the append-only audit log', async () => {
    const count = await prisma.auditLog.count({ where: { action: { startsWith: 'auth.' } } });
    expect(count).toBeGreaterThan(3);
    await expect(prisma.auditLog.deleteMany({})).rejects.toThrow(/append-only/);
  });
});

describe('role-based access control (server-enforced)', () => {
  it('denies Payroll User access to administration endpoints even via direct API calls', async () => {
    const agent = await login('user@test.local');
    expect((await agent.get('/users')).status).toBe(403);
    expect((await agent.get('/audit-logs')).status).toBe(403);
    expect((await agent.post('/employees').set('Origin', ORIGIN).send({ employeeCode: 'X1', fullName: 'Nope Person', joiningDate: '2024-01-01' })).status).toBe(403);
    expect((await agent.post('/salary-components').set('Origin', ORIGIN).send({ code: 'HACK', name: 'Hack', type: 'EARNING', basis: 'FIXED' })).status).toBe(403);
    const runId = '00000000-0000-4000-8000-000000000000';
    expect((await agent.post(`/payroll-runs/${runId}/approve`).set('Origin', ORIGIN)).status).toBe(403);
    expect((await agent.post(`/payroll-runs/${runId}/finalise`).set('Origin', ORIGIN)).status).toBe(403);
    expect((await agent.post(`/payroll-runs/${runId}/reopen`).set('Origin', ORIGIN).send({ reason: 'trying to bypass the UI' })).status).toBe(403);
  });

  it('requires authentication for every business endpoint', async () => {
    for (const path of ['/employees', '/payroll-runs', '/salary-components', '/dashboard', '/reports/net-payable?runId=00000000-0000-4000-8000-000000000000']) {
      expect((await request(app).get(path)).status).toBe(401);
    }
  });

  it('validates input on the server', async () => {
    const agent = await login('admin@test.local');
    const res = await agent.post('/employees').set('Origin', ORIGIN).send({ employeeCode: 'bad code!', fullName: '', joiningDate: '2024-13-01' });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.map((f: { path: string }) => f.path)).toEqual(expect.arrayContaining(['employeeCode', 'fullName', 'joiningDate']));
  });
});
