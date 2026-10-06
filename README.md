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

Without Supabase configuration, the app opens a clearly labeled local preview. Synthetic contacts, deal stages, tasks, and sample replies persist in browser localStorage. No real messages are sent. This browser preview is not a multi-user database and must not be used for private customer data. Clear the `intouch.demo.v1` localStorage key to reset sample records.

## Enable real accounts and CRM storage

1. Create a separate Supabase development project for InTouch.
2. Run `supabase/migrations/202610060001_foundation.sql` in that project's SQL editor. The migration is applied once to a clean project.
3. Copy `apps/web/.env.example` to `apps/web/.env.local` and `apps/api/.env.example` to `apps/api/.env`.
4. Set the same Supabase project URL and publishable key in both files. No service-role key is needed.
5. In Supabase Auth, enable email/password and set the site URL to `http://127.0.0.1:3100`. Keep email confirmation enabled; confirm before signing in.
6. Restart `pnpm dev`. Create an account, confirm your email, sign in, then create a business workspace.

Real accounts start with empty workspaces. All CRM requests use a verified Supabase user access token; row-level security enforces workspace membership. Workspace creation and owner membership happen in one database transaction. Cross-workspace foreign keys are rejected. Workspace IDs cannot be changed on existing CRM records. Only whitelisted fields can be changed through the API.

Multiple independent users can create their own workspaces. The membership schema supports shared access, but invitations, removal of teammates, role management, password recovery, and account deletion UI are not implemented in this milestone.

## Channels

The inbox and channel setup screens are previews. Actual OAuth/Embedded Signup, credential storage, webhook ingestion, and outbound delivery are not implemented. Adding Meta environment variables alone does not enable messaging.

See [Meta integration plan](docs/meta-integrations.md) for the per-business authorization design and external prerequisites.

## Verification

```powershell
pnpm check
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
```

Build before running browser tests. Playwright starts the production web and API processes automatically. PostgreSQL isolation tests use PGlite with a minimal Supabase `auth.uid()` fixture and execute the actual migration. These tests do not replace verification against a configured Supabase project, which is still required before inviting real users.

The first version loads up to 1,000 records from each resource. Pagination, production rate limits, monitoring, delivery jobs, billing, and deployment are later work. All current servers bind to the local machine.
