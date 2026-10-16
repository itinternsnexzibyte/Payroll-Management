import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import type { Logger } from 'pino';

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'SESSION_EXPIRED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_STATE'
  | 'ACCOUNT_LOCKED'
  | 'ACCOUNT_DISABLED'
  | 'INVALID_CREDENTIALS'
  | 'PASSWORD_CHANGE_REQUIRED'
  | 'PRICE_OVERRIDE_FORBIDDEN'
  | 'CONFIGURATION_MISSING'
  | 'RATE_LIMITED'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_FILE'
  | 'CSRF_REJECTED'
  | 'INTERNAL_ERROR';

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  SESSION_EXPIRED: 401,
  INVALID_CREDENTIALS: 401,
  FORBIDDEN: 403,
  PRICE_OVERRIDE_FORBIDDEN: 403,
  PASSWORD_CHANGE_REQUIRED: 403,
  CSRF_REJECTED: 403,
  ACCOUNT_DISABLED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVALID_STATE: 409,
  ACCOUNT_LOCKED: 423,
  CONFIGURATION_MISSING: 422,
  UNSUPPORTED_FILE: 415,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

export interface FieldIssue {
  path: string;
  message: string;
}

/** An expected, client-safe error. The message is shown to users, so never put sensitive values in it. */
export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: { fields?: FieldIssue[]; [key: string]: unknown },
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

export const notFound = (what: string) => new AppError('NOT_FOUND', `${what} was not found.`);
export const forbidden = (message = 'You do not have permission to perform this action.') => new AppError('FORBIDDEN', message);
export const invalidState = (message: string) => new AppError('INVALID_STATE', message);
export const conflict = (message: string, details?: Record<string, unknown>) => new AppError('CONFLICT', message, details);
export const validationError = (message: string, fields?: FieldIssue[]) => new AppError('VALIDATION_ERROR', message, { fields });

export function zodIssues(err: ZodError): FieldIssue[] {
  return err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError('NOT_FOUND', `Route ${req.method} ${req.path} does not exist.`));
};

/** Central error handler: maps known errors to a consistent JSON body and hides internals. */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    if (err instanceof ZodError) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Please correct the highlighted fields.', fields: zodIssues(err) } });
      return;
    }
    if (err instanceof AppError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.details ?? {}) } });
      return;
    }
    // Prisma unique-constraint and FK errors (duck-typed to keep core ORM-agnostic)
    const prismaCode = (err as { code?: string })?.code;
    if (prismaCode === 'P2002') {
      const target = (err as { meta?: { target?: string[] | string } }).meta?.target;
      res.status(409).json({ error: { code: 'CONFLICT', message: 'A record with the same unique value already exists.', target } });
      return;
    }
    if (prismaCode === 'P2025') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'The requested record was not found.' } });
      return;
    }
    if ((err as { type?: string })?.type === 'entity.too.large') {
      res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'The request is too large.' } });
      return;
    }
    if ((err as { type?: string })?.type === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'The request body is not valid JSON.' } });
      return;
    }
    logger.error({ err: { message: (err as Error)?.message, stack: (err as Error)?.stack, code: prismaCode }, reqId: (req as { id?: unknown }).id }, 'Unhandled error');
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred. Please try again or contact support.' } });
  };
}
