# Touchlumo domain launch

Smarter Connections. Stronger Relationships.

`https://touchlumo.com` is the planned public web address. Registration, ownership, DNS, certificates, hosting, and provider approval have not been verified by this rebrand. No live infrastructure or provider configuration was changed.

## Current working configuration

- Web: `http://127.0.0.1:3100`.
- API: `http://127.0.0.1:4100`, with existing `/v1` routes.
- Supabase Auth uses the existing development project and its current site/redirect URLs.
- Browser authentication redirects use `window.location.origin`. The API generates invitation and registration links from `WEB_ORIGIN`.
- Both servers bind to loopback. Production needs an appropriate hosting setup or HTTPS reverse proxy.

The environment examples document the planned domain while retaining their working local defaults. Actual environment files, secrets, Supabase configuration, and provider identifiers remain unchanged.

## Actions before public launch

1. Verify ownership or register the domain, select hosting, and approve a deployment plan. Provision and verify HTTPS for the web app and API before changing working URLs. `api.touchlumo.com` below is an example host that must also be provisioned; it is not an existing deployment.
2. Set `WEB_ORIGIN=https://touchlumo.com` in the deployed API. Its CORS configuration already reads this variable. Set the deployed web app's `NEXT_PUBLIC_API_URL` to the verified HTTPS API origin, for example `https://api.touchlumo.com`, without an extra `/v1` suffix. Retain the existing Supabase URL/key. Rebuild the web app because public Next.js environment values are embedded at build time.
3. In the existing Supabase project, verify ownership of the new site, add the exact required HTTPS authentication redirect URLs, and set the site URL to `https://touchlumo.com` at the approved cutover. Retain working development/previous callback entries during transition. Do not recreate the project or apply database changes for this rebrand.
4. Review hosted confirmation, invitation, and recovery email templates and change any product branding to Touchlumo. Configure a verified sender with display name **Touchlumo** and validate SMTP/domain authentication before testing real delivery. These templates and sender settings are hosted outside this repository; no emails were sent or settings changed here.
5. Meta authorization, OAuth callbacks, webhook ingestion, and outbound delivery are still planned. When implemented, register the actual deployed callback/webhook URLs in the provider dashboard and validate authorization for each business. Do not invent callback routes or replace existing provider settings as part of this branding change. SMS, subscription billing, and background delivery jobs are not implemented in this repository.
6. After verification, add the approved canonical URL and any absolute Open Graph URL/image metadata. No metadata currently advertises the planned domain as an active deployment. The existing chat icon is retained; there is no standalone favicon, social preview image, PWA manifest, or email-template asset in this repository. Provide approved assets if those should be added.
7. Test signup/confirmation, password recovery, logout, workspace isolation, CRM workflows, exports, public registration, and QR scanning on the deployed HTTPS origins. Generate new invitation/registration links and QR codes for public distribution; old loopback links only work on the original computer. Verify email delivery separately from automated link tests.
8. Change DNS, hosting, provider settings, and production environment values only after explicit approval. Keep a rollback plan with the previously working origins and callback entries.

See [the rebrand audit](rebrand-touchlumo.md) for retained technical identifiers and validation results.
