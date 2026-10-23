import { beforeAll, describe, expect, it } from 'vitest';
import type { Agent } from 'supertest';
import { prisma } from '../../src/db';
import { createUser } from '../../src/bootstrap';
import { login, ORIGIN, resetDb } from '../helpers';

let admin: Agent;
let employeeUser: Agent;
let payrollUser: Agent;
let employeeId: string;
const post = (agent: Agent, path: string, body: object) => agent.post(path).set('Origin', ORIGIN).send(body);
const put = (agent: Agent, path: string, body: object) => agent.put(path).set('Origin', ORIGIN).send(body);

beforeAll(async () => {
  await resetDb();
  admin = await login('admin@test.local');
  payrollUser = await login('user@test.local');
  const employee = await prisma.employee.create({
    data: { employeeCode: 'WRK-001', fullName: 'Workforce Test', joiningDate: new Date('2024-01-01T00:00:00Z') },
  });
  employeeId = employee.id;
  await createUser('employee@test.local', 'Test Employee', 'EMPLOYEE', 'TestPassw0rd-Strong', false);
  await prisma.user.update({ where: { email: 'employee@test.local' }, data: { employeeId } });
  employeeUser = await login('employee@test.local');
});

describe('workforce assignments', () => {
  it('assigns work, limits employee submissions to their linked record and supports reviewed revisions', async () => {
    expect((await payrollUser.get('/my/assignments')).status).toBe(403);
    const otherEmployee = await prisma.employee.create({
      data: { employeeCode: 'WRK-002', fullName: 'Other Employee', joiningDate: new Date('2024-01-01T00:00:00Z') },
    });
    const otherTask = await post(admin, '/assignments', { employeeId: otherEmployee.id, title: 'Other employee task' });
    const created = await post(admin, '/assignments', {
      employeeId,
      title: 'Prepare the monthly handover',
      description: 'Summarize outstanding work.',
      dueDate: '2026-11-05',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    expect(created.body).toMatchObject({
      employee: { id: employeeId, employeeCode: 'WRK-001' },
      title: 'Prepare the monthly handover',
      dueDate: '2026-11-05',
      status: 'OPEN',
      submissions: [],
    });
    expect(await prisma.employeeNotification.count({ where: { employeeId } })).toBe(1);

    const ownAssignments = await employeeUser.get('/my/assignments');
    expect(ownAssignments.status).toBe(200);
    expect(ownAssignments.body).toHaveLength(1);
    expect(ownAssignments.body[0].id).toBe(created.body.id);
    expect((await post(employeeUser, `/my/assignments/${otherTask.body.id}/submissions`, { submissionText: 'Not assigned to this employee.' })).status).toBe(404);

    const first = await post(employeeUser, `/my/assignments/${created.body.id}/submissions`, { submissionText: 'Initial handover.' });
    expect(first.status).toBe(201);
    expect((await post(employeeUser, `/my/assignments/${created.body.id}/submissions`, { submissionUrl: 'https://example.test/report' })).status).toBe(409);
    expect((await post(employeeUser, `/my/assignments/${created.body.id}/submissions`, { submissionUrl: 'javascript:alert(1)' })).status).toBe(400);

    const review = await put(admin, `/assignments/submissions/${first.body.id}/review`, {
      status: 'NEEDS_CHANGES',
      reviewerFeedback: 'Please include the open incident list.',
    });
    expect(review.status).toBe(200);
    expect(review.body.status).toBe('NEEDS_CHANGES');

    const second = await post(employeeUser, `/my/assignments/${created.body.id}/submissions`, {
      submissionText: 'Updated handover with the incident list.',
      submissionUrl: 'https://example.test/report',
    });
    expect(second.status).toBe(201);
    expect(second.body.revision).toBe(2);
    expect((await put(admin, `/assignments/submissions/${second.body.id}/review`, { status: 'ACCEPTED' })).status).toBe(200);

    const allAssignments = await admin.get('/assignments');
    const task = allAssignments.body.find((item: { id: string }) => item.id === created.body.id);
    expect(task.submissions.map((item: { revision: number }) => item.revision)).toEqual([2, 1]);
    expect(await prisma.employeeNotification.count({ where: { employeeId } })).toBe(3);
    expect(await prisma.auditLog.count({ where: { action: 'workforce.submission_reviewed' } })).toBe(2);
  });

  it('does not allow work to be submitted after an assignment is closed', async () => {
    const created = await post(admin, '/assignments', { employeeId, title: 'Closed task' });
    const closed = await put(admin, `/assignments/${created.body.id}`, { status: 'CLOSED' });
    expect(closed.status).toBe(200);
    const submission = await post(employeeUser, `/my/assignments/${created.body.id}/submissions`, { submissionText: 'Too late.' });
    expect(submission.status).toBe(409);
  });
});
