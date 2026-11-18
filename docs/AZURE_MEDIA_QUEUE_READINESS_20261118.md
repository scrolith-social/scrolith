# Azure durable media and capacity review - 2026-11-18

This change is source preparation, not deployment approval. No application resources have been provisioned. Preserve the public DNS zone and existing mail records. Money movement and external integrations stay off. Azure media processing stays off until private staging acceptance and separate activation approval.

## Source and transport

The verified starting backend PR #171 head is `f98dde7e1521e9aaf4f318c9298e4cf1539dd5e2`; frontend PR #170 and the gitlink remain `0b17963d6665665403a282a2d32c112ccf9c5879`. New code is additive. Google Cloud Tasks and inline processing remain available with their existing configuration. The Azure path uses `MEDIA_PROCESSING_MODE=azure_queue`, with both media flags explicitly true in the reviewed workload template.

Storage Queue is selected because processing needs at-least-once delivery of independent opaque job IDs, not ordered sessions. PostgreSQL owns the processing decision and fencing. Service Bus offers broker dead-lettering, locks and optional duplicate detection, but those do not make database/Blob writes atomic. Its private-endpoint tier and operational cost need a separate quote. This implementation uses durable PostgreSQL terminal states and a separate safe-metadata review queue; it does not pretend Storage Queue has native dead-lettering or exactly-once delivery.

| Phase | Durable behavior |
| --- | --- |
| Upload | Private original is written, then File and authoritative outbox request are inserted in one transaction. Failed transaction invokes existing upload cleanup. No queue call inside the transaction. |
| Quarantine | A persistent `media_scan_required` flag blocks original content, manifests and variants until the exact generation has a committed scanned DONE job. Turning the transport off does not remove quarantine. Existing owner/private/publication checks still run. |
| Dispatch | A scheduled job sends only `{id}`. Send precedes the dispatch timestamp. A crash may duplicate a message; outbox reconciliation resends requests older than three minutes. At most 50 sends per dispatch must be included in load planning. |
| Claim | Row locks serialize claims. A 180-second lease and monotonically increasing fence identify the current attempt. Expired leases are reclaimable. Five processing attempts maximum. |
| Scan/decode | Source bytes are bounded and hashed. Actual clean ClamAV result is required before decoding; mock-clean, deferred and unavailable results cannot authorize publication. Sharp produces image variants; ffprobe/FFmpeg produce H.264 metadata, WebP poster and thumbnail. Azure video runners permit only file/pipe protocols. |
| Publish | Upload unique per-attempt keys, then lock/check the job, source version, source key, owner and visibility. Variants, File metadata and DONE/digest commit together. A stale worker cannot overwrite a newer attempt. |
| Acknowledge | Processing messages are deleted after committed completion or after reading a durable terminal result. A lost COMMIT response or failed acknowledgement never causes committed objects to be deleted. Retriable/ambiguous work is not acknowledged. |
| Failure | RETRY backs off up to 15 minutes; REJECTED/DEAD/STALE are durable. File processing status reports failure while the publication gate stays closed. Invalid/unknown messages are copied to a review queue without full payloads, URLs, credentials or receipts. |
| Shutdown | SIGTERM/SIGINT abort publication and enforce a 25-second shutdown deadline. Unfinished work is redelivered after queue visibility/DB lease expiry. Unreferenced candidate objects may remain if database outcome cannot be established; never delete them speculatively. |

The synthetic regression harness injects queue/storage/scan responses. It runs real PostgreSQL transactions, Sharp and FFmpeg. These results do not prove actual Azure identity, scaler, Blob, queue, scanner-definition freshness or private-network behavior. Real ClamAV EICAR/clean-file acceptance is required in staging. No live provider is contacted.

## Least privilege and private infrastructure

`pilot-foundation.bicep` adds a queue private endpoint/DNS zone, processing/review queues and separate dispatcher, worker and scaler identities. Shared-key storage access remains disabled. API identity has no queue role. Dispatcher can send to the processing queue only. Worker can process/renew/delete processing messages and send safe review metadata. Scaler can read queue metadata only and its identity is unavailable to the container process. Registry pull identity is likewise unavailable to workload code.

The custom worker role includes `messages/write` because renewing visibility requires Update Message. The standard Message Processor role alone cannot renew. That permission also permits message creation; the scope is restricted to the single processing queue. Workers still validate opaque identifiers and cannot create authoritative jobs. Blob permissions are confined to the uploads container. A worker can read/delete objects in that container for processing/cleanup; splitting source and derivative containers would further reduce its compromise scope and requires compatible read-path changes and tests.

The API finalizer restricts outbox INSERT to request columns and denies UPDATE/DELETE/TRUNCATE: API credentials cannot forge DONE/scan evidence. `scrolith-media-roles.sql` creates separate NOLOGIN database roles with no financial/auth/migration access. Dispatcher can update only dispatch timestamps. Worker may update lease/status and selected media metadata fields, and insert/update variants; it cannot change source owner/visibility or delete records. No runtime credential should be enabled/enrolled before the main runtime finalizer, media policy and negative permission tests succeed. A reviewed separate media-role credential enablement procedure remains a deployment gate; this SQL does not enable login.

`pilot-media.bicep` creates scheduled dispatcher and event-driven worker jobs, with a private scanner app. Images require immutable reviewed digests from the private ACR. Separate versioned Key Vault database secrets are needed for the two database roles. Maximum two simultaneous worker executions, one replica per execution, and a two-connection database pool bound initial load. Scanner is private TCP/3310, 1.5 vCPU/3 GiB, min/max one. Its image must be mirrored, scanned and approved separately; no scanner image digest is invented here. Verify signature databases, resource usage, egress update destinations and freshclam recovery before enabling uploads. The reviewed scanner image/config must support StreamMaxLength and MaxFileSize of at least 250 MiB with bounded MaxScanSize, thread count and scan timeout; stock defaults may reject large supported videos. This configuration and definition freshness are not demonstrated by the synthetic scan fixtures.

`pilot-workloads.bicep` keeps activation false by default. First deploy/accept the media module separately while API processing is disabled; only then enable the API transport under a separate approval. Do not use that parameter as a substitute for acceptance tests.

### Private build and operator path

`pilot-operator.bicep` defines a D4as_v5 Linux VM with private NIC, no VM public IP/password, inbound SSH restricted to Azure Bastion, and ACR push access at the dedicated registry only. Exact Canonical image version and an operator-owned public SSH key are required; review `az vm image show` output and reject `latest` before what-if. The VM receives no database or Key Vault secret-reading role by default. Provision a distinct, reviewed temporary human/operator role for enrollment or migration when authorized.

Bastion Basic supplies browser SSH over Azure's control plane. An explicit NAT gateway and separate outbound IP supply package/GitHub access; new private subnets must not rely on default outbound internet access. Reserved subnets are 10.86.3.0/24 (operator) and 10.86.4.0/26 (Bastion), inside the foundation's 10.86.0.0/16 VNet. Validate peering and address overlap before provisioning.

Inside the private VM: verify canonical Git source/ancestor pins; obtain private-repository access through an approved GitHub App/secure operator channel; use rootless BuildKit; build pinned source, scan, preserve SBOM/provenance; publish immutable images only after owner authorization. Use the VM identity for private ACR access. Keep tokens/DB credentials out of arguments, histories and build contexts. Enroll versioned secrets through an approved secure console/SDK/stdin workflow. Do not pass passwords as `az --value`, `psql URL`, Docker args, build args or frontend VITE settings. A public GitHub runner or ephemeral Cloud Shell cannot be assumed to reach the private ACR, PostgreSQL or vault. DNS, routes, Entra propagation and Bastion/VM capacity remain deployed acceptance gates.

## Redis and account capacity

Account/tenant are the owner-specified subscription `d256e51d-950a-4141-9209-462302844a14` and tenant `3d2dc6a0-4ad4-4fa4-8c11-7a26b6bc99e5`. Resource group `rg-scrolith-sea-pilot`, selected region Southeast Asia. The group remains DNS-only. Read-only provider what-if checks did not create services.

Prior B0/B1 single-node and HA attempts failed. This continuation also received `CacheCapacityUnavailable` for B3 and B5 (HA and single-node), B10 (HA), and M10 (HA and single-node). Consequently none of the tested SKUs is currently capacity-validated. SKU availability in documentation and spare quota are not capacity reservations. These results cannot establish that every other size is unavailable.

Keep Southeast Asia selected. Request Microsoft capacity/support review with subscription/region, tested SKU/HA combinations, timestamps and saved tracking IDs; ask for eligible currently available families/sizes and an expected capacity window. Do not submit a paid support purchase without approval. A different Azure region is an explicit owner decision involving data residency, latency, price and network isolation; no region is changed here. Azure Cache for Redis is not an assumed fallback: new-customer creation restrictions and retirement apply, and tenant eligibility has not been established. Self-hosted/public Redis is not selected.

Redis requires TLS, Entra token renewal, NoEviction, DB 0, Lua/script behavior, session/rate-limit/revocation keys and Socket.IO pub/sub semantics. Test reconnects, failover and token refresh on an actual managed instance. Do not weaken fail-closed auth or rate limits to work around capacity.

One ACA environment quota was reported available; PostgreSQL regional/burstable limits were 256/32 cores. Recheck quotas and operator VM SKU restrictions immediately before approval. Concurrent staging and production need a second environment quota and separate data/identities/vault/queues/network boundaries; different app names in one environment are not demonstrated isolation.

## Socket.IO and schedulers

Keep one active API replica and single-revision mode. Existing JWT/session revocation and private-room checks remain unchanged and must pass exact-head CI. Redis availability remains part of readiness. No multi-replica claim is made: a Redis adapter, room/session recovery, cross-replica revocation and load tests are required first.

Existing API background schedulers remain enabled on the single pilot process; this change moves only media dispatch/processing into jobs. Notification, demo, cleanup and other in-process timers are not all protected by a distributed ownership mechanism. Single-revision mode/maxReplicas=1 does not prove zero overlap during rolling revisions. Until ownership/idempotency is validated, use a separately approved maintenance/drain/stop-old-before-start-new rollout. Do not overlap revisions or scale API replicas. Before production scaling, move scheduled work to a dedicated owner or implement tested database-backed leadership and per-operation idempotency. Financial reconciliation stays gated off with money movement.

## Recovery and operational acceptance

Monitor status counts, oldest due outbox age, attempts, expired leases, worker duration, poison queue size, scanner definition age and queue/scanner/Blob failures. Structured worker logs include opaque job ID, fence, attempt and bounded outcome codes, not payloads or arbitrary provider errors. Alert on sustained oldest-age growth, DEAD/REJECTED increases and scanner unavailability. Azure Monitor query/alert routing must be verified on actual deployed tables before go-live.

For DEAD jobs, first inspect source generation, digest/scan failure, durable state and storage/lease evidence using a privileged read-only operator. Save the previous terminal outcome in the approved audit/recovery record. Only an approved operator may transactionally requeue the same generation after the underlying fault is corrected; worker/runtime credentials cannot be used as an administrative reset tool. Never automatically requeue infected REJECTED content, bypass scanning, alter visibility, or reuse an old fence. Cleanup of unreferenced per-fence Blob keys requires a separate, age-bounded reference check and approval; this implementation favors retention on ambiguous outcomes.

Rollback: stop new media intake and dispatcher, preserve queue/outbox/Blob state, drain active jobs or let leases expire, then roll back only to an image that understands the persistent scan gate. Setting transport disabled does not release quarantined files. Keep the additive table/column and history; do not down-migrate during an incident. Database restore goes to a new isolated Flexible Server, followed by migration-ledger/role verification and reviewed connection-secret rotation; never restore over the live primary. Restore/replay of queue/outbox may duplicate deliveries, so fencing/idempotency must be retained.

Staging acceptance must prove private DNS from API/jobs/operator, actual MI/RBAC and denied public/SAS access, real queue visibility renewal/redelivery, actual ClamAV detection/freshness, image/video/private-file HTTP access, SIGTERM, worker crash, storage/DB outages, retry exhaustion and approved recovery. Do not use the public domain before approval. Use allowlisted native ACA hostnames; preserve Namecheap Private Email records.

## Local validation and exact-head gate

Local commands use an isolated official-registry install and task-owned PostgreSQL 17; environment files and owner databases are excluded. Commands/results and raw logs are retained outside source in the task evidence directories.

- `npm ci --registry=https://registry.npmjs.org --ignore-scripts --no-audit --no-fund`: clean isolated dependency install.
- `prisma generate`, `npm run build:prod`, focused Jest queue/publication/controller tests.
- Guarded `prisma migrate deploy`: 143 additive migrations; existing migration files unchanged.
- `node scripts/test-azure-media.mjs`: synthetic queue/Blob/scanner, actual DB/Sharp/FFmpeg.
- `node scripts/test-azure-media-permissions.mjs --apply-policy`: fresh disposable CI role checks; credentials passed through process environment only.
- `npm audit --registry=https://registry.npmjs.org --omit=dev --package-lock-only --json`: exact final lockfile; save all severity counts and hash.
- `az bicep build` for foundation, private endpoint, workloads, API, media and operator modules; provider what-if capacity failures are not passes.
- `git diff --check`; source/secret/permission/trigger review before explicit-path staging.

The existing CI now runs media integration/permissions after production compilation. The populated 141-to-142 auth-session upgrade remains checked, followed by migration 143 as the migrator. Drift CI expects exactly 143 complete unique ledger rows. Mandatory backend, browser, integration, drift and four-image security/provenance checks must be re-run on the published exact backend head before any merge. No earlier cached image or baseline run proves a new head passed.

Two local no-cache worker builds failed on refused connections from Docker to the official Alpine CDN. A host probe retrieved the exact first APK with the locked SHA-512; no URL, package-index, signature or checksum policy was weakened. Preserve failures and require a fresh completed build/scan of the exact final source, including the worker, before release. Package retention at the official CDN remains an availability limitation despite immutable content hashes and Alpine signature verification.

Independent human reviews on PRs #170/#171 and separate infrastructure/cost/provisioning approval remain required. Local tests and compiled templates are not managed-Azure integration or production-readiness evidence. A historical credential-shaped database URL must be rotated if it may ever have been valid; do not print it or rewrite history.

Official references: [Container Apps jobs](https://learn.microsoft.com/en-us/azure/container-apps/jobs), [job schema](https://learn.microsoft.com/en-us/azure/templates/microsoft.app/2026-01-01/jobs), [queue authorization](https://learn.microsoft.com/en-us/rest/api/storageservices/authorize-with-azure-active-directory), [storage RBAC](https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/storage), [Redis reliability/capacity](https://learn.microsoft.com/en-us/azure/redis/plan-reliability-and-durability), [Redis retirement](https://learn.microsoft.com/en-us/azure/azure-cache-for-redis/cache-whats-new).