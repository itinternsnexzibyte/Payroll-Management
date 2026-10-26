'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, EmptyState, ErrorState, Field, Input, PageHeader, RequirePermission, Spinner, errorMessage, get, post, qs, useToast } from '@nexzi/ui';

interface Row {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  present_days: number;
  absent_days: number;
  leave_days: number;
  late_days: number;
  worked_hours: number;
  overtime_hours: number;
  hasRecords: boolean;
}
interface Summary {
  period: string;
  run: { id: string; status: string } | null;
  fieldMap: { source: string; inputKey: string }[];
  rows: Row[];
}

export default function AttendanceToPayrollPage() {
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [lateAfter, setLateAfter] = useState('09:30');
  const [y, m] = month.split('-').map(Number);
  const toast = useToast();
  const qc = useQueryClient();
  const params = qs({ year: y, month: m, lateAfter });
  const q = useQuery({ queryKey: ['att-payroll', y, m, lateAfter], queryFn: () => get<Summary>(`/attendance-records/payroll-summary${params}`), enabled: Boolean(y && m) });
  const apply = useMutation({
    mutationFn: () => post<{ saved: number; errors: unknown[] }>('/attendance-records/apply-to-payroll', { year: y, month: m, lateAfter }),
    onSuccess: (r) => {
      toast.success(`${r.saved} input values written${r.errors.length ? `, ${r.errors.length} skipped` : ''}.`);
      qc.invalidateQueries({ queryKey: ['att-payroll'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const d = q.data;
  const editable = Boolean(d?.run && ['DRAFT', 'CALCULATED'].includes(d.run.status));
  const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
  return (
    <RequirePermission permission="attendance.view">
      <PageHeader title="Attendance to payroll" description="Totals from the daily attendance register, ready to fill the monthly payroll inputs." breadcrumbs={[{ label: 'Attendance records', href: '/attendance' }, { label: 'Attendance to payroll' }]} />
      <div className="space-y-6">
        <Card title="Month and rules">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Payroll month">
              <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </Field>
            <Field label="Late if check-in after">
              <Input type="time" value={lateAfter} onChange={(e) => setLateAfter(e.target.value || '09:30')} />
            </Field>
          </div>
        </Card>
        {q.isLoading && <Spinner />}
        {q.error && <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />}
        {d && (
          <Card title={`${d.period} — ${d.rows.length} employees`}>
            {!d.run && <Alert tone="info">No payroll run exists for {d.period} yet. The figures below are a preview; create the run to apply them.</Alert>}
            {d.run && !editable && <Alert tone="warning">This payroll is {d.run.status.replace('_', ' ').toLowerCase()}, so attendance can no longer be applied.</Alert>}
            {d.fieldMap.length === 0 && (
              <Alert tone="info">
                No attendance fields are mapped to payroll input columns yet. In Attendance sync, map present_days, absent_days, leave_days, late_days, worked_hours or overtime_hours.
              </Alert>
            )}
            {d.rows.length === 0 ? (
              <EmptyState title="No employees" />
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs uppercase text-muted">
                      <th className="py-2 pr-3">Employee</th>
                      <th className="pr-3 text-right">Present</th>
                      <th className="pr-3 text-right">Absent</th>
                      <th className="pr-3 text-right">Leave</th>
                      <th className="pr-3 text-right">Late</th>
                      <th className="pr-3 text-right">Worked h</th>
                      <th className="text-right">Overtime h</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.rows.map((r) => (
                      <tr key={r.employeeId} className="border-b border-line/60">
                        <td className="py-2 pr-3">
                          {r.employeeCode} · {r.employeeName}
                          {!r.hasRecords && <span className="ml-2 text-xs text-muted">no records</span>}
                        </td>
                        <td className="pr-3 text-right">{num(r.present_days)}</td>
                        <td className="pr-3 text-right">{num(r.absent_days)}</td>
                        <td className="pr-3 text-right">{num(r.leave_days)}</td>
                        <td className="pr-3 text-right">{num(r.late_days)}</td>
                        <td className="pr-3 text-right">{num(r.worked_hours)}</td>
                        <td className="text-right">{num(r.overtime_hours)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mt-4 flex justify-end">
              <Button onClick={() => apply.mutate()} disabled={!editable || d.fieldMap.length === 0 || apply.isPending}>
                Apply to payroll inputs
              </Button>
            </div>
          </Card>
        )}
      </div>
    </RequirePermission>
  );
}
