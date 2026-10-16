import { randomBytes, randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { AppError } from './errors';
import { hashPassword, hashToken, passwordSchema } from './auth';
import type { AuditWriter } from './audit';
import type { Mailer } from './mailer';
import type { ApiRegistry } from './registry';
import { envBool } from './env';

export interface EmailVerificationRecord {
  id: string;
  email: string;
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  verifiedAt: Date | null;
  tokenExpiresAt: Date | null;
  consumedAt: Date | null;
  createdAt: Date;
}

/** Persistence adapter implemented by each application against its own database. */
export interface SignupStore {
  userExists(email: string): Promise<boolean>;
  countRecent(email: string, since: Date): Promise<number>;
  latest(email: string): Promise<EmailVerificationRecord | null>;
  create(data: { email: string; codeHash: string; expiresAt: Date; ip: string | null }): Promise<{ id: string }>;
  incrementAttempts(id: string): Promise<void>;
  markVerified(id: string, tokenHash: string, tokenExpiresAt: Date): Promise<void>;
  findByToken(tokenHash: string): Promise<EmailVerificationRecord | null>;
  /** Creates the account and consumes the verification atomically; returns the new user id. */
  completeSignup(data: { verificationId: string; email: string; name: string; passwordHash: string; active: boolean; roleCode: string }): Promise<{ id: string }>;
}

export const signupEnvShape = {
  SIGNUP_ENABLED: envBool,
  /** Optional: when true, new accounts stay PENDING until an Administrator approves them (off by default). */
  SIGNUP_REQUIRE_APPROVAL: z
    .enum(['true', 'false', '1', '0'])
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  /**
   * Administrator sign-up: "approval" (default) lets people request an Administrator account,
   * created as PENDING until an existing Administrator approves it; "off" hides the option.
   */
  ADMIN_SIGNUP: z.enum(['off', 'approval']).default('approval'),
  /** Optional comma-separated list of email domains allowed to sign up (e.g. "client.com"). */
  SIGNUP_ALLOWED_DOMAINS: z
    .string()
    .default('')
    .transform((s) => s.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean)),
};

export interface SignupConfig {
  appName: string;
  enabled: boolean;
  requireApproval: boolean;
  allowedDomains: string[];
  /** Whether people may request an Administrator account (always approval-gated). */
  adminSignup: 'off' | 'approval';
  /** Role codes given to self-registered accounts. */
  roles: { user: string; admin: string };
  codeTtlMinutes?: number;
  maxAttempts?: number;
  resendCooldownSeconds?: number;
  maxCodesPerHour?: number;
}

export type AccountType = 'USER' | 'ADMIN';

const GENERIC_SENT = 'If this email can be used to sign up, a 6-digit verification code has been sent to it.';

function emailHtml(appName: string, heading: string, body: string) {
  return `<!doctype html><html><body style="margin:0;background:#f0d9dc;font-family:Arial,Helvetica,sans-serif;color:#24161a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:10px;overflow:hidden">
<tr><td style="background:#401018;color:#ffffff;padding:18px 24px;font-size:16px;font-weight:bold">${appName}</td></tr>
<tr><td style="padding:24px"><h1 style="margin:0 0 12px;font-size:18px;color:#401018">${heading}</h1>${body}
<p style="margin:24px 0 0;font-size:12px;color:#6b5a5e">If you did not request this, you can ignore this email.</p></td></tr>
</table></td></tr></table></body></html>`;
}

/**
 * Self-service sign-up: email → 6-digit code → name + password. Codes are hashed, expire, allow a
 * limited number of attempts and are throttled per address. Responses never reveal whether an
 * account already exists (existing users get an informational email instead of a code).
 */
export class SignupService {
  private readonly ttl: number;
  private readonly maxAttempts: number;
  private readonly cooldown: number;
  private readonly perHour: number;

  constructor(
    private readonly store: SignupStore,
    private readonly mailer: Mailer,
    private readonly audit: AuditWriter,
    private readonly config: SignupConfig,
  ) {
    this.ttl = config.codeTtlMinutes ?? 10;
    this.maxAttempts = config.maxAttempts ?? 5;
    this.cooldown = config.resendCooldownSeconds ?? 60;
    this.perHour = config.maxCodesPerHour ?? 5;
  }

  private assertEnabled() {
    if (!this.config.enabled) throw new AppError('FORBIDDEN', 'Self-service sign-up is disabled. Ask an administrator to create your account.');
  }

  private assertDomain(email: string) {
    const domain = email.split('@')[1] ?? '';
    if (this.config.allowedDomains.length && !this.config.allowedDomains.includes(domain)) {
      throw new AppError('VALIDATION_ERROR', 'Sign-up is limited to approved company email addresses.', { fields: [{ path: 'email', message: 'This email domain is not allowed.' }] });
    }
  }

  async start(email: string, ip: string | null) {
    this.assertEnabled();
    this.assertDomain(email);
    const now = Date.now();
    const latest = await this.store.latest(email);
    if (latest && now - latest.createdAt.getTime() < this.cooldown * 1000) {
      const wait = Math.ceil((this.cooldown * 1000 - (now - latest.createdAt.getTime())) / 1000);
      throw new AppError('RATE_LIMITED', `Please wait ${wait} seconds before requesting another code.`, { retryAfterSeconds: wait });
    }
    if ((await this.store.countRecent(email, new Date(now - 3_600_000))) >= this.perHour) {
      throw new AppError('RATE_LIMITED', 'Too many codes were requested for this email. Try again in an hour.');
    }
    const { appName } = this.config;
    if (await this.store.userExists(email)) {
      // Record the request (for throttling) but send an informational email instead of a code.
      await this.mailer.send({
        to: email,
        subject: `${appName}: sign-up request`,
        text: `Someone (hopefully you) tried to create a ${appName} account with this email address, but an account already exists. Sign in instead, or ask an administrator to reset your password.`,
        html: emailHtml(appName, 'You already have an account', '<p>Someone tried to create an account with this email address, but one already exists. Please sign in, or ask an administrator to reset your password.</p>'),
      });
      await this.store.create({ email, codeHash: '!', expiresAt: new Date(now), ip });
      await this.audit.write({ actorId: null, action: 'signup.requested_existing', entity: 'user', entityId: null, ip, metadata: { email } });
      return { message: GENERIC_SENT, resendAfterSeconds: this.cooldown, codeTtlMinutes: this.ttl };
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const codeHash = await bcrypt.hash(code, 10);
    // Send first: if delivery fails the person can retry at once instead of waiting out the cooldown.
    await this.mailer.send({
      to: email,
      subject: `${appName}: your verification code is ${code}`,
      text: `Your ${appName} verification code is ${code}. It expires in ${this.ttl} minutes. Do not share it with anyone.`,
      html: emailHtml(
        appName,
        'Verify your email address',
        `<p>Use this code to continue creating your account:</p><p style="font-size:32px;letter-spacing:8px;font-weight:bold;color:#7a2b36;margin:16px 0">${code}</p><p>The code expires in ${this.ttl} minutes. Do not share it with anyone.</p>`,
      ),
    });
    await this.store.create({ email, codeHash, expiresAt: new Date(now + this.ttl * 60_000), ip });
    await this.audit.write({ actorId: null, action: 'signup.code_sent', entity: 'user', entityId: null, ip, metadata: { email } });
    return { message: GENERIC_SENT, resendAfterSeconds: this.cooldown, codeTtlMinutes: this.ttl };
  }

  async verify(email: string, code: string, ip: string | null) {
    this.assertEnabled();
    const v = await this.store.latest(email);
    const invalid = () => new AppError('VALIDATION_ERROR', 'The code is incorrect or has expired.', { fields: [{ path: 'code', message: 'Incorrect or expired code.' }] });
    if (!v || v.codeHash === '!' || v.consumedAt || v.verifiedAt || v.expiresAt <= new Date()) throw invalid();
    if (v.attempts >= this.maxAttempts) throw new AppError('VALIDATION_ERROR', 'Too many incorrect attempts. Request a new code.', { fields: [{ path: 'code', message: 'Request a new code.' }] });
    if (!(await bcrypt.compare(code, v.codeHash))) {
      await this.store.incrementAttempts(v.id);
      const left = this.maxAttempts - v.attempts - 1;
      await this.audit.write({ actorId: null, action: 'signup.code_failed', entity: 'user', entityId: null, ip, metadata: { email, attemptsLeft: left } });
      throw new AppError('VALIDATION_ERROR', left > 0 ? `The code is incorrect. ${left} attempt(s) left.` : 'Too many incorrect attempts. Request a new code.', {
        fields: [{ path: 'code', message: 'Incorrect code.' }],
      });
    }
    const token = randomBytes(32).toString('base64url');
    await this.store.markVerified(v.id, hashToken(token), new Date(Date.now() + 15 * 60_000));
    await this.audit.write({ actorId: null, action: 'signup.email_verified', entity: 'user', entityId: null, ip, metadata: { email } });
    return { signupToken: token, email };
  }

  async complete(token: string, name: string, password: string, ip: string | null, accountType: AccountType = 'USER') {
    this.assertEnabled();
    if (accountType === 'ADMIN' && this.config.adminSignup === 'off') {
      throw new AppError('FORBIDDEN', 'Administrator sign-up is turned off. Ask an existing administrator to create your account.');
    }
    const v = await this.store.findByToken(hashToken(token));
    if (!v || v.consumedAt || !v.tokenExpiresAt || v.tokenExpiresAt <= new Date()) {
      throw new AppError('VALIDATION_ERROR', 'Your verification has expired. Please start again.', { reason: 'SIGNUP_EXPIRED' });
    }
    if (await this.store.userExists(v.email)) throw new AppError('CONFLICT', 'An account with this email already exists. Please sign in.');
    // Administrator accounts are never active on sign-up: an existing Administrator must approve them.
    const active = accountType === 'ADMIN' ? false : !this.config.requireApproval;
    const roleCode = accountType === 'ADMIN' ? this.config.roles.admin : this.config.roles.user;
    const user = await this.store.completeSignup({ verificationId: v.id, email: v.email, name, passwordHash: await hashPassword(password), active, roleCode });
    await this.audit.write({
      actorId: user.id,
      action: accountType === 'ADMIN' ? 'signup.admin_requested' : 'signup.account_created',
      entity: 'user',
      entityId: user.id,
      ip,
      after: { email: v.email, name, role: roleCode, status: active ? 'ACTIVE' : 'PENDING' },
    });
    return { email: v.email, requiresApproval: !active, accountType };
  }
}

/** Registers the public sign-up endpoints on an API. */
export function registerSignupRoutes(r: ApiRegistry, service: SignupService, config: SignupConfig, mailer: Mailer) {
  const email = z.string().trim().toLowerCase().email('Enter a valid email address.').max(200);
  r.add({
    method: 'get',
    path: '/auth/signup/config',
    tag: 'Auth',
    summary: 'Whether self-service sign-up is available',
    auth: false,
    handler: async () => ({ enabled: config.enabled, requiresApproval: config.requireApproval, adminSignup: config.adminSignup, devMailbox: mailer.mode === 'dev-mailbox', emailConfigured: mailer.mode !== 'dev-mailbox' && mailer.mode !== 'disabled' }),
  });
  r.add({
    method: 'post',
    path: '/auth/signup/start',
    tag: 'Auth',
    summary: 'Step 1: send a 6-digit verification code to the email address',
    auth: false,
    body: z.object({ email }),
    handler: async ({ body, ip }) => service.start(body.email, ip),
  });
  r.add({
    method: 'post',
    path: '/auth/signup/verify',
    tag: 'Auth',
    summary: 'Step 2: check the code; returns a short-lived sign-up token',
    auth: false,
    body: z.object({ email, code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code.') }),
    handler: async ({ body, ip }) => service.verify(body.email, body.code, ip),
  });
  r.add({
    method: 'post',
    path: '/auth/signup/complete',
    tag: 'Auth',
    summary: 'Step 3: set name and password and create the account (Payroll User, or an Administrator request awaiting approval)',
    auth: false,
    status: 201,
    body: z.object({
      signupToken: z.string().min(20).max(200),
      name: z.string().trim().min(2, 'Enter your full name.').max(120),
      password: passwordSchema,
      accountType: z.enum(['USER', 'ADMIN']).default('USER'),
    }),
    handler: async ({ body, ip }) => service.complete(body.signupToken, body.name, body.password, ip, body.accountType),
  });
}
