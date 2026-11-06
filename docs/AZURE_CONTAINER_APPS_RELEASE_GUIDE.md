# Scrolith Azure Container Apps release guide (Southeast Asia)

**Status: review-only candidate. No Azure resources, DNS records, images, or live data were changed.** This guide is not a deployment authorization or a production-readiness certification. Release is blocked until the items in [Known release blockers](#known-release-blockers) are closed and separately approved.

## 1. Source and candidate identity

This release candidate deliberately combines two separately maintained histories; it does **not** merge them together:

| Component | Candidate source | Pinned revision |
|---|---|---|
| Parent/backend repository | `scrolith-social/scrolith`, based on `backend/main` | `923ca7e25d4ee36ee00aa415eae2b6a60fc9777b` |
| Frontend submodule `geezle/` | `scrolith-social/scrolith`, `main` | `04ec1601cb1f58616d8d4c95269617e614974849` |
| Frontend correction in that history | frontend ancestor | `9fbbf40cd114cc8c4d349d653ebc781ba9b54dad` |

The parent repository records the frontend revision as a Git submodule gitlink. The local candidate updates that gitlink to the exact frontend `main` SHA and changes the submodule URL to the canonical HTTPS repository. Do not update it to a branch name or use a floating submodule reference. `main` and `backend/main` are divergent; do not merge either branch wholesale.

Before any release build, verify the checkout and both pins:

```powershell
git rev-parse HEAD
git -C geezle rev-parse HEAD
git submodule status
git status --short
```

The release record must include the final parent commit, frontend gitlink SHA, backend image digest, frontend image digest, SBOMs, provenance, and the source-to-image build run. The SHAs above are inputs, not image digests.

## 2. Cloud Shell startup choice

For the Azure Cloud Shell **Getting started** prompt shown in the setup screenshot:

1. Choose **No storage account required** for a temporary Cloud Shell session. It avoids creating or mounting a separate Cloud Shell file share. This setting does not create or remove the application's Blob Storage account.
2. Leave **Use an existing private virtual network** unchecked unless the Azure owner has identified and approved an existing VNet specifically for Cloud Shell access. This application design uses a dedicated application VNet; Cloud Shell networking is a separate choice.
3. Select the intended subscription, then Apply.

Cloud Shell is an operator terminal, not the deployment architecture. Do not paste secret values into shell commands, scripts, terminal transcripts, or browser screenshots.

## 3. Target architecture

All resources should be in **Southeast Asia (`southeastasia`)**, subject to each SKU's availability and quota:

```text
Browser ──HTTPS──> Container App: frontend (Nginx :8080)
   │                         │
   └──HTTPS api.scrolith.com─┴──> Container App: API (:5000)
                                      ├── private PostgreSQL Flexible Server (PG 17)
                                      ├── private Azure Blob Storage
                                      ├── Azure Managed Redis (Entra auth)
                                      └── Key Vault secret references (managed identity)

ACR (digest-pinned images) ── AcrPull managed identity ──> Container Apps
```

Recommended initial topology:

- One Container Apps **workload-profiles v2** environment in Southeast Asia, Consumption profile for initial cost modeling.
- Separate externally reachable frontend and API apps. Frontend ingress target is **8080**; API target is **5000**. Only ACA ingress is public; PostgreSQL, Blob, Redis, and Key Vault should use private networking/private endpoints and private DNS as supported by the selected SKU/network topology.
- PostgreSQL Flexible Server 17, private VNet integration, TLS required, backups/PITR enabled. The application runtime and migration job must use separate database roles and separate Key Vault secrets.
- Blob Storage with public access disabled. The current adapter uses `AZURE_STORAGE_CONNECTION_STRING`; it does **not** use Blob data-plane managed identity yet. Keep the container private; do not enable anonymous blob access to make URLs work.
- Azure Managed Redis with Microsoft Entra authentication for shared rate limiting and other Redis-backed controls. Use a dedicated user-assigned managed identity and the service's least-privilege data access policy. Do not ship a Redis access key in an environment variable.
- Key Vault with Azure RBAC and managed identity references for app secrets. Give each Container App identity `Key Vault Secrets User` only at the required vault scope; use a distinct registry-pull identity with `AcrPull` on ACR. Prefer separate identities for the API, frontend, migration job, and registry pull.
- ACR Basic is a lower-cost option with public registry endpoint and identity-authenticated image pulls. If policy requires a private ACR endpoint, Premium is required and adds cost; recalculate before selecting it.
- Log Analytics / Azure Monitor diagnostic settings for Container Apps system and console logs, PostgreSQL, Redis, Key Vault, Storage, and activity/audit events. Apply retention and redaction policy; do not log authorization headers, tokens, connection strings, or full OAuth/webhook payloads.

The first production-like deployment must run one API replica only. The backend starts scheduled/background tasks, and the code does not establish a distributed leader lock for all of them. Socket.IO is also not shown using a distributed adapter. Do not scale the API horizontally or enable multi-revision traffic splitting until worker leadership, duplicate-job safety, socket affinity/reconnect behavior, and cross-replica rate limiting are tested. The current code does use Redis for distributed rate limiting and fails closed for protected limits if Redis is unavailable.

## 4. Images and reproducible builds

The Dockerfiles pin base images by digest, use `npm ci`, and specify the official npm registry. Frontend build-time API origins are explicit:

- `VITE_BACKEND_URL=https://api.scrolith.com`
- `VITE_API_URL=https://api.scrolith.com/api`
- `VITE_PUBLIC_APP_DOMAIN=scrolith.com`
- Vite base path `/` (the Docker build passes `--base=/`)

Build only from a clean, reviewed checkout of the exact parent commit and submodule gitlink. Use unique source-derived tags for traceability, then deploy **OCI digests**, never `latest` or another mutable tag. Tag names are not immutable; record the resolved digest and configure the Container App with `repository@sha256:<digest>`.

Example local build commands for a later approved release build (they do not push or deploy):

```powershell
docker build --pull -f deploy/docker/backend.Dockerfile --target runtime `
  -t <ACR_NAME>.azurecr.io/scrolith-backend:src-<PARENT_SHA> .

docker build --pull -f deploy/docker/backend.Dockerfile --target migrator `
  -t <ACR_NAME>.azurecr.io/scrolith-backend-migrator:src-<PARENT_SHA> .

docker build --pull -f deploy/docker/frontend.Dockerfile `
  --build-arg VITE_BACKEND_URL=https://api.scrolith.com `
  --build-arg VITE_API_URL=https://api.scrolith.com/api `
  --build-arg VITE_PUBLIC_APP_DOMAIN=scrolith.com `
  -t <ACR_NAME>.azurecr.io/scrolith-frontend:src-<PARENT_SHA> .
```

These are templates only. Do not push until the independent release gates pass. Scan both runtime images, generate SBOMs and provenance, check the compiled frontend for unintended hosts/secrets, and record their registry digests. The `migrator` target is a one-shot migration image and must never be used as the long-running API app.

## 5. Container App settings and health

| App | Ingress | Target | Initial replica policy | Probe |
|---|---|---:|---|---|
| Frontend | External HTTPS | `8080` | Minimum 1; initially maximum 1 | `/` |
| API | External HTTPS | `5000` | Minimum 1; maximum 1 until worker/socket gates close | `/api/health` liveness; `/api/readyz` readiness |

`/api/health` is the lightweight liveness endpoint. `/api/readyz` checks readiness dependencies including PostgreSQL; configure ACA readiness behavior from observed response and timeout measurements. Do not use a DB-dependent readiness failure as a liveness restart signal. Verify WebSocket and long-polling Socket.IO through ACA ingress; do not assume the HTTP health probe proves realtime connectivity.

Set the backend environment to `NODE_ENV=production` and `PORT=5000`. Set the frontend public build arguments above before building—these are public browser values, never secrets. Set explicit CORS origins to only `https://scrolith.com` and `https://www.scrolith.com`; configure the API's public URL as `https://api.scrolith.com`. Do not add temporary ACA revision hostnames to production CORS unless a separately reviewed staging configuration requires them.

## 6. Database, migration, storage, and identity setup

### PostgreSQL

1. Create a new PostgreSQL Flexible Server 17 in Southeast Asia on private networking. Do not use an existing database unless the data owner explicitly approves the migration and rollback plan.
2. Require TLS (`sslmode=require`) and use private DNS/networking from the ACA environment.
3. Create separate `scrolith_runtime` and `scrolith_migrator` identities/roles. The runtime role must not own the schema and must not have DDL, trigger alteration, table truncation, or immutable-ledger delete privileges. The migration role may receive only the DDL privileges needed for the reviewed migrations, and it is used only by the one-shot migration job.
4. Store separate full connection URLs as Key Vault secrets, for example `scrolith-database-runtime-url` and `scrolith-database-migrator-url`. Do not put either URL in shell history, a Bicep parameter file, source, an image, or logs. Each URL includes a different database user; set the migrator URL as the `DATABASE_URL` environment variable only for the one-off migrator job.
5. Apply migrations with the exact approved migrator image digest using `prisma migrate deploy`. Do not run `migrate dev`, `migrate reset`, `db push`, seeds, or repair scripts against production. Review migration SQL and the backup/restore plan before the first application.

The repository has 139 Prisma migrations. A clean local PostgreSQL 17 replay completed all 139, but this is not a review of every migration's effect on pre-existing production data and does not verify production database roles. Historical migration SQL includes drops/renames. Use only a new database for initial launch unless a separate migration review approves otherwise.

### Blob Storage

Create a Standard General-purpose v2 Storage Account with Hot LRS, HTTPS-only, minimum TLS 1.2, public network access disabled after private endpoint/DNS verification, and anonymous blob access disabled. Create a private `uploads` container; enable soft delete/versioning and lifecycle retention according to the owner's recovery/privacy policy. Put the required `AZURE_STORAGE_CONNECTION_STRING` in Key Vault and reference it from the API app using managed identity. This is a shared-key credential retrieved through Key Vault, **not** direct managed-identity authorization to Blob. Rotate it through Key Vault and the storage account without placing it in command arguments.

**Release blocker:** `uploadBufferToBlob()` returns direct Blob URLs, and not every consumer is proven to route private content back through an authenticated API proxy. Private containers can therefore break media previews; public containers would expose uploads. Confirm all upload/download paths and fix/validate them before enabling uploads. The API also uses in-memory Multer buffering and accepts large uploads; measure peak memory and enforce a safe request-size/concurrency limit before production.

### Redis and Key Vault

- Configure `REDIS_URL` as the private TLS endpoint from the selected Azure Managed Redis instance. Configure `REDIS_ENTRA_CLIENT_ID` and `REDIS_ENTRA_OBJECT_ID` from the dedicated managed identity. These are identifiers, not credentials. Grant that identity only the Redis data permissions required by the code and verify the chosen Redis SKU supports the required Entra policy and private networking.
- Configure ACA Key Vault references using a user-assigned managed identity available before app creation, or create the app identity first and then add references. Assign Key Vault Secrets User at the narrowest supported scope. Use versioned secret URIs for controlled releases or versionless URIs only with an explicit rotation/restart procedure.
- Enter secret **values** in the Azure Portal Key Vault secret blade or an approved secrets-management workflow. Do not pass secret values in CLI flags, source, parameter files, frontend build args, or shell history. Never export a secret to inspect it in a pipeline log.

## 7. Environment-variable checklist

Configure only what is approved and actually used. Names below are from this backend source; never print their values.

| Purpose | Variables / setting | Handling |
|---|---|---|
| Core API | `NODE_ENV`, `PORT`, `DATABASE_URL`, `JWT_SECRET` | `DATABASE_URL` and `JWT_SECRET` are Key Vault references. Runtime DB URL must use the restricted runtime role. |
| Public origin and browser access | `FRONTEND_URL=https://scrolith.com`, `FRONTEND_ORIGIN=https://scrolith.com`, `PUBLIC_APP_URL=https://scrolith.com`, `CORS_ALLOWED_ORIGINS=https://scrolith.com,https://www.scrolith.com` | Non-secret; exact HTTPS origins only. |
| Redis | `REDIS_URL`, `REDIS_ENTRA_CLIENT_ID`, `REDIS_ENTRA_OBJECT_ID` | Private TLS URI and identity IDs; do not use a Redis password/key fallback. Validate auth from the running API identity. |
| Uploads | `UPLOAD_DRIVER=azure_blob`, `AZURE_STORAGE_CONNECTION_STRING`, `AZURE_STORAGE_CONTAINER=uploads` | Connection string via Key Vault. `AZURE_BLOB_BASE_URL` is not a fix for a private-container access failure. |
| Optional OAuth | `GOOGLE_OAUTH_CALLBACK_URL`, `LINKEDIN_OAUTH_CALLBACK_URL` plus provider credentials/settings supported by the current auth configuration | Register exact callback URLs with the providers; do not enable a provider until client credentials, verified domains, consent, and account-linking behavior are approved. |
| Optional email | `EMAIL_PROVIDER`, `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASS`, `EMAIL_FROM_NAME`, `EMAIL_FROM_EMAIL`, `EMAIL_ENCRYPTION` (or the documented provider-specific names) | Secrets via Key Vault; test delivery with a dedicated sender and synthetic account before launch. |
| Optional AI | `SCROLITHA_PROVIDER=disabled` until a real approved endpoint is configured; otherwise `SCROLITHA_CORE_ENDPOINT`, `SCROLITHA_CORE_MODEL` and any required auth settings | Do not point at a local loopback/Ollama endpoint from Azure. Provider and privacy review required. |

`EXTERNAL_PLATFORM_API_ENABLED` is not introduced or set by this candidate. Keep the external-platform API unavailable/off; do not add a public developer integration gate as part of Azure setup. If the Developer Platform credential-hashing feature is later separately authorized, provision `DEV_PLATFORM_HASH_PEPPER` as a Key Vault secret with at least 32 UTF-8 bytes. The local fallback was removed; do not reintroduce a development fallback. Do not configure this feature merely to make this release start.

Do not configure Stripe, payout, wallet, SMTP, OAuth, KYC, push, or AI secrets until the respective provider/account, environment, feature authorization, and operational owner have been confirmed. `VITE_*` values are embedded in the public bundle and can never hold credentials.

## 8. Namecheap DNS and TLS (placeholders only)

Do not change current DNS until the owner approves a cutover window and the new services pass smoke tests. Azure must first return the exact app FQDNs, environment inbound IP, and domain-validation ID. Never guess or copy values from another environment.

| Type | Name/host | Value to enter only after Azure supplies it |
|---|---|---|
| `A` | `@` | `<EXACT_EXTERNAL_CONTAINER_APPS_ENVIRONMENT_INBOUND_IP>` |
| `TXT` | `asuid` | `<EXACT_APEX_DOMAIN_VERIFICATION_ID>` |
| `CNAME` | `www` | `<EXACT_FRONTEND_CONTAINER_APP_FQDN>` |
| `TXT` | `asuid.www` | `<EXACT_WWW_DOMAIN_VERIFICATION_ID>` |
| `CNAME` | `api` | `<EXACT_API_CONTAINER_APP_FQDN>` |
| `TXT` | `asuid.api` | `<EXACT_API_DOMAIN_VERIFICATION_ID>` |

Confirm Azure's Custom Domains blade specifies the record type/value for each hostname. For an apex custom domain, ACA uses an A record to the environment IP and a TXT `asuid` validation record; subdomains use a CNAME to the exact app FQDN and a corresponding `asuid.<subdomain>` TXT. Add/bind domains and managed certificates only after DNS verification. The Nginx frontend config redirects `www.scrolith.com` to `https://scrolith.com`; both domains must be correctly bound and TLS-secured.

The current Nginx config uses `api.scrolith.com` for preconnect and the frontend build uses the same API origin. Do not point public DNS to an ACA default FQDN permanently or alter MX, SPF, DKIM, or DMARC records used by Zoho.

## 9. Release validation and go/no-go gates

### Completed locally for this candidate

- Frontend clean `npm ci` from `registry.npmjs.org`: passed; lockfile unchanged.
- Frontend production build with explicit API origins and root base path: passed; output was outside the repository.
- Static scan of the 432-file frontend build output found the expected `https://api.scrolith.com` origin, no recorded staging ACA hostname, and no hits for the checked common private-key/payment-token markers. This heuristic is not a complete secret scanner.
- Frontend certification unit tests: 54/54 passed.
- Mobile unit suite: 606/609 passed. The verified frontend source has no `mobile/` directory; one additional legacy assertion expects admin checks inline although the backend uses an authorization helper. This is a validation failure, not a pass.
- Backend clean `npm ci` from the official registry: passed; lockfile unchanged.
- Prisma Client generation and `prisma validate`: passed with a synthetic loopback URL; no database connection was made by those commands.
- Focused Developer Platform pepper tests: 1 suite, 2 tests passed using a synthetic value; no database/provider call.
- All 139 migrations applied successfully to a newly created local disposable PostgreSQL 17 database. The disposable container was removed. This does not test Azure networking, production role grants, or application compatibility with existing data.
- `npm audit --omit=dev --audit-level=high --registry=https://registry.npmjs.org`: frontend failed with 6 findings (3 critical, 2 high, 1 moderate); backend failed with 49 findings (33 high, 15 moderate, 1 low). No lockfile changes or automatic fixes were made. Release is blocked until reviewed dependency remediation is complete.
- Local backend Docker build was attempted twice and stopped after its in-container locked `npm ci` layer remained without completion/output for several minutes. A separate disposable Node container successfully queried the official npm registry. Docker image build therefore remains **unverified**, not passed; no registry image/digest exists.
- Parent and frontend images have **not** been pushed to Azure; no remote image digest exists.

### Required before any image publication

1. Re-run backend `npm run build:prod` at the final committed candidate SHA (the current isolated working-tree run passed, exit 0).
2. Run the complete backend unit and disposable-DB suites, and the frontend/mobile suites with documented dispositions for the existing failures.
3. Build all three local Docker targets (`runtime`, `migrator`, frontend), run container smoke tests on ports 5000/8080, and scan the images. Inspect the final Vite assets for endpoints/secrets and validate Nginx fallback, cache, and health behavior.
4. Test API CORS/preflight from the exact intended frontend origins, authentication/OAuth callback flows, Socket.IO polling and WebSocket, uploads/downloads, and DB readiness against isolated test infrastructure.
5. Independently review database migration permissions, Redis managed identity, Key Vault resolution, private DNS, ACA ingress and network security, and provider setup.
6. Close the upload/private-Blob, worker duplication, Socket.IO scale-out, migration rollback, startup security-default, and email/OAuth ownership issues listed below.
7. Have an independent reviewer approve the source and an owner approve production configuration, cost ceiling, DNS cutover, monitoring alerts, backups, and rollback window.

### Known release blockers

- **High — private uploads:** Blob adapter's connection-string auth and direct returned URLs are not yet proven compatible with private Blob access. Public access is not an acceptable workaround.
- **High — upload memory:** API uploads are buffered in process memory; no production concurrency/size test has been completed.
- **High — background jobs:** scheduled workers may run in every replica and lack a verified distributed leader guard. Keep API max replicas at 1; this remains a single-instance availability and rolling-deployment duplication risk.
- **High — realtime scale:** no Socket.IO Redis adapter has been verified. Do not scale API or split traffic until tested.
- **High — database operations:** all 139 migrations replay cleanly on empty PG17, but history includes destructive/renaming statements. Existing-data migration, runtime-role grants, and backward-compatible rollback have not been approved.
- **High — release validation:** mobile suite has three failures as described; full backend/browser production integration was not run; Docker image build, container smoke tests, and image scan are outstanding.
- **Critical — dependencies:** current official-registry production audits report 3 critical and 2 high findings in frontend runtime dependencies, and 33 high findings in backend production dependencies. Review advisories, upgrade compatible direct/transitive dependencies in a separate reviewed change, and rerun builds/tests/audits before image publication.
- **Medium — providers:** OAuth, SMTP/Zoho, Stripe, KYC, push, and AI provider credentials/settings are not verified. Do not infer readiness from source code.
- **Medium — external platform:** separate integration work is not enabled or part of this release. The candidate does not provision `DEV_PLATFORM_HASH_PEPPER`.

## 10. Rollback procedure

Rollback is an operational plan to review; do not execute without release-owner approval.

### Container Apps

1. Keep the previously approved app revision active and record its exact image digest and environment configuration before rollout.
2. Deploy the new digest as a new revision. For the first release, validate it on a non-production hostname/isolated environment before changing production DNS or traffic.
3. On failure, route 100% traffic back to the recorded previous healthy revision (or restore the previous digest as a new revision). Do not use a mutable tag to identify a rollback image.
4. Verify liveness/readiness, sign-in, API CORS, uploads, Socket.IO, error rate, latency, and logs before ending rollback monitoring.

### Database and Blob

- Do not run reverse SQL or `prisma migrate reset`. Before migration, take/verify a PostgreSQL backup and confirm PITR retention. If recovery is needed, restore to a **new** server at a selected point in time, validate it, and only then approve a connection cutover; never overwrite the original source server as the first recovery action.
- App rollback is safe only if the old app binary remains compatible with the migrated schema. Because this has not been proven for an existing populated database, require an explicit migration compatibility review before production migration.
- Enable Blob versioning/soft delete and retain recovery policy. Do not bulk-delete or rewrite blobs during a code rollback. Restore the prior app digest and keep the same private access policy.
- DNS rollback uses the recorded old DNS values and TTL. Change only the approved `@`, `www`, and `api` records; do not modify mail records. Wait for DNS/TTL propagation and verify TLS.

## 11. Indicative monthly cost (USD, Southeast Asia)

Planning estimate only, based on public retail-rate evidence available **2026-11-06**. It assumes 730 hours/month, one small API replica (1 vCPU/2 GiB) and one frontend replica (0.25 vCPU/0.5 GiB), low volume, no HA, 32 GB PostgreSQL storage, 20 GB Blob, 2 GB total ACR image layers, three private endpoints, and no discounts/tax/support. Actual subscription rates, free grants, usage, SKU availability, network design, log ingestion, and Redis price must be checked in the Azure Pricing Calculator before buying anything.

| Component | Assumption | Estimated monthly USD |
|---|---|---:|
| Container Apps frontend + API | Consumption; frontend idle-to-active, backend kept active by background work; unused subscription grant may reduce amount | **$111–$138** |
| PostgreSQL Flexible Server compute | Burstable B1ms at $0.026/hour × 730 | $18.98 |
| PostgreSQL storage | 32 GB at $0.138/GB-month | $4.42 |
| PostgreSQL backup | 7-day retention; within included backup allowance up to provisioned DB storage | $0 baseline; overage varies |
| Managed Redis | B0, one node, planning placeholder $0.04/hour × 730 | $29.20* |
| ACR | Basic $0.1666/day × 30 plus 2 GB image storage at $0.10/GB-month | $5.20 |
| Blob Storage | 20 GB Hot LRS at $0.02/GB-month plus modest transaction allowance | $0.75 |
| Blob/app internet egress | 50 GB/month planning amount; first free allowance may offset some/all, otherwise about $0.087/GB | $0–$4.35 |
| Private Link | 3 endpoints, data processing included; endpoint meter is region/account-specific in the calculator | $0–$21.90+ planning range |
| Private DNS | Four zones, low query volume (planning allowance) | ~$2+ |
| Key Vault | Low secret-operation volume | ~$0.10 |
| Azure Monitor / Log Analytics | 5 GB/month ingestion within assumed free grant; above that use $2.99/GB in the retail data snapshot | $0; +$2.99/GB over grant |
| **Indicative total** | Low traffic, one region, no HA, excludes taxes/support/provider charges | **approximately $172–$225/month** |

`*` The Azure Managed Redis official pricing page displays SKU/feature options but does not expose the Southeast Asia B0 numeric rate in the page text; the $0.04/hour planning figure is from a third-party mirror of the Azure Retail Prices API, not a binding quote. Replace it with the portal calculator's actual offer before approval. Private Link and DNS figures are planning ranges because the official pricing page is region/account-calculated. The estimate assumes the Azure 100-GB monthly outbound bandwidth allowance and first 5 GB/month Log Analytics ingestion allowance are unused; those benefits are subscription-wide, so other workloads may consume them first. Costs can exceed this range with active CPU, extra replicas, higher log volume, upload/egress traffic, database growth, or required HA. Add about $2.99 per Log Analytics GB beyond the assumed free allowance in the current retail snapshot. **This baseline exceeds the requested USD 50/month threshold.** It is intentionally not a production HA recommendation; B1ms PostgreSQL and one-node Redis are single-region, low-capacity choices.

Use the [Azure Pricing Calculator](https://azure.microsoft.com/pricing/calculator/) with the exact subscription/region and current SKUs. Use the official [Azure Retail Prices API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices) for repeatable public rate checks. Container Apps consumption pricing and free grants are documented [here](https://learn.microsoft.com/en-us/azure/container-apps/billing); PostgreSQL pricing is [here](https://azure.microsoft.com/en-us/pricing/details/postgresql/flexible-server/); Redis pricing is [here](https://azure.microsoft.com/en-us/pricing/details/managed-redis/).

## 12. Official operational references

- [Container Apps networking](https://learn.microsoft.com/en-us/azure/container-apps/networking)
- [Container Apps custom domains and managed certificates](https://learn.microsoft.com/en-us/azure/container-apps/custom-domains-managed-certificates)
- [Container Apps Key Vault references and managed identities](https://learn.microsoft.com/en-us/azure/container-apps/manage-secrets)
- [Container Apps managed-identity image pulls from ACR](https://learn.microsoft.com/en-us/azure/container-apps/managed-identity-image-pull)
- [PostgreSQL Flexible Server private networking](https://learn.microsoft.com/en-us/azure/postgresql/flexible-server/concepts-networking-private)
- [PostgreSQL backup and restore/PITR](https://learn.microsoft.com/en-us/azure/postgresql/backup-restore/concepts-backup-restore)
- [Azure Managed Redis private link](https://learn.microsoft.com/en-us/azure/redis/private-link)
- [Azure Managed Redis security and Entra authentication](https://learn.microsoft.com/en-us/azure/redis/secure-azure-managed-redis)
- [Azure Private Link pricing](https://azure.microsoft.com/en-us/pricing/details/private-link/)
- [Azure free services and bandwidth allowance](https://azure.microsoft.com/en-au/pricing/free-services)
- [Azure Monitor cost and usage](https://learn.microsoft.com/en-us/azure/azure-monitor/usage-estimated-costs)
- [Azure Monitor diagnostic settings for Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/log-options)
