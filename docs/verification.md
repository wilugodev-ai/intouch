# Supabase-backed CRM verification

Verified on Windows with Node 24.19.0 and pnpm 12.5.1, October 6, 2026.

- TypeScript checks passed for both applications.
- ESLint passed for both applications.
- Production builds passed for Next.js and NestJS.
- PostgreSQL/PGlite tests passed against both actual SQL migrations: independent workspace visibility; denied cross-business writes and foreign contact links; denied membership escalation; viewer write denial; assignment clearing and access revocation; verified-email invitation acceptance and replay rejection; append-only activity history; stage renaming with preserved deals and in-use/last-stage deletion protection; atomic and idempotent contact imports; anonymous access denial.
- Five Playwright tests passed against the configured Supabase development project: real contact creation/edit/deletion; deal and task writes; persistence across separate browser sessions; cross-user isolation; sign-out; confirmation and recovery links with password change; mobile sign-in; unauthenticated API rejection; CSV preview/import with duplicate detection; contact tags, notes and history; custom stage rename; invitation acceptance in a second browser session; viewer UI and API write denial; role change; assigned overdue follow-ups and assignment clearing on downgrade.

The application uses `intouch-dev` (`qsecrqhxqfesdvintdmy`, us-east-1). All six migrations through `202610070002` are applied and every CRM table has row-level security enabled. The demo fallback and synthetic records are removed.

Business-module verification also passed:

- Two PostgreSQL/PGlite suites now cover the original workflows and the business modules. Checks include transactional task generation, no duplicate execution on unchanged stage, no execution from stage renames, quote rounding and invalid-item rejection, overlapping/adjacent appointments, report totals, cross-tenant denial, viewer permissions, assignment clearing, and derived closure dates for custom default stages.
- Six Playwright tests passed against live Supabase. The added business workflow creates an automation and checks the generated follow-up, saves a quote and verifies its escaped printable document and total, exports a calendar file, rejects a scheduling conflict, resolves a ticket, verifies report counts/CSV export, checks automation history, and checks the mobile ticket layout.
- TypeScript, ESLint, and production builds passed for both applications. No Meta credentials or messaging permissions were needed.

Customer registration verification, October 7, 2026:

- All three database suites passed. Registration tests apply every migration and verify anonymous metadata-only access, denied table reads, pending-only intake, retry safety, invalid birthday/field rejection, owner/member review authorization, viewer denial, cross-workspace denial, duplicate matching, required identity-verification attestation, immutable consent events, withdrawal, consent reset after destination changes, explicitly reviewed renewed consent, stale-form rejection, disabled/rotated links, and the database submission quota.
- All seven live Playwright tests passed. The added test uses separate owner/customer browser sessions, checks unchecked marketing choices, submits an optional leap-day birthday without a birth year, confirms that no contact exists before review, approves a new contact, withdraws consent, prevents unverified updates, approves a verified update, downloads a QR SVG with its quiet zone, and verifies rotated and paused links. Mobile registration was inspected visually and checked for horizontal overflow.
- The registration browser test was rerun against the final destination-consent safeguards. Build, lint and TypeScript checks passed. Tests send no emails or social messages and delete their own temporary fixtures.
- Public deployment, actual phone-camera scanning of a hosted QR link, identity verification through email/SMS, CAPTCHA, and birthday delivery are not claimed as tested or implemented. Current sharing links target this computer; existing-contact verification is an explicit staff attestation.

Tests create temporary confirmed users and generate signup/recovery links with the test-only administration key; they remove their own accounts and CRM records afterward. No test emails are sent. Invitation links are tested; invitation emails are not sent by the application. Email delivery and public registration outside the Supabase organization still require custom SMTP. Live Meta authorization and messaging remain unimplemented. The application runs locally; its data and authentication are hosted in Supabase. Public sharing of invitation links requires deployment and a public web origin.
