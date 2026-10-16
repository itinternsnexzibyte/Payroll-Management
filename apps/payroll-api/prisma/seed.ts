/**
 * Seed script.
 *  - Always: roles and default permissions (idempotent).
 *  - Development only (refused when NODE_ENV=production): development sign-in accounts from .env
 *    and clearly labelled SYNTHETIC DEMO data. None of it represents the client's real data.
 */
import { prisma, Prisma } from '../src/db';
import { createUser, ensureRoles } from '../src/bootstrap';

async function seedDemo() {
  if ((await prisma.employee.count()) > 0) {
    console.log('Employees already exist — demo data skipped.');
    return;
  }
  const depts = await Promise.all(['Demo — Sales', 'Demo — Logistics', 'Demo — Accounts'].map((name) => prisma.department.create({ data: { name } })));
  const desigs = await Promise.all(['Demo — Executive', 'Demo — Officer', 'Demo — Driver'].map((name) => prisma.designation.create({ data: { name } })));

  // Monthly input columns (synthetic). Replace with the inputs filled manually in the client's Excel.
  await prisma.payrollInputDefinition.createMany({
    data: [
      { key: 'OTHER_EARNINGS', label: 'Other earnings (demo)', dataType: 'NUMBER', mandatory: false, minValue: new Prisma.Decimal(0), sortOrder: 10, description: 'SYNTHETIC DEMO INPUT' },
      { key: 'OTHER_DEDUCTIONS', label: 'Other deductions (demo)', dataType: 'NUMBER', mandatory: false, minValue: new Prisma.Decimal(0), sortOrder: 20, description: 'SYNTHETIC DEMO INPUT' },
      { key: 'REMARKS', label: 'Remarks', dataType: 'TEXT', mandatory: false, sortOrder: 90, description: 'Free-text note for the month' },
    ],
  });

  // Salary components (synthetic). The real configuration must come from the client's workbook.
  const note = 'SYNTHETIC DEMO COMPONENT — replace with the components in the client-approved workbook.';
  const basic = await prisma.salaryComponent.create({ data: { code: 'DEMO_BASIC', name: 'Basic (demo)', type: 'EARNING', basis: 'FIXED', sortOrder: 10, description: note } });
  const allow = await prisma.salaryComponent.create({
    data: { code: 'DEMO_ALLOWANCE', name: 'Allowance (demo, % of basic)', type: 'EARNING', basis: 'PERCENTAGE', percentOfCode: 'DEMO_BASIC', defaultPercentage: new Prisma.Decimal(20), sortOrder: 20, description: note },
  });
  const fixedAllow = await prisma.salaryComponent.create({ data: { code: 'DEMO_FIXED_ALLOWANCE', name: 'Fixed allowance (demo)', type: 'EARNING', basis: 'FIXED', sortOrder: 30, description: note } });
  await prisma.salaryComponent.create({ data: { code: 'DEMO_OTHER_EARNINGS', name: 'Other earnings (demo)', type: 'EARNING', basis: 'INPUT', inputKey: 'OTHER_EARNINGS', sortOrder: 40, description: note } });
  const advance = await prisma.salaryComponent.create({ data: { code: 'DEMO_ADVANCE_RECOVERY', name: 'Advance recovery (demo)', type: 'DEDUCTION', basis: 'FIXED', sortOrder: 110, description: note } });
  await prisma.salaryComponent.create({ data: { code: 'DEMO_OTHER_DEDUCTIONS', name: 'Other deductions (demo)', type: 'DEDUCTION', basis: 'INPUT', inputKey: 'OTHER_DEDUCTIONS', sortOrder: 120, description: note } });

  const demo = [
    ['DEMO-001', 'Demo Employee One', 0, 0, '2019-04-01', '30000.00', '2500.00', null],
    ['DEMO-002', 'Demo Employee Two', 0, 1, '2020-06-15', '24000.00', null, '1000.00'],
    ['DEMO-003', 'Demo Employee Three', 1, 2, '2021-01-04', '18000.00', '1500.00', null],
    ['DEMO-004', 'Demo Employee Four', 1, 2, '2022-09-01', '17500.00', null, null],
    ['DEMO-005', 'Demo Employee Five', 2, 1, '2018-11-12', '28000.00', '2000.00', '500.00'],
    ['DEMO-006', 'Demo Employee Six', 2, 0, '2023-03-20', '21000.00', null, null],
  ] as const;
  for (const [code, name, d, g, doj, basicAmt, fixed, adv] of demo) {
    const emp = await prisma.employee.create({ data: { employeeCode: code, fullName: name, departmentId: depts[d].id, designationId: desigs[g].id, joiningDate: new Date(doj + 'T00:00:00Z') } });
    const values = [
      { componentId: basic.id, value: new Prisma.Decimal(basicAmt) },
      { componentId: allow.id, value: new Prisma.Decimal('20') },
      ...(fixed ? [{ componentId: fixedAllow.id, value: new Prisma.Decimal(fixed) }] : []),
      ...(adv ? [{ componentId: advance.id, value: new Prisma.Decimal(adv) }] : []),
    ];
    await prisma.salaryVersion.create({ data: { employeeId: emp.id, versionNo: 1, effectiveFrom: new Date(doj + 'T00:00:00Z'), changeReason: 'Synthetic demo salary structure', values: { create: values } } });
  }
  console.log('Synthetic demo data created (6 employees, demo components and inputs).');
}

async function main() {
  await ensureRoles();
  console.log('Roles and permissions ensured.');
  if (process.env.NODE_ENV === 'production') {
    console.log('NODE_ENV=production: development accounts and demo data are NOT seeded. Use `npm run bootstrap:admin`.');
    return;
  }
  const { SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, SEED_PAYROLL_USER_EMAIL, SEED_PAYROLL_USER_PASSWORD } = process.env;
  if (SEED_ADMIN_EMAIL && SEED_ADMIN_PASSWORD) await createUser(SEED_ADMIN_EMAIL, 'Dev Administrator', 'ADMIN', SEED_ADMIN_PASSWORD, false, true);
  if (SEED_PAYROLL_USER_EMAIL && SEED_PAYROLL_USER_PASSWORD) await createUser(SEED_PAYROLL_USER_EMAIL, 'Dev Payroll User', 'PAYROLL_USER', SEED_PAYROLL_USER_PASSWORD, false, true);
  console.log('Development accounts ensured (see .env).');
  if (process.env.SEED_DEMO_DATA !== 'false') await seedDemo();
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
