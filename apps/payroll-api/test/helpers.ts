import request from 'supertest';
import { createApp } from '../src/app';
import { prisma, Prisma } from '../src/db';
import { createUser, ensureRoles } from '../src/bootstrap';

export const ORIGIN = 'http://localhost:3001';
export const PASSWORD = 'TestPassw0rd-Strong';

export async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  await ensureRoles();
  await createUser('admin@test.local', 'Test Admin', 'ADMIN', PASSWORD, false);
  await createUser('user@test.local', 'Test Payroll User', 'PAYROLL_USER', PASSWORD, false);
}

export const app = createApp();

export async function login(email: string, password = PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post('/auth/login').set('Origin', ORIGIN).send({ email, password });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}

/** Minimal payroll master data: one department, two components, one input definition. */
export async function seedMasters() {
  const dept = await prisma.department.create({ data: { name: 'Test Dept' } });
  await prisma.payrollInputDefinition.create({ data: { key: 'BONUS_INPUT', label: 'Bonus input', dataType: 'NUMBER', mandatory: false, minValue: new Prisma.Decimal(0) } });
  const basic = await prisma.salaryComponent.create({ data: { code: 'BASIC', name: 'Basic', type: 'EARNING', basis: 'FIXED', sortOrder: 1 } });
  const pct = await prisma.salaryComponent.create({ data: { code: 'PCT', name: 'Pct of basic', type: 'EARNING', basis: 'PERCENTAGE', percentOfCode: 'BASIC', sortOrder: 2 } });
  const ded = await prisma.salaryComponent.create({ data: { code: 'DED', name: 'Fixed deduction', type: 'DEDUCTION', basis: 'FIXED', sortOrder: 10 } });
  const bonus = await prisma.salaryComponent.create({ data: { code: 'BONUS', name: 'Bonus', type: 'EARNING', basis: 'INPUT', inputKey: 'BONUS_INPUT', sortOrder: 3 } });
  return { dept, basic, pct, ded, bonus };
}
