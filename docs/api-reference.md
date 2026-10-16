# API reference

- Swagger UI: http://localhost:4001/docs · OpenAPI JSON: http://localhost:4001/openapi.json
- Exported copies: [openapi/payroll.json](openapi/payroll.json) and the
  [endpoint table](openapi/payroll-endpoints.md) (68 operations, with required permissions)

The docs are generated from the same route declarations that enforce validation and
permissions. From the browser, endpoints are reached under the web app's `/api` prefix
(for example `http://localhost:3001/api/employees`).

## Conventions

- **Auth:** `POST /auth/login` sets the session cookie. All other endpoints except `/health`,
  `/ready`, `/docs` and `/openapi.json` require it. `GET /auth/me` returns the role and
  permissions; the server re-checks them on every request.
- **CSRF:** state-changing requests must send an `Origin` (or `Referer`) listed in `ALLOWED_ORIGINS`.
- **Lists:** `?page=1&pageSize=20&sortBy=<field>&sortDir=asc|desc&search=<text>` plus filters,
  returning `{ items, page, pageSize, total, totalPages }`. Sort fields are whitelisted.
- **Money and dates:** decimal amounts are strings (never floats); dates are `YYYY-MM-DD`.
- **Errors:** `{ "error": { "code", "message", "fields": [{ "path", "message" }] } }`. Codes:
  `VALIDATION_ERROR` 400; `UNAUTHENTICATED` / `SESSION_EXPIRED` / `INVALID_CREDENTIALS` 401;
  `FORBIDDEN` / `PASSWORD_CHANGE_REQUIRED` / `CSRF_REJECTED` / `ACCOUNT_DISABLED` 403; `NOT_FOUND` 404;
  `CONFLICT` / `INVALID_STATE` 409; `UNSUPPORTED_FILE` 415; `ACCOUNT_LOCKED` 423; `RATE_LIMITED` 429.
  Messages never contain salary values.
- **Files:** downloads come only from authorised endpoints (`?disposition=inline` to view).
  Uploads are `multipart/form-data`, field `file`, `.csv` or `.xlsx`, up to 5 MB.
- **Regenerate the exports:** `cd apps/payroll-api; npx tsx ../../infra/scripts/export-openapi.ts payroll`
