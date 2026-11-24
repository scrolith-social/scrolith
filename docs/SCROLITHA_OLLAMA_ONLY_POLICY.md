# Scrolitha Production Provider Policy

## Current activation profile

The approved initial production profile is **OLLAMA generation with the deterministic NATIVE provider enabled**. NATIVE may classify, route, extract, rank, validate, and orchestrate; it is not an LLM response and must never be represented as generated Ollama text.

| Control | Current profile |
|---|---|
| LLM provider | `OLLAMA` only |
| Deterministic provider | `NATIVE` enabled separately by explicit policy |
| Model | `qwen3:8b` |
| Core | Project-owned Scrolitha Core app, internal ingress only |
| Local sidecar | Off in production; Core is a separate Container App |
| Gemini, OpenAI, Mock | Disabled and not in the production provider allowlist |
| Backup provider | Disabled |
| Beta rollout | Existing `betaAllowlistOnly` and allowlist preserved |
| Autonomous actions | Prohibited; confirmation, consent, safety, quota, audit, and kill-switch controls remain required |

Required generation path:

`Scrolitha policy/context -> consent and safety checks -> ScrolithaAI.execute() -> OLLAMA -> qwen3:8b`

The persisted user/admin consent records remain authoritative. Setting provider environment variables does **not** by itself enable user-facing generation. Production requires a successful audited admin update of the persisted provider configuration and feature flags.

## Model decision and historical evidence

Older production documents and authenticated certification snapshots record `qwen3:14b`. Those records are historical evidence and do not establish the model deployed by the current source or candidate. Current backend defaults, admin configuration, and the Core image default select `qwen3:8b`.

This rollout retains `qwen3:8b`; it does not silently change the model. The official Ollama library lists the 8B artifact at about 5.2 GB and 14B at about 9.3 GB. The existing Container Apps environment is Consumption-only with a 4-vCPU/8-GiB per-app ceiling, so 14B does not fit that profile. The initial Core app is pinned to 4 vCPU/8 GiB with one loaded model, one concurrent inference, and a 4096-token context. Actual latency, memory headroom, and OOM behavior still require a production-sized synthetic load test before widening rollout.

## API environment contract

The API deployment must set:

- `SCROLITHA_PROVIDER=core`
- `SCROLITHA_CORE_ENDPOINT=https://<internal-core-fqdn>`
- `SCROLITHA_CORE_MODEL=qwen3:8b`
- `SCROLITHA_CORE_SIDECAR_MODE=false`
- `SCROLITHA_AI_LOCAL_ONLY=true`
- `SCROLITHA_AI_ALLOWED_PROVIDERS=OLLAMA`
- `SCROLITHA_AI_OLLAMA_ENABLED=true`
- `SCROLITHA_AI_NATIVE_PROVIDER_ENABLED=true`
- `SCROLITHA_AI_ENABLE_PROVIDER_CALLS=true`
- `SCROLITHA_AI_ALLOW_PROD_PROVIDER=1`
- `SCROLITHA_AI_FORCE_NO_EXTERNAL_PROVIDER=1`

The internal FQDN is HTTPS. The `https` endpoint passes the current admin configuration validator and is restricted by Container Apps internal ingress to apps in the same environment. Do not set a loopback endpoint or expose Core publicly. Do not configure `SCROLITHA_AI_ENABLED` as an environment override; master enablement belongs to persisted flags so the admin kill switch remains effective.

## Persisted admin activation

Only an authorized administrator with the existing `journeys.templates.manage` permission may make these changes through the supported admin APIs/UI. Keep them ordered and verify each persisted result and audit entry:

1. Update `/api/admin/scrolitha/config` for the **admin** scope with the Core HTTPS internal FQDN, provider `core`, model `qwen3:8b`, `sidecarMode: false`, and `allowGeminiFallback: false`. This updates the stored Scrolitha runtime settings; environment values remain the deployment source of truth.
2. Set persisted provider configuration `NATIVE.enabled=true` and `OLLAMA.enabled=true`; keep `GEMINI`, `OPENAI`, and `MOCK` false, and keep `allowedProviders` limited to `OLLAMA`.
3. Through `/api/admin/ai/feature-flags`, enable only the approved user-facing chat path: `masterEnabled`, `assistantEnabled`, `ASSISTANT_CHAT`, and `enableProviderCalls`. Enabling `enableProviderCalls` requires `X-Confirm-AI-Risk: CONFIRM`; production also requires `SCROLITHA_AI_ALLOW_PROD_PROVIDER=1`. Do not change `betaAllowlistOnly`, the beta allowlist, the kill switch, or unrelated capabilities.
4. Confirm consent and beta allowlist checks for each pilot user. Do not manufacture consent or expand the allowlist as part of infrastructure deployment.

An admin update must be considered failed if the setting and durable audit row do not commit together. The API change in this branch makes provider and feature-flag mutations transactional and fail-closed.

## Deployment and verification

Use `deploy/azure/scrolitha-core-containerapp.bicep` to deploy the reviewed Core image digest as `ca-scrolitha-core-sea-prod` into the **existing** `cae-scrolith-sea-prod` production Container Apps environment. Deploy Core first, read its generated internal FQDN, then pass its HTTPS FQDN and the same model to `deploy/azure/api-containerapp-single-replica.bicep`. Review the deployment `what-if` and exact current resource configuration before applying the full API template; preserve database, Redis, identity, blob, ingress, and scaling settings.

The Core app has internal ingress (`external: false`), a fixed single replica, no public route, and `/api/tags` probes. Its image bundles the model at build time. Runtime startup fails if the model is missing instead of downloading model data from the network. Ollama cloud access is disabled. The API keeps its existing PostgreSQL and Redis settings and readiness probes.

Before pilot traffic, verify all of the following:

- From the API Container App environment, Core `/api/tags` returns the exact `qwen3:8b` model tag.
- Admin provider health reports `NATIVE` and `OLLAMA` operational; Gemini, OpenAI, and Mock stay disabled.
- The persisted provider and feature-flag reads match the approved values; audit history contains the corresponding admin events.
- An authorized synthetic/allowlisted account with current AI consent completes one benign Scrolitha chat request through OLLAMA and reports `qwen3:8b`; no mock or external fallback is used.
- `/api/readyz` continues to show PostgreSQL and Redis healthy before and after the AI test.
- Safety post-processing, quota, privacy/consent checks, confirmation for tools, no-auto-action behavior, and emergency kill switch are unchanged.

Do not use `.github/workflows/g1-staging-provenance.yml` for production; it targets the staging registry. At this source revision, no production Core/API release workflow exists. The IaC is prepared, but production images, OIDC release permissions, protected-environment approval, and a reviewed production deployment path must be established before applying it. Never pass secret values on the command line or put them in a parameter file, log, image, or frontend variable.

## Cost and rollout limits

> **Owner budget update (2026-11-23):** The active maximum total Azure spend for this deployment is $700/month, not a target. This supersedes the earlier $200 ceiling mentioned in the historical estimate below; the older $100 target is not treated as the current approval criterion. The updated full-stack estimate and current no-provisioning decision are recorded in [the Azure Core deployment runbook](SCROLITHA_AZURE_CORE_DEPLOYMENT.md#current-700month-cap-review-2026-11-23).

The additional Core replica is configured at 4 vCPU/8 GiB with `minReplicas: 1` to avoid a cold model startup for every request. A public Azure Retail Prices API query for Southeast Asia on 2026-11-23 returned USD `$0.000004` per vCPU-second and GiB-second for idle usage, and `$0.000034` per vCPU-second plus `$0.000004` per GiB-second for active usage. At 730 hours/month, the Core replica alone is approximately:

| Utilization assumption | Calculation | Monthly estimate (USD) |
|---|---|---:|
| Continuously idle between requests | `4 vCPU × 2,628,000 sec × $0.000004` + `8 GiB × 2,628,000 sec × $0.000004` | `$126.14` |
| Active for all 730 hours (upper-bound compute scenario) | `4 vCPU × 2,628,000 sec × $0.000034` + `8 GiB × 2,628,000 sec × $0.000004` | `$441.50` |

These are gross public list-price estimates for the Core replica, before any subscription free grant or negotiated price. The Container Apps free grants (180,000 vCPU-seconds and 360,000 GiB-seconds per subscription/month) are shared with other apps and are not assumed available. Inference moves the replica to active billing while processing and can materially increase cost. The existing system's documented priced-assumption subtotal is $182.71/month non-HA or $197.31/month for a derived two-node Redis HA estimate, excluding private endpoints and variable charges. Adding Core's $126.14/month continuously-idle floor yields a combined planning subtotal of **$308.85/month non-HA** or **$323.45/month with the derived HA estimate**, before Core image storage, logging, egress, private endpoints, and other variable charges. These figures exceed both the $100 target and $200 ceiling even before those omitted costs; no available subscription-specific discount or grant has been verified. The Azure pricing data query for this subscription did not return a usable estimate, so obtain an account-specific calculator/export before making a spend decision. See [Azure Container Apps pricing](https://azure.microsoft.com/en-us/pricing/details/container-apps/), [Container Apps billing rules](https://learn.microsoft.com/azure/container-apps/billing), and the [Ollama qwen3 library](https://ollama.com/library/qwen3). Begin with the existing beta allowlist and synthetic tests, measure latency/memory and actual billed active time, and seek a separate decision before expanding users or adopting 14B/Dedicated/Flex/GPU capacity.

## Historical certification

`SCROLITHA_AUTHENTICATED_CERTIFICATION.md`, `PHASE33_0_MODEL_ROUTING.md`, and files under `docs/evidence/` retain their original `qwen3:14b` measurements. They must not be cited as validation of this `qwen3:8b` deployment or of the present Azure configuration.
