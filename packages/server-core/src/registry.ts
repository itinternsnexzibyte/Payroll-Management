import express, { type Request, type RequestHandler, type Response, type Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { AppError } from './errors';
import type { AuthUser } from './auth';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
type Infer<T> = T extends z.ZodType ? z.output<T> : undefined;

export interface UploadedFile {
  originalName: string;
  mimeType: string;
  size: number;
  buffer: Buffer;
}

export interface RouteContext<P, Q, B> {
  req: Request;
  res: Response;
  params: P;
  query: Q;
  body: B;
  user: AuthUser;
  file?: UploadedFile;
  ip: string | null;
}

export interface RouteSpec<P extends z.ZodType | undefined, Q extends z.ZodType | undefined, B extends z.ZodType | undefined> {
  method: Method;
  path: string;
  tag: string;
  summary: string;
  description?: string;
  /** `false` = public endpoint. Otherwise an authenticated session is required. */
  auth?: boolean;
  /** Permission code(s); the user needs at least one of them. Checked on the server for every request. */
  permission?: string | string[];
  /** Allows the route while the user still has to change a bootstrap password. */
  allowPendingPasswordChange?: boolean;
  params?: P;
  query?: Q;
  body?: B;
  upload?: { field: string; maxBytes: number; extensions: string[] };
  /** Success status for JSON responses (default 200). */
  status?: number;
  /** For OpenAPI: response kind. */
  produces?: 'json' | 'pdf' | 'xlsx' | 'csv' | 'zip';
  handler: (ctx: RouteContext<Infer<P>, Infer<Q>, Infer<B>>) => Promise<unknown> | unknown;
}

interface RouteDoc {
  method: Method;
  path: string;
  tag: string;
  summary: string;
  description?: string;
  auth: boolean;
  permission?: string[];
  params?: z.ZodType;
  query?: z.ZodType;
  body?: z.ZodType;
  upload?: { field: string };
  produces: string;
}

export interface RegistryOptions {
  authenticate: RequestHandler;
}

export function clientIp(req: Request): string | null {
  return req.ip ?? null;
}

/**
 * Route registry: every endpoint is declared once with its validation schemas and permission,
 * which drives both the Express router and the generated OpenAPI document.
 */
export class ApiRegistry {
  readonly router: Router = express.Router();
  readonly docs: RouteDoc[] = [];

  constructor(private readonly options: RegistryOptions) {}

  add<P extends z.ZodType | undefined = undefined, Q extends z.ZodType | undefined = undefined, B extends z.ZodType | undefined = undefined>(
    spec: RouteSpec<P, Q, B>,
  ): void {
    const requiresAuth = spec.auth !== false;
    const permissions = spec.permission ? (Array.isArray(spec.permission) ? spec.permission : [spec.permission]) : undefined;
    this.docs.push({
      method: spec.method,
      path: spec.path,
      tag: spec.tag,
      summary: spec.summary,
      description: spec.description,
      auth: requiresAuth,
      permission: permissions,
      params: spec.params,
      query: spec.query,
      body: spec.body,
      upload: spec.upload ? { field: spec.upload.field } : undefined,
      produces: spec.produces ?? 'json',
    });

    const chain: RequestHandler[] = [];
    if (requiresAuth) {
      chain.push(this.options.authenticate);
      chain.push((req, _res, next) => {
        const user = req.user!;
        if (user.mustChangePassword && !spec.allowPendingPasswordChange) {
          return next(new AppError('PASSWORD_CHANGE_REQUIRED', 'You must change your password before continuing.'));
        }
        if (permissions && !permissions.some((p) => user.permissions.has(p))) {
          return next(new AppError('FORBIDDEN', 'You do not have permission to perform this action.'));
        }
        next();
      });
    }
    if (spec.upload) {
      const { field, maxBytes, extensions } = spec.upload;
      const upload = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: maxBytes, files: 1, fields: 20 },
        fileFilter: (_req, file, cb) => {
          const ext = file.originalname.toLowerCase().split('.').pop() ?? '';
          if (!extensions.includes(ext)) return cb(new AppError('UNSUPPORTED_FILE', `Only ${extensions.map((e) => '.' + e).join(', ')} files are accepted.`));
          cb(null, true);
        },
      }).single(field);
      chain.push((req, res, next) =>
        upload(req, res, (err: unknown) => {
          if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') return next(new AppError('PAYLOAD_TOO_LARGE', `The file exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB limit.`));
            return next(new AppError('VALIDATION_ERROR', 'The upload could not be processed.'));
          }
          next(err as Error | undefined);
        }),
      );
    }
    chain.push(async (req, res, next) => {
      try {
        const params = spec.params ? spec.params.parse(req.params) : undefined;
        const query = spec.query ? spec.query.parse(req.query) : undefined;
        const body = spec.body ? spec.body.parse(req.body ?? {}) : undefined;
        const file = req.file ? { originalName: req.file.originalname, mimeType: req.file.mimetype, size: req.file.size, buffer: req.file.buffer } : undefined;
        if (spec.upload && !file) throw new AppError('VALIDATION_ERROR', 'Please choose a file to upload.');
        const result = await spec.handler({
          req,
          res,
          params: params as Infer<P>,
          query: query as Infer<Q>,
          body: body as Infer<B>,
          user: req.user as AuthUser,
          file,
          ip: clientIp(req),
        });
        if (res.headersSent) return;
        if (result === undefined) res.status(204).end();
        else res.status(spec.status ?? 200).json(result);
      } catch (err) {
        next(err);
      }
    });
    this.router[spec.method](spec.path, ...chain);
  }
}

// ---------- OpenAPI generation ----------

function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  try {
    return z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  } catch {
    return { type: 'object' };
  }
}

const MEDIA: Record<string, string> = {
  json: 'application/json',
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  zip: 'application/zip',
};

export function buildOpenApi(registry: ApiRegistry, info: { title: string; version: string; description: string; serverUrl: string; cookieName: string }) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of registry.docs) {
    const oaPath = r.path.replace(/:(\w+)/g, '{$1}');
    const parameters: unknown[] = [];
    for (const [where, schema] of [
      ['path', r.params],
      ['query', r.query],
    ] as const) {
      if (!schema) continue;
      const js = toJsonSchema(schema) as { properties?: Record<string, unknown>; required?: string[] };
      for (const [name, prop] of Object.entries(js.properties ?? {})) {
        parameters.push({ name, in: where, required: where === 'path' || (js.required ?? []).includes(name), schema: prop });
      }
    }
    const op: Record<string, unknown> = {
      tags: [r.tag],
      summary: r.summary,
      description: [r.description, r.permission ? `Required permission (any of): \`${r.permission.join('`, `')}\`` : r.auth ? 'Requires an authenticated session.' : 'Public endpoint.']
        .filter(Boolean)
        .join('\n\n'),
      parameters,
      security: r.auth ? [{ sessionCookie: [] }] : [],
      responses: {
        '200': { description: 'Success', content: { [MEDIA[r.produces] ?? 'application/json']: {} } },
        '400': { $ref: '#/components/responses/Error' },
        '401': { $ref: '#/components/responses/Error' },
        '403': { $ref: '#/components/responses/Error' },
        '404': { $ref: '#/components/responses/Error' },
        '409': { $ref: '#/components/responses/Error' },
      },
    };
    if (r.upload) {
      op.requestBody = {
        required: true,
        content: {
          'multipart/form-data': {
            schema: { type: 'object', properties: { [r.upload.field]: { type: 'string', format: 'binary' }, ...((r.body && (toJsonSchema(r.body) as { properties?: object }).properties) || {}) } },
          },
        },
      };
    } else if (r.body) {
      op.requestBody = { required: true, content: { 'application/json': { schema: toJsonSchema(r.body) } } };
    }
    paths[oaPath] ??= {};
    paths[oaPath][r.method] = op;
  }
  return {
    openapi: '3.0.3',
    info: { title: info.title, version: info.version, description: info.description },
    servers: [{ url: info.serverUrl }],
    components: {
      securitySchemes: { sessionCookie: { type: 'apiKey', in: 'cookie', name: info.cookieName } },
      responses: {
        Error: {
          description: 'Error',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: {
                    type: 'object',
                    properties: {
                      code: { type: 'string' },
                      message: { type: 'string' },
                      fields: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, message: { type: 'string' } } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    paths,
  };
}
