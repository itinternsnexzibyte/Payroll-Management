'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, MailCheck } from 'lucide-react';
import { ApiError, get, post } from '../lib/api';
import { cn } from '../lib/format';
import { Alert, Button, Field, Input } from '../components/primitives';

export interface SignupConfig {
  enabled: boolean;
  requiresApproval: boolean;
  devMailbox: boolean;
  emailConfigured: boolean;
}

export const useSignupConfig = () =>
  useQuery({ queryKey: ['signup-config'], queryFn: () => get<SignupConfig>('/auth/signup/config'), staleTime: 60_000, retry: false });

type Step = 'email' | 'code' | 'password' | 'done';
const STEPS: { id: Step; label: string }[] = [
  { id: 'email', label: 'Email' },
  { id: 'code', label: 'Verify' },
  { id: 'password', label: 'Password' },
];
const strongPassword = (p: string) => p.length >= 10 && /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p);

function Stepper({ step }: { step: Step }) {
  const idx = step === 'done' ? STEPS.length : STEPS.findIndex((s) => s.id === step);
  return (
    <ol className="flex items-center gap-2" aria-label="Sign-up progress">
      {STEPS.map((s, i) => (
        <li key={s.id} className="flex items-center gap-2" aria-current={i === idx ? 'step' : undefined}>
          <span className={cn('flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold', i < idx ? 'bg-wine text-white' : i === idx ? 'bg-burgundy text-white' : 'bg-blush text-muted')}>{i + 1}</span>
          <span className={cn('text-xs font-medium', i === idx ? 'text-burgundy' : 'text-muted')}>{s.label}</span>
          {i < STEPS.length - 1 && <span className="h-px w-6 bg-line" aria-hidden />}
        </li>
      ))}
    </ol>
  );
}

/** Split-screen sign-up: email → 6-digit code sent by email → name and password. */
export function SignupScreen({ appName, tagline, company, logo, features }: { appName: string; tagline: string; company: string; logo: ReactNode; features: string[] }) {
  const router = useRouter();
  const cfg = useSignupConfig();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [token, setToken] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [requiresApproval, setRequiresApproval] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);
  useEffect(() => {
    if (step === 'code') codeRef.current?.focus();
  }, [step]);

  const fail = (e: unknown) => {
    if (e instanceof ApiError) {
      const map = e.fieldMap();
      // The code field's message explains attempts left / expiry, so show the full server message.
      if (map.code) map.code = e.message;
      setErrors(map);
      setFormError(e.fields.length ? null : e.message);
      const wait = e.details.retryAfterSeconds;
      if (typeof wait === 'number') setCooldown(wait);
      if (e.details.reason === 'SIGNUP_EXPIRED') {
        setStep('email');
        setCode('');
      }
    } else setFormError('Something went wrong. Please try again.');
  };

  const sendCode = async (e?: FormEvent) => {
    e?.preventDefault();
    setErrors({});
    setFormError(null);
    setInfo(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setErrors({ email: 'Enter a valid email address.' });
    setBusy(true);
    try {
      const r = await post<{ message: string; resendAfterSeconds: number }>('/auth/signup/start', { email: email.trim() });
      setCooldown(r.resendAfterSeconds);
      setInfo(r.message);
      setStep('code');
      setCode('');
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    if (!/^\d{6}$/.test(code)) return setErrors({ code: 'Enter the 6-digit code.' });
    setBusy(true);
    try {
      const r = await post<{ signupToken: string }>('/auth/signup/verify', { email: email.trim(), code });
      setToken(r.signupToken);
      setInfo(null);
      setStep('password');
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const complete = async (e: FormEvent) => {
    e.preventDefault();
    const fe: Record<string, string> = {};
    if (name.trim().length < 2) fe.name = 'Enter your full name.';
    if (!strongPassword(password)) fe.password = 'Use at least 10 characters with upper- and lower-case letters and a digit.';
    if (confirm !== password) fe.confirm = 'The passwords do not match.';
    setErrors(fe);
    setFormError(null);
    if (Object.keys(fe).length) return;
    setBusy(true);
    try {
      const r = await post<{ requiresApproval: boolean }>('/auth/signup/complete', { signupToken: token, name: name.trim(), password });
      setRequiresApproval(r.requiresApproval);
      setPassword('');
      setConfirm('');
      setStep('done');
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const disabled = cfg.data && !cfg.data.enabled;

  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-burgundy p-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          {logo}
          <span className="text-xs uppercase tracking-[0.18em] text-rose">{company}</span>
        </div>
        <div className="relative z-10 max-w-md">
          <h1 className="text-3xl font-semibold leading-tight">{appName}</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-blush/90">{tagline}</p>
          <ul className="mt-8 space-y-3 text-sm text-blush/90">
            {features.map((f) => (
              <li key={f} className="flex items-start gap-3">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-rose" aria-hidden />
                {f}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-rose/80">Your email address is verified before an account is created.</p>
        <div className="pointer-events-none absolute -bottom-32 -right-32 h-96 w-96 rounded-full border border-wine/60" aria-hidden />
        <div className="pointer-events-none absolute -bottom-16 -right-16 h-64 w-64 rounded-full border border-wine/40" aria-hidden />
      </div>
      <div className="flex items-center justify-center bg-white px-6 py-12">
        <div className="w-full max-w-sm space-y-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rose lg:hidden">{company}</p>
            <h2 className="mt-1 text-2xl font-semibold text-burgundy">Create your account</h2>
            <p className="mt-1 text-sm text-muted">for {appName}</p>
          </div>

          {disabled ? (
            <Alert tone="warning">Self-service sign-up is turned off. Ask an administrator to create your account.</Alert>
          ) : (
            <>
              {step !== 'done' && <Stepper step={step} />}
              {formError && <Alert tone="danger">{formError}</Alert>}
              {info && step === 'code' && (
                <Alert tone="info" title="Check your email">
                  We sent a 6-digit code to <strong>{email.trim()}</strong>. It expires in 10 minutes.
                  {cfg.data?.devMailbox && <span className="mt-1 block text-xs">Development mode: no email server is configured, so the message was saved in the API&apos;s dev-mailbox folder.</span>}
                </Alert>
              )}

              {step === 'email' && (
                <form onSubmit={sendCode} className="space-y-5" noValidate>
                  <Field label="Email" htmlFor="su-email" error={errors.email} required hint="We will email you a verification code.">
                    <Input id="su-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} invalid={!!errors.email} autoFocus />
                  </Field>
                  <Button type="submit" className="w-full" loading={busy} disabled={cooldown > 0}>
                    {cooldown > 0 ? `Wait ${cooldown}s` : 'Send verification code'}
                  </Button>
                </form>
              )}

              {step === 'code' && (
                <form onSubmit={verify} className="space-y-5" noValidate>
                  <Field label="6-digit verification code" htmlFor="su-code" error={errors.code} required>
                    <Input
                      id="su-code"
                      ref={codeRef}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      className="text-center text-xl font-semibold tracking-[0.5em]"
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      invalid={!!errors.code}
                    />
                  </Field>
                  <Button type="submit" className="w-full" loading={busy}>
                    Verify code
                  </Button>
                  <div className="flex items-center justify-between text-sm">
                    <button type="button" className="text-wine hover:underline" onClick={() => (setStep('email'), setErrors({}), setInfo(null))}>
                      Change email
                    </button>
                    <button type="button" className="text-wine hover:underline disabled:text-muted disabled:no-underline" disabled={cooldown > 0 || busy} onClick={() => sendCode()}>
                      {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
                    </button>
                  </div>
                </form>
              )}

              {step === 'password' && (
                <form onSubmit={complete} className="space-y-5" noValidate>
                  <p className="flex items-center gap-2 text-sm text-success">
                    <MailCheck className="h-4 w-4" aria-hidden /> {email.trim()} verified
                  </p>
                  <Field label="Full name" htmlFor="su-name" error={errors.name} required>
                    <Input id="su-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} invalid={!!errors.name} autoFocus />
                  </Field>
                  <Field label="Password" htmlFor="su-pw" error={errors.password} required hint="At least 10 characters with upper- and lower-case letters and a digit.">
                    <Input id="su-pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} invalid={!!errors.password} />
                  </Field>
                  <Field label="Confirm password" htmlFor="su-confirm" error={errors.confirm} required>
                    <Input id="su-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} invalid={!!errors.confirm} />
                  </Field>
                  <Button type="submit" className="w-full" loading={busy}>
                    Sign up
                  </Button>
                </form>
              )}

              {step === 'done' && (
                <div className="space-y-4 text-center">
                  <CheckCircle2 className="mx-auto h-10 w-10 text-success" aria-hidden />
                  <h3 className="text-lg font-semibold text-burgundy">Account created</h3>
                  <p className="text-sm text-muted">
                    {requiresApproval ? 'An administrator must approve your account before you can sign in.' : 'Your account is ready. Sign in with your email and password.'}
                  </p>
                  <Button className="w-full" onClick={() => router.replace('/login')}>
                    Go to sign in
                  </Button>
                </div>
              )}
            </>
          )}

          {step !== 'done' && (
            <p className="text-center text-sm text-muted">
              Already have an account?{' '}
              <Link href="/login" className="font-medium text-wine hover:underline">
                Sign in
              </Link>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
