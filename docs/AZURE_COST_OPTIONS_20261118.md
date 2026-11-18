# Azure cost choices - Southeast Asia, 2026-11-18

The owner removed the former $200 hard ceiling. This proposal does not authorize spending. No tested Managed Redis size currently passes provider capacity validation, so these are conditional architecture budgets, not deployable quotes or reserved capacity. Separate owner approval is required before any billable provisioning.

## Evidence and method

Public USD retail records were retrieved from the [Azure Retail Prices API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices), filtered for Southeast Asia and Consumption. Raw records remain outside Git in the task evidence directory. No account-specific discount, startup credit, free grant, reservation or tax saving is assumed. Private endpoint/NAT/IP unit rates below remain provisional planning inputs requiring a current account quote; a missing regional API row is not zero cost.

Run `node scripts/azure-cost-model.mjs` to reproduce the calculations in `deploy/azure/cost-model-20261118.json`. Every continuously allocated resource uses 730 hours/month. App CPU/memory are budgeted at active rates for all hours, including the scanner; actual idle/scale-to-zero use can be lower. VM is budgeted for all 730 hours because the template does not implement a verified automatic-deallocation policy. Do not assume 40-hour VM use without operational controls and measurement.

| Selected public retail meter | Rate | Monthly basis |
| --- | ---: | --- |
| ACA active CPU | $0.000034 / vCPU-second | Allocation x 2,628,000 seconds |
| ACA active memory | $0.000004 / GiB-second | Allocation x 2,628,000 seconds |
| PG Flexible Server B1MS compute | $0.026 / hour | $18.98, staging only |
| PG General Purpose Ddsv5 2-vCore compute | $0.244 / hour | $178.12 per server; two for HA |
| Managed Redis B3 | $0.081 / node-hour | $59.13 non-HA; unavailable in tested previews |
| Managed Redis M10 | $0.268 / node-hour | $391.28 for two-node HA; unavailable in tested previews |
| Managed Redis B10 | $0.391 / node-hour | $570.86 for two-node HA; unavailable in tested preview |
| Private ACR Premium | $1.6666 / day | $50.69 using 730/24 days; included image storage assumed sufficient |
| Blob Hot LRS first tier | $0.02 / GB-month | Include originals, derivatives, versions and soft deletes |
| Blob writes / reads | $0.05 / 10k writes; $0.004 / 10k reads | Usage dependent |
| D4as_v5 Linux operator VM | $0.216 / hour | $157.68 continuously; disk extra |
| Bastion Basic | $0.19 / hour | $138.70; gateway is billed even when VM is off |
| Private endpoints, provisional | $0.01 / endpoint-hour | Five: Blob, Queue, Redis, ACR, vault; $36.50 plus data |
| NAT/IP, provisional | $0.045 / NAT-hour; $0.005 / IP-hour | $32.85 NAT + $7.30 for two public IPs; data extra |

Redis HA charges use two node quantities, consistent with the [official one/two-node pricing model](https://azure.microsoft.com/en-us/pricing/details/managed-redis/). Confirm billing quantity and SKU in the account quote; never budget an HA instance at a single-node price.

## Architecture options

| Scenario | Budget including 20% contingency | Scope / limitations |
| --- | ---: | --- |
| A: controlled synthetic staging | **$1,011.81/month** | One B3 Redis node without SLA, B1MS PostgreSQL, one API, scale-to-zero-capable frontend, private scanner, private operator/Bastion/NAT, ACR/PEs. Conditional on capacity. No real users/money. |
| B: recommended initial production | **$2,073.11/month** | Two M10 Redis nodes, two 2-vCore PG servers for HA, 24/7 scan service, private operator path, higher backup/log/network/media allowances. Requires production IaC sizing/HA changes and acceptance; current foundation remains a pilot template. |
| C: growth proposal | **$4,643.44/month** | Two B10 nodes, 4-vCore PG HA, larger single API allocation, two scanner replicas, substantially higher media/logging/traffic, $500 edge/restore allowance. Not a claim that multiple API replicas work. |
| Separate staging A + production B concurrently | **$3,084.92/month** | Conservative sum with separate data planes/operator stacks. Second ACA environment quota required; no unproved shared-environment isolation or shared free grants. |
| Availability-focused production | **$2,631.78/month** | B plus a second scanner and $300 extra edge/restore allowance. Does not purchase or establish a hot cross-region standby, RPO/RTO or tested failover. |

These are conservative capacity envelopes, not a promise that low traffic consumes active CPU 24/7. A is the simplest currently implemented secure pilot design; it has significant private operator and scanner fixed costs. A smaller bill may be possible with verified operator deallocation, measured app idle billing, an already approved private operator path, or a separately tested scanner sidecar design. None of those savings is assumed. Do not replace the scanner or managed cache with an unreliable public service to hit a price.

B is recommended for eventual production reliability if capacity, load and restore tests justify it. The present Bicep foundation intentionally remains single-region, B1MS, non-HA PostgreSQL for synthetic staging. Option B/C are design proposals requiring reviewed parameter/schema changes, service availability checks and new what-if evidence, not silently enabled settings.

## Included usage allowances

The reproducible calculator itemizes every line. A/B/C include respectively:

- PG storage and incremental backup budgets: $15/$50/$120. Validate IOPS, storage SKU, retention, geo-backup eligibility and actual WAL/backup volume. HA compute is charged twice in B/C.
- Blob capacity, version retention, operations and Queue usage: $5/$20/$60; measure originals and derivative amplification. ACR Premium included capacity is assumed adequate; charge any excess and replication separately.
- Logs: $20/$80/$400, conservatively $4/GB for about 5/20/100 GB; current ingestion plan, retention, queries and subscription grants require account confirmation.
- Scheduled dispatcher and worker execution: $10/$40/$300. Assumes bounded job duration and retries; measure cold starts, scanner time, AVIF/FFmpeg memory, queue polling and failed attempts. This is additional to the always-on scanner.
- Data transfer, private-link processing, NAT processing and inter-zone usage: $15/$80/$150. Validate actual egress routing/tier; the retail first paid internet tier returned $0.11/GB. Do not double-count a selected service's included traffic, or assume all egress is free.
- DNS/Key Vault: $8 for private zones, existing public zone/query usage and secret operations. Existing mail/domain-provider fees are outside Azure. No changes to public DNS/email are part of this proposal.
- Operator OS disk: $15, plus the full VM/Bastion/NAT/IP allocations above. Add retained snapshots and extra disks if selected. ACR does not grant GitHub source access; secure app credential enrollment and private admin access require separate review.
- Alerts: $5/$15/$30. Notification destinations, alert evaluations and any paid support plan need approval. Staff/on-call, taxes, Azure support subscriptions, domain/email/SMTP, payment fees and paid AI are not purchased or treated as included.

Each scenario adds 20% contingency after these explicit allowances. Obtain an account-specific calculator/export including chosen SKUs, backup retention, network volumes, logs and operator hours before spending. The old $173.94/$184.41 estimates omit material requirements and must not be used for this expanded design. Above $200 is not automatically a blocker; unapproved spending and unverified capacity remain blockers.

## Capacity, scaling and disaster recovery decisions

Do not provision from B0 pricing: no tested B0/B1/B3/B5/B10/M10 configuration has passed the available Southeast Asia capacity previews. Ask Microsoft for an eligible size/capacity window. Retain the preferred region. A second region requires owner approval for residency, latency, networking, price and a complete regional architecture; it is not a silent Redis-only workaround.

One active API replica remains mandatory until a Socket.IO adapter, reconnect/session recovery and scheduler ownership are proven. Single-revision mode alone does not prevent rollout overlap. Require a maintenance/drain plan for the pilot. Production availability needs PostgreSQL restore drills to a new private server, role finalization/rotation, immutable image rollback, queue/outbox redelivery tests and a measured RPO/RTO.

This proposal is **NO-GO for billable staging provisioning** until Redis capacity, exact-head CI, independent reviews, scanner/operator/private-network acceptance plans and owner cost approval are resolved. No resources were created by the pricing or what-if queries.