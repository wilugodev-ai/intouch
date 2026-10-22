# Touchlumo

Smarter Connections. Stronger Relationships.

Open [Touchlumo](https://touchlumo.com). The Hostinger domain connects directly to Google Cloud Run with HTTPS. See [domain configuration](docs/domain-google-cloud.md), [remaining launch checks](docs/touchlumo-launch.md), and the [rebrand audit](docs/rebrand-touchlumo.md).

A CRM for independent businesses to manage their customers, deals and follow-ups, with a deployed WhatsApp Business integration. Facebook Messenger and Instagram integration are planned.

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

The current development project is [intouch-dev](https://supabase.com/dashboard/project/qsecrqhxqfesdvintdmy), in US East. All seven migrations are applied and local environment files are configured on this workstation. The WhatsApp release is deployed; server readiness, the real Meta SDK and the active webhook are verified. Real customer-account onboarding and message delivery inside Touchlumo remain to be tested. Create an account, confirm your email, sign in, and create your business workspace.

## Enable real accounts and CRM storage

1. Create a separate Supabase development project for Touchlumo.
2. Apply the files in `supabase/migrations` in filename order, once each, or link the project and run `supabase db push`.
3. Copy `apps/web/.env.example` to `apps/web/.env.local` and `apps/api/.env.example` to `apps/api/.env`.
4. Set the same Supabase project URL and publishable key in both files. No service-role key is needed.
5. In Supabase Auth, enable email/password and set the site URL to `http://127.0.0.1:3100`. Keep email confirmation enabled; confirm before signing in.
6. Restart `pnpm dev`. Create an account, confirm your email, sign in, then create a business workspace.

Real accounts start with empty workspaces. All CRM requests use a verified Supabase user access token; row-level security enforces workspace membership. Workspace creation and owner membership happen in one database transaction. Cross-workspace foreign keys are rejected. Workspace IDs cannot be changed on existing CRM records. Only whitelisted fields can be changed through the API.

Multiple independent users can create their own workspaces. Password reset and password update screens are available through Supabase Auth. Email delivery requires a working Supabase email configuration. Owners can invite teammates, change their role, and remove access. Account deletion UI is still pending.

Password fields include Show/Hide controls. The browser signs users out after 30 minutes without interaction; activity is shared across tabs, and refreshing or reopening the app does not reset the timer. Returning after sleep also checks the deadline. The login page and account menu offer Light, Dark, and System appearance options, saved in this browser and kept after sign-out.

## CRM workflows

- **Contacts:** tags, website, assigned teammate, and a detail view with notes, calls, meetings, and automatic activity history. Search includes tags. Owners can delete any note; members can delete their own notes.
- **Team:** owner, member, and viewer roles enforced by database policies. Only owners manage invitations, teammate permissions, and pipeline stages. Removing a teammate revokes access; removal or downgrade to viewer clears assignments.
- **Invitations:** share a generated link manually; the app does not send invitation emails. Tokens expire after seven days, are stored only as hashes in the database, and require the invited verified email. Reissuing replaces the previous token. Revocation is available in Team. Local links work only on this machine until a public deployment and `WEB_ORIGIN` are configured.
- **Follow-ups:** due dates, contact links, collaborator assignments, completion, and filters for overdue, today, and assigned to me. Reminders are displayed inside the CRM; background email or push reminders are not configured.
- **CSV import:** preview and validate before saving. UTF-8 CSV supports `name,email,phone,company,status,tags`; only name is required. Tags use `|`. Limit: 500 contacts / 500 KB. Nonempty email duplicates are skipped case-insensitively. A repeated identical file is idempotent, including contacts without email. The import commits atomically.
- **Pipeline:** owners add, rename, order, and delete unused stages. Renames preserve existing deals. Each stage is open, won, or lost; dashboard totals use that classification. At least one stage must remain.

Contacts and follow-ups are searched on the server and displayed 25 at a time. Each pipeline stage has independent 10-deal pages and title search. Task filters apply to the entire workspace before pagination. Contact search covers name, email, phone, company, and exact (case-sensitive) tags. Customer selectors search all contacts and load additional results on demand. Overview counts and pipeline totals include the whole workspace, not just the current page.

Contact detail shows the latest 200 notes and 200 history events. History is generated by database triggers and cannot be edited by CRM users.

## Customer registration forms

1. An owner opens **Registration**, customizes the title/welcome message and optional privacy-policy URL, checks **Accept public registrations**, and saves.
2. Copy the link or download the QR code. QR generation runs locally; the SVG download includes a white quiet zone. Forms can be paused; replacing a link invalidates the previous link and QR code.
3. Customers open `/register/[token]` without creating an Touchlumo account. They provide a name and at least an email or international-format phone number. Company, birthday, birth year, preferred contact channel, and promotional email/WhatsApp consent are optional. Marketing checkboxes are unchecked by default; acknowledging the data notice is separate from marketing consent.
4. Owners and members review pending submissions. Approval creates a contact. Existing matches are never overwritten automatically: a teammate must select a matching record and attest that they verified the request with the customer through a trusted channel. Empty submitted email, phone, company, or birthday values preserve existing details; an explicitly supplied birthday without a year removes a previously stored year. Submitted marketing choices replace the old choices after verified review.

The database records the original notice, choices, submission time, reviewer and review time. Contact details display consent history and allow teammates to withdraw all marketing consent. Editing an email address or phone number clears its corresponding opt-in; an explicitly reviewed new submission can record consent for the new destination. A preferred channel alone is not marketing consent. Birthday fields can also be edited manually; birthday CSV columns and automatic birthday messaging are not implemented.

Public submissions do not create contacts or trigger follow-up automations until approved. Retry IDs prevent duplicate intake and duplicate approval. Anonymous callers cannot read submissions, contacts, or consent history, and submission responses do not disclose whether an email is already in the CRM. Viewers cannot review intake. The public API uses the publishable Supabase key and narrowly scoped functions, not a service-role key.

Current abuse controls include a honeypot, an in-memory API limit of 30 attempts per IP per hour, and a database-enforced rolling limit of 100 submissions per form per 24 hours, including direct RPC calls. These controls do not replace CAPTCHA or distributed rate limiting for a public production rollout; configure trusted proxy handling when deploying. Intake lists paginate 25 records per page; consent detail shows the latest 50 events. Dismissed submissions remain in the review history.

**Sharing outside this computer requires deployment.** Configure a public HTTPS `WEB_ORIGIN` and `NEXT_PUBLIC_API_URL` before distributing links or printing QR codes. Local `127.0.0.1` links do not work on customers' phones. No emails or social messages are sent by these forms.

## Business modules

- **Reports:** UTC date-range metrics for new contacts, won/lost deals, won deal value, and resolved tickets; current pipeline values and teammate workload; downloadable CSV. Database aggregation includes all records, independent of browser list limits. Win rate is won / (won + lost), and won value is not a payment ledger. Reopening or reclassifying a deal changes the current-state report. Deals already closed when this feature was installed use the migration date because historical closure dates were not previously stored.
- **Automations:** owners create, edit, pause, or delete rules. A new contact (including CSV imports), or a deal entering a chosen stage, creates an assigned follow-up with a relative due date. Rules execute transactionally in PostgreSQL. Editing unrelated fields or renaming a stage does not retrigger a rule; returning to a stage does. Rules apply to future events, not existing records. The latest 50 runs appear in the UI. These automations do not send emails or messages.
- **Quotes:** customer-linked USD proposals with up to 50 line items, integer quantities, configurable tax percentage, server-calculated totals, validity date, and notes. Users manually record draft/sent/accepted/declined status. Print / PDF opens a formatted document and the browser print dialog provides Save as PDF. No quote emails, public acceptance links, payment collection, or accounting integrations are implied.
- **Appointments:** customer meetings with responsible teammate, start/end times, location, notes, and scheduled/completed/cancelled status. Times display in the device timezone. Overlapping scheduled appointments for the same assigned teammate are rejected. Download an `.ics` file for external calendars. Public booking, calendar synchronization, and outgoing reminders are not configured.
- **Tickets:** customer support records with priority, due date, description, assigned teammate, and open/in-progress/resolved status. Resolution dates are recorded by the database and cleared when reopened.

All five modules enforce workspace isolation. Members can manage quotes, appointments, and tickets; viewers can read and export them. Only owners manage automation rules. New resource lists paginate 50 records at a time; their status filter applies to the displayed page. Downgrading/removing a teammate clears their assignments. Customer registration is implemented as described above. Customer files are available from Contacts > customer name > Files and documents.

The built-in Supabase email provider only delivers to organization team addresses. Configure [custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp) before enabling registration for other businesses. Email confirmation remains enabled; the app does not silently bypass it. The automated link tests generate confirmation/recovery links directly and do not test email delivery or send emails.

## Channels

The WhatsApp implementation includes owner-only Embedded Signup, encrypted server credentials, verified webhooks, customer-linked conversations and text replies within the 24-hour customer-service window. Members can reply; viewers can read. Each workspace connects its own authorized business number. Customer pages also have a WhatsApp tab. Messaging is disabled until the migration, server secrets and Meta setup are complete. The code is deployed. Server readiness, owner signup, viewer restrictions and the real Meta SDK pass hosted checks; the messages webhook is registered and active in Meta. Live authorization and message delivery inside Touchlumo still need verification with an actual business number. Access for external businesses remains subject to Meta requirements. CRM records work independently of messaging.

See [WhatsApp setup and limitations](docs/meta-integrations.md) for activation steps, Meta review requirements and operational procedures. Facebook Messenger and Instagram remain unimplemented.

## Google Cloud deployment

Open [Touchlumo](https://touchlumo.com). Project `touchlumo-20261021` hosts the
website and API, using the existing Supabase data/auth. The API accepts this
custom origin and generates invitation/registration links with it. The user
confirmed the Supabase Site URL and root redirect settings.

See [Google Cloud Run deployment](docs/deployment-google-cloud.md) and
[domain configuration](docs/domain-google-cloud.md). HTTPS, the login page, icons,
API CORS and anonymous-access rejection were verified. A temporary confirmed
account also passed hosted sign-in and pagination checks; its fixtures were
removed. Signup and recovery email delivery still require SMTP setup, which
the user deferred. Cloud usage is not guaranteed to remain free.

## Verification

```powershell
pnpm check
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
```

Build before running browser tests and stop stale local servers. Playwright starts the production web and API processes automatically. PostgreSQL isolation tests use PGlite with a minimal Supabase Auth fixture and execute the actual migrations. Live browser tests use a dedicated development project and temporary confirmed accounts without sending emails. They verify persistence, tenant isolation, notes/history, CSV imports, stages, invitations, roles, assignments, and the new business modules, then remove their own test accounts and records. See [verification details](docs/verification.md).

For live tests, set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in the ignored root `.env.test.local`. This service-role key is only for test fixtures; never deploy it. Ordinary CRM access uses the publishable key and authenticated user sessions. WhatsApp server operations require a separate production secret key as described in the setup guide. Never commit environment files. Without the test configuration, the live test is explicitly skipped.

Core contacts, tasks, and deals use server searches and pagination; the overview loads a bounded snapshot with full totals. Production rate limits, monitoring, delivery jobs, and billing remain later work. Local servers bind to the local machine; the optional Cloud Run deployment binds to the container network.

## Customer file attachments

Owners and members can upload and permanently remove files; viewers can download them. Each customer supports 100 files, up to 10 MiB each, with 20 files per page. Supported extensions are PDF, JPG/JPEG, PNG, WebP, TXT, CSV, DOCX, XLSX, and PPTX. Upload checks cover filenames, MIME types and basic file signatures; this is not antivirus scanning or full document validation. Files download as attachments rather than rendering inline.

Cloud Run stores files and their metadata in a private Cloud Storage bucket, using the runtime service account. Every file operation verifies the signed-in user and current workspace/customer access through Supabase. No public object links or service-account keys are created, and no database migration is required. Storage, operations and transfer can incur charges beyond Google allowances. See [Google Cloud deployment](docs/deployment-google-cloud.md).

Local development without `ATTACHMENTS_BUCKET` stores files under `.data/attachments` (from the API package working directory); `ATTACHMENTS_LOCAL_DIR` can override this. Production requires the bucket and never falls back to the container filesystem. Do not commit local customer files.

Remove a customer's files before deleting the customer through the CRM. File deletion is permanent: bucket soft delete is disabled. Direct database/admin deletion bypasses the application guard and can leave private orphaned files, so remove the matching `customers/WORKSPACE_UUID/CONTACT_UUID/` objects explicitly when performing administrative deletions. No automated cross-store cleanup or attachment backup is configured.

## Customer management pages

In Contacts, select **Open page** beside a customer, or use **Open customer page** from their quick details. Each customer has a bookmarkable `/customers/WORKSPACE_UUID/CONTACT_UUID` page. Sign-in and workspace membership are required; the page remains a staff workspace.

Overview shows contact information, assignments, tags, birthday/consent preferences and exact counts. Activity, Files and documents, Tasks, Deals, Quotes, Appointments and Tickets keep related work together. Every list filters by the customer on the server before pagination; unlinked and other-customer records are excluded. New tasks and deals default to this customer, and new quotes, appointments and tickets keep their customer fixed in the editor. Existing owners/members/viewers permissions continue to apply.

The profile query and customer-scoped list filters use existing Supabase row-level policies. No database migrations, email configuration changes or new infrastructure are needed.
