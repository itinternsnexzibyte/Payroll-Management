'use client';
import { Suspense } from 'react';
import { BarChart3, Building2, CalendarCheck2, FileSpreadsheet, LayoutDashboard, ScrollText, Settings2, ShieldCheck, Upload, Users, UsersRound, Wallet } from 'lucide-react';
import { AppShell, BrandMark, Spinner, useAuth, type NavItem } from '@nexzi/ui';

const NAV: NavItem[] = [
  { label: 'Dashboard', href: '/', icon: LayoutDashboard },
  { label: 'Payroll runs', href: '/payroll', icon: CalendarCheck2, permission: 'payroll.view', section: 'Payroll' },
  { label: 'Reports', href: '/reports', icon: BarChart3, permission: 'reports.view', section: 'Payroll' },
  { label: 'Employees', href: '/employees', icon: UsersRound, permission: 'employees.view', section: 'People' },
  { label: 'Import employees', href: '/employees/import', icon: Upload, permission: 'employees.manage', section: 'People' },
  { label: 'Salary components', href: '/salary-components', icon: Wallet, permission: ['salary.view', 'settings.manage'], section: 'Configuration' },
  { label: 'Payroll settings', href: '/settings', icon: Settings2, permission: 'settings.manage', section: 'Configuration' },
  { label: 'Departments', href: '/settings/masters', icon: Building2, permission: ['settings.manage', 'employees.manage'], section: 'Configuration' },
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
    <AppShell brand={{ appName: 'Payroll', company: 'NexziByte', logo: <BrandMark letter="P" /> }} nav={NAV} banner={<RulesBanner />}>
      <Suspense fallback={<Spinner />}>{children}</Suspense>
    </AppShell>
  );
}
