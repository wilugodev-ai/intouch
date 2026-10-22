# WhatsApp integration

## Current status

The application code implements per-workspace WhatsApp Embedded Signup, signed webhooks, a customer-linked inbox and text replies. It is deployed at https://touchlumo.com. Hosted readiness, real SDK loading, owner/viewer access and webhook authentication pass. Meta reports the messages webhook active. Real Meta account connection and end-to-end message delivery inside Touchlumo are still pending. All seven database migrations, including `202610220001_whatsapp.sql`, are now applied remotely; the WhatsApp columns and denied anonymous server-RPC access were verified. Missing setup keeps the connection button unavailable instead of creating a synthetic connection.

Facebook Messenger and Instagram are still planned. Adding their names or environment variables does not enable them.

As of October 22, 2026, Meta shows ABLEST SOLUTIONS LLC as business-verified under the Ablest Digital Solution portfolio. The separate technology-provider access verification has been submitted and is under review. A new Embedded Signup attempt after business verification still displayed that the provider cannot onboard clients at this time. The message does not identify the exact remaining requirement. No WhatsApp account was connected in that attempt; access approval, required app permissions and publishing must be checked before claiming external-customer availability.

## What businesses will use

A workspace owner opens **Channels > Connect WhatsApp**, signs in through Meta and chooses an authorized WhatsApp Business account and phone number. Owners manage connections, members can reply, and viewers can read. The same phone cannot be claimed by a different workspace, including after a local disconnect; moving a phone to another workspace requires a deliberate administrator migration of its private history.

The inbox lists 25 conversations per page and 50 messages per page, polling every 15 seconds while visible. Customer pages include a WhatsApp tab filtered by that customer. Incoming phone numbers match exactly one existing normalized customer phone, or create a new contact when no unique match exists. A message does not grant marketing consent.

This release supports inbound text and text replies within 24 hours of the customer's latest incoming message. Other message types display a placeholder; media preview/download, outbound attachments, templates, campaigns, automated birthday messages and replies outside that window are not implemented. Existing WhatsApp Business app coexistence depends on Meta eligibility and the chosen configuration and is not promised by this implementation. A new number needs an owner-chosen six-digit registration PIN; an already registered number may leave it blank.

## Meta setup

1. Open [Meta for Developers](https://developers.facebook.com/apps/), sign in, register as a developer if requested, and create the Touchlumo app using the WhatsApp business messaging use case. Follow the current dashboard's business portfolio requirements. On iPhone, use Safari's page menu and **Request Desktop Website** if controls are hidden; a desktop is easier for the later configuration.
2. Configure the app for onboarding other businesses using WhatsApp Embedded Signup / Facebook Login for Business. Obtain the public App ID and Embedded Signup configuration ID. Request `whatsapp_business_management` and `whatsapp_business_messaging` and complete the dashboard's business verification, technology-provider and App Review requirements for third-party customer access. Development-mode testing does not establish general availability.
3. Configure the supported Graph API version explicitly. There is no guessed fallback version. Set website/JavaScript SDK allowed domains and any required OAuth redirect settings for `https://touchlumo.com` according to the selected business login configuration.
4. Configure the WhatsApp `messages` webhook at `https://touchlumo-api-swsowi5cua-uc.a.run.app/v1/meta/whatsapp`, with the same private verification token used by the API. Subscribe the app to the webhook field in Meta; the server also subscribes each connected WABA after authorization. HMAC signatures are mandatory for delivered events.
5. Set the deauthorization callback to the API origin plus `/v1/meta/whatsapp/deauthorize`, and the data-deletion callback to `/v1/meta/whatsapp/delete`. These endpoints accept Meta's signed requests. Establish a real privacy policy, user support contact and deletion review process before app submission. The deletion callback queues review; it does not claim automatic deletion is complete.
6. Test with authorized Meta test assets first: connect, receive a real message, reply, inspect delivery receipts, reconnect, disconnect and exercise signed deauthorization/deletion. Then verify two independent customer businesses cannot cross account boundaries before making the app available broadly.

The [official Meta sample provider application](https://github.com/fbsamples/business-messaging-sample-tech-provider-app) describes the onboarding, registration, subscription and messaging flow. Meta dashboard requirements can vary with account eligibility and app use case; some direct documentation pages require login. Meta messaging fees can apply; consult [current platform pricing](https://business.whatsapp.com/products/platform-pricing).

## Database and server configuration

For a new installation, apply `supabase/migrations/202610220001_whatsapp.sql` once after the first six migrations. This migration is already installed in the existing Touchlumo project. Review/back up the database before an operator-run migration. The normal Cloud Run deployment does not execute SQL. New private credential, signup, receipt and deletion tables have RLS and no browser grants. Authenticated RPCs enforce current workspace roles; the server RPC is restricted to the `service_role` claim and grant. Ordinary CRM access continues to use user JWTs and RLS.

Configure these public values on the **API service only**:

| Variable | Value |
| --- | --- |
| `META_APP_ID` | Public App ID |
| `META_WHATSAPP_CONFIG_ID` | Public Embedded Signup configuration ID |
| `META_GRAPH_API_VERSION` | Supported explicit version such as the one selected in Meta's dashboard |
| `META_PUBLIC_API_ORIGIN` | `https://touchlumo-api-swsowi5cua-uc.a.run.app` |

Configure these as separate Google Secret Manager secrets, exposed only to the API runtime:

| Variable | Secret content |
| --- | --- |
| `META_APP_SECRET` | App secret from Meta |
| `META_WEBHOOK_VERIFY_TOKEN` | Random verification token chosen by the operator |
| `SUPABASE_WHATSAPP_SECRET_KEY` | Dedicated server secret key from this Supabase project |
| `WHATSAPP_TOKEN_ENCRYPTION_KEY` | 32 cryptographically random bytes in standard base64 |

Use a new Supabase `sb_secret_` key from the project's API keys settings. The legacy service-role format is accepted for compatibility, but the test-only `.env.test.local` key must never be deployed. A Supabase secret key bypasses RLS, so it must remain server-only. Grant the Cloud Run runtime identity `roles/secretmanager.secretAccessor` on these specific secrets, not across the project. Reference explicit secret versions in Cloud Run's Variables & Secrets settings. Do not pass their values to image builds, `NEXT_PUBLIC_*`, git, chat or deployment command arguments.

The deployer updates its managed public environment values and preserves existing Meta variables and Secret Manager references. It does not read or deploy local Meta secrets or test administration keys. See [Cloud Run secret configuration](https://cloud.google.com/run/docs/configuring/services/secrets) and [Supabase API key guidance](https://supabase.com/docs/guides/api/api-keys).

Keep the encryption key durable and backed up privately; losing or replacing it makes stored provider tokens unreadable. Rotation requires re-encryption with the previous key or reconnecting every business. Keys and provider tokens are never returned to the browser. The registration PIN is used for the registration request and is not persisted by Touchlumo.

## Delivery and disconnection behavior

A one-use, ten-minute signup nonce is bound to the owner and workspace. The server exchanges the Meta code, checks its app and scopes, and verifies that the selected phone belongs to the authorized WABA. Connections remain `connecting` until registration/subscription succeed and ownership is rechecked. Provider tokens use AES-256-GCM with workspace/phone authenticated data.

Inbound processing verifies the unmodified webhook bytes, derives the workspace from the registered phone and WABA mapping, and commits every supported event before responding successfully. Replayed provider message IDs are deduplicated. Delivery receipts can arrive before the send response and cannot downgrade a read receipt.

Outbound requests reserve a unique request UUID before calling Meta. A retry of the same request never sends again. Accepted means Meta accepted the request; sent, delivered and read are separate statuses. A timeout or ambiguous provider failure is `unknown`, not a successful send, and is never retried automatically. An interrupted `sending` message is displayed as unknown after two minutes. Investigate unknown sends before intentionally submitting a new request. Database limits cap each connection at 30 outgoing attempts per minute and 500 per rolling day; these reduce bursts but do not cap Meta or cloud charges.

Owner disconnection immediately removes the encrypted credential and blocks local sends and inbound ingestion while retaining CRM history. It does not globally revoke the owner's Meta grant or unsubscribe an entire WABA, which could affect other numbers. For full provider revocation, remove the app's business integration in Meta as well. Signed deauthorization removes current matching credentials and marks connections as requiring reconnection. Expired or invalid credentials require reauthorization.

## Data-deletion operations

A valid signed deletion request disconnects current access and creates a private pending request containing the associated connection IDs, including historical authorizations. The public opaque confirmation URL reports pending until an operator actually completes the request. Do not mark a request completed merely because the callback succeeded.

Before activating third-party onboarding, assign an operator and define the applicable retention policy. The operator reviews `private.whatsapp_deletions`, identifies provider-sourced data through its saved connection IDs and historical account links, and removes the relevant messages, receipt rows, conversations and connection/account mappings as appropriate. Review CRM contacts separately: they may contain independently collected customer data. If deleting customer records or files, follow the existing attachment cleanup procedure. Retain only the minimum deletion confirmation record required by policy, and mark its status `completed` only after the work finishes. No automatic deletion worker or operator UI is implemented yet.

## Verification boundary

Unit/database tests apply every migration to isolated PostgreSQL/PGlite fixtures and verify workspace separation, owner/viewer restrictions, nonce consumption, private credentials, inbound deduplication, consent behavior, idempotent sends, delivery ordering and pending deletion. HTTP tests use a real Nest server with simulated Meta/store dependencies to verify raw signatures, failed-persistence retries, signed callbacks and uncertain-send behavior. Browser tests use real temporary Supabase login/workspace fixtures with simulated Meta SDK and WhatsApp endpoints; no Meta authorization or messages occur. Before remote migration, a separate browser check verified the honest unavailable state against the previous schema.

Live Meta authorization, phone registration, actual message delivery, review approval and multi-business production onboarding remain external activation checks.


## Setup progress, October 22, 2026

Meta app 3298543490345785 and Embedded Signup configuration 2073556199961752 are created using the system-user, 60-day token template. The user confirmed a Meta-console test message was delivered. Public IDs, API origin and Graph v25.0 (shown in the Meta console test code) are saved in ignored local API settings. This does not establish live Touchlumo messaging.

Secret Manager is enabled in touchlumo-20261021. The user explicitly approved these resources and secret-level roles/secretmanager.secretAccessor access for touchlumo-runtime@touchlumo-20261021.iam.gserviceaccount.com:

- touchlumo-meta-app-secret
- touchlumo-meta-webhook-verify-token
- touchlumo-whatsapp-encryption-key
- touchlumo-supabase-whatsapp-secret-key

All four resources now exist with user-managed us-central1 replication and verified secret-scoped runtime access. Webhook verification and encryption each have enabled version 1, generated without printing or storing plaintext locally. The user added both the Meta and dedicated Supabase server secrets; enabled version 1 was verified by metadata for each. The provisioning script at deploy/cloud-run/prepare-whatsapp-secrets.ps1 preserves existing enabled versions when rerun; PrepareOnly performs no cloud changes. No project-level secret access was granted.

The user applied the transaction-wrapped seventh migration and confirmed the final true result. A zero-row remote check recognizes the new columns, and an anonymous call to the server-only RPC is denied with 42501. Both API/web images for release 20261022-132120-whatsapp built successfully in Cloud Build e1373b3f-cc5f-429d-a488-e87269f1b4de. The user explicitly approved production deployment. API revision touchlumo-api-00011-m85 and web revision touchlumo-web-00007-mv6 serve all traffic with service/revision maximums of one. The dedicated Supabase secret reference is pinned to version 2; the other three are version 1. The four references are mounted only on the API. Hosted server/UI/webhook checks pass; real business-account connection and message delivery inside the CRM are still outstanding.

The deployer accepts -WhatsAppConfigurationFile with exactly four public values and four approved, pinned secret references; secret payloads and mismatched project IDs are rejected in local validation. -ExistingApiImage and -ExistingWebImage reuse the reviewed images without rebuilding. The runtime configuration file and exact production command are ignored under .data/whatsapp.


## Hosted checks after deployment

The corrected dedicated Supabase server secret is stored as version 2 and mounted only on the API. The runtime readiness check now succeeds. Hosted tests passed owner-only signup nonce creation, member/viewer denial, anonymous and outsider isolation, empty inbox behavior, private customer WhatsApp pages, real Meta SDK loading with an enabled connection button, viewer controls and mobile overflow. Test accounts, workspaces and records were removed. No Meta login or WhatsApp messages were sent by these checks. Desktop/mobile screenshots were visually inspected.

The webhook passed a valid verification-token challenge and signed empty-body event, plus unsigned/incorrect-token rejection. A read-only Graph call accepted the saved app secret. Secret values were used only in memory for these checks and were not printed or saved locally. Existing customer workflows also passed a hosted regression, including private files and viewer restrictions, with fixture cleanup.

The app initially had no webhook subscription. Using Meta's official app subscriptions endpoint, the WhatsApp Business Account object was registered for messages at https://touchlumo-api-swsowi5cua-uc.a.run.app/v1/meta/whatsapp. Meta completed its real callback verification handshake and reports active=true; its returned messages field version is v26.0. Per-business WABA subscriptions are created by the existing connect flow after each owner authorizes their assets. No external business number has been authorized by the automated checks.

The next manual test is a real workspace owner's Channels > Connect WhatsApp flow, followed by an incoming customer message and a CRM reply. External-business availability remains subject to Meta business verification, access review and app publishing requirements. The operator must also maintain the documented data-deletion review process.


The first real Embedded Signup attempt reached Meta but displayed that Ablest Digital Solution cannot onboard clients at this time. The screenshot does not identify the exact pending requirement. The next step is to inspect the app dashboard business/access verification and review status; no successful business-number connection or CRM message delivery is claimed. A read-only app metadata request returned Graph error 100 and did not establish the business verification status. Existing hosted readiness and active-webhook checks remain valid.
