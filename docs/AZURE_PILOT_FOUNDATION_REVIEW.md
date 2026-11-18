# Southeast Asia pilot design and release gates

This review candidate uses a single Container Apps workload profiles environment in Southeast Asia. The pilot has synthetic data and uses the Azure-generated app URLs with an explicit reviewer IP allowlist. The existing public DNS zone and mail records are outside the templates. Production data, domain cutover, and money movement require separate release decisions.

## Foundation and workload order

1. Review `deploy/azure/pilot-foundation.bicep` and `pilot-private-endpoint.bicep`. Confirm the resource names, unused CIDRs, Redis SKU and ACL, PostgreSQL configuration, monitoring retention, and the subscription cost estimate. Foundation uses one VNet with dedicated Container Apps, PostgreSQL, and private endpoint subnets. PostgreSQL uses delegated-subnet private access with its own linked private DNS zone and no public access. Blob, Redis, Key Vault, and Premium ACR use separate private endpoints and linked private DNS zones. The apps use public HTTPS ingress restricted to reviewers. This avoids a second Container Apps environment or an ACA private ingress endpoint.
2. Confirm a private operator and image publishing path. A generic GitHub-hosted runner or ordinary Cloud Shell has no route to the private ACR, vault or database endpoints. Establish a reviewed VNet-connected build/operator environment and budget for it. Use identity-based access, private DNS resolution and immutable signed digests for all images. Verify pull identity permissions, Entra audience and registry authentication, scoped Blob access, and Redis commands against the actual managed services before starting the application.
3. Enroll credentials from the approved private operator path. Create PostgreSQL bootstrap, migrator and runtime identities using the existing role scripts under `deploy/postgres/`. Use TLS with server identity verification, and leave the runtime login disabled until the finalizer succeeds. Put separate runtime and migrator database URLs in the named Key Vault secrets, plus the JWT signing secret and TLS Redis URL. The templates reference secret versions and give each workload access only to its own secrets. Keep Azure CLI arguments, source and logs free of secret values. Review Redis command/data scope using the application's actual auth, rate-limit, revocation and session clients before supplying the ACL. The Redis custom ACL API is preview. Approve its use and verify server acceptance separately. The configured client is nonclustered.
4. Validate an incremental foundation `what-if` after selecting real names, IP ranges, ACL and secure PostgreSQL parameter delivery. Then validate the workload `what-if` after the foundation resolves the real registry, identities, environment domain and vault. Render both locally with `az bicep build --file <file> --stdout`. Use the reviewed non-secret parameters and the approved in-memory/secure secret channel in Azure. A compiled template does not verify data-plane connectivity, API eligibility or role assignment propagation.
5. `pilot-workloads.bicep` defaults to the manually started migrator job with one execution and zero automatic retries. Ensure no concurrent migration job can run, snapshot the migration ledger, and execute the approved retention and migration preflights. After migration, verify the ledger, run the finalizer and enable-runtime steps, prove runtime cannot alter schema or financial history, and confirm the migrator credential is inaccessible to the API. Only then select `startApplications=true`.
6. Build the frontend image with `VITE_API_URL=https://<approved-api-app-fqdn>/api` and `VITE_BACKEND_URL=https://<approved-api-app-fqdn>`. Set the exact corresponding frontend origin in the API and register only the reviewed callback URLs with test providers. Confirm the API remains one replica, uses fail-closed Redis rate limiting and preserves existing JWT and Socket.IO revocation behavior. A rolling revision can still overlap startup with an older revision. Treat non-distributed scheduled jobs as a separate gate. Single replica capacity and downtime during restart are explicit pilot limits.
7. Collect the actual health and readiness probes, browser and private media smoke results, alerts and logs. Test PostgreSQL point-in-time restore to a separate isolated server, verify migrations and recovery time, and rehearse reapplying roles. Test Blob version/soft-delete recovery. Roll back application revisions by redeploying the previous approved digest with compatible schema and versioned configuration. Prefer a forward database repair. Restore to a separate server and switch only after verification if recovery is needed. A false `startApplications` value in an incremental deployment will not remove apps that already exist.

## Media authorization, queue and failure recovery

Current path: the upload controller writes validated content and its File row, then calls the enqueue facade after commit. The facade picks Google Cloud Tasks or local inline processing. In Cloud Tasks mode the worker authenticates the caller with Google OIDC, runs the existing image/video processors, and writes metadata and derivatives. The video processor checks processing version/status and scan visibility, and delivery continues through the API's authenticated media routes. The existing Google path stays intact.

The current facade logs enqueue failure and does not publish an outbox event atomically with the File row. The worker also returns HTTP 200 for BUSY and FAILED outcomes. The video claim changes database state to PROCESSING; a dead process can leave it there. Reusing the Google request/ack behavior on Azure could lose jobs or retry an ambiguous result. Some image deduplication is process-local. These behaviors require application work before Azure media processing can run.

The proposed Azure transport is a private Azure Storage Queue with an event-driven Container Apps Job. Azure Storage Queue does not provide automatic dead-letter handling. Pair it with a PostgreSQL outbox/lease table and permanent failure tracking:

- Write the authoritative job row transactionally with the eligible upload or subsequent scan approval. Key it by File ID, media kind, and processing generation. Queue messages contain only that reference. They never carry object URLs, SAS credentials, user tokens, or publication instructions.
- A reconciler dispatches committed outbox rows and retries missing or uncertain sends. Grant only queue sender to the dispatch identity. Scope queue reader/scaler and consumer identities separately. Give the worker only the database and private Blob access required for media. Limit job concurrency and resource use. The job consumes via Entra identity on private networking with no HTTP job endpoint.
- On receipt, compare the persisted job and file generation, current scan decision, and publication policy. Use a database claim with a lease expiry and fencing token. Renew the queue visibility and database lease for a bounded execution. Derivative keys are immutable/generation-scoped. Only the current fence may commit approved variant references. Acknowledge the queue after that commit. An interrupted write remains unreferenced and eligible for safe cleanup later.
- Duplicate messages must safely observe already-completed state or defer to an active lease. Retry transient errors with bounded delay and attempt limits. Persist terminal reason and move poison references to a separate queue before acknowledging, with reconciliation if either action is interrupted. Recovery requires an audited requeue of an eligible generation. Test backlog, process termination, expired leases, duplicate delivery, scan rejection, private read denial, and storage/DB recovery before activation.
- Lock down worker network and filesystem access before accepting untrusted media. Verify supported input formats, temp-file ownership and removal, process timeouts, and that a decoder cannot fetch unrelated network resources. Local H.264/WebP/Sharp checks cover representative codecs and do not replace a full upload-to-publication or Azure identity test.

This PR prepares and validates the existing worker image. It does not implement or enable the proposed queue consumer or reconciler. Default-disabled media avoids derivative computation, poster and thumbnail generation, and video metadata extraction. Product owners must approve a pilot with that scope. Keep existing upload authorization, scan visibility and original-media behavior. Validate those flows with synthetic files before any pause or omission is approved.

References: [Container Apps event-driven jobs](https://learn.microsoft.com/en-us/azure/container-apps/tutorial-event-driven-jobs), [secured Azure Storage queues](https://learn.microsoft.com/en-us/azure/storage/queues/secure-queues), [private DNS names](https://learn.microsoft.com/en-us/azure/private-link/private-endpoint-dns), [Redis custom ACL preview](https://learn.microsoft.com/en-us/azure/redis/configure-access-permissions).

## Monthly planning model (USD)

730 hours, no credits or free grants assumed. API stays at 1 vCPU and 2 GiB. Rates per second are $0.000034 for active CPU, $0.000004 for idle CPU, and $0.000004 per GiB. Active hours include requests and sustained connections. Frontend scales to zero at 0.25 vCPU and 0.5 GiB. Event-driven worker uses 1 vCPU and 2 GiB with zero idle replicas. These are planning workloads, not measured capacity.

| Component | Minimal staging | Initial production | Sustained activity |
|---|---:|---:|---:|
| API, 36 / 240 / 730 active hours | 35.42 | 57.46 | 110.38 |
| Frontend, 8 / 60 / 100 active hours | 0.30 | 2.27 | 3.78 |
| Worker, 2 / 12 / 45 active hours | 0.30 | 1.81 | 6.80 |
| PostgreSQL B1ms compute | 18.98 | 18.98 | 18.98 |
| PostgreSQL 32 GiB Premium SSD | 4.42 | 4.42 | 4.42 |
| Backup above included allowance, 0 / 10 / 32 GB | 0.00 | 0.95 | 3.04 |
| Managed Redis B0, one / two / two nodes | 14.60 | 29.20 | 29.20 |
| Premium ACR (per-day price, 730/24 days) | 50.69 | 50.69 | 50.69 |
| Hot LRS Blob, 20 / 50 / 150 GB plus operations | 0.60 | 1.80 | 6.00 |
| Queue operations | 0.02 | 0.10 | 0.50 |
| Five private endpoints including the proposed queue, $0.01/hour each | 36.50 | 36.50 | 36.50 |
| Private Link data, 20 / 80 / 260 GB at $0.01/GB | 0.20 | 0.80 | 2.60 |
| Six private DNS zones and queries | 3.04 | 3.40 | 4.20 |
| Vault operations | 0.03 | 0.06 | 0.12 |
| Logs, 2 / 5 / 12 GB at $2.99/GB | 5.98 | 14.95 | 35.88 |
| Internet egress, 10 / 75 / 250 GB at $0.12/GB | 1.20 | 9.00 | 30.00 |
| Container Apps requests | 0.10 | 0.40 | 1.60 |
| Alerting allowance | 1.00 | 1.00 | 1.00 |
| **Subtotal** | **173.39** | **233.79** | **345.69** |
| **With 10% contingency** | **190.73** | **257.17** | **380.26** |

Regional Retail Prices API meters for Container Apps, registry and database were refreshed on 2026-11-18. PostgreSQL storage and regional Redis B0 reference the existing handoff rate snapshot. Redis HA is a two-node extrapolation. Endpoint, transaction, log, alert and egress lines are planning allowances. No account-specific rate card, tax, support plan, or private publishing/operator runner estimate was available. Those items must be priced separately. Extra cross-zone/inter-region traffic, restore overlaps and a higher PostgreSQL tier or HA also increase the total. Microsoft lists B1ms as Burstable. This model uses single-node PostgreSQL throughout and is a capacity/cost floor, not a production availability commitment.

Isolated coexistence of the modeled staging and low-traffic production stacks costs approximately **$447.89/month** with contingency and requires a second ACA environment quota. Low-traffic production is **$57.17 above** the $200 ceiling before the exclusions above. Sustained activity is **$180.26 above**.

Two choices for owner review:

1. Fund a single, time-limited synthetic pilot with no overlapping production stack. An explicitly approved media-disabled pilot removes the worker and queue lines, one endpoint and one zone, giving approximately **$181.79/month** with contingency, before unpriced items. Validate restore and the private operator path and set usage alerts before approving spend. Keep production approval pending.
2. Fund independent staging and production and obtain a second ACA environment quota. Use at least the modeled **$447.89/month** as a monthly floor while both coexist, verify PostgreSQL availability requirements and add operator/build costs. Decommission staging after the agreed retention period if permanent coexistence is unnecessary. A subsequent single production stack has a **$257.17/month** modeled floor at low traffic.

References: [Azure Retail Prices API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices), [Container Apps pricing](https://azure.microsoft.com/en-us/pricing/details/container-apps/), [PostgreSQL pricing](https://azure.microsoft.com/en-us/pricing/details/postgresql/flexible-server/), [Redis pricing](https://azure.microsoft.com/en-us/pricing/details/managed-redis/), [Private Link pricing](https://azure.microsoft.com/en-us/pricing/details/private-link/).
