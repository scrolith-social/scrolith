# Ollama v0.40.17 vulnerability triage

This is a source-stage review for the Scrolith Core build. It is not a waiver,
an image scan, or a production-network assessment. All govulncheck and Trivy
records must be retained and reported; this document does not suppress them.

## Latest local builder-stage evidence — 2026-11-25

The exact command was:

```text
docker build --pull --no-cache --progress=plain --target ollama-core-build --build-arg ACR_BUILD_NONCE=local-security-20261125T4 --tag scrolith-core-security-hardening-rerun:20261125 D:\scrolith-ai-production-activation-20261123\geezle-backend\infra\scrolitha-core
```

Exit code: `0`. The Core-specific Go tests passed in `381.4s`; `go mod verify`
reported `all modules verified`. The source-mode govulncheck completed with no
finding events. The binary-mode scan used govulncheck `v1.10.0`, database last
modified `2026-11-24T15:56:00Z`, and Go `1.26.11`.

This is a builder-stage image, not the model-bearing runtime image:

- Builder image ID: `sha256:549cccce5a6a64bf12eeb3b7289bb233bafb2246ad1b11b16d4511fb5e92db9a`
- Image size: `796,990,380` bytes
- Binary report: `17,825` finding records. Eight IDs each have `2,228`
  records; `GO-2026-5750` has one module-only record.
- For each of the first eight IDs, the binary report repeats the same `1,414`
  unique package/function traces across `79` packages. The reported module
  version is `github.com/ollama/ollama v0.40.17+dirty`.
- The `GO-2026-5750` record has a module/version trace but no package or symbol.
- Binary-mode traces identify linked symbols; they do not show the vulnerable
  call chain or prove that a request can reach the vulnerable behavior. The
  source report has zero findings, but that alone does not negate binary-mode
  findings.

Raw reports are preserved outside the repository:

| Report | SHA-256 | Bytes |
|---|---|---:|
| `govulncheck-core-source-rerun-20261125.jsonl` | `6ED921470A8E3CFB45249A5D6C34D3DCA9F90FFE181DA462586BE2F13A4FD8CF` | 943,168 |
| `govulncheck-core-binary-rerun-20261125.jsonl` | `0F80639D96970C0DCD13D37BA555D58CA6D1148A0336C278614B29765C5584DE` | 6,095,637 |

The raw files are under `D:\scrolith-ai-final-evidence-20261124\`. The Docker
build stage preserved both reports before validation. The report validator
accepts only the reviewed Ollama module/version and the nine IDs below, rejects
unknown IDs or a different scan mode/module/version, and prints the unfiltered
record count. It does not remove records from the raw report or change Trivy
output. Its unit tests passed with:

```text
PowerShell from the repository root:

$hardening = (Resolve-Path .\geezle-backend\infra\scrolitha-core\ollama-core-hardening).Path
docker run --rm --network none --mount "type=bind,source=$hardening,target=/test,readonly" --workdir /test --entrypoint /bin/sh scrolith-core-security-hardening-rerun:20261125 -c "go test verify_govuln_report.go verify_govuln_report_test.go"
```

Result: `ok command-line-arguments 0.018s`, exit code `0`.

## Advisory-by-advisory disposition

The govulncheck database records are module-wide and have no fixed-version
boundary. The corresponding reviewed GitHub advisories state narrower affected
upper bounds. The pinned upstream source is Ollama tag `v0.40.17`, commit
`23b94a2daf2cd1fbf6b4dcfbfd3efbaca424b7bf`, beyond each stated bound below.
This version evidence is relevant but does not make the scanner records
disappear or, on its own, prove the final image safe.

| Go ID | Advisory | Reviewed affected versions | Issue / current reachability evidence |
|---|---|---:|---|
| `GO-2025-3557` | [GHSA-fccc-8m69-8r78](https://github.com/advisories/GHSA-fccc-8m69-8r78) | `<= 0.3.14` | Crafted GGUF import can exhaust memory. Core omits model upload/create and pull routes; model files are bundled and manifest-verified. |
| `GO-2025-3558` | [GHSA-89qx-m49c-8crf](https://github.com/advisories/GHSA-89qx-m49c-8crf) | `<= 0.3.14` | Crafted GGUF can trigger an out-of-bounds read. Same model-import restrictions apply. |
| `GO-2025-3559` | [GHSA-9gcr-28rp-cc24](https://github.com/advisories/GHSA-9gcr-28rp-cc24) | `<= 0.3.14` | Crafted GGUF can trigger divide-by-zero. Same model-import restrictions apply. |
| `GO-2025-3582` | [GHSA-p2wh-w96x-w232](https://github.com/advisories/GHSA-p2wh-w96x-w232) | `<= 0.3.14` | Crafted GGUF model creation can trigger a null dereference. Same model-import restrictions apply. |
| `GO-2025-3689` | [GHSA-2xf2-gjm6-g2c6](https://github.com/advisories/GHSA-2xf2-gjm6-g2c6) | `<= 0.3.3` | Crafted model metadata can trigger divide-by-zero during import. Same model-import restrictions apply. |
| `GO-2025-3695` | [GHSA-wrh5-cmwx-q2qr](https://github.com/advisories/GHSA-wrh5-cmwx-q2qr) | `<= 0.5.11` | Crafted manifest can crash the server through `/api/pull`; Core omits `/api/pull` and automatic pull. |
| `GO-2025-3824` | [GHSA-x9hg-5q6g-q3jr](https://github.com/advisories/GHSA-x9hg-5q6g-q3jr) | `<= 0.9.6` | Cross-domain authorization-token exposure through `/api/pull`; Core omits `/api/pull`. |
| `GO-2025-4251` | [GHSA-f6mr-38g8-39rg](https://github.com/advisories/GHSA-f6mr-38g8-39rg) | `<= 0.13.5` | Unauthenticated model-management operations; Core omits management routes and management CLI commands. The inference listener itself is not authenticated by Ollama. |
| `GO-2026-5750` | [GHSA-x99g-8v8j-25j2](https://github.com/advisories/GHSA-x99g-8v8j-25j2) | `<= 0.20.2` | Path traversal in `x/imagegen/transfer/digestToPath`. The affected `github.com/ollama/ollama/x/imagegen/transfer` package is absent from the pinned source tree; this binary report has no package/symbol trace for the ID. |

These are dispositions based on the advisory ranges, exact source tree, and
route design. The binary report still contains all nine IDs, and the final
runtime image has not yet been built and scanned in this continuation.

## Core-specific attack-surface changes and tests

Review of upstream `v0.40.17` found an additional outbound model-proxy route
that earlier triage missed. Upstream `server/routes.go` constructed the Codex
desktop proxy and registered `/api/codex/*`; `server/codex_proxy.go` forwarded
requests to external OpenAI/ChatGPT endpoints. That was inconsistent with a
private, local-inference-only Core.

The Scrolith patch now:

- Registers the Codex desktop proxy only outside Scrolith Core mode, leaving
  `/api/codex/*` unregistered in Core.
- Rejects cloud-model forwarding in the shared cloud proxy before any outbound
  request when Core mode is active. `OLLAMA_NO_CLOUD=1` remains set in the
  runtime image.
- Omits model pull/push/delete/create, blob upload/head, copy, web-search,
  web-fetch, and model-recommendation routes from Core.
- Returns an error for a missing bundled model before Ollama's automatic-pull
  path, and verifies the bundled Qwen manifest against the pinned digest data.

The 2026-11-25 Core tests passed. They assert that model-management, fetch, and
Codex routes return `404`, that a cloud-model request returns `403`, and that a
local HTTP test server receives no outbound proxy request. They also test that
a missing Qwen model is not downloaded. These tests do not establish the Azure
network boundary or authenticated API-to-Core behavior.

## Remaining security gates

- Ollama's HTTP listener does not authenticate callers itself. Production
  safety requires private ingress, isolation from untrusted apps in the same
  Container Apps environment, and authenticated API-to-Core requests. Those
  network and identity controls have not been validated against a private
  candidate environment in this run.
- No candidate API, disposable PostgreSQL/Redis, or private browser runner was
  provisioned. The owner has no existing synthetic account for this test and
  must create one through the supported signup and consent flow when the
  private candidate URL is available. No consent is seeded by the agent.
- No final model-bearing Core runtime image digest, Trivy scan, Qwen 8B
  inference measurement, API-to-Core request, quota settlement, audit record,
  or no-fallback integration result is established by this builder-stage run.
- The existing production AI settings and traffic have not been changed.

## Historical snapshot (2026-11-24)

The earlier ACR builder-stage report used the same upstream tag and govulncheck
version but an older vulnerability database. It reported 17,256 records for
eight IDs (2,157 records per ID) and source mode had no finding events. Those
counts are historical and are superseded by the 2026-11-25 local report above.
The failed ACR run did not produce a final image or digest. Preserve its raw
report and the associated task evidence packet outside the repository.
