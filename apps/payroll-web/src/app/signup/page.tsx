'use client';
import { Suspense } from 'react';
import { BrandMark, SignupScreen, Spinner } from '@nexzi/ui';

export default function SignupPage() {
  return (
    <Suspense fallback={<Spinner className="min-h-screen" />}>
      <SignupScreen
        appName="Payroll Management"
        company="NexziByte Solutions"
        tagline="Verify your email, choose a password and start managing payroll with confidence."
        logo={<BrandMark letter="P" />}
        features={['Employee master with salary history', 'Review, approval and locked finalisation', 'Payslips and payroll reports']}
      />
    </Suspense>
  );
}