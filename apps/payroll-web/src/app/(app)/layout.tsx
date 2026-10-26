'use client';
import { Suspense } from 'react';
import { ArrowLeftRight, Banknote, BarChart3, Bell, BookOpen, Building2, CalendarCheck2, CalendarDays, CalendarRange, ClipboardList, FileSpreadsheet, FileText, Gift, HandCoins, Landmark, LayoutDashboard, LineChart, RadioTower, ScrollText, Settings2, ShieldAlert, ShieldCheck, Upload, UserRound, Users, UsersRound, Wallet } from 'lucide-react';
import { SearchPalette } from '@/components/search-palette';
import { AppShell, BrandMark, Spinner, useAuth, type NavItem } from '@nexzi/ui';

const NAV: NavItem[] = [
  { label: 'Dashboard', href: '/', icon: LayoutDashboard, permission: 'payroll.view' },
  { label: 'My payslips', href: '/my', icon: FileText, permission: 'self.service', section: 'My account', when: (u) => Boolean(u.employeeLinked) },
  { label: 'My account', href: '/my/account', icon: UserRound, permission: 'self.service', section: 'My account', when: (u) => Boolean(u.employeeLinked) },
  { label: 'My leave', href: '/my/leave', icon: CalendarDays, permission: 'self.service', section: 'My account', when: (u) => Boolean(u.employeeLinked) },
  { label: 'My attendance', href: '/my/attendance', icon: CalendarCheck2, permission: 'self.service', section: 'My account', when: (u) => Boolean(u.employeeLinked) },
  { label: 'Notifications', href: '/notifications', icon: Bell, permission: 'notifications.view', section: 'My account', when: (u) => Boolean(u.employeeLinked) },
  { label: 'Payroll runs', href: '/payroll', icon: CalendarCheck2, permission: 'payroll.view', section: 'Payroll' },
  { label: 'Payroll alerts', href: '/alerts', icon: ShieldAlert, permission: 'payroll.view_amounts', section: 'Payroll' },
  { label: 'Reconciliation', href: '/reconciliation', icon: ArrowLeftRight, permission: 'reports.view', section: 'Payroll' },
  { label: 'Analytics', href: '/analytics', icon: LineChart, permission: 'reports.view', section: 'Payroll' },
  { label: 'Reports', href: '/reports', icon: BarChart3, permission: 'reports.view', section: 'Payroll' },
  { label: 'Bank salary payments', href: '/bank', icon: Banknote, permission: ['bank.view', 'bank.manage', 'bank.export'], section: 'Payroll' },
  { label: 'Loans & advances', href: '/advances', icon: HandCoins, permission: 'loans.manage', section: 'Payroll' },
  { label: 'Bonuses & incentives', href: '/bonuses', icon: Gift, permission: ['bonuses.manage', 'payroll.approve'], section: 'Payroll' },
  { label: 'Employees', href: '/employees', icon: UsersRound, permission: 'employees.view', section: 'People' },
  { label: 'Clients', href: '/clients', icon: Building2, permission: 'clients.view', section: 'People' },
  { label: 'Work assignments', href: '/assignments', icon: ClipboardList, permission: ['workforce.view', 'workforce.submit'], section: 'People' },
  { label: 'Calendar', href: '/calendar', icon: CalendarRange, permission: 'calendar.view', section: 'People' },
  { label: 'Import employees', href: '/employees/import', icon: Upload, permission: 'employees.manage', section: 'People' },
  { label: 'Leave', href: '/leave', icon: CalendarRange, permission: ['leave.view', 'leave.manage', 'leave.approve'], section: 'People' },
  { label: 'Salary components', href: '/salary-components', icon: Wallet, permission: ['salary.view', 'settings.manage'], section: 'Configuration' },
  { label: 'Payroll settings', href: '/settings', icon: Settings2, permission: 'settings.manage', section: 'Configuration' },
  { label: 'Statutory deductions', href: '/statutory', icon: Landmark, permission: 'settings.manage', section: 'Configuration' },
  { label: 'Attendance sync', href: '/attendance-sync', icon: RadioTower, permission: 'integrations.manage', section: 'Configuration' },
  { label: 'Attendance records', href: '/attendance', icon: CalendarDays, permission: 'attendance.view', section: 'Configuration' },
  { label: 'Attendance to payroll', href: '/attendance/payroll', icon: CalendarCheck2, permission: 'attendance.view', section: 'Configuration' },
  { label: 'Departments', href: '/settings/masters', icon: Building2, permission: ['settings.manage', 'employees.manage'], section: 'Configuration' },
  { label: 'Knowledge centre', href: '/knowledge', icon: BookOpen, section: 'Handover' },
  { label: 'Users', href: '/admin/users', icon: Users, permission: 'users.manage', section: 'Administration' },
  { label: 'Roles & permissions', href: '/admin/roles', icon: ShieldCheck, permission: 'users.manage', section: 'Administration' },
  { label: 'Audit log', href: '/admin/audit', icon: ScrollText, permission: 'audit.view', section: 'Administration' },
];

function RulesBanner() {
  const { user } = useAuth();
  if (!user || user.rulesApproved) return null;
  return (
    <div className="no-print border-b border-warning/20 bg-warning-bg px-6 py-2 text-center text-xs text-warning">
      <FileSpreadsheet className="mr-1.5 inline h-3.5 w-3.5 align-[-2px]" aria-hidden />
      Calculation rules are <strong>provisional</strong> until reconciled with the client&apos;s approved payroll workbook. Amounts are not authoritative.
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell brand={{ appName: 'Payroll Management', company: 'NexziByte', logo: <BrandMark letter="P" />, logoImage: { src: '/brand/nexzibyte-logo-light.png', alt: 'NexziByte Solutions Pvt Ltd' } }} nav={NAV} banner={<RulesBanner />}>
      <Suspense fallback={<Spinner />}>{children}</Suspense>
      <SearchPalette />
    </AppShell>
  );
}
