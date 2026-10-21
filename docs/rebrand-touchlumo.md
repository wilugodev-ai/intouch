# Touchlumo rebrand audit

Date: October 21, 2026. Branch: `rebrand/touchlumo`.

The product is now **Touchlumo**, with the tagline **Smarter Connections. Stronger Relationships.** Existing uncommitted account-menu, appearance, password-visibility, and inactivity-logout work was preserved. The pre-change diff and protected-file fingerprints are saved locally in the ignored `.data/rebrand-touchlumo/` directory.

## Scope and implementation

The repository contains a Next.js/React frontend, a NestJS API, pnpm workspaces, and Supabase PostgreSQL/Auth. The rebrand changes presentation, export labels, metadata, documentation, and comments in environment examples. It adds no dependencies and performs no database migrations or infrastructure changes.

- Login and signup use the Touchlumo wordmark and welcome label; the sidebar, accessibility labels, tagline, and footer use the new identity. The longer wordmark is fitted to the existing layout.
- Page/application titles, descriptions, Open Graph site/title fields, and Twitter metadata use Touchlumo. Public registration preserves its `noindex, nofollow` and `no-referrer` protections.
- Customer registration uses “Powered by Touchlumo,” including unavailable-form states; the owner sharing note uses Touchlumo.
- CSV reports contain the Touchlumo name and download as `touchlumo-report.csv`. Calendar files identify Touchlumo as their producer while preserving existing event identities.
- The existing SVG chat symbol and design system are retained. There are no standalone logo, favicon, PWA-manifest, social-preview-image, or email-template files to replace. No broken asset references or temporary graphics were introduced.
- The API has no Swagger title, branded email sender/template, or notification display name to update. Its machine-readable health identifier remains unchanged for compatibility. Messaging, SMS, billing, and provider callback implementations were not added or altered.

## Files changed for the rebrand

| File | Change |
| --- | --- |
| `README.md` | Product name, tagline, public-registration wording, launch/audit links. |
| `PROJECT.md` | Product name, tagline, planned-domain note. |
| `apps/web/.env.example` | Planned-domain comments; working values preserved. |
| `apps/api/.env.example` | Planned CORS origin comment; working values preserved. |
| `apps/web/app/layout.tsx` | Application, page, Open Graph, and Twitter metadata. |
| `apps/web/app/globals.css` | Fit the longer wordmark at existing breakpoints. |
| `apps/web/app/register/[token]/page.tsx` | Public-registration page title. |
| `apps/web/app/ui/crm.tsx` | Login/sidebar wordmarks, accessibility labels, welcome label, tagline, footer. |
| `apps/web/app/ui/public-registration.tsx` | Customer-facing product attribution. |
| `apps/web/app/ui/registration-manager.tsx` | Local-sharing product name. |
| `apps/web/app/ui/business.tsx` | Report heading/filename and calendar producer name. |
| `tests/e2e/live.spec.ts` | Branding, calendar compatibility, report assertions, screenshot filenames. |
| `tests/e2e/appearance.spec.ts` | Screenshot filenames. Existing compatibility checks remain. |
| `tests/e2e/branding.spec.ts` | New branding/metadata checks across themes, screen sizes, signup, and unavailable registration. |
| `docs/touchlumo-launch.md` | Domain, hosting, auth, email/provider cutover instructions. |
| `docs/rebrand-touchlumo.md` | This implementation and validation record. |

Restarting the local development server also regenerated `apps/web/next-env.d.ts` to reference Next.js development route/root-parameter types. Other application files already dirty/untracked at task start belong to the preserved earlier work and are not additional rebrand changes. The combined changes are tracked on the dedicated rebrand branch.

## Remaining old-name references

Source, configuration, tests, documentation, and local Supabase metadata were searched case-insensitively for the old name and related spellings. These references are intentional:

| Reference / locations | Reason retained |
| --- | --- |
| Root package `intouch`, packages `@intouch/web` and `@intouch/api`, and Playwright package filters | Internal workspace identities; changing them is unnecessary and could break existing commands/tooling. |
| API health service `intouch-api` in `apps/api/src/main.ts` | Existing machine-readable API contract and possible health-monitor identifier. Routes and payload behavior stay compatible. |
| `intouch-theme` in the theme component, layout bootstrap, and appearance tests; `intouch-theme-change` browser event | Preserve saved appearance choices and synchronization across existing tabs. |
| `intouch-invite` in the CRM | Preserve pending workspace invitations stored in the browser. |
| `intouch:last-activity:*` in the inactivity module | Preserve timeout deadlines across existing sessions and reloads. |
| `@intouch` suffix on calendar `UID` values and its regression assertion | Keep previously exported appointments identifiable, avoiding duplicate events on reimport. Only the producer display name changed. |
| Supabase `project_id = "intouch"`, linked-project name `intouch-dev`, and references in README/PROJECT/verification documentation | Describe the actual existing development project; no new project or auth identity was created. |
| Foundation migration comment referring to the former product | Historical migration file is left byte-for-byte unchanged. No migration replay or database work is needed for branding. |
| Local path `C:\intouch` in run instructions | Existing checkout path is still correct; the workspace was not moved. |
| Random `intouch-test-*` and `intouch-confirm-*` test email prefixes | Internal temporary fixture identities, not product UI or outbound sender names. |
| Negative old-brand assertions in `branding.spec.ts` | Tests explicitly reject old branding in rendered text. |
| “stay in touch” in registration defaults and the corresponding migration | Ordinary English in customer-configurable content, not the former product name; saved business copy is preserved. |
| Old strings in this audit, Git history, generated dependencies/builds, local logs, and ignored screenshots/baselines | Historical or generated records; not active user-facing branding. The earlier artifacts are retained rather than deleted. |

Actual environment files and credentials, all six SQL migrations, Supabase project configuration/link metadata, package manifests, workspace definitions, and the lockfile were fingerprinted before modification. All 17 protected files match their baseline hashes after the rebrand.

## Validation

- `pnpm check`: passed; frontend/backend ESLint, TypeScript, and production builds.
- `pnpm test`: passed, 3 database suites, 0 failures and 0 skips.
- `pnpm test:e2e --output .data/rebrand-touchlumo/browser-results`: passed against the production builds, 16 tests, 0 failures and 0 skips. Coverage includes branding/metadata, signup/sign-in, password recovery, account actions, password visibility, saved themes, 30-minute inactivity, sleep/offline behavior, multiple tabs, persistence, tenant isolation, team permissions, automations, quotes, appointment/calendar export, reports, and registration/consent/QR workflows.
- Visual review: passed for desktop/mobile and light/dark screenshots. Login captures are in `.data/rebrand-touchlumo/`; account captures use `.data/touchlumo-dark-account-*.png`. Wordmark fit and horizontal overflow are also checked automatically.
- Local development servers were restarted afterward. The web page returns HTTP 200 with the Touchlumo title; the API health check is healthy and database configuration remains present.

The database suites use isolated PGlite instances. Browser tests use temporary accounts/records in the existing development project and clean up their own fixtures. They do not send emails or social messages and do not validate real email delivery or live Meta integration.

## Domain readiness

`touchlumo.com` remains planned. Actual `.env` values, CORS defaults, Supabase Auth settings, current redirect URLs, and generated-link behavior are unchanged. No DNS, hosting, OAuth-provider, or production infrastructure action was performed. Follow [the launch instructions](touchlumo-launch.md) for the manual actions and explicit approval required before cutover.
