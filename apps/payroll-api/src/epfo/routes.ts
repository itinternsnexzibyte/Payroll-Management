
import { z } from 'zod';
import {
  AppError,
  idParam,
  notFound,
  type ApiRegistry,
} from '@nexzi/server-core';

import { prisma, Prisma } from '../db';
import { sendReport } from '../output/report-export';
import type { ReportData } from '../output/templates';

const PF_REFERENCE = 'STATUTORY_PF';

function jsonText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return null;
}

async function buildEpfoPreview(runId: string) {
  const run = await prisma.payrollRun.findUnique({
    where: { id: runId },
  });

  if (!run) throw notFound('Payroll run');

  if (run.status !== 'FINALISED') {
    throw new AppError(
      'INVALID_STATE',
      'EPFO ECR preview is available only for finalised payroll runs.',
    );
  }

  const members = await prisma.payrollRunEmployee.findMany({
    where: { payrollRunId: run.id },
    include: {
      employee: {
        select: {
          id: true,
          fullName: true,
          uanNumber: true,
          pfNumber: true,
          joiningDate: true,
          exitDate: true,
        },
      },
    },
    orderBy: { employeeCode: 'asc' },
  });

  const lines = await prisma.payrollLine.findMany({
    where: { payrollRunId: run.id },
  });

  const records = members.map((member) => {
    const warnings: string[] = [];

    const pfLines = lines.filter((line) => {
      if (line.employeeId !== member.employeeId) return false;

      const detail =
        line.calcDetail &&
        typeof line.calcDetail === 'object' &&
        !Array.isArray(line.calcDetail)
          ? (line.calcDetail as Prisma.JsonObject)
          : {};

      return detail.formulaRef === PF_REFERENCE;
    });

    if (pfLines.length > 1) {
      warnings.push('Multiple statutory PF lines found.');
    }

    const pfLine = pfLines[0];

    const detail =
      pfLine?.calcDetail &&
      typeof pfLine.calcDetail === 'object' &&
      !Array.isArray(pfLine.calcDetail)
        ? (pfLine.calcDetail as Prisma.JsonObject)
        : {};

    const uan = member.employee.uanNumber;
    const grossWages = member.gross?.toString() ?? null;
    const epfWages = jsonText(detail.pfWages);
    const employeePf = pfLine?.amount.toString() ?? null;
    const employerPf = jsonText(detail.employerContribution);

    if (!uan) {
      warnings.push('Employee UAN is missing.');
    }

    if (grossWages === null) {
      warnings.push('Gross wages are missing.');
    }

    if (!pfLine) {
      warnings.push('Statutory PF calculation line is missing.');
    }

    if (pfLine && epfWages === null) {
      warnings.push('EPF wages are missing from PF calculation details.');
    }

    if (pfLine && employerPf === null) {
      warnings.push('Employer PF contribution is missing.');
    }

    if (
      member.resultStatus === 'ERROR' ||
      member.resultStatus === 'PENDING'
    ) {
      warnings.push('Payroll employee result is incomplete.');
    }

    warnings.push(
      'Confirm employee name against the name registered with UAN.',
    );

    return {
      employeeId: member.employeeId,
      employeeCode: member.employeeCode,
      uan,
      memberName: member.employee.fullName,
      grossWages,
      epfWages,
      employeePfContribution: employeePf,
      employerPfContribution: employerPf,
      warnings,
      readyForGeneration: false,
    };
  });

  const warningCount = records.reduce(
    (total, record) => total + record.warnings.length,
    0,
  );

  return {
    payrollRun: {
      id: run.id,
      year: run.year,
      month: run.month,
      status: run.status,
    },
    recordCount: records.length,
    warningCount,
    readyForGeneration: false,
    message:
      'Preview only. Complete and verify all statutory ECR mappings before generating the official file.',
    records,
  };
}

export function registerEpfoRoutes(r: ApiRegistry) {
  // List finalised payroll runs available for EPFO ECR.
  r.add({
    method: 'get',
    path: '/epfo/payroll-runs',
    tag: 'EPFO',
    summary: 'List finalised payroll runs available for EPFO ECR',
    permission: 'epfo.view',
    handler: async () => {
      return prisma.payrollRun.findMany({
        where: { status: 'FINALISED' },
        select: {
          id: true,
          year: true,
          month: true,
          status: true,
          employeeCount: true,
          finalisedAt: true,
        },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
      });
    },
  });

  // Preview saved payroll information for EPFO ECR.
  r.add({
    method: 'get',
    path: '/epfo/payroll-runs/:id/preview',
    tag: 'EPFO',
    summary: 'Preview and validate EPFO ECR records',
    permission: 'epfo.view',
    params: idParam,
    handler: async ({ params }) => {
      return buildEpfoPreview(params.id);
    },
  });

  // Export the same EPFO preview as PDF or Excel.
  r.add({
    method: 'get',
    path: '/epfo/payroll-runs/:id/export',
    tag: 'EPFO',
    summary: 'Download EPFO ECR preview as PDF or Excel',
    permission: 'epfo.view',
    produces: 'xlsx',
    params: idParam,
    query: z.object({
      format: z.enum(['pdf', 'xlsx']),
    }),
    handler: async ({ params, query, res }) => {
      const preview = await buildEpfoPreview(params.id);

      const period = `${preview.payrollRun.year}-${String(
        preview.payrollRun.month,
      ).padStart(2, '0')}`;

      const report: ReportData = {
        title: 'EPFO ECR Preview',
        subtitle: `Payroll period: ${period} | Employees: ${preview.recordCount} | Warnings: ${preview.warningCount}`,
        banners: [
          'PREVIEW — NOT AN OFFICIAL EPFO FILING',
          'Only currently available payroll fields are included.',
          preview.message,
        ],
        columns: [
          { header: 'Employee Code', key: 'employeeCode' },
          { header: 'Member Name', key: 'memberName' },
          { header: 'UAN', key: 'uan' },
          { header: 'Gross Wages', key: 'grossWages', numeric: true },
          { header: 'EPF Wages', key: 'epfWages', numeric: true },
          {
            header: 'Employee PF Contribution',
            key: 'employeePfContribution',
            numeric: true,
          },
          {
            header: 'Employer PF Contribution',
            key: 'employerPfContribution',
            numeric: true,
          },
          { header: 'Validation Warnings', key: 'warnings' },
          { header: 'Ready for Generation', key: 'readyForGeneration' },
        ],
        rows: preview.records.map((record) => ({
          employeeCode: record.employeeCode,
          memberName: record.memberName,
          uan: record.uan,
          grossWages: record.grossWages,
          epfWages: record.epfWages,
          employeePfContribution: record.employeePfContribution,
          employerPfContribution: record.employerPfContribution,
          warnings: record.warnings.join(' | '),
          readyForGeneration: record.readyForGeneration ? 'Yes' : 'No',
        })),
      };

      return sendReport(
        res,
        query.format,
        report,
        `epfo-ecr-preview-${period}`,
      );
    },
  });
}
