import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AppError } from '@nexzi/server-core';
import { config } from '../config';

let keyOverride: Buffer | null | undefined;
export const setClientDataKeyForTests = (key: Buffer | null | undefined) => {
  keyOverride = key;
};

function key() {
  const value = keyOverride !== undefined ? keyOverride : config.CLIENT_DATA_KEY ? Buffer.from(config.CLIENT_DATA_KEY, 'base64') : null;
  if (!value) throw new AppError('INVALID_STATE', 'Private client documents are disabled until CLIENT_DATA_KEY is configured.');
  return value;
}

export function encryptClientFile(contents: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(contents), cipher.final()]);
  return Buffer.from(['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join(':'));
}

export function decryptClientFile(contents: Buffer) {
  const [version, iv, tag, data] = contents.toString('utf8').split(':');
  if (version !== 'v1' || !iv || !tag || !data) throw new AppError('INTERNAL_ERROR', 'Stored client document is unreadable.');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]);
  } catch {
    throw new AppError('INVALID_STATE', 'Stored client document cannot be decrypted with the configured CLIENT_DATA_KEY.');
  }
}
