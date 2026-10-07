# InTouch project

## Product

A multi-business CRM. Each business owner signs up, creates a private workspace, and will authorize their own WhatsApp Business, Facebook Page, and Instagram professional account. Other businesses must not access their records or credentials.

## Milestone 1: local foundation and CRM

- Next.js responsive dashboard, contacts, pipeline, tasks, inbox preview, and channel setup screens.
- Real Supabase accounts and persistent contact, deal, and task storage; no demo fallback.
- Supabase sign-up/sign-in UI and workspace creation/switching.
- NestJS authenticated contact/deal/task create, update, delete, and state endpoints.
- SQL schema and membership RLS, transactional workspace bootstrap, and workspace-scoped relationships.
- Database isolation and browser workflow tests.

Supabase project `intouch-dev` (`qsecrqhxqfesdvintdmy`, us-east-1) is provisioned and the initial migration is applied. Sign-in/registration, password recovery, and private workspaces use this project. Email confirmation is enabled. The API does not contain an outbound message endpoint or allow clients to fabricate channel connections. Meta setup remains pending.

## Next milestones

CRM workflows are implemented: contact tags, assignees, notes and activity history; owner/member/viewer team access with expiring invitation links; assigned follow-ups and date filters; validated CSV preview/import; editable pipeline stages. The additive workflow migration is applied to the development database. See README for limits and local invitation sharing behavior.

Business modules are implemented independently of Meta: full-database sales/workload reports and CSV export; transactional follow-up rules; printable USD quotes; internal appointment scheduling with collision prevention and calendar export; support tickets with priorities, assignees, and resolution tracking. Migrations through `202610060004` are applied. Public booking, outgoing notifications, attachments, and lead-capture forms remain future work.

1. Complete email delivery configuration and verify real signup/confirmation and password recovery delivery before opening registration to other businesses.
2. Add pagination and account lifecycle flows. Invitations and owner/member/viewer management are implemented.
3. Implement and validate Meta authorization per business, token encryption, account selection, disconnection, webhook verification/routing/idempotency, and outbound delivery/status handling.
4. Validate provider eligibility and permissions using approved test accounts; complete required review before third-party businesses onboard.
5. Deploy only after the above gates pass and operational settings are configured.

## Architecture

`apps/web` is the Next.js client; `apps/api` owns CRM mutations; `supabase/migrations` owns the database schema. The browser holds the Supabase user session and calls the API using its bearer token. The API validates the user through Supabase Auth and forwards that user's authorization to the database, so ordinary operations never bypass RLS.

Sample data and the local demo have been removed. All CRM data belongs to authenticated Supabase workspaces. No existing IterateView project credentials or customer data were copied.
