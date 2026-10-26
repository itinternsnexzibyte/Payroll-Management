import express, { type Express, type RequestHandler } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import type { Logger } from 'pino';
import { z } from 'zod';
import { AppError, errorHandler, notFoundHandler } from './errors';
import { httpLogger } from './logger';
import { ApiRegistry, buildOpenApi } from './registry';
import { AuthService, passwordSchema } from './auth';

export interface BaseAppOptions {
  name: string;
  version: string;
  description: string;
  logger: Logger;
  allowedOrigins: string[];
  /** Runs once before handling a request, for hosts that initialize databases on demand. */
  beforeRequest?: () => Promise<void>;
  /** Path prefixes of API-key (Authorization: Bearer) endpoints exempt from the Origin check. */
  keyAuthPrefixes?: string[];
  auth: AuthService;
  cookieName: string;
  publicApiPrefix: string;
  readiness: () => Promise<void>;
  /** Registers the application's own routes. */
  register: (registry: ApiRegistry) => void;
  /** Extra data returned by GET /auth/me. */
  meExtras?: (userId: string) => Promise<Record<string, unknown>>;
  loginRateLimit?: { windowMs: number; max: number };
}

/**
 * CSRF defence for cookie sessions: state-changing requests must carry a matching Origin
 * (or Referer) header from an allowed frontend, plus the session cookie is SameSite=Strict.
 */
export function originCheck(allowedOrigins: string[], keyAuthPrefixes: string[] = []): RequestHandler {
  const allowed = new Set(
    allowedOrigins.flatMap((o) => {
      const clean = o.replace(/\/$/, '');
      const hostOnly = clean.replace(/^https?:\/\//i, '');
      return [clean, `https://${hostOnly}`, `http://${hostOnly}`];
    }),
  );
  return (req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    // Server-to-server endpoints authenticate with an API key in the Authorization header (which a
    // browser cannot attach cross-site) and never with the session cookie, so CSRF does not apply.
    if (keyAuthPrefixes.some((p) => req.path.startsWith(p)) && /^Bearer\s+\S+$/i.test(req.get('authorization') ?? '')) return next();
    const origin = req.get('origin') ?? (req.get('referer') ? new URL(req.get('referer')!).origin : undefined);
    const host = req.get('x-forwarded-host') ?? req.get('host');
    const isSameHost = Boolean(host && origin && (origin === `https://${host}` || origin === `http://${host}`));
    if (!origin || (!allowed.has(origin) && !isSameHost)) {
      return next(new AppError('CSRF_REJECTED', `Request origin "${origin ?? 'none'}" is not allowed. (Configured allowed: ${Array.from(allowed).join(', ')})`));
    }
    next();
  };
}

/**
 * Express treats a string "1" as an IP address, not a hop count, so TRUST_PROXY=1 would trust no
 * proxy and every client would share one rate-limit bucket. Numbers become hop counts.
 */
export function parseTrustProxy(value: string | undefined): boolean | number | string {
  const v = value?.trim();
  if (!v) return 'loopback';
  if (/^\d+$/.test(v)) return Number(v);
  if (v === 'true' || v === 'false') return v === 'true';
  return v;
}

export function createBaseApp(opts: BaseAppOptions): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY));
  const apiPrefix = opts.publicApiPrefix.replace(/\/+$/, '');
  if (apiPrefix && apiPrefix !== '/') {
    app.use((req, _res, next) => {
      if (req.path === apiPrefix || req.path.startsWith(`${apiPrefix}/`)) {
        req.url = req.url.slice(apiPrefix.length) || '/';
      }
      next();
    });
  }
  app.use(httpLogger(opts.logger));
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-origin' },
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // Unauthenticated operational endpoints.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: opts.name, time: new Date().toISOString() });
  });
  app.get('/ready', async (_req, res) => {
    try {
      await opts.readiness();
      res.json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'not_ready' });
    }
  });

  const beforeRequest = opts.beforeRequest;
  if (beforeRequest) {
    app.use((_req, _res, next) => {
      beforeRequest().then(() => next(), next);
    });
  }

  app.use(originCheck(opts.allowedOrigins, opts.keyAuthPrefixes));

  const registry = new ApiRegistry({ authenticate: opts.auth.authenticate });
  const loginLimiter = rateLimit({
    windowMs: opts.loginRateLimit?.windowMs ?? 15 * 60_000,
    limit: opts.loginRateLimit?.max ?? 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new AppError('RATE_LIMITED', 'Too many sign-in attempts. Please wait and try again.')),
  });
  app.use('/auth/login', loginLimiter);
  app.use(
    '/auth/signup',
    rateLimit({
      windowMs: 15 * 60_000,
      limit: opts.loginRateLimit?.max ?? 30,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      handler: (_req, _res, next) => next(new AppError('RATE_LIMITED', 'Too many sign-up attempts. Please wait and try again.')),
    }),
  );
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: Number(process.env.API_RATE_LIMIT_PER_MINUTE ?? 600),
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      handler: (_req, _res, next) => next(new AppError('RATE_LIMITED', 'Too many requests. Please slow down.')),
    }),
  );

  // ---- Auth endpoints shared by both applications ----
  registry.add({
    method: 'post',
    path: '/auth/login',
    tag: 'Auth',
    summary: 'Sign in with email and password (sets an httpOnly session cookie)',
    auth: false,
    body: z.object({ email: z.string().trim().email('Enter a valid email address.').max(200), password: z.string().min(1, 'Enter your password.').max(200), portal: z.enum(['ADMIN', 'USER']).optional() }),
    handler: async ({ req, res, body }) => {
      const user = await opts.auth.login(req, res, body.email, body.password, body.portal);
      return { user: { id: user.id, email: user.email, name: user.name, role: user.roleCode, roleName: user.roleName, mustChangePassword: user.mustChangePassword } };
    },
  });
  registry.add({
    method: 'post',
    path: '/auth/logout',
    tag: 'Auth',
    summary: 'Sign out and revoke the current session',
    allowPendingPasswordChange: true,
    handler: async ({ req, res }) => {
      await opts.auth.logout(req, res);
      return undefined;
    },
  });
  registry.add({
    method: 'get',
    path: '/auth/me',
    tag: 'Auth',
    summary: 'Current user, role and permissions',
    allowPendingPasswordChange: true,
    handler: async ({ user }) => ({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.roleCode,
      roleName: user.roleName,
      permissions: [...user.permissions].sort(),
      mustChangePassword: user.mustChangePassword,
      ...(opts.meExtras ? await opts.meExtras(user.id) : {}),
    }),
  });
  registry.add({
    method: 'post',
    path: '/auth/change-password',
    tag: 'Auth',
    summary: 'Change own password (revokes other sessions)',
    allowPendingPasswordChange: true,
    body: z.object({ currentPassword: z.string().min(1).max(200), newPassword: passwordSchema }),
    handler: async ({ req, body }) => {
      await opts.auth.changePassword(req, body.currentPassword, body.newPassword);
      return undefined;
    },
  });

  opts.register(registry);

  const openapi = buildOpenApi(registry, {
    title: `${opts.name} API`,
    version: opts.version,
    description: opts.description,
    serverUrl: opts.publicApiPrefix,
    cookieName: opts.cookieName,
  });
  app.get('/openapi.json', (_req, res) => {
    res.json(openapi);
  });
  const docsCsp: RequestHandler = (_req, res, next) => {
    // Swagger UI needs inline scripts; relax CSP for the docs page only.
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:");
    next();
  };
  app.use('/docs', docsCsp, swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: `${opts.name} API`, swaggerOptions: { withCredentials: true } }));

  app.use(registry.router);
  app.use(notFoundHandler);
  app.use(errorHandler(opts.logger));
  return app;
}
