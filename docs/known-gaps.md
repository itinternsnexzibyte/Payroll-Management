# Known gaps

## Blocked on client inputs (must be resolved before production use)

| Area | Gap | Safeguard in place |
|---|---|---|
| Formulas | No client formula is implemented; `FORMULA_REGISTRY` is empty | FORMULA components block calculation; `PAYROLL_RULES_APPROVED=false` labels all amounts provisional |
| Reconciliation | No test against real Excel sample months | The engine is unit-tested for mechanics only |
| Payslip and report layouts | Internal provisional layouts | Banner and watermark until `PAYSLIP_FORMAT_APPROVED=true` |
| Real data | Only synthetic demo data in the development seed | The seed refuses demo data and dev accounts in production |
| Statutory deductions, attendance, proration, overtime | Not implemented (out of scope until agreed) | Documented |
| Historical months | Import of past payroll not built | Open question P11 |

## Engineering gaps

| Gap | Notes / next step |
|---|---|
| Docker images not built or run | Docker was not available in the development environment; build and smoke-test on the target host |
| No production deployment | Hosting not yet chosen |
| Dependency advisories | `npm audit --omit=dev` reports transitive findings in Prisma CLI tooling (`deepmerge-ts`), puppeteer-core's browser-download helpers (`extract-zip`, `basic-ftp`; the app never downloads browsers), Next's bundled `postcss`/`sharp` (image optimisation not used) and `exceljs` → `uuid` (moderate). Next.js is on 15.5.27, which fixes all Next advisories reported at the time. Upgrade when patched releases are at least two weeks old |
| Email | Sign-up codes use SMTP; a real mail server must be configured before production. No other emails and no password reset by email (administrators reset passwords) |
| Notifications | In-app pending-action notifications only |
| Accessibility | Labels, focus management, keyboard grid navigation and a contrast-checked palette; no formal WCAG audit |
| Payroll alert thresholds | Placeholder defaults (20 % net, 25 % component, 2× outlier, minimum 100, 3–6 months history) until agreed with the client |
| Change requests A, B, F | Built but not in the PDF specification; need approval through the change-request process |
| Deferred change requests | C scenario simulator, D employee document centre, E AI assistant, G operations centre — see [feature-gap-analysis.md](feature-gap-analysis.md) |
| Load testing | Not performed (scale is about 150 employees and a few users) |
