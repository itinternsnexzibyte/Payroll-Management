import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { AppError } from '@nexzi/server-core';
import { config } from '../config';

/**
 * AES-256-GCM for bank account numbers. Stored as "v1:<iv>:<tag>:<ciphertext>" (base64 parts).
 * The key comes from BANK_DATA_KEY. When that is not set, the server generates a key once and keeps
 * it in STORAGE_DIR/keys/bank-data.key (owner-only), on the persistent disk rather than in the
 * database. Either way the key never touches the database or logs; losing it makes stored account
 * numbers unreadable, so back the file up with the storage disk.
 */
let keyOverride: Buffer | null | undefined;
let keyCache: Buffer | null = null;
export const setBankKeyForTests = (k: Buffer | null | undefined) => {
  keyOverride = k;
};

const keyFile = () => path.resolve(config.STORAGE_DIR, 'keys', 'bank-data.key');

/** Reads the server-generated key, creating it on first use. Returns null if storage is not writable. */
function storedKey(): Buffer | null {
  const file = keyFile();
  try {
    if (!existsSync(file)) {
      mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      // 'wx' never overwrites a key another process created first.
      writeFileSync(file, randomBytes(32).toString('base64'), { flag: 'wx', mode: 0o600 });
      chmodSync(file, 0o600);
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') return null;
  }
  try {
    const k = Buffer.from(readFileSync(file, 'utf8').trim(), 'base64');
    return k.length === 32 ? k : null;
  } catch {
    return null;
  }
}

function key(): Buffer {
  if (keyOverride !== undefined) {
    if (!keyOverride) throw new AppError('INVALID_STATE', 'Bank details are switched off: the server has no BANK_DATA_KEY. Ask the administrator to configure it.');
    return keyOverride;
  }
  if (config.BANK_DATA_KEY) return Buffer.from(config.BANK_DATA_KEY, 'base64');
  keyCache ??= storedKey();
  if (!keyCache) throw new AppError('INVALID_STATE', 'Bank details are switched off: the server has no BANK_DATA_KEY and cannot write its storage folder. Ask the administrator to configure it.');
  return keyCache;
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
    throw new AppError('INVALID_STATE', 'A stored bank account cannot be decrypted with the current bank data key.');
  }
}

export const maskAccount = (last4: string) => `•••• ${last4}`;
