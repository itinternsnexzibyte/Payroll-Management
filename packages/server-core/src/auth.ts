import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { CookieOptions, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { AppError } from './errors';
import type { AuditWriter } from './audit';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  roleCode: string;
  roleName: string;
  permissions: Set<string>;
  mustChangePassword: boolean;
  sessionId: string;
  attributes: Record<string, unknown>;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export interface AuthUserRecord {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  status: 'ACTIVE' | 'DISABLED' | 'PENDING';
  failedLoginCount: number;
  lockedUntil: Date | null;
  mustChangePassword: boolean;
  roleCode: string;
  roleName: string;
  roleEnabled: boolean;
  permissions: string[];
  attributes?: Record<string, unknown>;
}

export interface SessionRecord {
  id: string;
  userId: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

/** Persistence adapter implemented by each application against its own database. */
export interface AuthStore {
  findUserByEmail(email: string): Promise<AuthUserRecord | null>;
  findUserById(id: string): Promise<AuthUserRecord | null>;
  setLoginFailure(userId: string, failedLoginCount: number, lockedUntil: Date | null): Promise<void>;
  recordLoginSuccess(userId: string): Promise<void>;
  createSession(data: { userId: string; tokenHash: string; expiresAt: Date; ip: string | null; userAgent: string | null }): Promise<{ id: string }>;
  findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  touchSession(id: string, at: Date): Promise<void>;
  revokeSession(id: string): Promise<void>;
  revokeUserSessions(userId: string, exceptSessionId?: string): Promise<void>;
  updatePassword(userId: string, passwordHash: string): Promise<void>;
}

export interface AuthConfig {
  cookieName: string;
  cookieSecure: boolean;
  idleTimeoutMinutes: number;
  absoluteTimeoutHours: number;
  maxFailedAttempts: number;
  lockoutMinutes: number;
}

export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters.')
  .max(128, 'Password must be at most 128 characters.')
  .regex(/[a-z]/, 'Password must contain a lowercase letter.')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter.')
  .regex(/[0-9]/, 'Password must contain a digit.');

const BCRYPT_COST = 12;
export const hashPassword = (plain: string) => bcrypt.hash(plain, BCRYPT_COST);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
// A real bcrypt hash used to keep response timing similar when the email is unknown.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= bcrypt.hash(randomBytes(16).toString('hex'), BCRYPT_COST));

export class AuthService {
  constructor(
    private readonly store: AuthStore,
    private readonly config: AuthConfig,
    private readonly audit: AuditWriter,
  ) {}

  private cookieOptions(maxAgeMs?: number): CookieOptions {
    return { httpOnly: true, secure: this.config.cookieSecure, sameSite: 'strict', path: '/', ...(maxAgeMs ? { maxAge: maxAgeMs } : {}) };
  }

  toAuthUser(u: AuthUserRecord, sessionId: string): AuthUser {
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      roleCode: u.roleCode,
      roleName: u.roleName,
      permissions: new Set(u.permissions),
      mustChangePassword: u.mustChangePassword,
      sessionId,
      attributes: u.attributes ?? {},
    };
  }

  async login(req: Request, res: Response, email: string, password: string): Promise<AuthUser> {
    const ip = req.ip ?? null;
    const user = await this.store.findUserByEmail(email.trim().toLowerCase());
    if (!user) {
      await verifyPassword(password, await getDummyHash());
      await this.audit.write({ actorId: null, action: 'auth.login_failed', entity: 'user', entityId: null, ip, metadata: { reason: 'unknown_user' } });
      throw new AppError('INVALID_CREDENTIALS', 'The email or password is incorrect.');
    }
    const now = new Date();
    if (user.lockedUntil && user.lockedUntil > now) {
      await this.audit.write({ actorId: user.id, action: 'auth.login_blocked', entity: 'user', entityId: user.id, ip, metadata: { reason: 'locked' } });
      throw new AppError('ACCOUNT_LOCKED', 'This account is temporarily locked after repeated failed sign-in attempts. Try again later or contact an administrator.', {
        lockedUntil: user.lockedUntil.toISOString(),
      });
    }
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      const failed = user.failedLoginCount + 1;
      const lock = failed >= this.config.maxFailedAttempts ? new Date(now.getTime() + this.config.lockoutMinutes * 60_000) : null;
      await this.store.setLoginFailure(user.id, lock ? 0 : failed, lock);
      await this.audit.write({ actorId: user.id, action: lock ? 'auth.account_locked' : 'auth.login_failed', entity: 'user', entityId: user.id, ip, metadata: { failedAttempts: failed } });
      throw new AppError('INVALID_CREDENTIALS', 'The email or password is incorrect.');
    }
    if (user.status === 'PENDING') {
      await this.audit.write({ actorId: user.id, action: 'auth.login_blocked', entity: 'user', entityId: user.id, ip, metadata: { reason: 'pending_approval' } });
      throw new AppError('ACCOUNT_PENDING', 'Your account is awaiting approval by an administrator. You can sign in once it has been approved.');
    }
    if (user.status !== 'ACTIVE' || !user.roleEnabled) {
      await this.audit.write({ actorId: user.id, action: 'auth.login_blocked', entity: 'user', entityId: user.id, ip, metadata: { reason: user.status !== 'ACTIVE' ? 'disabled' : 'role_disabled' } });
      throw new AppError('ACCOUNT_DISABLED', 'This account is disabled. Contact an administrator.');
    }
    await this.store.recordLoginSuccess(user.id);
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + this.config.absoluteTimeoutHours * 3_600_000);
    const session = await this.store.createSession({ userId: user.id, tokenHash: hashToken(token), expiresAt, ip, userAgent: req.get('user-agent')?.slice(0, 255) ?? null });
    res.cookie(this.config.cookieName, token, this.cookieOptions(this.config.absoluteTimeoutHours * 3_600_000));
    await this.audit.write({ actorId: user.id, action: 'auth.login', entity: 'user', entityId: user.id, ip });
    return this.toAuthUser(user, session.id);
  }

  async logout(req: Request, res: Response): Promise<void> {
    if (req.user) {
      await this.store.revokeSession(req.user.sessionId);
      await this.audit.write({ actorId: req.user.id, action: 'auth.logout', entity: 'user', entityId: req.user.id, ip: req.ip ?? null });
    }
    res.clearCookie(this.config.cookieName, this.cookieOptions());
  }

  async changePassword(req: Request, currentPassword: string, newPassword: string): Promise<void> {
    const authUser = req.user!;
    const user = await this.store.findUserById(authUser.id);
    if (!user) throw new AppError('UNAUTHENTICATED', 'Please sign in again.');
    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      throw new AppError('VALIDATION_ERROR', 'The current password is incorrect.', { fields: [{ path: 'currentPassword', message: 'Incorrect password.' }] });
    }
    if (currentPassword === newPassword) {
      throw new AppError('VALIDATION_ERROR', 'Choose a password different from the current one.', { fields: [{ path: 'newPassword', message: 'Must differ from the current password.' }] });
    }
    await this.store.updatePassword(user.id, await hashPassword(newPassword));
    await this.store.revokeUserSessions(user.id, authUser.sessionId);
    await this.audit.write({ actorId: user.id, action: 'auth.password_changed', entity: 'user', entityId: user.id, ip: req.ip ?? null });
  }

  /** Middleware: resolves the session cookie into req.user or rejects with 401. */
  authenticate: RequestHandler = async (req, res, next) => {
    try {
      const token = req.cookies?.[this.config.cookieName];
      if (!token || typeof token !== 'string') throw new AppError('UNAUTHENTICATED', 'Please sign in to continue.');
      const session = await this.store.findSessionByTokenHash(hashToken(token));
      const now = new Date();
      if (!session || session.revokedAt) throw new AppError('UNAUTHENTICATED', 'Please sign in to continue.');
      const idleLimit = new Date(session.lastSeenAt.getTime() + this.config.idleTimeoutMinutes * 60_000);
      if (session.expiresAt <= now || idleLimit <= now) {
        await this.store.revokeSession(session.id);
        res.clearCookie(this.config.cookieName, this.cookieOptions());
        throw new AppError('SESSION_EXPIRED', 'Your session has expired. Please sign in again.');
      }
      const user = await this.store.findUserById(session.userId);
      if (!user || user.status !== 'ACTIVE' || !user.roleEnabled) {
        await this.store.revokeSession(session.id);
        throw new AppError('UNAUTHENTICATED', 'Please sign in to continue.');
      }
      // Throttle writes: only refresh last-seen once per minute.
      if (now.getTime() - session.lastSeenAt.getTime() > 60_000) await this.store.touchSession(session.id, now);
      req.user = this.toAuthUser(user, session.id);
      next();
    } catch (err) {
      next(err);
    }
  };
}
