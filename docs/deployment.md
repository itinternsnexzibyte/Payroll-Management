# Deployment

**Nothing has been deployed.** Hosting is to be provided or approved by the client. No domains,
credentials or hosting accounts are in this repository.

```
Internet ──HTTPS──► Reverse proxy (TLS, HSTS) ──► payroll-web :3001 ──/api──► payroll-api :4001 ──► PostgreSQL "payroll"
```

Only the web container is exposed. The API needs a persistent volume for `STORAGE_DIR`
(payslip PDFs); Chromium is installed in the API image.

## Option V — Vercel web frontend + separately hosted API

The Next.js frontend is configured for Vercel in `apps/payroll-web/vercel.json`. Vercel hosts
the web application only. The Payroll API is a long-running Express service and needs PostgreSQL
plus durable private storage for payslip PDFs; those services must run on a separate host with a
persistent volume. Do not deploy the current API as a Vercel Function: its local PDF storage would
not be durable.

1. Create a Vercel project for this repository with `apps/payroll-web` as the Root Directory, and
   enable **Include source files outside of the Root Directory** so the shared UI package is
   available. The checked-in configuration installs dependencies at the workspace root and builds
   `@nexzi/payroll-web`.
2. Deploy the API, PostgreSQL database, and persistent `STORAGE_DIR` on a host that supports a
   continuously running Node.js service and durable volumes. Build with
   `npm run build -w @nexzi/payroll-api`, run database migrations with
   `npm run db:migrate -w @nexzi/payroll-api`, and start with
   `npm run start -w @nexzi/payroll-api`.
3. Set `API_INTERNAL_URL` in the Vercel project's Production environment to the public HTTPS base
   URL of the API (for example, `https://payroll-api.example.com`). This is a server-side rewrite
   destination, not a `NEXT_PUBLIC_*` variable. Vercel builds fail if this URL is missing or not
   HTTPS.
4. On the API host, set `ALLOWED_ORIGINS` to the exact HTTPS origin of the Vercel site (including
   any custom domain), `COOKIE_SECURE=true`, `NODE_ENV=production`, `TRUST_PROXY=1`, the production
   `DATABASE_URL`, and all other required production environment variables below. Never use a
   wildcard origin. Vercel preview URLs must be explicitly allowed if preview deployments need to
   make state-changing API requests; do not broadly allow every preview hostname.
5. After configuring production secrets and migrations, create the first Administrator using the
   documented `BOOTSTRAP_ADMIN_*` process. Do not reuse development seed credentials.

The frontend rewrites `/api/*` through the same Vercel origin to `API_INTERNAL_URL`, preserving the
host-only secure session cookie and the API's Origin-based CSRF check. A Vercel deployment serves
the web app, but it is not production-ready until the API, database, durable storage, email, secrets,
administrator account, and go-live checks below are configured and tested.

## Option R — Render API + PostgreSQL with Vercel frontend

Use [`infra/render/payroll-api.env.example`](../infra/render/payroll-api.env.example) as a list of
environment variable names and safe example values; it is not a populated secrets file.

1. Create a Render PostgreSQL database and a Render **Web Service** from this repository. Use the
   repository root, Runtime **Node**, Build Command `npm ci && npm run build -w @nexzi/payroll-api`,
   and Start Command `npm run start -w @nexzi/payroll-api`.
2. Add a Render persistent disk mounted at `/var/data` and set `STORAGE_DIR=/var/data/storage`.
   Keep generated payslips on this disk; do not rely on the service's ephemeral filesystem.
3. Add the variables from the example to the Render service. Set `DATABASE_URL` to the Render
   database's **internal** connection URL, `ALLOWED_ORIGINS` to the exact Vercel production origin,
   and `COOKIE_SECURE=true`. Use the Render-provided `PORT` (do not hard-code it when configuring
   Render). Fill in SMTP settings only after selecting an email provider.
4. Before serving traffic after the first deployment, run
   `npm run db:migrate -w @nexzi/payroll-api` once against the production `DATABASE_URL`. For later
   deployments, run the same forward-only migrations before the new API version handles traffic.
5. Create the first production Administrator using the documented `BOOTSTRAP_ADMIN_*` process;
   do not set development `SEED_*` accounts in production. Generate a fresh `BANK_DATA_KEY` if
   bank account storage is enabled and retain it securely for the life of the database.
6. Copy the Render API's HTTPS URL into Vercel's `API_INTERNAL_URL`, then deploy the Vercel
   frontend. Verify `https://<render-service>/health` and `/ready`, then test login and a
   state-changing request through the Vercel site.

Use Render's secret/environment settings for all actual database URLs, passwords, and encryption
keys. Do not upload or commit a populated `.env` file. Keep payroll rules and payslip approval
flags `false` until the existing go-live checks are complete.

## Option A — Docker Compose

> The Dockerfiles and compose file have **not yet been built or run**: Docker was not available in
> the development environment. Build and smoke-test them on the target host.

```bash
cp infra/docker/payroll-api.env.example infra/docker/payroll-api.env   # edit DB password and public origin
POSTGRES_PASSWORD='<strong secret>' docker compose --profile app up -d --build
docker compose exec -e BOOTSTRAP_ADMIN_EMAIL=you@client -e BOOTSTRAP_ADMIN_NAME="Your Name" \
  -e BOOTSTRAP_ADMIN_PASSWORD='<temporary strong password>' payroll-api node dist/bootstrap-admin.js
```

`bootstrap-admin` also creates the roles and default permissions. The web image bakes in
`API_INTERNAL_URL` at build time.

## Option B — Node processes

```bash
npm ci
npm run build
npm run db:migrate                                   # with the production DATABASE_URL
node apps/payroll-api/dist/server.js                 # under systemd / PM2 / NSSM
node apps/payroll-web/.next/standalone/apps/payroll-web/server.js   # PORT=3001
```

Copy `apps/payroll-web/.next/static` to `.next/standalone/apps/payroll-web/.next/static` (the
Dockerfile does this).

## Production environment (API)

`NODE_ENV=production`, `DATABASE_URL`, `ALLOWED_ORIGINS` (public HTTPS origin), `COOKIE_SECURE=true`,
`TRUST_PROXY=1`, session and lockout settings, `STORAGE_DIR`, `PDF_BROWSER_PATH` (if needed),
`LOG_LEVEL`, `PAYSLIP_COMPANY_NAME`, and `PAYROLL_RULES_APPROVED` / `PAYSLIP_FORMAT_APPROVED`.
Keep the last two `false` until reconciliation and sign-off are documented. Set
`VIEWER_ROLE_ENABLED` only after the client confirms the role. Web build: `API_INTERNAL_URL`.

## Health, monitoring, migrations

- `GET /health` (liveness) and `GET /ready` (database reachable; the Docker healthcheck uses it).
  Every response has an `x-request-id`. Attach error monitoring in
  `packages/server-core/src/errors.ts` (`errorHandler`).
- Migrations are forward-only (`prisma migrate deploy`), or run at container start with
  `RUN_MIGRATIONS=true`. Back up before every release. To roll back, redeploy the previous build
  and restore the pre-release backup if a migration must be undone. Never edit applied migrations.

## Go-live checklist

- [ ] Hosting, HTTPS and secrets configured; migrations run; first administrator created and their password changed
- [ ] Client components and formulas configured and reconciled against sample months, then `PAYROLL_RULES_APPROVED=true`
- [ ] Client payslip format implemented and approved, then `PAYSLIP_FORMAT_APPROVED=true`
- [ ] Chromium and fonts verified with a test payslip
- [ ] Daily backups scheduled and a restore tested; smoke test done; rollback plan ready
