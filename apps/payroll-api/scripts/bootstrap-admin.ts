/**
 * Production bootstrap: creates the first Administrator when none exists.
 *   BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_NAME, BOOTSTRAP_ADMIN_PASSWORD (temporary; must be changed at first sign-in)
 * Usage: npm run bootstrap:admin -w @nexzi/payroll-api   (after `npm run build`)
 */
import { passwordSchema } from '@nexzi/server-core';
import { prisma } from '../src/db';
import { createUser, ensureRoles } from '../src/bootstrap';

async function main() {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim();
  const name = process.env.BOOTSTRAP_ADMIN_NAME?.trim() || 'Administrator';
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? '';
  if (!email) throw new Error('Set BOOTSTRAP_ADMIN_EMAIL.');
  const pw = passwordSchema.safeParse(password);
  if (!pw.success) throw new Error(`BOOTSTRAP_ADMIN_PASSWORD is too weak: ${pw.error.issues.map((i) => i.message).join(' ')}`);
  await ensureRoles();
  const admins = await prisma.user.count({ where: { role: { code: 'ADMIN' }, status: 'ACTIVE' } });
  if (admins > 0) {
    console.log('An active Administrator already exists — nothing to do.');
    return;
  }
  await createUser(email, name, 'ADMIN', password, true);
  console.log(`Administrator ${email} created. The password must be changed at first sign-in.`);
}

main()
  .catch((e) => {
    console.error((e as Error).message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
