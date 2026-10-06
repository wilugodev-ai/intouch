# InTouch

A CRM for independent businesses to manage their own customers, deals, follow-ups, and eventually WhatsApp, Facebook Messenger, and Instagram conversations.

Built with the same stack as IterateView: TypeScript, Next.js/React, NestJS/Node.js, Supabase PostgreSQL/Auth, and pnpm workspaces. IterateView files and credentials are not reused.

## Run locally

Use Node 24.19+ (24.x) and pnpm 12.5.1.

```powershell
cd C:\intouch
pnpm install
pnpm dev
```

- Web: http://127.0.0.1:3100
- API health: http://127.0.0.1:4100/v1/health

The app opens at sign-in and uses Supabase for real accounts and persistent CRM data. No sample records are loaded and no CRM records are stored in browser localStorage. Without Supabase configuration, sign-in remains unavailable instead of falling back to a demo.

The current development project is [intouch-dev](https://supabase.com/dashboard/project/qsecrqhxqfesdvintdmy), in US East. Its initial migration has been applied and local environment files are configured on this workstation. Create an account, confirm your email, sign in, and create your business workspace.

## Enable real accounts and CRM storage

1. Create a separate Supabase development project for InTouch.
2. Run `supabase/migrations/202610060001_foundation.sql` in that project's SQL editor. The migration is applied once to a clean project.
3. Copy `apps/web/.env.example` to `apps/web/.env.local` and `apps/api/.env.example` to `apps/api/.env`.
4. Set the same Supabase project URL and publishable key in both files. No service-role key is needed.
5. In Supabase Auth, enable email/password and set the site URL to `http://127.0.0.1:3100`. Keep email confirmation enabled; confirm before signing in.
6. Restart `pnpm dev`. Create an account, confirm your email, sign in, then create a business workspace.

Real accounts start with empty workspaces. All CRM requests use a verified Supabase user access token; row-level security enforces workspace membership. Workspace creation and owner membership happen in one database transaction. Cross-workspace foreign keys are rejected. Workspace IDs cannot be changed on existing CRM records. Only whitelisted fields can be changed through the API.

Multiple independent users can create their own workspaces. Password reset and password update screens are available through Supabase Auth. Email delivery requires a working Supabase email configuration. The membership schema supports shared access; invitations, removal of teammates, role management, and account deletion UI are still pending.

The built-in Supabase email provider only delivers to organization team addresses. Configure [custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp) before enabling registration for other businesses. Email confirmation remains enabled; the app does not silently bypass it. The automated link tests generate confirmation/recovery links directly and do not test email delivery or send emails.

## Channels

The inbox starts empty. Actual OAuth/Embedded Signup, credential storage, webhook ingestion, and outbound delivery are not implemented. Adding Meta environment variables alone does not enable messaging. CRM contacts, deals, and tasks work independently of messaging.

See [Meta integration plan](docs/meta-integrations.md) for the per-business authorization design and external prerequisites.

## Verification

```powershell
pnpm check
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
```

Build before running browser tests. Playwright starts the production web and API processes automatically. PostgreSQL isolation tests use PGlite with a minimal Supabase `auth.uid()` fixture and execute the actual migration. The live browser test uses a dedicated development project and creates two temporary confirmed accounts, without sending emails. It verifies persistence across separate browser sessions and denies cross-user data access, then removes its own test accounts and records.

For live tests, set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in the ignored root `.env.test.local`. The service-role key is only used by the test runner for creating and cleaning fixtures. The web and API use only the publishable key and authenticated user sessions. Never commit environment files. Without the test configuration, the live test is explicitly skipped.

The first version loads up to 1,000 records from each resource. Pagination, production rate limits, monitoring, delivery jobs, billing, and deployment are later work. All current servers bind to the local machine.
