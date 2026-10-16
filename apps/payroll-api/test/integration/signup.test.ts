import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { devOutbox } from '@nexzi/server-core';
import { prisma } from '../../src/db';
import { app, login, ORIGIN, PASSWORD, resetDb } from '../helpers';

const post = (path: string, body: object) => request(app).post(path).set('Origin', ORIGIN).send(body);
const lastCode = (email: string) => {
  const m = [...devOutbox].reverse().find((x) => x.to === email && /verification code is \d{6}/.test(x.subject));
  return m ? /verification code is (\d{6})/.exec(m.subject)![1] : null;
};
const STRONG = 'Signup-Strong-Pass9';

beforeAll(resetDb);

describe('self-service sign-up with email verification', () => {
  it('reports sign-up configuration without requiring a session', async () => {
    const res = await request(app).get('/auth/signup/config');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ enabled: true, requiresApproval: false });
  });

  it('email → 6-digit code → name + password creates an active account that can sign in', async () => {
    const email = 'new.person@example.test';
    const start = await post('/auth/signup/start', { email });
    expect(start.status).toBe(200);
    expect(JSON.stringify(start.body)).not.toMatch(/\d{6}/); // the code is only ever emailed
    const code = lastCode(email)!;
    expect(code).toMatch(/^\d{6}$/);
    const mail = devOutbox.find((m) => m.to === email)!;
    expect(mail.html).toContain(code);
    expect(mail.text).toContain('expires in 10 minutes');

    const wrong = await post('/auth/signup/verify', { email, code: code === '000000' ? '111111' : '000000' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.message).toMatch(/4 attempt/);

    const verify = await post('/auth/signup/verify', { email, code });
    expect(verify.status).toBe(200);
    const token = verify.body.signupToken as string;
    expect(token.length).toBeGreaterThan(30);

    expect((await post('/auth/signup/complete', { signupToken: token, name: 'New Person', password: 'weak' })).status).toBe(400);
    const done = await post('/auth/signup/complete', { signupToken: token, name: 'New Person', password: STRONG });
    expect(done.status).toBe(201);
    expect(done.body).toEqual({ email, requiresApproval: false, accountType: 'USER' });

    const user = await prisma.user.findFirstOrThrow({ where: { email } });
    expect(user.status).toBe('ACTIVE');
    expect(user.passwordHash).not.toContain(STRONG);
    const agent = await login(email, STRONG);
    expect((await agent.get('/auth/me')).body.email).toBe(email);
    const actions = (await prisma.auditLog.findMany({ select: { action: true } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['signup.code_sent', 'signup.code_failed', 'signup.email_verified', 'signup.account_created']));
  });

  it('does not store the code or sign-up token in plain text', async () => {
    const rows = await prisma.emailVerification.findMany({ where: { email: 'new.person@example.test' } });
    expect(rows[0].codeHash).toMatch(/^\$2[aby]\$/);
    expect(rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a sign-up token cannot be used twice', async () => {
    const email = 'reuse@example.test';
    await post('/auth/signup/start', { email });
    const verify = await post('/auth/signup/verify', { email, code: lastCode(email)! });
    const body = { signupToken: verify.body.signupToken, name: 'Reuse Person', password: STRONG };
    expect((await post('/auth/signup/complete', body)).status).toBe(201);
    const again = await post('/auth/signup/complete', body);
    expect([400, 409]).toContain(again.status);
    expect(await prisma.user.count({ where: { email } })).toBe(1);
  });

  it('throttles repeated code requests for the same address', async () => {
    const email = 'throttle@example.test';
    expect((await post('/auth/signup/start', { email })).status).toBe(200);
    const second = await post('/auth/signup/start', { email });
    expect(second.status).toBe(429);
    expect(second.body.error.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('locks a code after 5 wrong attempts, even if the right code is then entered', async () => {
    const email = 'attempts@example.test';
    await post('/auth/signup/start', { email });
    const code = lastCode(email)!;
    const bad = code === '123456' ? '654321' : '123456';
    for (let i = 0; i < 5; i++) expect((await post('/auth/signup/verify', { email, code: bad })).status).toBe(400);
    const res = await post('/auth/signup/verify', { email, code });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Too many incorrect attempts/);
  });

  it('rejects expired codes', async () => {
    const email = 'expired@example.test';
    await post('/auth/signup/start', { email });
    const code = lastCode(email)!;
    await prisma.emailVerification.updateMany({ where: { email }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await post('/auth/signup/verify', { email, code })).status).toBe(400);
  });

  it('rejects a sign-up token whose window has passed', async () => {
    const email = 'late@example.test';
    await post('/auth/signup/start', { email });
    const verify = await post('/auth/signup/verify', { email, code: lastCode(email)! });
    await prisma.emailVerification.updateMany({ where: { email }, data: { tokenExpiresAt: new Date(Date.now() - 1000) } });
    const res = await post('/auth/signup/complete', { signupToken: verify.body.signupToken, name: 'Late Person', password: STRONG });
    expect(res.status).toBe(400);
    expect(await prisma.user.count({ where: { email } })).toBe(0);
  });

  it('does not reveal existing accounts: same response, no code is sent', async () => {
    const before = devOutbox.length;
    const res = await post('/auth/signup/start', { email: 'admin@test.local' });
    expect(res.status).toBe(200);
    const fresh = await post('/auth/signup/start', { email: 'brand.new@example.test' });
    expect(res.body.message).toBe(fresh.body.message);
    const mails = devOutbox.slice(before);
    expect(mails.find((m) => m.to === 'admin@test.local')!.subject).toMatch(/sign-up request/);
    expect(lastCode('admin@test.local')).toBeNull();
    // and the code cannot be guessed into an account takeover
    expect((await post('/auth/signup/verify', { email: 'admin@test.local', code: '000000' })).status).toBe(400);
  });

  it('validates the email format and the code format', async () => {
    expect((await post('/auth/signup/start', { email: 'not-an-email' })).status).toBe(400);
    expect((await post('/auth/signup/verify', { email: 'a@b.test', code: '12ab' })).status).toBe(400);
    expect((await post('/auth/signup/complete', { signupToken: 'x', name: 'A', password: STRONG })).status).toBe(400);
  });

  it('requires an allowed Origin on sign-up requests (CSRF)', async () => {
    const res = await request(app).post('/auth/signup/start').set('Origin', 'https://evil.example').send({ email: 'csrf@example.test' });
    expect(res.status).toBe(403);
  });
});

// keep the shared test password referenced so the helper import stays meaningful
void PASSWORD;