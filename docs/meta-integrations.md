# Meta integration plan

Status: planned, not implemented. This build cannot authorize or send/receive live Meta messages.

## Per-business connections

Use provider-hosted authorization so each business grants access to its own assets. Do not ask business owners to paste account tokens into the CRM. A single administrator-owned connection does not satisfy this product.

- WhatsApp: implement Meta's Embedded Signup flow for a provider onboarding customer businesses; select and validate the authorized business account and phone number.
- Facebook Messenger: authorize the business's Facebook Page and obtain the required messaging permissions.
- Instagram: use the supported professional-account messaging authorization flow; verify available permissions and account requirements when implementing it.

Meta publishes an [official sample provider application](https://github.com/fbsamples/business-messaging-sample-tech-provider-app) showing WhatsApp onboarding, account management, messages, and webhooks. It is a reference, not code incorporated into this repository. Also consult the [Messenger documentation](https://developers.facebook.com/docs/messenger-platform/) and [Instagram messaging documentation](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/) during implementation. Direct Meta documentation pages were unavailable to the research tool during this initial build; account-specific prerequisites must be checked in the developer dashboard.

## Implementation gates

1. A dedicated Meta developer app, a suitable business configuration, approved redirect/webhook URLs, relevant permissions, and any required review/verification for third-party business access.
2. Owner-authorized connection initiation, one-use expiring OAuth state bound to the signed-in user and workspace, server-side code exchange, asset ownership verification, and explicit account selection.
3. Encrypt provider credentials in a server-only private schema with a separate encryption key. Public connection rows contain metadata only. Do not log tokens or store them in browser storage.
4. Verify callback signatures against the unmodified request bytes. Resolve workspace from the verified provider asset mapping, never from an inbound caller-supplied workspace ID. Handle webhook retries idempotently with durable processing.
5. Authorize every outbound request against workspace membership and connection ownership. Validate applicable messaging windows, consent/template requirements, and provider errors at implementation time. Persist provider IDs and delivery failures; never show a successful send before confirmation.
6. Disconnect, revoke/expire tokens, process provider deauthorization/deletion callbacks, and test that revoked users cannot send or reconnect accounts.
7. Verify two independent businesses cannot list, select, receive, or send using each other's connected accounts.

The migration intentionally grants clients read-only access to connection/conversation/message tables. Metadata cannot be fabricated by authenticated clients. Credential storage and narrowly scoped server delivery permissions must be added with their own tests when integration work starts.

Database access follows [Supabase's row-level security guidance](https://supabase.com/docs/guides/database/postgres/row-level-security): authenticated-user requests retain RLS, with explicit grants and membership policies.
