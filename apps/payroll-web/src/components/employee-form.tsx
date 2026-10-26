'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, Button, Field, Input, Select, post, put, useToast } from '@nexzi/ui';
import { useDepartments, useDesignations, useEmployeeOptions } from '@/lib/hooks';
import type { Employee } from '@/lib/types';

const schema = z
  .object({
    employeeCode: z.string().trim().min(1, 'Enter the Employee ID.').max(30).regex(/^[A-Za-z0-9][A-Za-z0-9/_-]*$/, 'Use letters, digits, "-", "_" or "/".'),
    fullName: z.string().trim().min(2, 'Enter the employee name.').max(120),
    departmentId: z.string(),
    designationId: z.string(),
    joiningDate: z.string().min(1, 'Enter the joining date.'),
    exitDate: z.string(),
    status: z.enum(['ACTIVE', 'INACTIVE', 'EXITED']),
    contactEmail: z.string().trim().max(200).refine((v) => !v || /^\S+@\S+\.\S+$/.test(v), 'Enter a valid email address.'),
    contactPhone: z.string().trim().max(20).refine((v) => !v || /^\+?[0-9 ()-]{7,20}$/.test(v), 'Enter a phone number with 7–20 digits.'),
    managerId: z.string(),
    panNumber: z.string().trim().toUpperCase().refine((v) => !v || /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v), 'Enter a 10-character PAN like ABCDE1234F.'),
    uanNumber: z.string().trim().refine((v) => !v || /^\d{12}$/.test(v), 'The UAN has 12 digits.'),
    pfNumber: z.string().trim().max(30),
  })
  .superRefine((v, ctx) => {
    if (v.exitDate && v.joiningDate && v.exitDate < v.joiningDate) ctx.addIssue({ code: 'custom', path: ['exitDate'], message: 'Exit date cannot be before the joining date.' });
    if (v.status === 'EXITED' && !v.exitDate) ctx.addIssue({ code: 'custom', path: ['exitDate'], message: 'Exit date is required for exited employees.' });
  });
type FormValues = z.infer<typeof schema>;

export function EmployeeForm({ employee, onSaved, onCancel }: { employee?: Employee; onSaved: (e: Employee) => void; onCancel?: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const depts = useDepartments();
  const desigs = useDesignations();
  const people = useEmployeeOptions();
  const codeLocked = Boolean(employee?.payrollRunCount);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      employeeCode: employee?.employeeCode ?? '',
      fullName: employee?.fullName ?? '',
      departmentId: employee?.department?.id ?? '',
      designationId: employee?.designation?.id ?? '',
      joiningDate: employee?.joiningDate ?? '',
      exitDate: employee?.exitDate ?? '',
      status: employee?.status ?? 'ACTIVE',
      contactEmail: employee?.contactEmail ?? '',
      contactPhone: employee?.contactPhone ?? '',
      managerId: employee?.manager?.id ?? '',
      panNumber: employee?.panNumber ?? '',
      uanNumber: employee?.uanNumber ?? '',
      pfNumber: employee?.pfNumber ?? '',
    },
  });

  const onSubmit = async (v: FormValues) => {
    const body = { ...v, departmentId: v.departmentId || null, designationId: v.designationId || null, exitDate: v.exitDate || null, contactEmail: v.contactEmail || null, contactPhone: v.contactPhone || null, managerId: v.managerId || null, panNumber: v.panNumber || null, uanNumber: v.uanNumber || null, pfNumber: v.pfNumber || null };
    try {
      const saved = employee ? await put<Employee>(`/employees/${employee.id}`, body) : await post<Employee>('/employees', body);
      await qc.invalidateQueries({ queryKey: ['employees'] });
      await qc.invalidateQueries({ queryKey: ['employee', saved.id] });
      toast.success(employee ? 'Employee updated.' : 'Employee created.');
      onSaved(saved);
    } catch (e) {
      if (e instanceof ApiError && e.fields.length) {
        for (const f of e.fields) setError(f.path as keyof FormValues, { message: f.message });
      }
      toast.error(e instanceof ApiError ? e.message : 'Could not save the employee.');
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Employee ID" htmlFor="employeeCode" error={errors.employeeCode?.message} required locked={codeLocked ? 'The ID cannot change after the employee has been included in payroll.' : undefined}>
          <Input id="employeeCode" {...register('employeeCode')} readOnly={codeLocked} invalid={!!errors.employeeCode} />
        </Field>
        <Field label="Employee name" htmlFor="fullName" error={errors.fullName?.message} required>
          <Input id="fullName" {...register('fullName')} invalid={!!errors.fullName} />
        </Field>
        <Field label="Department" htmlFor="departmentId" error={errors.departmentId?.message}>
          <Select id="departmentId" {...register('departmentId')}>
            <option value="">— Not set —</option>
            {depts.data?.filter((d) => d.active || d.id === employee?.department?.id).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Designation" htmlFor="designationId" error={errors.designationId?.message}>
          <Select id="designationId" {...register('designationId')}>
            <option value="">— Not set —</option>
            {desigs.data?.filter((d) => d.active || d.id === employee?.designation?.id).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Joining date" htmlFor="joiningDate" error={errors.joiningDate?.message} required>
          <Input id="joiningDate" type="date" {...register('joiningDate')} invalid={!!errors.joiningDate} />
        </Field>
        <Field label="Exit date" htmlFor="exitDate" error={errors.exitDate?.message}>
          <Input id="exitDate" type="date" {...register('exitDate')} invalid={!!errors.exitDate} />
        </Field>
        <Field label="Employment status" htmlFor="status" error={errors.status?.message} required>
          <Select id="status" {...register('status')}>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
            <option value="EXITED">Exited</option>
          </Select>
        </Field>
        <Field label="Contact email" htmlFor="contactEmail" error={errors.contactEmail?.message}>
          <Input id="contactEmail" type="email" autoComplete="off" {...register('contactEmail')} invalid={!!errors.contactEmail} />
        </Field>
        <Field label="Contact phone" htmlFor="contactPhone" error={errors.contactPhone?.message}>
          <Input id="contactPhone" type="tel" autoComplete="off" {...register('contactPhone')} invalid={!!errors.contactPhone} />
        </Field>
        <Field label="Reports to" htmlFor="managerId" error={errors.managerId?.message} hint="Places the employee in the organisation chart.">
          <Select id="managerId" {...register('managerId')}>
            <option value="">— No manager (top of the structure) —</option>
            {employee?.manager && !people.data?.items.some((p) => p.id === employee.manager!.id) && <option value={employee.manager.id}>{employee.manager.fullName}</option>}
            {people.data?.items
              .filter((p) => p.id !== employee?.id)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.fullName} ({p.employeeCode})
                </option>
              ))}
          </Select>
        </Field>
        <Field label="PAN" htmlFor="panNumber" error={errors.panNumber?.message} hint="Printed on payslips and Form 16.">
          <Input id="panNumber" autoComplete="off" maxLength={10} className="uppercase" {...register('panNumber')} invalid={!!errors.panNumber} />
        </Field>
        <Field label="UAN" htmlFor="uanNumber" error={errors.uanNumber?.message} hint="Universal Account Number for PF (12 digits).">
          <Input id="uanNumber" inputMode="numeric" autoComplete="off" maxLength={12} {...register('uanNumber')} invalid={!!errors.uanNumber} />
        </Field>
        <Field label="PF number" htmlFor="pfNumber" error={errors.pfNumber?.message}>
          <Input id="pfNumber" autoComplete="off" maxLength={30} className="uppercase" {...register('pfNumber')} invalid={!!errors.pfNumber} />
        </Field>
      </div>
      <p className="text-xs text-muted">Bank details are kept separately (encrypted) on the Bank salary payments page.</p>
      <div className="flex justify-end gap-2 border-t border-line pt-4">
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" loading={isSubmitting}>
          {employee ? 'Save changes' : 'Create employee'}
        </Button>
      </div>
    </form>
  );
}
