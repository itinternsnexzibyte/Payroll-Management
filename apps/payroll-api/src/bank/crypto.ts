import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AppError } from '@nexzi/server-core';
import { config } from '../config';

/**
 * AES-256-GCM for bank account numbers. Stored as "v1:<iv>:<tag>:<ciphertext>" (base64 parts).
 * The key comes from BANK_DATA_KEY and never touches the database or logs.
 */
let keyOverride: Buffer | null | undefined;
export const setBankKeyForTests = (k: Buffer | null | undefined) => {
  keyOverride = k;
};

function key(): Buffer {
  const k = keyOverride !== undefined ? keyOverride : config.BANK_DATA_KEY ? Buffer.from(config.BANK_DATA_KEY, 'base64') : null;
  if (!k) throw new AppError('INVALID_STATE', 'Bank details are switched off: the server has no BANK_DATA_KEY. Ask the administrator to configure it.');
  return k;
}

export const bankKeyConfigured = () => {
  try {
    key();
    return true;
  } catch {
    return false;
  }
};

export function encryptAccount(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
}

export function decryptAccount(stored: string): string {
  const [v, iv, tag, data] = stored.split(':');
  if (v !== 'v1' || !iv || !tag || !data) throw new AppError('INTERNAL_ERROR', 'Stored bank account is unreadable.');
  try {
    const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
  } catch {
    throw new AppError('INVALID_STATE', 'A stored bank account cannot be decrypted with the current BANK_DATA_KEY.');
  }
}

export const maskAccount = (last4: string) => `•••• ${last4}`;
