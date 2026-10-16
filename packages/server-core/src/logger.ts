import pino, { type Logger } from 'pino';
import pinoHttp from 'pino-http';
import { randomUUID } from 'node:crypto';

/**
 * Structured JSON logger. Request/response bodies are never logged, and common
 * secret-bearing fields are redacted defensively (salary and price values must not reach logs).
 */
export function createLogger(name: string, level = process.env.LOG_LEVEL ?? 'info'): Logger {
  return pino({
    name,
    level: process.env.NODE_ENV === 'test' ? 'silent' : level,
    redact: {
      paths: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]', '*.password', '*.passwordHash', '*.token'],
      censor: '[REDACTED]',
    },
  });
}

export function httpLogger(logger: Logger) {
  return pinoHttp({
    logger,
    genReqId: (req, res) => {
      const existing = req.headers['x-request-id'];
      const id = typeof existing === 'string' && /^[\w-]{8,64}$/.test(existing) ? existing : randomUUID();
      res.setHeader('x-request-id', id);
      return id;
    },
    // Keep URLs but drop query strings, which could carry search terms.
    serializers: {
      req: (req: { id: unknown; method: string; url: string }) => ({ id: req.id, method: req.method, url: req.url.split('?')[0] }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
    },
    autoLogging: { ignore: (req) => req.url === '/health' || req.url === '/ready' },
  });
}
