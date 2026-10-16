import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import nodemailer, { type Transporter } from 'nodemailer';
import { z } from 'zod';
import { AppError } from './errors';
import { envBool } from './env';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  /** "smtp"/"brevo"/"resend" send real email; "dev-mailbox" saves messages to disk (development/test only). */
  readonly mode: 'smtp' | 'brevo' | 'resend' | 'dev-mailbox' | 'disabled';
  send(message: MailMessage): Promise<void>;
}

/** Minimal logger interface (pino-compatible) so delivery failures are visible in the server logs. */
export interface MailLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export const mailEnvShape = {
  /**
   * Delivery method. "smtp" (default when SMTP_HOST is set), or an HTTPS email API — "brevo" or
   * "resend" — for hosts that block outgoing SMTP ports (e.g. Render free instances).
   */
  MAIL_PROVIDER: z.enum(['smtp', 'brevo', 'resend']).optional(),
  /** API key for MAIL_PROVIDER=brevo or resend. */
  MAIL_API_KEY: z.string().optional(),
  SMTP_HOST: z
    .string()
    .optional()
    .transform((s) => s?.trim() || undefined),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: envBool,
  SMTP_USER: z
    .string()
    .optional()
    .transform((s) => s?.trim() || undefined),
  // App passwords are often copied with spaces ("abcd efgh ijkl mnop"); spaces are never part of them.
  SMTP_PASSWORD: z
    .string()
    .optional()
    .transform((s) => s?.replace(/\s+/g, '') || undefined),
  MAIL_FROM: z.string().default('NexziByte <no-reply@example.invalid>'),
};

/** Messages captured in this process by the dev mailbox (used by automated tests). */
export const devOutbox: (MailMessage & { at: Date })[] = [];

const consoleLogger: MailLogger = {
  info: (o, m) => console.log(m ?? '', o),
  warn: (o, m) => console.warn(m ?? '', o),
  error: (o, m) => console.error(m ?? '', o),
};

/** Splits "Name <addr@x>" or "addr@x" into its parts. */
export function parseAddress(from: string): { name?: string; email: string } {
  const m = /^\s*"?([^"<]*?)"?\s*<\s*([^>\s]+)\s*>\s*$/.exec(from);
  if (m) return { name: m[1].trim() || undefined, email: m[2] };
  return { email: from.trim() };
}

function sendFailed(): AppError {
  return new AppError('INTERNAL_ERROR', 'The email could not be sent. Please try again later.');
}

function disabledMailer(reason: string, logger: MailLogger): Mailer {
  logger.error({ reason }, 'Email delivery is not configured');
  return {
    mode: 'disabled',
    async send() {
      throw new AppError('CONFIGURATION_MISSING', 'Email delivery is not configured on the server. Contact an administrator.');
    },
  };
}

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<{ ok: boolean; status: number; text: string }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  return { ok: res.ok, status: res.status, text: (await res.text()).slice(0, 500) };
}

/**
 * Creates the mailer.
 * - MAIL_PROVIDER=brevo|resend with MAIL_API_KEY: sends over HTTPS (works where SMTP ports are blocked).
 * - SMTP_HOST set: sends through SMTP.
 * - Neither: development and test write each message to `<storageDir>/dev-mailbox/`; production
 *   refuses (sending is reported as not configured) so codes are never silently dropped or logged.
 */
export function createMailer(
  env: {
    NODE_ENV: string;
    STORAGE_DIR: string;
    MAIL_PROVIDER?: 'smtp' | 'brevo' | 'resend';
    MAIL_API_KEY?: string;
    SMTP_HOST?: string;
    SMTP_PORT: number;
    SMTP_SECURE: boolean;
    SMTP_USER?: string;
    SMTP_PASSWORD?: string;
    MAIL_FROM: string;
  },
  logger: MailLogger = consoleLogger,
): Mailer {
  const provider = env.MAIL_PROVIDER ?? (env.SMTP_HOST ? 'smtp' : undefined);
  const from = parseAddress(env.MAIL_FROM);

  if (provider === 'brevo' || provider === 'resend') {
    if (!env.MAIL_API_KEY) return disabledMailer(`MAIL_PROVIDER=${provider} requires MAIL_API_KEY`, logger);
    const key = env.MAIL_API_KEY;
    logger.info({ provider, from: from.email }, 'Email delivery: HTTPS API');
    return {
      mode: provider,
      async send(m) {
        let r: { ok: boolean; status: number; text: string };
        try {
          r =
            provider === 'brevo'
              ? await postJson('https://api.brevo.com/v3/smtp/email', { 'api-key': key }, { sender: from, to: [{ email: m.to }], subject: m.subject, textContent: m.text, htmlContent: m.html })
              : await postJson('https://api.resend.com/emails', { authorization: `Bearer ${key}` }, { from: env.MAIL_FROM, to: [m.to], subject: m.subject, text: m.text, html: m.html });
        } catch (err) {
          logger.error({ provider, err: (err as Error).message }, 'Email API request failed');
          throw sendFailed();
        }
        if (!r.ok) {
          logger.error({ provider, status: r.status, response: r.text }, 'Email API rejected the message');
          throw sendFailed();
        }
      },
    };
  }

  if (provider === 'smtp') {
    if (!env.SMTP_HOST) return disabledMailer('MAIL_PROVIDER=smtp requires SMTP_HOST', logger);
    if (env.SMTP_HOST.includes('@') || /\s/.test(env.SMTP_HOST)) {
      return disabledMailer(`SMTP_HOST must be a server hostname such as smtp.gmail.com, not an email address (got "${env.SMTP_HOST}")`, logger);
    }
    if (env.SMTP_USER && !env.SMTP_PASSWORD) logger.warn({ host: env.SMTP_HOST }, 'SMTP_USER is set but SMTP_PASSWORD is empty');
    const implicitTls = env.SMTP_SECURE || env.SMTP_PORT === 465;
    const transport: Transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      // Port 465 is implicit TLS; 587 uses STARTTLS. Inferred when SMTP_SECURE is left at its default.
      secure: implicitTls,
      requireTLS: !implicitTls && env.SMTP_PORT === 587,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? '' } : undefined,
      // Fail fast (instead of hanging the request for minutes) when the port is blocked.
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
    const target = { host: env.SMTP_HOST, port: env.SMTP_PORT, user: env.SMTP_USER };
    if (env.NODE_ENV !== 'test') {
      transport.verify().then(
        () => logger.info(target, 'SMTP connection verified'),
        (err: Error & { code?: string }) =>
          logger.error(
            { ...target, code: err.code, err: err.message },
            'SMTP connection check failed — sign-up codes will not be delivered. If the host blocks SMTP ports, use MAIL_PROVIDER=brevo or resend.',
          ),
      );
    }
    return {
      mode: 'smtp',
      async send(m) {
        try {
          await transport.sendMail({ from: env.MAIL_FROM, to: m.to, subject: m.subject, text: m.text, html: m.html });
        } catch (err) {
          const e = err as Error & { code?: string; responseCode?: number };
          logger.error({ ...target, code: e.code, responseCode: e.responseCode, err: e.message }, 'SMTP send failed');
          throw sendFailed();
        }
      },
    };
  }

  if (env.NODE_ENV === 'production') return disabledMailer('Set SMTP_HOST (or MAIL_PROVIDER + MAIL_API_KEY) to send sign-up codes', logger);

  const dir = resolve(env.STORAGE_DIR, 'dev-mailbox');
  return {
    mode: 'dev-mailbox',
    async send(m) {
      devOutbox.push({ ...m, at: new Date() });
      if (devOutbox.length > 200) devOutbox.shift();
      await mkdir(dir, { recursive: true });
      const safeTo = m.to.replace(/[^a-z0-9@._-]/gi, '_');
      await writeFile(resolve(dir, `${Date.now()}-${safeTo}-${randomUUID().slice(0, 8)}.json`), JSON.stringify({ ...m, from: env.MAIL_FROM, at: new Date().toISOString() }, null, 2));
    },
  };
}
