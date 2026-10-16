'use client';
import { Suspense } from 'react';
import { BrandMark, LoginScreen, Spinner } from '@nexzi/ui';

export default function LoginPage() {
  return (
    <Suspense fallback={<Spinner className="min-h-screen" />}>
      <LoginScreen
        appName="Payroll Management"
        company="NexziByte Solutions"
        tagline="A structured, auditable replacement for the monthly payroll workbook — built so anyone authorised can run payroll with confidence."
        brandLogo={{ light: '/brand/nexzibyte-logo-light.png', dark: '/brand/nexzibyte-logo.png', alt: 'NexziByte Solutions Pvt Ltd' }}
        logo={<BrandMark letter="P" />}
        features={['Employee master with salary history', 'Excel-like monthly input grid', 'Review, approval and locked finalisation', 'Payslips and payroll reports']}
      />
    </Suspense>
  );
}
