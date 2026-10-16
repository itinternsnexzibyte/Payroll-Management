# Sign-up with email verification

The application offers self-service sign-up. The flow has three steps; the screen is
`/signup` and a "Create an account" link appears on the sign-in page.

1. **Email** — the person enters their email address; the server emails a 6-digit code.
2. **Verify** — they enter the code. A short-lived (15 minute) one-time sign-up token is issued.
3. **Password** — they enter their name and a password (10+ characters with upper case, lower
   case and a digit, confirmed twice) and the account is created. They then sign in normally.

There is **no administrator approval step** by default: a verified email becomes an active
account with the standard Payroll User role. Administrators
can change a user's role or disable the account afterwards in Users. Approval can be switched back
on with `SIGNUP_REQUIRE_APPROVAL=true`; the account is then created as `PENDING` and cannot sign
in (the sign-in page says it is awaiting approval). There is no approval screen yet, so for now
a pending account would have to be activated by an administrator editing the user's status.

> **Security note.** The default role can see salary amounts . Without restrictions, anyone who can receive email at any address can create an
> account. Set `SIGNUP_ALLOWED_DOMAINS=yourcompany.com` to accept only company email addresses,
> or set `SIGNUP_ENABLED=false` to turn self-service sign-up off entirely.

## Settings (per API, in `.env`)

| Variable | Default | Meaning |
|---|---|---|
| `SIGNUP_ENABLED` | `false` (the `.env.example` sets `true` for development) | Turns the sign-up endpoints and screen on |
| `SIGNUP_ALLOWED_DOMAINS` | empty (any) | Comma-separated list of permitted email domains |
| `SIGNUP_REQUIRE_APPROVAL` | `false` | New accounts wait as `PENDING` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` | empty / 587 | Outgoing email server. **Required in production.** |
| `MAIL_FROM` | `NexziByte <no-reply@example.invalid>` | Sender shown on emails (use a real, authorised address) |

**Development without an email server:** leave `SMTP_HOST` empty. Each email is then written as a
JSON file to `<STORAGE_DIR>/dev-mailbox/` (for example `apps/payroll-api/storage/dev-mailbox/`),
and the sign-up screen says so. In production, with no `SMTP_HOST`, sending is refused with a
clear error instead of silently dropping or logging codes.

Gmail / Google Workspace example: `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_SECURE=false`,
`SMTP_USER=<mailbox>`, `SMTP_PASSWORD=<app password>`. Microsoft 365: `smtp.office365.com`, port 587.

## Protections

- Codes are random 6-digit values, stored only as bcrypt hashes, valid for 10 minutes.
- At most 5 wrong attempts per code; a new code is needed afterwards.
- One code per address per 60 seconds, and at most 5 per hour; plus a per-IP rate limit on `/auth/signup/*`.
- The sign-up token is single-use, valid 15 minutes, stored only as a SHA-256 hash.
- Responses never reveal whether an address already has an account: existing users get a
  "you already have an account" email instead of a code, with the same on-screen message.
- Account creation consumes the verification inside one transaction, so a token cannot create two accounts.
- All steps are audit-logged (`signup.code_sent`, `signup.code_failed`, `signup.email_verified`,
  `signup.account_created`, `signup.requested_existing`); codes and tokens are never logged.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/auth/signup/config` | Whether sign-up is available (public) |
| `POST` | `/auth/signup/start` | `{ email }` — send the code |
| `POST` | `/auth/signup/verify` | `{ email, code }` — returns `{ signupToken }` |
| `POST` | `/auth/signup/complete` | `{ signupToken, name, password }` — creates the account |

Tests: `apps/*-api/test/integration/signup.test.ts` (11 cases) and `e2e/tests/signup.spec.ts`
(the full browser flow).