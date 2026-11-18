# Scrolith Azure Container Apps release guide (Southeast Asia)

**Status: review-only candidate. No Azure resources, DNS records, images, or live data were changed.** This guide is not a deployment authorization or a production-readiness certification. Release is blocked until the items in [Known release blockers](#known-release-blockers) are closed and separately approved.

## 1. Source and candidate identity

This release candidate deliberately combines two separately maintained histories; it does **not** merge them together:

| Component | Candidate source | Pinned revision |
|---|---|---|
| Parent/backend base | `scrolith-social/scrolith`, `backend/main` | `923ca7e25d4ee36ee00aa415eae2b6a60fc9777b` |
| Local parent candidate commit | remediation worktree base (the parent worktree is modified) | `425a4111815465425e55a8e8ef2530cc49bc7eee` |
| Frontend base gitlink | `scrolith-social/scrolith`, `main` | `04ec1601cb1f58616d8d4c95269617e614974849` |
| Local frontend submodule commit | local-only fix for official-registry lockfile URLs and the admin-policy test | `30399bfbd555e325c790a92b75eb6fcde078ca70` |
| Frontend correction in the existing history | ancestor of the local frontend commit | `9fbbf40cd114cc8c4d349d653ebc781ba9b54dad` |

The parent repository records the frontend revision as a Git submodule gitlink. The remediation worktree points that gitlink to `30399bfbd555e325c790a92b75eb6fcde078ca70`. The canonical remote `main` still points to `04ec1601cb1f58616d8d4c95269617e614974849`; the local submodule commit has not been published and cannot yet be fetched by a clean clone. Its parent worktree changes also remain uncommitted. Therefore the image evidence below is for the exact local working snapshot, not for a clean, remotely reproducible release commit. Publish the reviewed frontend commit first and then publish a parent commit that pins it; do not use a branch name or floating submodule reference. `main` and `backend/main` are divergent; do not merge either branch wholesale.

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
- Blob Storage with public access disabled. Production uses `AZURE_STORAGE_ACCOUNT_URL`, `AZURE_STORAGE_CONTAINER`, and `AZURE_STORAGE_AUTH_MODE=managed_identity`; a connection string is rejected in production. The API uses a user-assigned managed identity. Local/test connection strings remain supported only outside production. Keep the container private; do not enable anonymous blob access to make URLs work.
- Azure Managed Redis with Microsoft Entra authentication for shared rate limiting and other Redis-backed controls. Use a dedicated user-assigned managed identity and the service's least-privilege data access policy. The API Bicep template attaches this identity and accepts its resource, client, and object IDs separately from the Blob/Key Vault API identity. Do not ship a Redis access key in an environment variable.
- Key Vault with Azure RBAC and managed identity references for app secrets. Give each Container App identity `Key Vault Secrets User` only at the required vault scope; use a distinct registry-pull identity with `AcrPull` on ACR. Prefer separate identities for the API, frontend, migration job, and registry pull.
- ACR Basic is a lower-cost option with public registry endpoint and identity-authenticated image pulls. If policy requires a private ACR endpoint, Premium is required and adds cost; recalculate before selecting it.
- Log Analytics / Azure Monitor diagnostic settings for Container Apps system and console logs, PostgreSQL, Redis, Key Vault, Storage, and activity/audit events. Apply retention and redaction policy; do not log authorization headers, tokens, connection strings, or full OAuth/webhook payloads.

The API deployment configuration in [`deploy/azure/api-containerapp-single-replica.bicep`](../deploy/azure/api-containerapp-single-replica.bicep) sets `minReplicas=1`, `maxReplicas=1`, and `activeRevisionsMode=Single`. It is an enforceable per-app limit only when the reviewed template is applied. Scheduled jobs now use a PostgreSQL session advisory lock as a best-effort cross-process overlap guard; the lock is released with its database session and does not provide durable queuing, fencing, or exactly-once completion if a worker fails mid-job. Socket.IO presence and rooms remain process-local, and no Redis Socket.IO adapter is configured. Keep the single-replica/single-active-revision topology; it limits concurrent copies but does not eliminate restart interruption or establish horizontal realtime correctness. Before scaling out, add and test durable job ownership/recovery and cross-replica Socket.IO presence/room behavior. Redis remains used for distributed rate limiting, with protected limits failing closed when Redis is unavailable.

The media-processing implementation is not yet Azure-ready. `mediaProcessingQueue.ts` supports disabled, in-process `inline_async`, and `cloud_tasks` modes. The `cloud_tasks` adapter calls Google Cloud Tasks and signs tasks for the Google-OIDC-protected `mediaWorkerApp`; it is not Azure Service Bus or an Azure Container Apps Job integration. `inline_async` is process-local, best-effort, and loses queued work on process exit. The worker entry point is not wired into the current Azure templates. Keep media processing disabled in the Azure candidate until an Azure-native durable queue/worker design (or an explicitly approved cross-cloud dependency) is implemented and tested for retries, deduplication, poison messages, shutdown, and recovery.

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
3. Create separate `scrolith_runtime` and `scrolith_migrator` login roles. The templates [`scrolith-runtime-migrator-roles.sql`](../deploy/postgres/scrolith-runtime-migrator-roles.sql) and [`scrolith-runtime-finalize.sql`](../deploy/postgres/scrolith-runtime-finalize.sql) contain no passwords and stop unless an operator explicitly opts in. They are for a **fresh disposable/new database only**, not an existing database. Runtime receives application DML but no schema `CREATE`, object ownership, `TRIGGER`, or `TRUNCATE` privileges; default privileges cover migrator-created objects, and the finalizer removes runtime access to `_prisma_migrations`. The migrator is used only for reviewed one-shot migrations. Verify effective grants and ownership after replay; local tests do not verify Azure's deployed roles.
4. Store separate full connection URLs as Key Vault secrets, for example `scrolith-database-runtime-url` and `scrolith-database-migrator-url`. Do not put either URL in shell history, a Bicep parameter file, source, an image, or logs. Each URL includes a different database user; set the migrator URL as the `DATABASE_URL` environment variable only for the one-off migrator job.
5. Apply migrations with the exact approved migrator image digest using `prisma migrate deploy`. Do not run `migrate dev`, `migrate reset`, `db push`, seeds, or repair scripts against production. Review migration SQL and the backup/restore plan before the first application.

The repository has 141 Prisma migration directories. A clean local PostgreSQL 17 replay completed all 141, and a synthetic populated-schema upgrade from 140 to 141 completed. This is not a review of every migration's effect on pre-existing production data and does not verify managed-database behavior or production roles. Historical migration SQL includes drops/renames. Use only a new database for initial launch unless a separate migration review approves otherwise.

### Blob Storage

Create a Standard General-purpose v2 Storage Account with Hot LRS, HTTPS-only, minimum TLS 1.2, public network access disabled after private endpoint/DNS verification, and anonymous blob access disabled. Create the private `uploads` container before starting the API; runtime no longer creates containers. Grant the API user-assigned identity `Storage Blob Data Contributor` only at the container scope, or a narrower validated data-plane role. Do not configure a production connection string. Production requires the standard account endpoint, `AZURE_STORAGE_AUTH_MODE=managed_identity`, and optionally the user-assigned identity client ID.

Azure file responses use the authenticated `/api/files/content/:id` route. Azure video-thumbnail references are stored internally and returned through the same route with `?variant=thumbnail`; access follows the parent file's existing public/private rules. Azure uploads are disk-backed, retain the 500 MiB per-file cap, reject when two Azure uploads are already active per API process, and stream Blob blocks using an 8 MiB buffer with SDK concurrency 2. Database-write failure triggers best-effort cleanup of uploaded blobs. This reduces in-process buffering but does not prove 500 MiB uploads are operationally acceptable; load, slow-client, and disk-capacity tests remain release gates. Keep the container private and configure soft delete/versioning and retention with the data owner.

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
| Uploads | `UPLOAD_DRIVER=azure_blob`, `AZURE_STORAGE_AUTH_MODE=managed_identity`, `AZURE_STORAGE_ACCOUNT_URL`, `AZURE_STORAGE_CONTAINER=uploads`, optional `AZURE_STORAGE_MANAGED_IDENTITY_CLIENT_ID` | No connection string in production. The API UAMI needs scoped Blob data-plane authorization. `AZURE_BLOB_BASE_URL` is not an authorization mechanism or a workaround for private access. |
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

### Historical local validation (through 2026-11-06; superseded below)

- The frontend lockfile was corrected to official `registry.npmjs.org` tarball URLs while preserving integrity metadata; exact Capacitor peer versions were reconciled, and the stale admin-role test now follows the maintained shared policy helper. The resulting local submodule commit is `30399bfbd555e325c790a92b75eb6fcde078ca70`; it is not on remote `main` yet. A clean frontend `npm ci` from the official registry installed 831 packages in about 253 seconds with lifecycle scripts enabled. Slow individual tarball responses explained the earlier apparent stall; no integrity or lifecycle failure was observed. The Dockerfiles explicitly select the official registry and retry slow fetches.
- Frontend production build passed with explicit API origins and root base path. Static inspection of generated assets found the expected `https://api.scrolith.com` origin, no staging ACA hostname, and no matches for checked private-key/payment-token markers; this heuristic is not a complete secret scan.
- Frontend certification unit tests: 54/54 passed. Mobile unit tests: 624/624 passed across 7 suites after setting the required local source-root variables. This is not Android/iOS native build validation.
- Backend focused tests: 6 suites, 35/35 tests passed (upload limits, concurrency limit, Azure upload persistence, Blob auth, Azure file access, media storage). The production TypeScript compilation and `npm run build:prod` passed as part of the container builder stage. The full backend Jest/browser integration suite was not run.
- Official npm registry production audits exited 0 with zero reported vulnerabilities for both applications. Frontend audit covered 274 production dependencies; backend audit covered 604. These exclude development dependencies and do not constitute a blanket dependency certification.
- All three Docker targets built successfully from the current local working snapshot. Local image IDs (not registry manifest digests) and sizes: frontend `sha256:6d9f3a40f71583b2da0a46bb5b4d4e3c7906f51c5a1d5178fc644a0c995011b7` (129,396,294 bytes); backend runtime `sha256:7d02542ea6fd66368565d8acc5989be84e6d2e73fdfdf5de4ed868d73957b9ac` (1,027,032,352 bytes); migrator `sha256:3cc680cf223d7131658a303102e09572e81bf2ec77fb7770bfe5f7380829d7d5` (1,291,032,039 bytes). Trivy 0.76.2, verified against Aqua Security's official release checksum, scanned all three images against the local vulnerability DB refreshed 2026-11-06: frontend and backend runtime reported zero; the migrator report contains High `braces@3.0.3` (CVE-2026-93687) and Medium `sprintf-js@1.0.3` (CVE-2026-97058). The current GitHub-reviewed advisories for both packages are withdrawn (braces on 2026-10-23 as not practically exploitable; sprintf-js on 2026-10-22); Trivy's refreshed DB still emits the records. Treat this as a scanner/advisory-feed discrepancy requiring documented reviewer disposition or a scanner DB correction—not as confirmation of an active vulnerability and not as a clean raw scan. Both packages arrive through development-dependency paths inherited by the migrator from the builder, making the migrator image 1.29 GB; a separately minimized migrator remains a follow-up. No images were pushed; no registry digest, SBOM, or provenance was produced.
- Frontend static container smoke returned HTTP 200 for `/` and `/login`. Backend container smoke against a disposable PostgreSQL 17 database and local Redis returned HTTP 200 for `/api/health` and `/api/readyz` in development mode with synthetic settings. A production-mode readiness attempt without Azure managed identity returned 429/not-ready, as expected for a missing protected Redis identity; actual Azure identity, Key Vault, private networking, and Blob access have not been tested. The backend Docker health probe had not completed its next interval at the time of inspection, so no `healthy` container status is claimed.
- Prisma clean replay applied all 139 migration directories to a fresh disposable PostgreSQL 17 database; the migration ledger contained 139 completed rows. Prisma schema validation and migration status passed. This establishes clean replay only, not effects on populated data or Azure networking.
- Disposable PostgreSQL role checks confirmed runtime can connect and has schema USAGE, but lacks schema CREATE, ownership, TRIGGER, TRUNCATE, migration-ledger access, and DELETE on `Transaction`, `GcoinTransaction`, `PaymentSettlement`, and `WalletFundingIntent`. Runtime UPDATE remains granted; source workflows update transaction status, so blanket UPDATE removal would break supported paths. No trigger makes those tables immutable; the deployed production role remains unverified. The migrator performed all 141 migrations. Temporary databases and roles were disposable-only.
- Focused Blob/auth/upload tests exercise mocked identity, private API authorization, bounded upload concurrency, and best-effort cleanup. Real Azure Blob authorization, slow-client/load behavior, process-crash temp cleanup, and deployed identity/network policy remain untested.
- Full browser flows (CORS/preflight, authenticated sign-in/OAuth, Socket.IO polling/WebSocket, upload/download against an authenticated UI) were not run in that earlier review.

### 2026-11-13 local validation update (current candidate; not a release approval)

- **Source identity:** root `425a4111815465425e55a8e8ef2530cc49bc7eee`; frontend gitlink and local submodule `30399bfbd555e325c790a92b75eb6fcde078ca70`. The frontend commit is not available from the canonical remote, so a clean external checkout cannot reproduce this candidate yet. All validation outputs are local and stored outside this worktree.
- **Frontend install/build:** a no-cache Docker build from the final local frontend working tree completed a clean `npm ci` (892 packages; lifecycle scripts and integrity checks enabled) and Vite production build. Local frontend image ID: `sha256:97ef5dffb80c04d9f43b4bea62a39192d80b080090d164eea66885d3710c2bf8`. Nginx configuration validation succeeded; static `/`, `/login`, `/signup`, and `/jobs` returned HTTP 200. The bundled assets contained the configured public API origin and no detected staging-host or secret-marker matches. This is local evidence for the dirty submodule working tree, not an externally reproducible immutable source build.
- **Frontend tests/types:** intended Vitest set passed 29 files / 157 tests; the explicit API-origin regression passed 1 file / 2 tests; certification unit suite passed 54/54; mobile unit suite passed 624/624 with explicit local source-root variables. The broad Vitest auto-discovery command failed because it picked up Jest-style files; it is not the intended runner. On 2026-11-15, `npm run typecheck:production` exited 2 with 135 diagnostics after removing a duplicate `is_featured` declaration; the field remains declared once. The earlier clean-main comparison (207 baseline / 187 candidate, zero candidate-only diagnostics) predates this run and is not a current same-snapshot differential. The 135 remaining diagnostics are not suppressed and the production typecheck is not passing.
- **Certification authentication:** the prior local Playwright run reported 43 passed, 11 skipped, 3 failed. Failures were an iPhone feed probe (`no_post_cards`) and two notification cases redirected to `/auth/login`. Review found setup swallowed a failed login assertion and wrote state anyway; when auth state was created during setup, dependent projects also failed to select that new state. The current local source now fails closed on missing login/token, supplies generated state to credentialed projects, stores it under the OS temporary directory, and requires explicit target/API origins rather than inferring the public API host. With no local certification credentials or authenticated storage state configured, the focused local-target rerun skipped all 8 tests; it is not a pass. Signup/Human Verification and device-approval are not proven by authenticated browser coverage.
- **Backend:** production audit against `registry.npmjs.org` reported zero vulnerabilities; the audited lockfile SHA-256 is `BCFCCC7D083E4F42F94775BF44D99CC2BE0F1079ED6931E6322C887B73C9211F`. Production build passed. Full Jest completed 215 suites (214 passed, 1 gated) and 1,338 tests (1,328 passed, 10 pending, 0 failed). All 10 pending tests are in the explicitly gated community financial-history runtime HTTP suite and require `SCROLITH_ROLE_HTTP_TEST_APPROVED=true` plus a disposable runtime-role target; they were not counted as passed. The API production image IDs are runtime `sha256:d39570a3d84c6db8492e1f0d58fc56952924ceb391aab7b7422bd89894839c6b` and migrator `sha256:f046697787d1ac45fe81434d018d5e52b13e5a00f96824c025cfc361da25144c`.
- **Images/scanner:** all three local images were built without cache from the final source available in this worktree. Trivy 0.76.2, using its database refreshed 2026-11-13 07:00 UTC, reported zero Critical/High/Medium/Low/Unknown vulnerabilities for the exact frontend (`sha256:97ef5dffb80c04d9f43b4bea62a39192d80b080090d164eea66885d3710c2bf8`), backend runtime (`sha256:d39570a3d84c6db8492e1f0d58fc56952924ceb391aab7b7422bd89894839c6b`), and migrator (`sha256:f046697787d1ac45fe81434d018d5e52b13e5a00f96824c025cfc361da25144c`) images. The final frontend raw Trivy JSON is stored outside the worktree with SHA-256 `65D301C2D72DB574EF8C8108A337C4F8024805418F757F3A0A0E5C6F37B3ECF2`; backend raw reports are preserved there as well. These are local image IDs, not registry manifest digests; no SBOM or provenance was generated. A rebuild from the externally published immutable source will still be required before publication.
- **Prisma/roles:** schema validation passed; all 141 migrations replayed on fresh disposable PostgreSQL 17, and synthetic populated schema upgrade 140→141 passed. Disposable bootstrap/handoff/finalizer, injected finalizer failure/retry, separate enable failure, and successful enable tests passed. This does not verify Azure-managed PostgreSQL grants or production data effects.
- **Readiness:** frontend static routes returned HTTP 200. In local development with disposable PostgreSQL and Redis, `/api/health` and `/api/readyz` returned 200. Without Azure managed identity, production-mode readiness returned 503 `NOT_READY`; this is expected locally, not an Azure verification. After a local Redis outage/recovery, readiness stayed not-ready until the task-owned API process was restarted, which remains a reconnection/operations risk.
- **Bicep/API origin:** local Bicep compilation succeeded without Azure login/resource operations. The API template maps `frontendOrigin` to `FRONTEND_URL`, `FRONTEND_ORIGIN`, and `PUBLIC_APP_URL`; payout return URLs read `PUBLIC_APP_URL` first, so the return-origin wiring is consistent.
- **Money-movement gate:** `SCROLITH_MONEY_MOVEMENT_ENABLED` is fail-closed when unset and must equal `true` to enable. `moneyMovementHardOff` is mounted before API route registration and returns 503 for writes matching the financial namespaces/action paths; focused unit coverage checks the default-off behavior and representative paths. This corrects the earlier statement that no server-side gate exists. It does not yet prove every financial route alias or internal service/worker entry point is covered; complete the route-by-route and integration audit before treating this as a release control. Prisma `walletFundingEnabled` and `paymentTestMode` defaults are UI/configuration data, not authorization controls. Keep the environment gate explicitly false, and keep the external integrations API unavailable unless a separately reviewed gate is added.
- **Budget:** Section 11 is the current estimate and supersedes the earlier $194.39 HA subtotal based on generic Managed Redis page rates. A fresh Southeast Asia Azure Retail Prices API query returned the consumption meter for Azure Managed Redis Balanced B0 at **$0.02/hour**, effective 2026-01-01; at 730 hours this is $14.60 for one node. The two-node HA figure is only a 2x planning extrapolation ($29.20), not a confirmed HA quote. With the Section 11 assumptions, priced subtotals are **$182.71/month non-HA** and **$197.31/month derived HA**, before private endpoints and variable usage. Private endpoint-hour/data-processing charges, Blob transactions, API requests, backup overage, and other variable charges remain unpriced. The estimate exceeds the $100 target and does **not** demonstrate safe headroom below the $200 ceiling. Use the subscription-specific Azure Pricing Calculator before approving any spend; public prices are not an account quote.
- **Security/operations:** private Azure identity, Blob authorization/networking, deployed database grants, full authenticated browser flows, OAuth/email/provider setup, Socket.IO scale-out, worker single-leader behavior, backup restore and production rollback remain unverified. A historical credential-shaped database URL may have been exposed; rotate it if it was valid. It was not printed or rewritten in history.

### Required before any image publication

1. Publish the reviewed frontend submodule commit before publishing a parent gitlink that references it; then rebuild from that clean immutable source commit. Repeat scans with a current Trivy release, produce SBOMs/provenance, record registry manifest digests, and inspect final Vite assets.
2. Run the full backend unit and disposable-DB suites; distinguish omitted tests from passing focused suites.
3. Test API CORS/preflight from the exact intended frontend origins, authentication/OAuth callback flows, Socket.IO polling and WebSocket, uploads/downloads, and DB readiness against isolated test infrastructure.
4. Independently review database migration permissions, Redis managed identity, Key Vault resolution, private DNS, ACA ingress and network security, and provider setup.
5. Close the remaining private-Blob deployment, worker duplication, Socket.IO scale-out, migration rollback/runtime-role, startup security-default, and email/OAuth ownership issues listed below.
6. Have an independent reviewer approve the source and an owner approve production configuration, cost ceiling, DNS cutover, monitoring alerts, backups, and rollback window.

### Historical release blockers (as documented before 2026-11-13)

- **High — database role scope (historical assessment):** earlier review found broad runtime UPDATE and incomplete financial-history protection. Later disposable-database work added a retention migration and role templates, but Azure grants and managed-database semantics remain unverified. Do not assume money movement is disabled: the current schema defaults `walletFundingEnabled` to true.
- **High — upload operations:** private Azure Blob access is implemented through managed identity and authenticated API content routes, and uploads are disk-backed/bounded in process. Real Azure identity/private-network authorization, load, slow-client, crash cleanup, and disk-exhaustion behavior have not been tested. Public containers are not an acceptable workaround.
- **High — background jobs:** scheduled workers may run in every replica and lack a verified distributed leader guard. Keep API max replicas at 1; this remains a single-instance availability and rolling-deployment duplication risk.
- **High — realtime scale:** no Socket.IO Redis adapter has been verified. Do not scale API or split traffic until tested.
- **High — database operations:** 141 migrations replay on empty PG17, but history includes destructive/renaming statements (including removal of legacy Gcoin settings columns). Existing-data migration, runtime-role least privilege, and backward-compatible rollback have not been approved.
- **High — release validation:** no authenticated Azure integration, real managed identity/Blob test, production migration rehearsal, full backend/browser suite, or cloud smoke test has run. The migrator's raw Trivy output still includes two records whose GitHub-reviewed advisories are withdrawn; independent disposition and a clean-source rebuild/scan remain outstanding. No SBOM, provenance, or registry digests exist.
- **Dependency audit:** official-registry production audits now report zero findings for both apps after scoped dependency corrections. Development dependencies and deprecation/maintenance risks still require review; record complete audit results separately before PR/release.
- **Medium — providers:** OAuth, SMTP/Zoho, Stripe, KYC, push, and AI provider credentials/settings are not verified. Do not infer readiness from source code.
- **Medium — external platform:** separate integration work is not enabled or part of this release. The candidate does not provision `DEV_PLATFORM_HASH_PEPPER`.

> **Historical scan note (superseded by the 2026-11-13 final scan above):** An earlier migrator scan reported `braces` and `sprintf-js` advisory records. The later Trivy 0.76.2 run against the refreshed database scanned the final local frontend, runtime, and migrator image IDs and reported zero findings in every severity. Keep the earlier raw report as historical evidence; do not use it instead of the final report. The unpublished frontend source pin, browser gap, Azure identity/network checks, lack of image SBOM/provenance, and cost uncertainty remain release blockers.

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

Planning estimate based on Microsoft public pricing sources checked **2026-11-14**, not a subscription quote. The owner-set planning target is **$100/month** and the absolute recurring ceiling is **$200/month**. Assumptions: 730 hours/month; API app 1 vCPU/2 GiB active all month; frontend app 0.25 vCPU/0.5 GiB idle all month; PostgreSQL Flexible Server B1ms and 32 GiB Premium SSD storage; one non-HA Azure Managed Redis Balanced B0; 20 GB Hot LRS Blob; 2 GB ACR stored layers; 50 GB outbound internet transfer; 5 GB Log Analytics ingestion; 10,000 Key Vault operations; and four private DNS zones. The public-list calculation does not apply account discounts or credits. It also does not credit subscription-level free allowances, so it is conservative for those items; the actual billing scope and allowance eligibility must be checked in the subscription calculator. Taxes, support, and high availability are excluded. Azure Cache for Redis Basic C0 is not assumed for a new account.

| Component | Assumption | Estimated monthly USD |
|---|---|---:|
| Container Apps frontend + API | API 1 vCPU/2 GiB active 730 hours; frontend 0.25 vCPU/0.5 GiB idle 730 hours; excludes request charges | **$118.26** |
| PostgreSQL Flexible Server compute | B1ms, $0.026/hour x 730 | $18.98 |
| PostgreSQL storage | 32 GiB at $0.138/GiB-month (Southeast Asia Retail Prices API record) | $4.42 |
| PostgreSQL backup | Assumes backup usage remains within the included allowance up to provisioned storage | $0 baseline; excess unpriced here |
| Azure Managed Redis | Southeast Asia Retail Prices API consumption meter for Balanced B0: $0.02/hour effective 2026-01-01; 730 hours. Two-node HA is estimated as 2x the one-node rate; verify topology pricing in the subscription calculator. Reservation meters are excluded. | $14.60 non-HA / $29.20 HA (HA derived) |
| ACR | Basic registry allowance, 2 GB stored layers within included tier capacity; $0.1666/day x 365/12 | $5.07 |
| Blob Storage | 20 GB Hot LRS at $0.02/GB-month; transactions excluded | $0.40 + transactions |
| Internet egress | 50 GB at a conservative $0.08/GB; no subscription-wide allowance assumed | $4.00 |
| Key Vault | 10,000 operations at $0.03/10,000 | $0.03 |
| Azure Monitor / Log Analytics | 5 GB at $2.99/GB; no free grant assumed | $14.95 |
| Private DNS zones | Four zones, provisionally budgeted at $0.50 per zone-month | $2.00 |
| Private endpoints | Blob and Redis are private-endpoint candidates; Key Vault may require another. PostgreSQL is planned with VNet private access, not a private endpoint. The Southeast Asia Retail Prices API returned Blob Private Endpoint Premium Data Processed at $0.004/GB; its $0.70/hour-enabled meter has `unitOfMeasure=1`, so the hourly basis is ambiguous. Redis/Key Vault endpoint hourly rates were not established. | **Not priced** |
| **Priced-assumption subtotal** | Includes four private DNS zones and conservative 50 GB egress / 5 GB logs; with one-node Redis: $182.71; with two-node HA Redis: $197.31 (HA is a derived estimate). Excludes private endpoints, Blob transactions, API request charges, backup overage, taxes, support, and other variable usage. | **$182.71 non-HA / $197.31 HA plus unpriced items** |

The public-rate subtotal is **not a complete quote**. It exceeds the $100 target by $82.71 for one-node Redis and by $97.31 for the derived two-node HA Redis estimate. The HA case leaves only $2.69 before private endpoints and variable charges; that is not demonstrated headroom, so the design is **not demonstrated to fit the $200 ceiling**. The Southeast Asia Retail Prices API record for Azure Managed Redis Balanced B0 is $0.02/hour (USD, consumption, effective 2026-01-01); 730 hours gives $14.60 for one node, and $29.20 for two nodes is a simple 2x estimate, not an independently confirmed HA quote. The public Managed Redis pricing page lists generic B0 one-node non-HA at $13.14/month and two-node HA at $26.28/month, so calculator confirmation is still required. The current API data reports PostgreSQL storage at $0.138/GiB-month; the ACR Basic public rate used here is $0.1666/day. The Retail Prices API returned Blob Private Endpoint Premium Data Processed at $0.004/GB, but its $0.70 “hour enabled” meter has `unitOfMeasure=1`, so I have not inferred a time unit or used it as an hourly charge; regional Redis and Key Vault endpoint-hour rates remain unconfirmed. Obtain an account-specific Azure Pricing Calculator estimate before approving the design. If a private endpoint is also added to the Container Apps environment, the November 2026 Southeast Asia management meter is $0.10/hour ($73/month) in addition to Private Link charges; the proposed topology keeps public ACA ingress and does not include that option. The 5 GB Log Analytics line is a gross planning allowance and must be recalculated for the selected log plan, billing scope, and region. PostgreSQL backup overage, Blob transactions/retention, outbound requests, active frontend CPU, scale-out, and higher logging can increase cost. This is not a production HA recommendation: B1ms PostgreSQL, one API replica, and the one-node Redis pricing option are single-instance choices.

Use the [Azure Pricing Calculator](https://azure.microsoft.com/pricing/calculator/) with the exact subscription, region, network topology, and selected SKUs. Use the official [Azure Retail Prices API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices) for repeatable public rate checks. Container Apps consumption pricing and free grants are documented [here](https://learn.microsoft.com/en-us/azure/container-apps/billing); PostgreSQL pricing is [here](https://azure.microsoft.com/en-us/pricing/details/postgresql/flexible-server/); Redis pricing is [here](https://azure.microsoft.com/en-us/pricing/details/managed-redis/); Private Link pricing is [here](https://azure.microsoft.com/en-us/pricing/details/private-link/).

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
