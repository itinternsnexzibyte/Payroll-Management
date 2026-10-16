import { redact, type AuditEntry, type AuditWriter } from '@nexzi/server-core';
import { prisma, type Tx } from './db';

function toRow(e: AuditEntry, actorEmail?: string | null) {
  return {
    actorId: e.actorId,
    actorEmail: actorEmail ?? null,
    action: e.action,
    entity: e.entity,
    entityId: e.entityId,
    before: e.before === undefined ? undefined : (redact(e.before) as object),
    after: e.after === undefined ? undefined : (redact(e.after) as object),
    metadata: e.metadata === undefined ? undefined : (redact(e.metadata) as object),
    ip: e.ip ?? null,
  };
}

/** Writes audit rows; pass a transaction client to make the audit entry atomic with the change. */
export const audit: AuditWriter & { tx(tx: Tx, entry: AuditEntry): Promise<void> } = {
  async write(entry) {
    const actor = entry.actorId ? await prisma.user.findUnique({ where: { id: entry.actorId }, select: { email: true } }) : null;
    await prisma.auditLog.create({ data: toRow(entry, actor?.email) });
  },
  async tx(tx, entry) {
    const actor = entry.actorId ? await tx.user.findUnique({ where: { id: entry.actorId }, select: { email: true } }) : null;
    await tx.auditLog.create({ data: toRow(entry, actor?.email) });
  },
};
