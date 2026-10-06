# Supabase-backed CRM verification

Verified on Windows with Node 24.19.0 and pnpm 12.5.1, October 6, 2026.

- TypeScript checks passed for both applications.
- ESLint passed for both applications.
- Production builds passed for Next.js and NestJS.
- PostgreSQL/PGlite isolation test passed against the actual SQL migration: independent workspace visibility, denied cross-business insert/update/delete, rejected foreign contact links, denied membership escalation and fabricated channel connections, valid shared-member access, immutable workspace assignment, and anonymous access denial.
- Four Playwright tests passed against the configured Supabase development project: real contact creation/edit/deletion; deal and task writes; contact/task persistence across separate browser sessions; denied cross-user reads and writes; sign-out; confirmation and recovery links with a successful password change; mobile sign-in; unauthenticated API rejection.

The application now uses `intouch-dev` (`qsecrqhxqfesdvintdmy`, us-east-1). The initial migration is applied and all eight CRM tables have row-level security enabled. The demo fallback and synthetic records are removed.

Tests create temporary confirmed users and generate signup/recovery links with the test-only administration key; they remove their own accounts and CRM records afterward. No test emails are sent. Email delivery, public registration for users outside the Supabase organization, team invitations, and live Meta messaging remain unverified or unimplemented. Custom SMTP is still needed for external users. The application runs locally; its data and authentication are hosted in Supabase.
