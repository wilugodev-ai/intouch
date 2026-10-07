# Supabase-backed CRM verification

Verified on Windows with Node 24.19.0 and pnpm 12.5.1, October 6, 2026.

- TypeScript checks passed for both applications.
- ESLint passed for both applications.
- Production builds passed for Next.js and NestJS.
- PostgreSQL/PGlite tests passed against both actual SQL migrations: independent workspace visibility; denied cross-business writes and foreign contact links; denied membership escalation; viewer write denial; assignment clearing and access revocation; verified-email invitation acceptance and replay rejection; append-only activity history; stage renaming with preserved deals and in-use/last-stage deletion protection; atomic and idempotent contact imports; anonymous access denial.
- Five Playwright tests passed against the configured Supabase development project: real contact creation/edit/deletion; deal and task writes; persistence across separate browser sessions; cross-user isolation; sign-out; confirmation and recovery links with password change; mobile sign-in; unauthenticated API rejection; CSV preview/import with duplicate detection; contact tags, notes and history; custom stage rename; invitation acceptance in a second browser session; viewer UI and API write denial; role change; assigned overdue follow-ups and assignment clearing on downgrade.

The application uses `intouch-dev` (`qsecrqhxqfesdvintdmy`, us-east-1). Migrations `202610060001` through `202610060004` are applied and every CRM table has row-level security enabled. The demo fallback and synthetic records are removed.

Business-module verification also passed:

- Two PostgreSQL/PGlite suites now cover the original workflows and the business modules. Checks include transactional task generation, no duplicate execution on unchanged stage, no execution from stage renames, quote rounding and invalid-item rejection, overlapping/adjacent appointments, report totals, cross-tenant denial, viewer permissions, assignment clearing, and derived closure dates for custom default stages.
- Six Playwright tests passed against live Supabase. The added business workflow creates an automation and checks the generated follow-up, saves a quote and verifies its escaped printable document and total, exports a calendar file, rejects a scheduling conflict, resolves a ticket, verifies report counts/CSV export, checks automation history, and checks the mobile ticket layout.
- TypeScript, ESLint, and production builds passed for both applications. No Meta credentials or messaging permissions were needed.

Tests create temporary confirmed users and generate signup/recovery links with the test-only administration key; they remove their own accounts and CRM records afterward. No test emails are sent. Invitation links are tested; invitation emails are not sent by the application. Email delivery and public registration outside the Supabase organization still require custom SMTP. Live Meta authorization and messaging remain unimplemented. The application runs locally; its data and authentication are hosted in Supabase. Public sharing of invitation links requires deployment and a public web origin.
