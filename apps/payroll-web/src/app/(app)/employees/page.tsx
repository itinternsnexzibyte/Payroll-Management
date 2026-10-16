'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Download, Plus, Upload } from 'lucide-react';
import {
  Button,
  ButtonLink,
  Card,
  DataTable,
  EmptyState,
  PageHeader,
  Pagination,
  RequirePermission,
  SearchInput,
  Select,
  StatusBadge,
  Toolbar,
  download,
  errorMessage,
  formatDate,
  get,
  qs,
  useAuth,
  useListParams,
  useToast,
  type Page,
} from '@nexzi/ui';
import { useDepartments } from '@/lib/hooks';
import type { Employee } from '@/lib/types';

export default function EmployeesPage() {
  return (
    <RequirePermission permission="employees.view">
      <EmployeeList />
    </RequirePermission>
  );
}

const FILTERS = { status: '', departmentId: '' };

function EmployeeList() {
  const { can } = useAuth();
  const toast = useToast();
  const list = useListParams({ sortBy: 'employeeCode', sortDir: 'asc', filters: FILTERS });
  const depts = useDepartments();
  const q = useQuery({ queryKey: ['employees', list.query], queryFn: () => get<Page<Employee>>(`/employees${qs(list.query)}`), placeholderData: (p) => p });

  const exportFile = async (format: 'csv' | 'xlsx') => {
    try {
      await download(`/employees/export${qs({ format, search: list.search, ...list.filters })}`, `employees.${format}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <>
      <PageHeader
        title="Employees"
        description="Employee master. Records are deactivated, never deleted, so payroll history stays intact."
        breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Employees' }]}
        actions={
          <>
            <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => exportFile('xlsx')}>
              Export XLSX
            </Button>
            <Button variant="secondary" onClick={() => exportFile('csv')}>
              CSV
            </Button>
            {can('employees.manage') && (
              <>
                <ButtonLink href="/employees/import" variant="secondary" icon={<Upload className="h-4 w-4" />}>
                  Import
                </ButtonLink>
                <ButtonLink href="/employees/new" icon={<Plus className="h-4 w-4" />}>
                  Add employee
                </ButtonLink>
              </>
            )}
          </>
        }
      />
      <Card padded={false}>
        <Toolbar>
          <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search by ID or name" label="Search employees" />
          <Select className="w-44" value={list.filters.status} onChange={(e) => list.setFilter('status', e.target.value)} aria-label="Filter by status">
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
            <option value="EXITED">Exited</option>
          </Select>
          <Select className="w-56" value={list.filters.departmentId} onChange={(e) => list.setFilter('departmentId', e.target.value)} aria-label="Filter by department">
            <option value="">All departments</option>
            {depts.data?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Toolbar>
        <DataTable<Employee>
          caption="Employees"
          rows={q.data?.items}
          rowKey={(e) => e.id}
          loading={q.isLoading}
          error={q.error ? errorMessage(q.error) : null}
          onRetry={() => q.refetch()}
          sortBy={list.sortBy}
          sortDir={list.sortDir}
          onSort={list.toggleSort}
          rowHref={(e) => `/employees/${e.id}`}
          empty={
            <EmptyState
              title={list.search || list.filters.status || list.filters.departmentId ? 'No employees match these filters' : 'No employees yet'}
              hint={can('employees.manage') ? 'Add employees one by one or import them from a spreadsheet.' : undefined}
            />
          }
          columns={[
            { key: 'employeeCode', header: 'Employee ID', sortable: true, render: (e) => <Link className="font-medium text-wine hover:underline" href={`/employees/${e.id}`}>{e.employeeCode}</Link> },
            { key: 'fullName', header: 'Name', sortable: true, render: (e) => e.fullName },
            { key: 'department', header: 'Department', render: (e) => e.department?.name ?? '—' },
            { key: 'designation', header: 'Designation', render: (e) => e.designation?.name ?? '—' },
            { key: 'joiningDate', header: 'Joined', sortable: true, render: (e) => formatDate(e.joiningDate) },
            { key: 'status', header: 'Status', sortable: true, render: (e) => <StatusBadge status={e.status} /> },
          ]}
        />
        {q.data && <Pagination page={q.data.page} totalPages={q.data.totalPages} total={q.data.total} pageSize={q.data.pageSize} onPage={list.setPage} onPageSize={list.setPageSize} />}
      </Card>
    </>
  );
}
