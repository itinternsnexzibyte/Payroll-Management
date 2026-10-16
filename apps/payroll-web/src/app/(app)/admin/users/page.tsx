'use client';
import { UsersAdmin } from '@nexzi/ui';
import { useEmployeeOptions } from '@/lib/hooks';

export default function UsersPage() {
  const employees = useEmployeeOptions();
  return <UsersAdmin employeeOptions={(employees.data?.items ?? []).map((e) => ({ id: e.id, label: `${e.employeeCode} · ${e.fullName}` }))} />;
}
