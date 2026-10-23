import { z } from 'zod';
import { AppError, idParam, isoDate, notFound, toIsoDate, type ApiRegistry } from '@nexzi/server-core';
import { prisma, Prisma } from '../db';
import { audit } from '../audit';
import { notifyEmployees } from '../notifications';

const assignmentInclude = {
  employee: { select: { id: true, employeeCode: true, fullName: true } },
  submissions: { orderBy: { revision: 'desc' as const } },
};

type AssignmentWithDetails = Prisma.WorkAssignmentGetPayload<{ include: typeof assignmentInclude }>;

const serializeAssignment = (assignment: AssignmentWithDetails) => ({
  id: assignment.id,
  employee: assignment.employee,
  title: assignment.title,
  description: assignment.description,
  dueDate: assignment.dueDate ? toIsoDate(assignment.dueDate) : null,
  status: assignment.status,
  createdAt: assignment.createdAt,
  submissions: assignment.submissions.map((submission) => ({
    id: submission.id,
    revision: submission.revision,
    submissionText: submission.submissionText,
    submissionUrl: submission.submissionUrl,
    status: submission.status,
    submittedAt: submission.submittedAt,
    reviewedAt: submission.reviewedAt,
    reviewerFeedback: submission.reviewerFeedback,
  })),
});

async function linkedEmployeeId(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { employeeId: true } });
  if (!user?.employeeId) throw new AppError('INVALID_STATE', 'Your account must be linked to an employee record.');
  return user.employeeId;
}

const assignmentBody = z.object({
  employeeId: z.string().uuid(),
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(10000).nullable().optional().or(z.literal('').transform(() => null)),
  dueDate: isoDate.nullable().optional(),
});

const updateAssignmentBody = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  description: z.string().trim().max(10000).nullable().optional().or(z.literal('').transform(() => null)),
  dueDate: isoDate.nullable().optional(),
  status: z.enum(['OPEN', 'CLOSED']).optional(),
});

const submissionBody = z
  .object({
    submissionText: z.string().trim().max(10000).nullable().optional().or(z.literal('').transform(() => null)),
    submissionUrl: z
      .string()
      .trim()
      .max(500)
      .refine((value) => {
        try {
          return new URL(value).protocol === 'https:';
        } catch {
          return false;
        }
      }, 'Use a valid HTTPS link.')
      .nullable()
      .optional()
      .or(z.literal('').transform(() => null)),
  })
  .refine((body) => body.submissionText || body.submissionUrl, {
    message: 'Enter submission text or provide a link.',
  });

const reviewBody = z.object({
  status: z.enum(['ACCEPTED', 'NEEDS_CHANGES']),
  reviewerFeedback: z.string().trim().max(5000).nullable().optional().or(z.literal('').transform(() => null)),
}).superRefine((body, ctx) => {
  if (body.status === 'NEEDS_CHANGES' && !body.reviewerFeedback) {
    ctx.addIssue({ code: 'custom', path: ['reviewerFeedback'], message: 'Explain what needs to change.' });
  }
});

export function registerWorkforceRoutes(r: ApiRegistry) {
  r.add({
    method: 'get',
    path: '/assignments',
    tag: 'Workforce',
    summary: 'List employee assignments and submission history',
    permission: 'workforce.view',
    query: z.object({
      employeeId: z.string().uuid().optional(),
      status: z.enum(['OPEN', 'CLOSED']).optional(),
    }),
    handler: async ({ query }) => {
      const rows = await prisma.workAssignment.findMany({
        where: {
          ...(query.employeeId ? { employeeId: query.employeeId } : {}),
          ...(query.status ? { status: query.status } : {}),
        },
        include: assignmentInclude,
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
        take: 500,
      });
      return rows.map(serializeAssignment);
    },
  });

  r.add({
    method: 'post',
    path: '/assignments',
    tag: 'Workforce',
    summary: 'Assign work to an active employee',
    permission: 'workforce.manage',
    body: assignmentBody,
    handler: async ({ body, user, ip }) => {
      const employee = await prisma.employee.findUnique({ where: { id: body.employeeId }, select: { id: true, status: true } });
      if (!employee || employee.status !== 'ACTIVE') throw notFound('Active employee');
      const assignment = await prisma.$transaction(async (tx) => {
        const created = await tx.workAssignment.create({
          data: {
            employeeId: employee.id,
            title: body.title,
            description: body.description ?? null,
            dueDate: body.dueDate ?? null,
            createdById: user.id,
          },
          include: assignmentInclude,
        });
        await notifyEmployees(tx, [employee.id], {
          title: 'New work assigned',
          message: `${created.title}${created.dueDate ? ` · due ${toIsoDate(created.dueDate)}` : ''}`,
          kind: 'WORK_ASSIGNMENT',
          targetUrl: '/assignments',
        });
        return created;
      });
      await audit.write({ actorId: user.id, action: 'workforce.assignment_created', entity: 'work_assignment', entityId: assignment.id, metadata: { employeeId: employee.id }, ip });
      return serializeAssignment(assignment);
    },
  });

  r.add({
    method: 'put',
    path: '/assignments/:id',
    tag: 'Workforce',
    summary: 'Update an assignment or close/reopen submissions',
    permission: 'workforce.manage',
    params: idParam,
    body: updateAssignmentBody,
    handler: async ({ params, body, user, ip }) => {
      const existing = await prisma.workAssignment.findUnique({ where: { id: params.id } });
      if (!existing) throw notFound('Assignment');
      const updated = await prisma.workAssignment.update({
        where: { id: existing.id },
        data: {
          ...body,
          ...(body.dueDate !== undefined ? { dueDate: body.dueDate } : {}),
        },
        include: assignmentInclude,
      });
      await audit.write({ actorId: user.id, action: 'workforce.assignment_updated', entity: 'work_assignment', entityId: updated.id, before: { status: existing.status }, after: { status: updated.status }, ip });
      return serializeAssignment(updated);
    },
  });

  r.add({
    method: 'get',
    path: '/my/assignments',
    tag: 'Workforce',
    summary: 'List assignments for the linked employee',
    permission: 'workforce.submit',
    handler: async ({ user }) => {
      const employeeId = await linkedEmployeeId(user.id);
      const rows = await prisma.workAssignment.findMany({
        where: { employeeId },
        include: assignmentInclude,
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
        take: 200,
      });
      return rows.map(serializeAssignment);
    },
  });

  r.add({
    method: 'post',
    path: '/my/assignments/:id/submissions',
    tag: 'Workforce',
    summary: 'Submit work for an assigned task',
    permission: 'workforce.submit',
    params: idParam,
    body: submissionBody,
    status: 201,
    handler: async ({ params, body, user, ip }) => {
      const employeeId = await linkedEmployeeId(user.id);
      const submission = await prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<{ id: string; status: string }[]>`
          SELECT "id", "status" FROM "work_assignments"
          WHERE "id" = ${params.id}::uuid AND "employeeId" = ${employeeId}::uuid
          FOR UPDATE
        `;
        const assignment = locked[0];
        if (!assignment) throw notFound('Assignment');
        if (assignment.status !== 'OPEN') throw new AppError('INVALID_STATE', 'This assignment is closed.');
        const latest = await tx.workSubmission.findFirst({
          where: { assignmentId: assignment.id },
          orderBy: { revision: 'desc' },
        });
        if (latest?.status === 'SUBMITTED' || latest?.status === 'ACCEPTED') {
          throw new AppError('INVALID_STATE', latest.status === 'ACCEPTED' ? 'This submission has already been accepted.' : 'Your submission is awaiting review.');
        }
        return tx.workSubmission.create({
          data: {
            assignmentId: assignment.id,
            revision: (latest?.revision ?? 0) + 1,
            submissionText: body.submissionText ?? null,
            submissionUrl: body.submissionUrl ?? null,
          },
        });
      });
      await audit.write({ actorId: user.id, action: 'workforce.submission_created', entity: 'work_submission', entityId: submission.id, metadata: { assignmentId: submission.assignmentId, revision: submission.revision }, ip });
      return { id: submission.id, revision: submission.revision, status: submission.status, submittedAt: submission.submittedAt };
    },
  });

  r.add({
    method: 'put',
    path: '/assignments/submissions/:id/review',
    tag: 'Workforce',
    summary: 'Accept a submission or request changes',
    permission: 'workforce.review',
    params: idParam,
    body: reviewBody,
    handler: async ({ params, body, user, ip }) => {
      const submission = await prisma.workSubmission.findUnique({
        where: { id: params.id },
        include: { assignment: { select: { id: true, employeeId: true } } },
      });
      if (!submission) throw notFound('Submission');
      const reviewerEmployeeId = await prisma.user.findUnique({ where: { id: user.id }, select: { employeeId: true } });
      if (reviewerEmployeeId?.employeeId === submission.assignment.employeeId) {
        throw new AppError('FORBIDDEN', 'You cannot review your own work submission.');
      }
      if (submission.status !== 'SUBMITTED') throw new AppError('INVALID_STATE', 'Only a pending submission can be reviewed.');
      const updated = await prisma.$transaction(async (tx) => {
        const result = await tx.workSubmission.updateMany({
          where: { id: submission.id, status: 'SUBMITTED' },
          data: {
            status: body.status,
            reviewerFeedback: body.reviewerFeedback ?? null,
            reviewedAt: new Date(),
            reviewedById: user.id,
          },
        });
        if (!result.count) throw new AppError('INVALID_STATE', 'This submission has already been reviewed.');
        const reviewed = await tx.workSubmission.findUniqueOrThrow({ where: { id: submission.id } });
        await notifyEmployees(tx, [submission.assignment.employeeId], {
          title: body.status === 'ACCEPTED' ? 'Work submission accepted' : 'Changes requested for your work',
          message: body.reviewerFeedback ?? 'Your work submission has been accepted.',
          kind: 'WORK_ASSIGNMENT',
          targetUrl: '/assignments',
        });
        return reviewed;
      });
      await audit.write({ actorId: user.id, action: 'workforce.submission_reviewed', entity: 'work_submission', entityId: updated.id, metadata: { assignmentId: submission.assignment.id, status: updated.status }, ip });
      return { id: updated.id, status: updated.status, reviewerFeedback: updated.reviewerFeedback, reviewedAt: updated.reviewedAt };
    },
  });
}
