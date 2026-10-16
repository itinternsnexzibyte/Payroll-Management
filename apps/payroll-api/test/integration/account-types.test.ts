/**
 * Create account as User or as Administrator, approval of Administrator requests, and the
 * "Sign in as User / as Administrator" check.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { devOutbox } from '@nexzi/server-core';
import { prisma } from '../../src/db';
import { app, login, ORIGIN, PASSWORD, resetDb } from '../helpers';

const post = (path: string, body: object) => request(app).post(path).set('Origin', ORIGIN).send(body);
const STRONG = 'Account-Type-Pass9';

async function signUp(email: string, accountType?: 'USER' | 'ADMIN') {
  expect((await post('/auth/signup/start', { email })).status).toBe(200);
  const mail = [...devOutbox].reverse().find((m) => m.to === email && /verification code is \d{6}/.test(m.subject))!;
  const code = /verification code is (\d{6})/.exec(mail.subject)![1];
  const verify = await post('/auth/signup/verify', { email, code });
  return post('/auth/signup/complete', { signupToken: verify.body.signupToken, name: 'Test Person', password: STRONG, ...(accountType ? { accountType } : {}) });
}
const signIn = (email: string, password: string, portal?: 'USER' | 'ADMIN') => post('/auth/login', { email, password, ...(portal ? { portal } : {}) });

beforeAll(resetDb);

describe('create account as User or as Administrator', () => {
  it('advertises the Administrator option in the sign-up configuration', async () => {
    const res = await request(app).get('/auth/signup/config');
    expect(res.body).toMatchObject({ enabled: true, adminSignup: 'approval' });
  });

  it('a User account is active immediately with the Payroll User role', async () => {
    const res = await signUp('new.user@example.test', 'USER');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ requiresApproval: false, accountType: 'USER' });
    const u = await prisma.user.findFirstOrThrow({ where: { email: 'new.user@example.test' }, include: { role: true } });
    expect([u.status, u.role.code]).toEqual(['ACTIVE', 'PAYROLL_USER']);
    expect((await signIn('new.user@example.test', STRONG, 'USER')).status).toBe(200);
  });

  it('defaults to a User account when no type is given (existing clients unchanged)', async () => {
    const res = await signUp('default.type@example.test');
    expect(res.body.accountType).toBe('USER');
  });

  it('an Administrator request is created pending and cannot sign in until approved', async () => {
    const res = await signUp('wants.admin@example.test', 'ADMIN');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ requiresApproval: true, accountType: 'ADMIN' });
    const u = await prisma.user.findFirstOrThrow({ where: { email: 'wants.admin@example.test' }, include: { role: true } });
    expect([u.status, u.role.code]).toEqual(['PENDING', 'ADMIN']);
    const blocked = await signIn('wants.admin@example.test', STRONG, 'ADMIN');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('ACCOUNT_PENDING');
    expect(await prisma.auditLog.count({ where: { action: 'signup.admin_requested', entityId: u.id } })).toBe(1);
  });

  it('only users with user-management rights can approve, and only once', async () => {
    const pending = await prisma.user.findFirstOrThrow({ where: { email: 'wants.admin@example.test' } });
    const payrollUser = await login('user@test.local');
    expect((await payrollUser.post(`/users/${pending.id}/approve`).set('Origin', ORIGIN).send({})).status).toBe(403);

    const admin = await login('admin@test.local');
    const notifications = await admin.get('/notifications');
    expect(notifications.body.items.some((n: { message: string }) => n.message.includes('requested a Administrator account'))).toBe(true);

    const [a, b] = await Promise.all([admin.post(`/users/${pending.id}/approve`).set('Origin', ORIGIN).send({}), admin.post(`/users/${pending.id}/approve`).set('Origin', ORIGIN).send({})]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const ok = await signIn('wants.admin@example.test', STRONG, 'ADMIN');
    expect(ok.status).toBe(200);
    expect(ok.body.user.role).toBe('ADMIN');
    expect(await prisma.auditLog.count({ where: { action: 'user.approved', entityId: pending.id } })).toBe(1);
  });

  it('a rejected request is disabled (kept, not deleted) with the reason audited', async () => {
    await signUp('rejected.admin@example.test', 'ADMIN');
    const u = await prisma.user.findFirstOrThrow({ where: { email: 'rejected.admin@example.test' } });
    const admin = await login('admin@test.local');
    expect((await admin.post(`/users/${u.id}/reject`).set('Origin', ORIGIN).send({ reason: 'Unknown requester' })).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).status).toBe('DISABLED');
    expect((await signIn('rejected.admin@example.test', STRONG, 'ADMIN')).body.error.code).toBe('ACCOUNT_DISABLED');
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: 'user.rejected', entityId: u.id } });
    expect(entry.metadata).toMatchObject({ reason: 'Unknown requester' });
    // Approving an already-handled request is refused.
    expect((await admin.post(`/users/${u.id}/approve`).set('Origin', ORIGIN).send({})).status).toBe(409);
  });

  it('rejects an unknown account type', async () => {
    expect((await signUp('odd.type@example.test', 'ROOT' as 'ADMIN')).status).toBe(400);
  });
});

describe('sign in as User or as Administrator', () => {
  it('lets each account in through its own sign-in only, without creating a session otherwise', async () => {
    const sessionsBefore = await prisma.session.count();
    const adminOnUser = await signIn('admin@test.local', PASSWORD, 'USER');
    expect(adminOnUser.status).toBe(403);
    expect(adminOnUser.body.error.message).toMatch(/Sign in as Administrator/);
    expect(adminOnUser.headers['set-cookie']).toBeUndefined();
    const userOnAdmin = await signIn('user@test.local', PASSWORD, 'ADMIN');
    expect(userOnAdmin.status).toBe(403);
    expect(userOnAdmin.body.error.message).toMatch(/Payroll User account.*Sign in as User/);
    expect(await prisma.session.count()).toBe(sessionsBefore);

    expect((await signIn('admin@test.local', PASSWORD, 'ADMIN')).status).toBe(200);
    expect((await signIn('user@test.local', PASSWORD, 'USER')).status).toBe(200);
  });

  it('never reveals the account type before the password is checked', async () => {
    const res = await signIn('admin@test.local', 'Wrong-Password-9', 'USER');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('keeps sign-in without a portal working for API clients', async () => {
    expect((await signIn('user@test.local', PASSWORD)).status).toBe(200);
  });
});
