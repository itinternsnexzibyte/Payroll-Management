'use client';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button, Dialog, Field, Input, Select, Textarea, errorMessage, get, post, useToast } from '@nexzi/ui';
import { useEmployeeOptions } from '@/lib/hooks';

export interface LeaveType {
  id: string;
  code: string;
  name: string;
  paid: boolean;
  annualDays: string | null;
  active: boolean;
  sortOrder: number;
}
export interface LeaveRequest {
  id: string;
  employee: { id: string; code: string; name: string };
  leaveType: { id: string; code: string; name: string; paid: boolean };
  startDate: string;
  endDate: string;
  days: string;
  reason: string | null;
  status: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  requestedByName: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}
export interface Balance {
  leaveType: { id: string; code: string; name: string; paid: boolean };
  allowance: string | null;
  approved: string;
  pending: string;
  remaining: string | null;
}

export const LEAVE_STATUS: Record<LeaveRequest['status'], { label: string; tone: 'warning' | 'success' | 'danger' | 'neutral' }> = {
  REQUESTED: { label: 'Waiting for approval', tone: 'warning' },
  APPROVED: { label: 'Approved', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
};

export const useLeaveTypes = () => useQuery({ queryKey: ['leave-types'], queryFn: () => get<LeaveType[]>('/leave/types'), staleTime: 60_000 });

export function RequestDialog({ onClose, onSaved, self }: { onClose: () => void; onSaved: () => void; self?: boolean }) {
  const toast = useToast();
  const types = useLeaveTypes();
  const employees = useEmployeeOptions(!self);
  const [f, setF] = useState({ employeeId: '', leaveTypeId: '', startDate: '', endDate: '', days: '1', reason: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: () => post(self ? '/me/leave' : '/leave/requests', { ...(self ? {} : { employeeId: f.employeeId }), leaveTypeId: f.leaveTypeId, startDate: f.startDate, endDate: f.endDate || f.startDate, days: f.days.trim(), reason: f.reason.trim() || undefined }),
    onSuccess: () => {
      toast.success(self ? 'Leave requested. You will be told when it is decided.' : 'Leave request recorded.');
      onSaved();
    },
    onError: (e: unknown) => {
      const fields = (e as { fieldMap?: () => Record<string, string> }).fieldMap?.() ?? {};
      setErrors(fields);
      if (!Object.keys(fields).length) toast.error(errorMessage(e));
      else toast.error(errorMessage(e));
    },
  });
  const submit = () => {
    const fe: Record<string, string> = {};
    if (!self && !f.employeeId) fe.employeeId = 'Choose the employee.';
    if (!f.leaveTypeId) fe.leaveTypeId = 'Choose the leave type.';
    if (!f.startDate) fe.startDate = 'Choose the first day.';
    if (!/^\d{1,3}(\.5|\.0)?$/.test(f.days.trim())) fe.days = 'Whole or half days, e.g. 1 or 1.5.';
    setErrors(fe);
    if (!Object.keys(fe).length) m.mutate();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={self ? 'Request leave' : 'New leave request'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={m.isPending} onClick={submit}>
            {self ? 'Send request' : 'Save request'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {!self && (
          <Field label="Employee" htmlFor="lr-emp" required error={errors.employeeId} className="sm:col-span-2">
            <Select id="lr-emp" value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })} invalid={!!errors.employeeId}>
              <option value="">Choose…</option>
              {employees.data?.items.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.employeeCode} · {x.fullName}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Leave type" htmlFor="lr-type" required error={errors.leaveTypeId} className="sm:col-span-2">
          <Select id="lr-type" value={f.leaveTypeId} onChange={(e) => setF({ ...f, leaveTypeId: e.target.value })} invalid={!!errors.leaveTypeId}>
            <option value="">Choose…</option>
            {types.data?.filter((t) => t.active).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.paid ? '' : ' (unpaid)'}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="From" htmlFor="lr-start" required error={errors.startDate}>
          <Input id="lr-start" type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value, endDate: f.endDate && f.endDate >= e.target.value ? f.endDate : e.target.value })} invalid={!!errors.startDate} />
        </Field>
        <Field label="To" htmlFor="lr-end" error={errors.endDate} hint="Within the same month.">
          <Input id="lr-end" type="date" min={f.startDate} value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} invalid={!!errors.endDate} />
        </Field>
        <Field label="Days" htmlFor="lr-days" required error={errors.days} hint="Half days allowed, e.g. 0.5 or 1.5.">
          <Input id="lr-days" inputMode="decimal" value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} invalid={!!errors.days} />
        </Field>
        <Field label="Reason" htmlFor="lr-reason" className="sm:col-span-2">
          <Textarea id="lr-reason" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} maxLength={500} />
        </Field>
      </div>
    </Dialog>
  );
}
