# InTouch project

## Product

A multi-business CRM. Each business owner signs up, creates a private workspace, and will authorize their own WhatsApp Business, Facebook Page, and Instagram professional account. Other businesses must not access their records or credentials.

## Milestone 1: local foundation and CRM

- Next.js responsive dashboard, contacts, pipeline, tasks, inbox preview, and channel setup screens.
- Functional browser demo with synthetic data and persistence.
- Supabase sign-up/sign-in UI and workspace creation/switching.
- NestJS authenticated contact/deal/task create, update, delete, and state endpoints.
- SQL schema and membership RLS, transactional workspace bootstrap, and workspace-scoped relationships.
- Database isolation and browser workflow tests.

External setup is not present: live Supabase authentication/storage has not been exercised. Messaging is simulated in the demo and disabled for real accounts. The API does not contain an outbound message endpoint or allow clients to fabricate channel connections.

## Next milestones

1. Configure the separate Supabase project and verify signup, confirmation, session refresh, two-user isolation, and workspace switching end to end.
2. Add invitations and membership management, password recovery, pagination, and account lifecycle flows.
3. Implement and validate Meta authorization per business, token encryption, account selection, disconnection, webhook verification/routing/idempotency, and outbound delivery/status handling.
4. Validate provider eligibility and permissions using approved test accounts; complete required review before third-party businesses onboard.
5. Deploy only after the above gates pass and operational settings are configured.

## Architecture

`apps/web` is the Next.js client; `apps/api` owns CRM mutations; `supabase/migrations` owns the database schema. The browser holds the Supabase user session and calls the API using its bearer token. The API validates the user through Supabase Auth and forwards that user's authorization to the database, so ordinary operations never bypass RLS.

The local demo has its own storage key and never seeds an authenticated business workspace. No existing IterateView credentials or customer data were copied.
