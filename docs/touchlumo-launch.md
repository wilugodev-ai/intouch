# Touchlumo domain launch

Smarter Connections. Stronger Relationships.

## Current deployment: October 21, 2026

- Website: https://touchlumo.com, with verified HTTPS and the Touchlumo browser logo.
- Domain registration and DNS remain at Hostinger. Google Cloud Run direct domain
  mapping serves touchlumo-web in us-central1, project touchlumo-20261021.
- API: https://touchlumo-api-swsowi5cua-uc.a.run.app, with existing /v1 routes.
  WEB_ORIGIN is https://touchlumo.com for CORS and generated links.
- Supabase is the existing project qsecrqhxqfesdvintdmy. The user confirmed Site
  URL https://touchlumo.com and both exact root redirect URLs; old entries remain.
- HTTPS, the login page, favicon links, API health, domain preflight, and anonymous
  CRM access rejection passed. The pagination release also passed sign-in and
  paged-list checks using a temporary confirmed account and private test workspace.
  Those fixtures were removed; no emails were sent.
- www.touchlumo.com is not yet mapped separately. Share the apex address above.

Local development retains web http://127.0.0.1:3100 and API
http://127.0.0.1:4100. Domain setup did not change local environment files, database
migrations, Supabase keys, or data. Containers bind publicly within Cloud Run.

## Remaining launch checks

1. Test real sign-in, signup/confirmation, recovery, logout, workspace isolation,
   CRM workflows, exports, registration forms, and QR codes on the HTTPS domain.
   Generate new invitation/registration links and QR codes for distribution.
2. Verify SMTP, sender authentication, and hosted confirmation/recovery templates.
   Use Touchlumo branding and test delivery separately from automated URL checks.
3. Meta OAuth/webhooks and outbound delivery remain planned. Register actual
   callback URLs only when those features exist. SMS, subscription billing, and
   background delivery jobs are not implemented in this repository.
4. Add canonical/social URL metadata and approved social images if required.
   Browser icons are already provided through icon.svg, favicon.ico and
   apple-icon.png. No PWA manifest or social preview image is supplied.
5. Retain a rollback plan and required previous authentication redirect entries.
   See [domain configuration](domain-google-cloud.md) for exact DNS records,
   provider status, limitations, and origin rollback.

The selected direct Cloud Run domain mapping is a Preview feature; Google's
production-readiness limitation was explained before setup. Cloud usage is not
guaranteed to remain free. The existing development database is still in use.

See [deployment details](deployment-google-cloud.md) and
[the rebrand audit](rebrand-touchlumo.md).
