'use client';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CalendarCheck2, Clock, UserMinus, UsersRound } from 'lucide-react';
import { Card, EmptyState, ErrorState, PageHeader, RequirePermission, Spinner, StatCard, errorMessage, formatDateTime, get, humanize, useAuth } from '@nexzi/ui';
import { SimpleBarChart } from '@/components/bar-chart';

interface Overview {
  headcount: { active: number; inactive: number; exited: number };
  byDepartment: { label: string; value: number }[];
  hiring: { month: string; joined: number; left: number }[];
  payrollCost: { period: string; label: string; employees: number; earnings: string; deductions: string; net: string }[] | null;
  attendance: { windowDays: number; presentRate: number | null; totals: { present: number; absent: number; leave: number }; averageWorkingHours: number | null; daily: { date: string; present: number; absent: number; leave: number }[] };
  pendingLeaveRequests: number;
}
interface Activity {
  id: string;
  occurredAt: string;
  actor: string | null;
  action: string;
  entity: string;
}

const axis = { fill: '#6c7293', fontSize: 12 };
const tip = { borderRadius: 8, borderColor: '#e3e7ef', fontSize: 12 };

export default function AnalyticsPage() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['analytics'], queryFn: () => get<Overview>('/analytics/overview') });
  const feed = useQuery({ queryKey: ['analytics-activity'], queryFn: () => get<Activity[]>('/analytics/activity?limit=12'), enabled: can('audit.view') });
  const d = q.data;
  return (
    <RequirePermission permission="reports.view">
      <PageHeader title="Analytics" description="Workforce, payroll cost and attendance trends from live data." breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Analytics' }]} />
      {q.isLoading && <Spinner />}
      {q.error && <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />}
      {d && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Active employees" value={d.headcount.active} hint={`${d.headcount.inactive} inactive · ${d.headcount.exited} exited`} icon={<UsersRound className="h-4 w-4" />} href="/employees?status=ACTIVE" />
            <StatCard
              label={`Attendance rate · ${d.attendance.windowDays} days`}
              value={d.attendance.presentRate === null ? '—' : `${d.attendance.presentRate}%`}
              hint={`${d.attendance.totals.present} present · ${d.attendance.totals.absent} absent · ${d.attendance.totals.leave} leave`}
              icon={<CalendarCheck2 className="h-4 w-4" />}
              href="/attendance"
            />
            <StatCard label="Avg. working hours / day" value={d.attendance.averageWorkingHours === null ? '—' : `${d.attendance.averageWorkingHours} h`} icon={<Clock className="h-4 w-4" />} />
            <StatCard label="Leave requests pending" value={d.pendingLeaveRequests} tone={d.pendingLeaveRequests > 0 ? 'attention' : 'default'} icon={<UserMinus className="h-4 w-4" />} href="/leave" />
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card title="Headcount by department">{d.byDepartment.length === 0 ? <EmptyState title="No active employees" /> : <SimpleBarChart data={d.byDepartment} valueLabel="Employees" />}</Card>
            <Card title="Joiners and leavers — last 12 months">
              <div className="h-56 w-full">
                <ResponsiveContainer>
                  <BarChart data={d.hiring} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="#e3e7ef" />
                    <XAxis dataKey="month" tickLine={false} tick={axis} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={axis} width={28} />
                    <Tooltip contentStyle={tip} />
                    <Legend />
                    <Bar dataKey="joined" name="Joined" fill="#0cb884" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="left" name="Left" fill="#e5484d" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card title="Payroll cost — finalised months">
              {d.payrollCost === null ? (
                <EmptyState title="Amounts hidden" hint="Your role does not include permission to view payroll amounts." />
              ) : d.payrollCost.length === 0 ? (
                <EmptyState title="No finalised payroll yet" hint="Cost trends appear once a month is finalised." />
              ) : (
                <div className="h-56 w-full">
                  <ResponsiveContainer>
                    <LineChart data={d.payrollCost.map((p) => ({ label: p.label, Earnings: Number(p.earnings), Deductions: Number(p.deductions), 'Net pay': Number(p.net) }))} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="#e3e7ef" />
                      <XAxis dataKey="label" tickLine={false} tick={axis} />
                      <YAxis tickLine={false} axisLine={false} tick={axis} width={70} />
                      <Tooltip contentStyle={tip} />
                      <Legend />
                      <Line dataKey="Earnings" stroke="#3b86d1" strokeWidth={2} dot={false} />
                      <Line dataKey="Deductions" stroke="#e5484d" strokeWidth={2} dot={false} />
                      <Line dataKey="Net pay" stroke="#0cb884" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
            <Card title="Daily attendance — last 30 days">
              {d.attendance.daily.length === 0 ? (
                <EmptyState title="No attendance recorded" hint="Daily records appear here once employees check in or an administrator adds them." />
              ) : (
                <div className="h-56 w-full">
                  <ResponsiveContainer>
                    <BarChart data={d.attendance.daily.map((x) => ({ ...x, date: x.date.slice(5) }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="#e3e7ef" />
                      <XAxis dataKey="date" tickLine={false} tick={axis} />
                      <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={axis} width={28} />
                      <Tooltip contentStyle={tip} />
                      <Legend />
                      <Bar dataKey="present" name="Present" stackId="a" fill="#0cb884" />
                      <Bar dataKey="leave" name="Leave" stackId="a" fill="#f5a524" />
                      <Bar dataKey="absent" name="Absent" stackId="a" fill="#e5484d" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
          </div>

          {can('audit.view') && (
            <Card title="Recent activity">
              {feed.isLoading ? (
                <Spinner />
              ) : !feed.data?.length ? (
                <EmptyState title="No activity yet" />
              ) : (
                <ul className="divide-y divide-line text-sm">
                  {feed.data.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span>
                        <strong className="font-medium">{humanize(a.action.replace(/[._]/g, ' '))}</strong> <span className="text-muted">· {a.actor ?? 'system'}</span>
                      </span>
                      <span className="text-xs text-muted">{formatDateTime(a.occurredAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
      )}
    </RequirePermission>
  );
}
