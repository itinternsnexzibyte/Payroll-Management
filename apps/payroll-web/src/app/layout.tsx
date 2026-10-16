import type { Metadata } from 'next';
import { AuthProvider, Providers } from '@nexzi/ui';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Payroll Management · NexziByte', template: '%s · Payroll Management' },
  description: 'Payroll Management — employees, salary structures, monthly payroll, payslips and reports.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <AuthProvider>{children}</AuthProvider>
        </Providers>
      </body>
    </html>
  );
}
