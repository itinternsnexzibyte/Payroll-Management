import type { Prisma } from './db';

type NotificationWriter = Pick<Prisma.TransactionClient, 'employeeNotification'>;

export async function notifyEmployees(
  db: NotificationWriter,
  employeeIds: string[],
  input: { title: string; message: string; kind: string; targetUrl?: string | null },
) {
  const ids = [...new Set(employeeIds)];
  if (!ids.length) return 0;
  const result = await db.employeeNotification.createMany({
    data: ids.map((employeeId) => ({
      employeeId,
      title: input.title,
      message: input.message,
      kind: input.kind,
      targetUrl: input.targetUrl ?? null,
    })),
  });
  return result.count;
}
