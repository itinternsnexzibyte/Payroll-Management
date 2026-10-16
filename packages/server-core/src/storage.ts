import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { AppError } from './errors';

/**
 * Private file storage on local disk (outside any web-served directory). Keys are random
 * UUID paths, never user-supplied names, and are only exposed through authorised endpoints.
 */
export class FileStorage {
  private readonly root: string;
  constructor(rootDir: string) {
    this.root = resolve(rootDir);
  }

  private pathFor(key: string): string {
    const full = resolve(this.root, key);
    if (!full.startsWith(this.root + sep)) throw new AppError('INTERNAL_ERROR', 'Invalid storage key.');
    return full;
  }

  async save(buffer: Buffer, extension: string, folder: string): Promise<{ key: string; sha256: string; size: number }> {
    const now = new Date();
    const safeFolder = folder.replace(/[^a-z0-9-]/gi, '');
    const key = [safeFolder, String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, '0'), `${randomUUID()}.${extension.replace(/[^a-z0-9]/gi, '')}`].join('/');
    const full = this.pathFor(key);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, buffer, { flag: 'wx' });
    return { key, sha256: createHash('sha256').update(buffer).digest('hex'), size: buffer.length };
  }

  async read(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.pathFor(key));
    } catch {
      return null;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.pathFor(key));
      return true;
    } catch {
      return false;
    }
  }
}
