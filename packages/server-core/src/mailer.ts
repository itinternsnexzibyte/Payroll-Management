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
  /** "smtp" sends real email; "dev-mailbox" saves messages to disk (development/test only). */
  readonly mode: 'smtp' | 'dev-mailbox' | 'disabled';
  send(message: MailMessage): Promise<void>;
}

export const mailEnvShape = {
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: envBool,
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().default('NexziByte <no-reply@example.invalid>'),
};

/** Messages captured in this process by the dev mailbox (used by automated tests). */
export const devOutbox: (MailMessage & { at: Date })[] = [];

/**
 * Creates the mailer. With SMTP_HOST set, email is sent through SMTP. Without it, development and
 * test environments write each message to `<storageDir>/dev-mailbox/` instead; production refuses
 * (sending is reported as not configured) so codes are never silently dropped or logged.
 */
export function createMailer(env: {
  NODE_ENV: string;
  STORAGE_DIR: string;
  SMTP_HOST?: string;
  SMTP_PORT: number;
  SMTP_SECURE: boolean;
  SMTP_USER?: string;
  SMTP_PASSWORD?: string;
  MAIL_FROM: string;
}): Mailer {
  if (env.SMTP_HOST) {
    const transport: Transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? '' } : undefined,
    });
    return {
      mode: 'smtp',
      async send(m) {
        try {
          await transport.sendMail({ from: env.MAIL_FROM, to: m.to, subject: m.subject, text: m.text, html: m.html });
        } catch {
          throw new AppError('INTERNAL_ERROR', 'The email could not be sent. Please try again later.');
        }
      },
    };
  }
  if (env.NODE_ENV === 'production') {
    return {
      mode: 'disabled',
      async send() {
        throw new AppError('CONFIGURATION_MISSING', 'Email delivery is not configured on the server. Contact an administrator.');
      },
    };
  }
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
