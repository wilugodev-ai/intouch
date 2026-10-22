# Connect touchlumo.com directly to Cloud Run

Use Cloud Run domain mapping for touchlumo.com, keeping domain registration and
DNS at Hostinger. The website is the existing touchlumo-web service in
us-central1, project touchlumo-20261021. The API keeps its existing HTTPS Cloud
Run URL and Supabase remains the authentication/database provider. Firebase is
not used for this selected route; the earlier deploy/firebase configuration is
an undeployed alternative.

Google labels direct domain mapping Preview and does not recommend it for
production due to latency issues. This limitation was explained and the user
selected the direct route. It adds no Firebase Hosting or load balancer. Existing
Cloud Run/build/storage/network usage can still generate charges.

## Status: October 21, 2026

- Domain ownership is verified for the deployment account, wilugo91@gmail.com.
- The touchlumo.com mapping to touchlumo-web has been created in us-central1.
- Ready=True, CertificateProvisioned=True, DomainRoutable=True. HTTPS returns
  HTTP 200 with the Touchlumo login page. Chromium verified the page and all
  three browser/bookmark icon links.
- Prepared request: .data/cloud-run/domain-mapping-request.json (ignored).
- Public DNS snapshot: .data/cloud-run/domain-dns-before.json (ignored; this is
  a public-record snapshot, not a full Hostinger zone export).
- All four requested A and four AAAA records now match public and authoritative DNS.
- The Google ownership TXT remains published; no CAA restriction was found.
- www CNAME remains touchlumo.com; www has no separate Cloud Run mapping yet.
- Nameservers: nova.dns-parking.com and cosmos.dns-parking.com.
- API WEB_ORIGIN is https://touchlumo.com. Revision touchlumo-api-00005-64c
  serves all API traffic; service/revision maximums are both restored to 1.
- API health and domain CORS preflight passed. An anonymous CRM request from
  Chromium on the new domain returned 401 and was readable through CORS.
- The user confirmed Supabase Site URL is https://touchlumo.com and both exact
  root redirect URLs are saved. Existing redirect entries were retained.
- No real credentials, confirmation/recovery emails, or CRM writes were used
  during verification. SMTP and full account workflows still need their own check.

## Exact DNS records issued by Google

Replace the previous website A record (@ -> 2.57.91.91) with the four A records
below, and add the four AAAA records. Use TTL 300 if available. Keep the verified
Google TXT and unrelated/email records. The existing www record is unchanged;
www is not configured as an additional Cloud Run mapping yet.

| Type | Hostinger name | Content |
| --- | --- | --- |
| A | @ | 216.239.32.21 |
| A | @ | 216.239.34.21 |
| A | @ | 216.239.36.21 |
| A | @ | 216.239.38.21 |
| AAAA | @ | 2001:4860:4802:32::15 |
| AAAA | @ | 2001:4860:4802:34::15 |
| AAAA | @ | 2001:4860:4802:36::15 |
| AAAA | @ | 2001:4860:4802:38::15 |

Source: the live Cloud Run mapping status.resourceRecords, saved to the ignored
.data/cloud-run/domain-mapping-result.json on October 21, 2026.

## 1. Verify ownership

Open https://search.google.com/search-console/welcome?new_domain_name=touchlumo.com
with the deployment account. Choose Domain, enter touchlumo.com, and continue.
Copy the complete google-site-verification= value Google provides.

In Hostinger, open Domains > Domain portfolio > touchlumo.com > Manage >
DNS / Nameservers > DNS records. Add a TXT record with Name @ and the exact
Google value. Keep other records. Return to Search Console and click Verify.
Keep this TXT record after verification.

Google CLI check:

~~~powershell
gcloud domains list-user-verified --project touchlumo-20261021 --format=json
~~~

## 2. Create the mapping and retrieve exact routing records

Only after verification, create the mapping to the existing web service:

~~~powershell
gcloud beta run domain-mappings create --service touchlumo-web --domain touchlumo.com --project touchlumo-20261021 --region us-central1 --platform managed
gcloud beta run domain-mappings describe --domain touchlumo.com --project touchlumo-20261021 --region us-central1 --platform managed --format=json
~~~

If the portable CLI beta component is unavailable, the existing authenticated
Google access token can call the official regional REST endpoint instead:
https://us-central1-run.googleapis.com/apis/domains.cloudrun.com/v1/namespaces/touchlumo-20261021/domainmappings
Use the prepared DomainMapping request body for POST; GET lists current mappings.
Keep access tokens internal and never place them in a document or chat.

Read status.resourceRecords from Google's response. Copy all supplied A/AAAA
records to the apex in Hostinger, replacing only conflicting website routing
records. Do not guess Google IP addresses. Retain the Hostinger nameservers and
preserve email MX/SPF/DKIM/DMARC and unrelated TXT records. If CAA restrictions
exist, allow pki.goog and letsencrypt.org as Google requires.

The existing www CNAME does not establish www HTTPS by itself. A separate www
mapping and suitable application redirect/origin configuration must be added and
verified before advertising www as supported.

## 3. Wait for HTTPS, then finish application cutover

Google automatically issues and renews the certificate. Issuance usually takes
about 15 minutes but can take up to 24 hours. Check mapping readiness and the
actual https://touchlumo.com login page before changing the application origin.

1. Set the API WEB_ORIGIN to https://touchlumo.com; verify readiness, health and
   CORS from this origin. It controls generated invitation/registration links too.
   Keep the existing NEXT_PUBLIC_API_URL (Cloud Run HTTPS), so no web rebuild is
   required just for this domain.
2. In Supabase project qsecrqhxqfesdvintdmy, open Authentication > URL
   Configuration. Set Site URL to https://touchlumo.com and add
   https://touchlumo.com and https://touchlumo.com/ to Redirect URLs (this app
   redirects to its root, so no wildcard is needed). Retain
   required localhost and previous working entries during transition.
3. Verify login, authenticated API access, confirmation/recovery redirects,
   public registration and generated links. SMTP and sender validation are
   separate; no test emails or CRM writes have been performed for this setup.
4. Generate new shared QR codes/links after the origin change.

The deployment script now preserves the existing API WEB_ORIGIN on repeat
releases. An explicit -WebOrigin https://touchlumo.com overrides it at cutover;
without an existing API origin the initial run.app behavior is retained.

Rollback: restore the previous website DNS records and the API origin
https://touchlumo-web-swsowi5cua-uc.a.run.app together. Retain the previous
Supabase redirect entries until final verification. Do not remove the ownership
TXT when rolling back traffic.

## References

- [Cloud Run custom domains](https://docs.cloud.google.com/run/docs/mapping-custom-domains)
- [Domain mapping API](https://docs.cloud.google.com/run/docs/reference/rest/v1/namespaces.domainmappings/create)
- [Hostinger DNS management](https://support.hostinger.com/en/articles/1583249-how-to-manage-dns-records-at-hostinger)
