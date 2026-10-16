# Deployment

**Nothing has been deployed.** Hosting is to be provided or approved by the client. No domains,
credentials or hosting accounts are in this repository.

```
Internet ──HTTPS──► Reverse proxy (TLS, HSTS) ──► payroll-web :3001 ──/api──► payroll-api :4001 ──► PostgreSQL "payroll"
```

Only the web container is exposed. The API needs a persistent volume for `STORAGE_DIR`
(payslip PDFs); Chromium is installed in the API image.

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

## Option C — Render (Blueprint)

`render.yaml` defines the database, `payroll-api` (Docker, Chromium included, persistent disk at
`/var/lib/nexzi/storage`) and `payroll-web`. Create it from Dashboard → Blueprints, then fill the
secret values (`SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`, optional `BOOTSTRAP_ADMIN_*`).

- `API_INTERNAL_URL` comes from the API's `hostport` (`payroll-api:10000`); `next.config.ts` adds
  `http://`. It is baked in at build time, so redeploy the web service after changing it. A free
  API instance cannot receive private-network traffic: then set `API_INTERNAL_URL` to its public
  `https://….onrender.com` URL.
- `ALLOWED_ORIGINS` must be the exact public web URL (`https://payroll-web.onrender.com`).
- `TRUST_PROXY=2`: Render's proxy plus the web app's `/api` proxy, so rate limits see the real client.
- Roles are created at API start-up, so sign-up works on a fresh database. Set
  `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` (/ `BOOTSTRAP_ADMIN_NAME`) to create the
  first Administrator at start-up; remove the password afterwards.
- Email: `SMTP_HOST=smtp.gmail.com` (not an address), port 587, `SMTP_SECURE=false`, a Google App
  Password. Free instances block SMTP — use a paid instance or `MAIL_PROVIDER=brevo` (see
  [signup-and-email.md](signup-and-email.md)).

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
