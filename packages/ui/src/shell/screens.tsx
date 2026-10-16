'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, post } from '../lib/api';
import { Alert, Button, Field, Input } from '../components/primitives';
import { useSignupConfig } from './signup';
import { useToast } from '../components/feedback';
import { useAuth } from './auth';
import { AmbientBackground, BrandPanelArt } from '../components/effects';

/** Sign-in screen with lockout / expiry messaging. */
export function LoginScreen({ appName, tagline, company, logo, features }: { appName: string; tagline: string; company: string; logo: ReactNode; features: string[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const expired = params.get('expired') === '1';
  const signupCfg = useSignupConfig();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const fe: typeof errors = {};
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) fe.email = 'Enter a valid email address.';
    if (!password) fe.password = 'Enter your password.';
    setErrors(fe);
    setFormError(null);
    if (Object.keys(fe).length) return;
    setBusy(true);
    try {
      const res = await post<{ user: { mustChangePassword: boolean } }>('/auth/login', { email: email.trim(), password });
      qc.clear();
      const next = params.get('next');
      router.replace(res.user.mustChangePassword ? '/change-password' : next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Sign-in failed. Please try again.');
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-navy p-12 text-white lg:flex">
        <BrandPanelArt />
        <div className="relative z-10 flex items-center gap-3">
          {logo}
          <span className="text-xs uppercase tracking-[0.18em] text-accent">{company}</span>
        </div>
        <div className="fx-enter relative z-10 max-w-md">
          <h1 className="text-4xl font-semibold leading-[1.1] tracking-[-0.02em]">{appName}</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-haze">{tagline}</p>
          <ul className="mt-8 space-y-3 text-sm text-white/85">
            {features.map((f) => (
              <li key={f} className="flex items-start gap-3">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent shadow-[0_0_8px_rgb(12_184_132/0.9)]" aria-hidden />
                {f}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative z-10 text-xs text-haze/80">Authorised users only. Activity is recorded in the audit trail.</p>
                      </div>
      <div className="relative flex items-center justify-center overflow-hidden bg-surface px-6 py-12">
        <AmbientBackground className="!absolute" />
        <form onSubmit={submit} className="fx-enter relative z-10 w-full max-w-sm space-y-5 rounded-2xl border border-white bg-white/80 p-8 shadow-[0_30px_60px_-30px_rgb(30_64_175/0.35)] backdrop-blur-xl" noValidate>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-ink lg:hidden">{company}</p>
            <h2 className="mt-1 text-[28px] font-semibold tracking-[-0.02em] text-ink">Sign in</h2>
            <p className="mt-1 text-sm text-muted">to {appName}</p>
          </div>
          {expired && <Alert tone="warning">Your session expired. Please sign in again.</Alert>}
          {formError && <Alert tone="danger">{formError}</Alert>}
          <Field label="Email" htmlFor="email" error={errors.email} required>
            <Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} invalid={!!errors.email} autoFocus />
          </Field>
          <Field label="Password" htmlFor="password" error={errors.password} required>
            <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} invalid={!!errors.password} />
          </Field>
          <Button type="submit" className="w-full" loading={busy}>
            Sign in
          </Button>
          <p className="text-center text-xs text-muted">Forgotten your password? Ask an administrator to reset it.</p>
          {signupCfg.data?.enabled && (
            <p className="border-t border-line pt-4 text-center text-sm text-muted">
              New here?{' '}
              <Link href="/signup" className="font-medium text-cobalt hover:underline">
                Create an account
              </Link>
            </p>
          )}
        </form>
      </div>
    </div>
  );
}

export function ChangePasswordScreen() {
  const { user, refresh, logout } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const forced = user?.mustChangePassword;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const fe: Record<string, string> = {};
    if (!form.currentPassword) fe.currentPassword = 'Enter your current password.';
    if (form.newPassword.length < 10 || !/[a-z]/.test(form.newPassword) || !/[A-Z]/.test(form.newPassword) || !/\d/.test(form.newPassword))
      fe.newPassword = 'Use at least 10 characters with upper- and lower-case letters and a digit.';
    if (form.confirm !== form.newPassword) fe.confirm = 'The passwords do not match.';
    setErrors(fe);
    if (Object.keys(fe).length) return;
    setBusy(true);
    try {
      await post('/auth/change-password', { currentPassword: form.currentPassword, newPassword: form.newPassword });
      toast.success('Password changed. Other sessions were signed out.');
      await refresh();
      router.replace('/');
    } catch (err) {
      if (err instanceof ApiError && err.fields.length) setErrors(err.fieldMap());
      else toast.error(err instanceof ApiError ? err.message : 'Could not change the password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md">
      <div className="rounded-[var(--radius-card)] border border-line bg-white p-6 shadow-[var(--shadow-card)]">
        <h1 className="text-xl font-semibold text-primary">Change password</h1>
        {forced && (
          <Alert tone="warning" className="mt-4">
            For security, you must set a new password before continuing.
          </Alert>
        )}
        <form onSubmit={submit} className="mt-5 space-y-4" noValidate>
          <Field label="Current password" htmlFor="cur" error={errors.currentPassword} required>
            <Input id="cur" type="password" autoComplete="current-password" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} invalid={!!errors.currentPassword} />
          </Field>
          <Field label="New password" htmlFor="new" error={errors.newPassword} hint="At least 10 characters, with upper- and lower-case letters and a digit." required>
            <Input id="new" type="password" autoComplete="new-password" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} invalid={!!errors.newPassword} />
          </Field>
          <Field label="Confirm new password" htmlFor="confirm" error={errors.confirm} required>
            <Input id="confirm" type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} invalid={!!errors.confirm} />
          </Field>
          <div className="flex justify-between gap-2 pt-2">
            {forced ? (
              <Button variant="ghost" onClick={() => void logout()}>
                Sign out
              </Button>
            ) : (
              <Link href="/" className="inline-flex h-10 items-center px-2 text-sm text-cobalt hover:underline">
                Cancel
              </Link>
            )}
            <Button type="submit" loading={busy}>
              Update password
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function NotFoundScreen() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <p className="text-5xl font-semibold text-haze">404</p>
      <h1 className="text-xl font-semibold text-primary">Page not found</h1>
      <p className="max-w-sm text-sm text-muted">The page you are looking for does not exist or has moved.</p>
      <Link href="/" className="text-sm font-medium text-cobalt hover:underline">
        Go to dashboard
      </Link>
    </div>
  );
}

export function ErrorScreen({ reset }: { reset: () => void }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <h1 className="text-xl font-semibold text-primary">Something went wrong</h1>
      <p className="max-w-sm text-sm text-muted">An unexpected error occurred while showing this page. Your saved data is safe.</p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
