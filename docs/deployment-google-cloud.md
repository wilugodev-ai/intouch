# Touchlumo on Google Cloud Run

This trial deployment uses two public HTTPS Cloud Run services: `touchlumo-web`
(Next.js) and `touchlumo-api` (NestJS). Existing Supabase Auth, PostgreSQL, data,
and row-level access policies stay in the existing Supabase project. No database
migrations run. Domain registration stays with Hostinger; first test the Google
`run.app` addresses before changing DNS.

## Current deployment: October 21, 2026

- Project: `touchlumo-20261021` (Touchlumo), with billing enabled.
- Website: <https://touchlumo.com> (Hostinger DNS, direct Cloud Run mapping).
- Cloud Run web URL: <https://touchlumo-web-swsowi5cua-uc.a.run.app>.
- API health: <https://touchlumo-api-swsowi5cua-uc.a.run.app/v1/health>.
- Both services are ready in `us-central1`, with 1 CPU, 512 MiB RAM, zero minimum
  instances, and a service/revision maximum of 1 instance each.

The original `avian-chariot-453917-m4` project remains associated with its previous
closed billing account. It was not modified or deleted. The dedicated Touchlumo
project successfully linked to the active account instead.

Use `https://touchlumo.com` as the supported website origin. The API's CORS
configuration and generated links use this custom domain. Google's original web
URLs still serve the page but are no longer the API's allowed browser origin. Cloud Run container builds, public API health,
anonymous CRM access rejection, browser CORS/preflight, the login page, password
visibility, persistent appearance and mobile layout were checked. The initial smoke checks did not sign in. Later pagination and attachment checks
use temporary confirmed accounts and clean up their own fixtures; see
[verification results](verification.md). No test emails are sent.

The user updated Hostinger DNS and confirmed the Supabase Site URL and exact
root redirect URLs. HTTPS and Chromium checks passed on the custom domain;
API revision `touchlumo-api-00008-p84` serves all traffic with `WEB_ORIGIN` set
to the domain. Custom SMTP is deferred; actual signup and password-recovery
email delivery remains unverified. See the remaining checks in section 4. See [domain configuration](domain-google-cloud.md).

Customer attachments are live in private bucket `touchlumo-20261021-customer-files`.
The final web revision is `touchlumo-web-00006-kdp` (image `20261021-230955`);
the API image is `20261021-230402`. Hosted upload/download/removal and workspace
permissions passed using temporary accounts, with all fixtures removed.

Private customer management pages are available from **Contacts > Open page**.
The URL `/customers/WORKSPACE_UUID/CONTACT_UUID` is bookmarkable and requires
workspace membership. Existing data, file storage and authentication settings
are used; see [customer-page verification](verification.md).

The deployer temporarily allows 2 service instances during each revision
replacement, while retaining a maximum of 1 instance per revision, and restores
the service maximum to 1 in a finally block. Both services retain a zero minimum.
If deployment is interrupted, inspect readiness and verify the service maximum
with Google Cloud before retrying; restore `--max=1` if necessary.

## 1. Create the project and connect this computer

1. Open <https://console.cloud.google.com/projectcreate>, name the project
   **Touchlumo**, and copy its **project ID**. The display name is not the ID.
2. Link a billing account at <https://console.cloud.google.com/billing>. Google
   requires billing even when usage is within a free allowance. New-customer
   trial credits, if offered, are separate from recurring free usage.
3. Install the [Google Cloud CLI](https://cloud.google.com/sdk/docs/install-sdk)
   for Windows, including its Python component. Open a new PowerShell window.
   This workstation also supports the verified portable CLI under
   `.data/google-cloud/google-cloud-sdk/bin/gcloud.cmd`; the deployer discovers
   it automatically. When using it, replace `gcloud` below with that full path.
4. Run `gcloud auth login` and finish sign-in in Google's browser window. Do not
   share passwords, payment details, authorization codes, or downloaded keys in chat.
   The deployment script uses this interactive login; no service-account key
   download is required. Use a project owner account for this initial setup.
5. In Google Cloud Billing, create a project-scoped budget alert (for example
   $5/month). **Budget alerts do not cap or stop spending.**

## 2. Check the local configuration

Use Node 24.19+ (24.x). From PowerShell:

```powershell
cd C:\intouch
.\deploy\cloud-run\deploy.ps1 -PrepareOnly
```

This checks that the existing API/web environment files agree, rejects secret or
service-role keys, and writes an ignored deployment plan under `.data/cloud-run`.
It creates no cloud resources. Only the existing Supabase URL and publishable
(or legacy `anon`) key are used. The deployer does not read `.env.test.local`.
Using the existing development database makes this a preview, not a separate
production environment. Don't run destructive integration tests against it.

## 3. Build and deploy

```powershell
.\deploy\cloud-run\deploy.ps1 -ProjectId YOUR_PROJECT_ID
```

New Google IAM/service-agent permissions can take time to propagate. If the first
build submission returns a permission error immediately after initial setup,
verify permissions and retry after propagation. If an API image has already built
successfully, resume with `-ExistingApiImage FULL_API_IMAGE_TAG` to reuse it instead
of rebuilding it; only an API image in this project's Touchlumo repository is accepted.

The default region is `us-central1`, with request-based billing, 1 CPU, 512 MiB RAM,
0 minimum instances, and 1 maximum instance **per service** (two in total). Both
services scale to zero when idle; the first request can be slower. Maximum
instances reduce scaling but do not impose a dollar spending cap or an absolute
instantaneous instance guarantee during replacement/deployment.

The script checks billing and the actual Google upload list, enables the required
APIs, and creates:

- An Artifact Registry Docker repository named `touchlumo`.
- A private source-staging bucket named `PROJECT_ID-touchlumo-source`.
- A private Standard-storage customer-file bucket named `PROJECT_ID-customer-files`,
  in the deployment region, with uniform bucket IAM, public access prevention,
  and soft delete disabled so confirmed file removal is permanent.
- A build service account with log-writing, image-publishing, and source-reading
  permissions; the runtime service account has no project roles and receives
  `roles/storage.objectUser` only on the customer-file bucket.
- The API and web services, using two targets of `deploy/cloud-run/Dockerfile`.

Cloud Build builds Linux images, so Docker Desktop is not required locally.
`.gcloudignore` and `.dockerignore` allow only application source and manifests.
Actual environment files, test/admin credentials, `.git`, local data, backups,
and dependencies are excluded. The script stops if Google's upload list contains
an unexpected file. Public browser configuration is passed explicitly to the web
build; changing the Supabase URL/key or API URL requires rebuilding the web image.

The API starts on `0.0.0.0:$PORT`; local development retains its loopback default.
The web image uses Next.js standalone output, binds to `0.0.0.0:$PORT`, and serves
its bundled static assets. Both containers run as the unprivileged `node` user.
Google's public URLs are read after deployment. The script sets the API's exact
`WEB_ORIGIN` from `-WebOrigin`, or preserves the existing API origin; it uses the
Cloud Run web URL when neither exists. It then checks API configuration and the
web page. The health endpoint confirms configuration, not live database connectivity.

Both services permit public HTTP invocation. Protected CRM routes still verify
Supabase user tokens and database workspace policies; public registration routes
retain their existing anonymous behavior. CORS is not an authentication boundary.

## 4. Finish authentication and verify the preview

The URLs appear in the terminal and `.data/cloud-run/deployment-result.json`.
In the existing Supabase project, open **Authentication > URL Configuration**:

1. Add the exact web origin and its root URL with a trailing slash to **Redirect
   URLs**. These two custom-domain entries are user-confirmed for this deployment.
   This app uses its root route for confirmation/recovery, not `/auth/callback`.
   Retain working localhost entries. The app requests redirects to the browser's
   actual origin. The primary Site URL is user-confirmed as `https://touchlumo.com`.
2. Confirm custom SMTP is configured if users outside your Supabase organization
   need confirmation or password-recovery emails. The deployer does not send mail.
3. Verify sign-in, confirmation/recovery, sign-out, 30-minute inactivity logout,
   light/dark appearance, workspace isolation, CRM changes and persistence, and
   generated invitation/registration links on the deployed origins.
4. Test public registration and its QR code from another device. Its existing
   per-IP limiter is in memory and does not implement Cloud Run-aware trusted
   proxy handling; clients may share proxy limits and a restart resets counters.
   The database per-form rolling quota remains enforced. Review proxy-aware or
   distributed abuse protection before a wider public registration rollout.

The initial automated smoke checks do not establish a production-ready launch.
Changing DNS, the Supabase primary Site URL, or email settings is a separate
cutover after the preview works. See [direct domain setup](domain-google-cloud.md)
and the [domain launch checklist](touchlumo-launch.md). Repeat deployments preserve
the existing API web origin; use `-WebOrigin https://touchlumo.com` for the initial
custom-domain cutover after HTTPS is ready.

## Costs and stopping the trial

Cloud Run free CPU, memory and request allowances are shared across services in
the billing account. Cloud Build, Artifact Registry, stored source archives,
logging, customer-file storage/operations, network transfer, and overages have separate pricing/free allowances.
This setup can have charges even with only one instance per service. It creates
no load balancer, Cloud SQL instance, VPC connector, or paid minimum instance.
Source archives and old container images accumulate until cleaned up.

To stop hosting, explicitly delete only these trial services:

```powershell
gcloud run services delete touchlumo-web --project YOUR_PROJECT_ID --region us-central1
gcloud run services delete touchlumo-api --project YOUR_PROJECT_ID --region us-central1
```

Storage can still cost money after deleting services. Review/delete the trial
repository, source bucket, and customer-file bucket separately when no longer needed, after deciding
whether to retain images for rollback and customer documents. Do not delete the
customer-file bucket while documents are still needed. No cleanup here deletes Supabase data or
changes the domain. Cloud Run revisions can be used for rollback; restore the
matching web/API origins together if URLs or configuration change.

## References

- [Cloud Run deployment](https://cloud.google.com/run/docs/deploying)
- [Container contract](https://cloud.google.com/run/docs/container-contract)
- [Cloud Run pricing](https://cloud.google.com/run/pricing)
- [Cloud Build service accounts](https://cloud.google.com/build/docs/cloud-build-service-account-updates)
- [Budget alerts](https://cloud.google.com/billing/docs/how-to/budgets)


## Optional WhatsApp activation

The WhatsApp code and seventh SQL migration are prepared and tested locally, but have not been deployed or applied remotely. Configure Meta and separate server secrets before enabling connections; follow [WhatsApp setup](meta-integrations.md). The deployer does not execute migrations or upload local Meta/test secrets. Repeat deployments use updates for managed public environment values, preserving existing optional Meta variables and Secret Manager references. Grant runtime secret access on individual secrets when activating this feature. The prior no-project-roles runtime setup remains sufficient while WhatsApp is disabled.


## WhatsApp release, October 22, 2026

The user approved and deployed API/web images tagged 20261022-132120-whatsapp. Ready revisions are touchlumo-api-00010-q8q and touchlumo-web-00007-mv6, each serving 100% of traffic with service/revision maxima of one. Seven SQL migrations are installed. Secret references are API-only and pinned to version 1; runtime access is scoped to the four approved secrets. The existing customer-page hosted regression passed. WhatsApp currently remains disabled because the supplied Supabase value does not authorize the private server RPC; a corrected secret version is required before completing hosted WhatsApp checks and Meta webhook setup.


The Supabase credential correction is complete: API revision touchlumo-api-00011-m85 uses secret version 2, with the other three references still pinned to version 1. Full hosted WhatsApp server/UI checks pass and all temporary fixtures were removed. Meta reports the registered messages webhook active after its callback verification handshake. Real business-number authorization and CRM message delivery remain pending.
