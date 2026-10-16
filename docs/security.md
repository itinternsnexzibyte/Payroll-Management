# Security

| Control | Implementation |
|---|---|
| Passwords | bcrypt (cost 12). Policy: at least 10 characters with upper case, lower case and a digit. Temporary passwords must be changed at first sign-in |
| Sign-in protection | The same error for an unknown user and a wrong password. The account locks after 5 failures for 15 minutes (configurable). Login is rate-limited per IP, and there is a global API rate limit |
| Sessions | A 256-bit random token in an `HttpOnly`, `SameSite=Strict` cookie (`Secure` with the `__Host-` prefix in production); only its SHA-256 is stored. Idle expiry 30 min, absolute expiry 8 h. Revoked on logout, account disable, role change and password change/reset |
| Authorisation | Every route declares its permission(s), checked on the server for each request. Hiding UI elements is only a convenience |
| CSRF | SameSite=Strict, plus an Origin/Referer allow-list for every non-GET request |
| Validation | Zod schemas for params, query and body. Decimal strings are validated; sort fields are whitelisted; queries are parameterised |
| XSS | React escaping and Handlebars escaping in PDFs. CSP headers on the API, and on the web app in production |
| PDF rendering | Headless Chromium with JavaScript disabled and all non-`data:` requests blocked |
| Files | Uploads: extension allow-list, XLSX magic-byte check, 5 MB limit, parsed in memory and never executed or stored publicly. Generated PDFs: private directory, random keys, permission-checked endpoints |
| Exports | Cells starting with `= + - @ TAB CR` are neutralised to prevent formula injection |
| Data minimisation | Salary amounts require `payroll.view_amounts`. The optional Viewer role sees no amounts unless granted |
| Logging | Structured JSON. No request bodies, query strings, cookies or auth headers; amounts are not written into calculation audit metadata |
| Audit | Append-only table (DB trigger). Covers sign-ins and lockouts, user/role changes, employee and salary changes (old → new), settings, the payroll lifecycle with reasons, imports, exports and downloads. Only users with `audit.view` can read it |
| Integrity | DB triggers make finalised payroll results and salary values immutable |
| Secrets | Only in environment variables. `.env` is git-ignored. Production refuses insecure cookies and the development seed accounts |

Recommendations: terminate HTTPS at a reverse proxy and set `TRUST_PROXY` to match; use a
least-privilege database user; run `npm audit` regularly (see [known-gaps.md](known-gaps.md)).
