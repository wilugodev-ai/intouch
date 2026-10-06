# Initial local verification

Verified on Windows with Node 24.19.0 and pnpm 12.5.1, October 6, 2026.

- TypeScript checks passed for both applications.
- ESLint passed for both applications.
- Production builds passed for Next.js and NestJS.
- PostgreSQL/PGlite isolation test passed against the actual SQL migration: independent workspace visibility, denied cross-business insert/update/delete, rejected foreign contact links, denied membership escalation and fabricated channel connections, valid shared-member access, immutable workspace assignment, and anonymous access denial.
- Five Playwright tests passed: contact creation/edit/search/delete and reload persistence; deal-stage and task completion persistence; local-only demo reply and honest channel setup; mobile viewport layout; API authentication rejection.

The browser tests use the synthetic preview. No live Supabase project or Meta developer application was configured. Live signup/confirmation, session lifecycle, API-to-Supabase access, and actual social messaging remain unverified. This is the first local CRM milestone, not a production release.
