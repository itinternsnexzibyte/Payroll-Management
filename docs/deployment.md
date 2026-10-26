# Deployment

**Nothing has been deployed.** Hosting is to be provided or approved by the client. No domains,
credentials or hosting accounts are in this repository.

```
Internet ──HTTPS──► Reverse proxy (TLS, HSTS) ──► payroll-web :3001 ──/api──► payroll-api :4001 ──► PostgreSQL "payroll"
```

Only the web container is exposed. The API needs a persistent volume for `STORAGE_DIR`
(payslip PDFs); Chromium is installed in the API image.

## Option R — Render web, API, and PostgreSQL

Use [`infra/render/payroll-api.env.example`](../infra/render/payroll-api.env.example) as a list of
environment variable names and safe example values; it is not a populated secrets file.

1. Create a Render PostgreSQL database and two Render **Web Services** from this repository: one
   for the API and one for the web frontend. Use the same region for all services.
2. Configure the API service to use the repository root as its Docker context and
   `infra/docker/api.Dockerfile` as its Dockerfile. Attach a persistent disk mounted at `/var/data`
   and set `STORAGE_DIR=/var/data/storage`; generated payslip PDFs must not be stored on the
   ephemeral filesystem.
3. Add the variables from the example to the API service. Set `DATABASE_URL` to the Render
   database's **internal** connection URL, `ALLOWED_ORIGINS` to the exact HTTPS origin of the
   Render web service, and `COOKIE_SECURE=true`. Enable `RUN_MIGRATIONS=true`. Use the Render-
   provided `PORT`. Fill in SMTP settings only after selecting an email provider.
4. Configure the web service using repository-root Docker context and
   `infra/docker/web.Dockerfile`. Set its build-time `API_INTERNAL_URL` to the API service's HTTPS
   URL. The web service proxies `/api/*` to the API; users sign in through the web service's
   origin, preserving the secure session cookie and the API's Origin-based CSRF check.
5. Before serving traffic after the first deployment, run
   `npm run db:migrate -w @nexzi/payroll-api` once against the production `DATABASE_URL`, or let
   the API Docker entrypoint run it with `RUN_MIGRATIONS=true`. Keep migrations forward-only.
6. Create the first production Administrator using the documented `BOOTSTRAP_ADMIN_*` process;
   do not set development `SEED_*` accounts in production. Generate a fresh `BANK_DATA_KEY` if
   bank account storage is enabled and retain it securely for the life of the database.
7. Verify the API's `/health` and `/ready` endpoints, then test login and a state-changing request
   through the Render web service.

Use Render's secret/environment settings for all actual database URLs, passwords, and encryption
keys. Do not upload or commit a populated `.env` file. Keep payroll rules and payslip approval
flags `false` until the existing go-live checks are complete. Select an instance plan with persistent
disk support for the API service.

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
