# Scrolitha MCP Release Readiness

Status: **BLOCKED for independent security review handoff; NOT ready for staging or production**

Validation date: 2026-10-16 (Asia/Singapore)

## Scope and source integrity

- Worktree: `C:\Projects\.worktrees\scrolitha-ai-mcp-foundation-20261016`
- Branch: `codex/scrolitha-ai-mcp-foundation-20261016`
- Baseline HEAD: `ad7f0cee0acb728882926edf2560516542cdff58`
- Existing Phase 1.4 report SHA-256: `a43a8888d7a49975ae1015121081f30d0dc04eca0675188fed3764d997f477c6`
- Existing independent review patch SHA-256: `f0aa25dbb498c1bb5c595ca04ecb4744e1119d35d1192487a0184ccf5ae6e3fe`
- Current tracked-delta review patch SHA-256: `d4bb2b21612b43c95fbb6e25fd93ac749bb03ad65c328f7c5f259703826f5608`
- Current tracked-delta review patch: `C:\Projects\scrolitha-ai-mcp-phase1-4-current-tracked.patch` (94,286 bytes)
- Frontend submodule gitlink used by the completed rerun: `cb0be573ac7f11e2d8fb8c59a6a7978410e0d575` (exact pinned parent revision; initialized from the local `C:\Projects\geezle` object store)

The worktree was preserved. No commit, push, Azure access, GitHub workflow dispatch, OAuth provider registration, live credential retrieval, staging/production database connection, migration, or deployment was performed.

The worktree already contained uncommitted MCP implementation, package, server, and validation changes before this report. The targeted local-test corrections made during this validation were limited to:

- `geezle-backend/docker-compose.test.yml`
- `geezle-backend/package.json` (`test:db:up` starts both disposable services)
- `geezle-backend/scripts/run-cloudbuild-test-command.mjs`
- `geezle-backend/scripts/run-jest-full.mjs`
- `geezle-backend/scripts/run-test-db-command.mjs`

Those corrections add a disposable Redis service, pinned local images, a local shadow database default, and fail-closed local Redis target validation. No Prisma schema or migration file was changed.

## Consolidated validation matrix

| Area | Result | Evidence |
|---|---|---|
| MCP focused Jest suite | **PASS** | 4 suites, 27 tests, 0 skipped, exit 0; `jest.scrolitha-mcp.config.cjs`, `--runInBand` |
| MCP TypeScript validation | **PASS** | `npm exec --no -- tsc --project tsconfig.scrolitha-mcp.json --pretty false`, exit 0 |
| Normal backend build | **PASS** | `npm run build -- --pretty false`, exit 0 |
| Node contract tests | **PASS** | `npm run test:node`, exit 0; runner completed all discovered `node:test` files |
| Disposable PostgreSQL/Redis target guard | **PASS** | `node scripts/test-db-guard.mjs`, exit 0; local loopback target and test markers accepted |
| Disposable PostgreSQL startup | **PASS** | PostgreSQL 16 pinned image, synthetic credentials, loopback port 55432, health/readiness check |
| Disposable Redis startup | **PASS** | Redis 7 pinned image, loopback port 56379, `REDIS_TEST_MODE=local`, health/readiness check |
| Prisma migration replay | **PASS** | `npm exec --no -- prisma migrate deploy`, exit 0; 139 migrations found/applied in disposable PostgreSQL |
| Prisma Client generation | **PASS** | `npm exec --no -- prisma generate`, exit 0; Prisma Client 7.10.1 |
| Synthetic fixture seeding | **PASS** | `node scripts/seed-test-fixtures.mjs`, exit 0 |
| Full sharded Jest suite | **PASS** | D:-backed rerun completed all 34 groups; 207/207 suites and 1,312/1,312 tests passed, 0 pending, 0 todo, 0 skipped, 0 timed-out groups, 0 unreadable summaries; exit 0. The exact frontend gitlink revision was initialized before the rerun. |
| Docker Compose definition | **PASS with warning** | `docker compose -f docker-compose.test.yml config --quiet`, exit 0; Docker warns that the obsolete `version` key is ignored |
| Docker image integrity | **PASS** | PostgreSQL image digest `sha256:65b16a8b326e0cfbdf33fa7e783f2a0cb352a61448616ccccfd616ef42aa0f65`; Redis image digest `sha256:858f009f9709ce576febc734aa78b8f6d624b82571f9ddb6bda4377c833b3499`; both `linux/amd64` |
| Docker resource cleanup | **PASS** | No containers, volumes, or networks remained with label `scrolitha.local-test=20261016` |
| `git diff --check` | **PASS** | Exit 0 |
| GitHub Actions semantic lint | **NOT RUN** | `actionlint` is unavailable locally; basic workflow structure checks passed, but that is not equivalent to actionlint |
| MCP Inspector 2.11.0 | **BLOCKED / NOT EXECUTED** | The approved digest-pinned Linux/amd64 image `node@sha256:b6f26b36c8ff49624cfdac716b8ea1138d606df02586a77d364bb5536a634f85` reports Node `v22.23.2`. The official Inspector tarball is intact, but does not bundle its client dependency. The official `@modelcontextprotocol/client@2.3.1` tarball contains both `dist/index.mjs` and `dist/index.cjs`; the prior isolated/offline `npm exec` environment still failed with `ERR_MODULE_NOT_FOUND` for `dist/index.mjs`. The published-artifact absence is therefore ruled out; the exact npm resolution/cache cause remains unresolved. A fresh network pull in the pinned container did not complete within the bounded window. No official Inspector protocol result is claimed. |
| Alternative maintained MCP client conformance | **PASS** | Official `@modelcontextprotocol/client@2.3.1` exercised a local synthetic HTTP MCP server: initialization, discovery of all five tools, schema bounds, five valid calls, structured content, invalid-token 401, malformed-argument rejection, two-account isolation, listing visibility, and disabled-route 404 all passed; no database or live service was used. |
| MCP Jest natural shutdown | **PASS** | Focused 4-suite/27-test MCP run completed without `--forceExit`, with `--detectOpenHandles`, exit 0; no open handles were reported. The full sharded runner still uses its existing `--forceExit`. |

The first disposable attempt failed before test execution because the launcher inspected health on containers created without health checks. That harness issue was corrected by using the health-checked pinned services; the later replay reached migration and test execution. The first full Jest attempt then stopped at group 8 because C: exhausted its temporary Jest transform-cache space (`ENOSPC`); 665 tests that started passed, but the run was incomplete. A second run used the run-owned D: temporary path `D:\scrolitha-mcp-full-jest-temp-20261016-v2` and completed all 34 groups successfully. The environment failure is retained as evidence and is not reclassified as a test failure.

The completed full run still emitted existing diagnostic output, including optional-environment warnings, Prisma slow-query logs, synthetic missing-service paths, and a post-test asynchronous-log warning. The runner's existing `--forceExit` option remains in use, so the run proves test completion and exit 0 but does not independently prove a natural process-lifecycle exit.

Reproducible command evidence for the completed rerun:

```text
$env:TEMP='D:\scrolitha-mcp-full-jest-temp-20261016-v2'
$env:TMP=$env:TEMP
$env:NODE_ENV='test'; $env:APP_RUNTIME='test'; $env:DISABLE_BACKGROUND_WORKERS='true'
$env:TEST_DB_KIND='local-postgres'; $env:TEST_DB_PROJECT='local-only'; $env:TEST_DB_INSTANCE='local-postgres-test'; $env:TEST_DB_NAME='scrolith_test'
$env:DATABASE_URL='postgresql://scrolith_test:local_test_password@127.0.0.1:55432/scrolith_test'
$env:SHADOW_DATABASE_URL='postgresql://scrolith_test:local_test_password@127.0.0.1:55432/scrolith_shadow'
$env:REDIS_TEST_MODE='local'; $env:REDIS_URL='redis://127.0.0.1:56379'
npm.cmd run test:full
exit=0
```

The Inspector runtime checks were:

```text
docker run --rm node@sha256:b6f26b36c8ff49624cfdac716b8ea1138d606df02586a77d364bb5536a634f85 node --version
v22.23.2

docker run --rm ... npm exec --offline --yes --package=@modelcontextprotocol/inspector@2.11.0 -- mcp-inspector --cli --help
exit=1
Error: Cannot find module '@modelcontextprotocol/client/dist/index.mjs'
```

The ellipsis above denotes only the D:-cache bind mount; no live service, credential, or non-local endpoint was used.

## Inspector artifact verification and protocol closure

Official npm metadata for `@modelcontextprotocol/inspector@2.11.0` reports Node `>=22.19.0`, tarball URL `https://registry.npmjs.org/@modelcontextprotocol/inspector/-/inspector-2.11.0.tgz`, npm shasum `0ac1d0eb20372528789fbcd259b5cd72ce539691`, and integrity `sha512-gqMw2x0NCotTdjLNv3PSm/IJSeXL7O8u0SpyZXtXGhSukJ2DMoAy8RR7xKngHTCETJcG5gyPdxhOn8zf/ofSRA==`. The locally downloaded tarball was 1,560,193 bytes with SHA-256 `F316F4E4CB25F8EA052C733CAD14B530C6EB6E89F6F9B9370D7022E49AB8B757`; its published inventory contains the launcher and CLI builds but no bundled `@modelcontextprotocol/client` directory.

The exact dependency metadata requires `@modelcontextprotocol/client` `2.3.1`. Its official tarball was 1,650,068 bytes with npm shasum `3220735690d1f1609f77dfff8b969714c1da9dc7`, integrity `sha512-mIGZXpHsjnZ6lD+gD/WCMpR5k8yVQQ8nNFH1N0Srf7AvnwTUMYD6pvTY8ng2+He5FfV7YMZLmrjL7cLa/cc3dQ==`, and SHA-256 `0FEBE399E355B703D4E9FA6EB1453C5FA06B06C78E2421D797DCB145FB9BB68F`. Its published inventory contains both `package/dist/index.mjs` and `package/dist/index.cjs`.

The official release page identifies Inspector 2.11.0 at signed commit `074b810`. npm currently reports 2.11.0 as the `latest` Inspector release; no verified newer release was available during this validation. The supported Inspector documentation requires Node 22.19.0 or newer and documents `npx @modelcontextprotocol/inspector --cli` as the machine-readable client.

The missing-module failure is therefore classified as **dependency installation/resolution or cache inconsistency, not a missing file in the official client tarball**. The previous failing reproduction is preserved in the report and cache evidence; package files were not copied, renamed, or patched. Because the official Inspector path remains unresolved, the alternative-client result below is not substituted for official Inspector approval.

The independent conformance command used a temporary installation of the official maintained client package and a local synthetic Express MCP server:

```text
NODE_PATH=D:\scrolitha-mcp-client-20261016\node_modules;C:\Projects\.worktrees\scrolitha-ai-mcp-foundation-20261016\geezle-backend\node_modules
node D:\scrolitha-mcp-client-20261016\run-alternative-client-conformance.cjs
exit=0
ALTERNATIVE_CLIENT_CONFORMANCE=PASS
TOOLS=5; VALID_CALLS=5; INVALID_TOKEN=401; MALFORMED_ARGUMENTS=REJECTED
TWO_ACCOUNT_ISOLATION=PASS; DISABLED_ROUTE=404
```

This is a protocol conformance and authorization-boundary result using synthetic identities and data. It is not an official Inspector result and does not authorize `/mcp` enablement.

## Local MCP implementation review

The route is mounted at `/mcp` but remains disabled unless `MCP_ENABLED` is explicitly truthy. Production-like runtimes additionally require exact allowed hosts, a resource URI, and HTTPS or an explicitly trusted HTTPS proxy header.

The five exposed tools are:

1. `get_my_profile`
2. `search_jobs`
3. `get_job_details`
4. `search_gigs`
5. `get_gig_details`

All five are annotated read-only, non-destructive, and closed-world. Tool input is schema-bounded; account identity comes from the verified token subject rather than a caller-supplied account identifier. No arbitrary SQL, write tool, shell, file, or application-record administration interface was found in the reviewed MCP source.

Authentication checks require a bearer token, HTTPS issuer and JWKS URL, an explicit audience, supported `RS256`/`ES256` algorithms, signature verification, issuer/audience/expiry/not-before validation, the `scrolith:read` scope, and—when configured—the exact resource claim. The local tests use synthetic keys and principals only.

The implementation treats profile/listing content as untrusted data and documents prompt-injection boundaries. Remaining operational controls include egress restrictions for the configured JWKS endpoint, production secret/configuration review, rate-limit sizing, log redaction verification, and an independent security review.

## OAuth/OIDC decision

The current code is an MCP resource server/verifier, not a complete authorization server. It does not provide a maintained authorization-code endpoint, token endpoint, client-registration lifecycle, consent UI, provider discovery implementation, account-linking policy, or revocation/session management for MCP clients. Existing social-login routes must not be assumed to satisfy MCP resource indicators or audience binding.

**Recommendation:** use a dedicated managed OIDC/OAuth 2.1 provider with Authorization Code + PKCE (S256), exact redirect URI registration, resource/audience binding, discovery, JWKS rotation, consent, revocation, and an explicit `scrolith:read` scope. Keep Scrolith as the resource server and map identities by `(issuer, subject)`; do not link by email alone. Account linking, duplicate prevention, multi-account selection, and unlink/revoke behavior require explicit product/security approval.

External provider selection, tenant/audience/resource values, client registration, redirect URIs, data-processing terms, and any paid service require owner and security approval. No provider was registered and no live credential was used in this work.

## Dependency-security disposition

Commands executed against the public npm registry were:

```text
npm.cmd audit --omit=dev --audit-level=high --registry=https://registry.npmjs.org --json
npm.cmd audit --audit-level=high --registry=https://registry.npmjs.org --json
```

Results:

- Production scope: exit 0; 0 High, 0 Critical, 31 Moderate, 1 Low.
- Full tree: exit 1; 0 Critical, 31 High, 36 Moderate, 3 Low.
- The full-tree High findings are concentrated in development tooling: Jest 29.x transitive packages, `@types/jest`, `braces`/`micromatch` through `chokidar`, and direct `ts-node-dev` paths.

These findings were not suppressed, force-upgraded, or granted an exception. The next remediation should be a targeted dependency review with advisory-by-advisory reachability and compatibility testing. Production-scope zero High/Critical remains a local result, not a release approval.

The full-tree High inventory is 31 package nodes, with the following reviewed paths and remediation signals:

- Jest 29 development graph: `jest`, `@types/jest`, `@jest/console`, `@jest/core`, `@jest/environment`, `@jest/expect`, `@jest/fake-timers`, `@jest/globals`, `@jest/reporters`, `@jest/test-result`, `@jest/test-sequencer`, `@jest/transform`, `babel-jest`, `create-jest`, `expect`, `jest-circus`, `jest-cli`, `jest-config`, `jest-environment-node`, `jest-haste-map`, `jest-message-util`, `jest-resolve`, `jest-resolve-dependencies`, `jest-runner`, `jest-runtime`, `jest-snapshot`, and `jest-watcher`. The registry reports the principal remediation as Jest `30.5.2`, a major-version change requiring compatibility review; `@types/jest` reports `30.0.0` separately.
- File-watching development graph: `braces` through `micromatch`/`chokidar`, including the `braces` advisory `GHSA-vfj7-8cjw-p6xm`; the audit reports `chokidar` and direct `ts-node-dev` without an automatic fix.
- The remaining high node is `micromatch`, which is part of the Jest/file-watching graph. No High or Critical production-scope node was reported.

This is an inventory/disposition input, not a security exception. Reachability is development-tooling based on the lockfile graph; each advisory still requires owner/security disposition and compatibility testing before release approval.

## Source and worktree inventory

At report time, the worktree had these tracked modifications:

- `geezle-backend/docker-compose.test.yml`
- `geezle-backend/package-lock.json`
- `geezle-backend/package.json`
- `geezle-backend/scripts/run-cloudbuild-test-command.mjs`
- `geezle-backend/scripts/run-jest-full.mjs`
- `geezle-backend/scripts/run-test-db-command.mjs`
- `geezle-backend/src/server.ts`

It also had the existing untracked MCP implementation, tests, configs, and Phase 1.x documents under `geezle-backend/`. Those inherited changes were preserved and were not reset, cleaned, staged, committed, or pushed. The tracked-delta patch hash above does not include untracked files; reviewers must use the worktree inventory and the existing Phase 1.4 review patch for complete source review.

A high-risk secret-pattern scan over the MCP source, configs, and reports found no private-key blocks, GitHub tokens, cloud access-key patterns, API-key patterns, or provider client secrets. The only credential-looking values encountered in the local-test scripts are the intentionally synthetic loopback PostgreSQL credentials and are not operational credentials.

## Independent-review package

The complete source/evidence package is prepared at `D:\scrolitha-mcp-final-review-20261016.zip`. It contains 26 files listed in `FILE_HASHES.sha256`, including the complete MCP-related tracked/untracked source set, validation documents, the updated readiness report, the synthetic alternative-client conformance harness, and the review checklist. It excludes `node_modules`, compiled binaries, Docker images, npm tarballs, private keys, credentials, and disposable service data.

The final package SHA-256 and byte size are reported with the handoff artifact. The package is a handoff artifact only; it does not represent independent security approval.

## Release gates

| Gate | Status | Required action |
|---|---|---|
| Local source implementation | **PASS with review caveat** | Preserve `/mcp` disabled by default and review the complete uncommitted source set |
| Disposable database/Redis infrastructure | **PASS** | Retain pinned image and target guards |
| Full backend Jest regression | **PASS** | Exact frontend submodule revision was initialized from the local object store; D:-backed rerun completed all 34 groups with 207 suites and 1,312 tests passing, exit 0 |
| Independent MCP Inspector protocol validation | **BLOCKED** | Node 22.23.2 is available in a digest-pinned local image. The official Inspector tarball and official client tarball were integrity-checked; the prior isolated npm resolution still fails before protocol execution, and no newer verified Inspector release is available. Obtain a vendor-supported resolution or approved tool correction, then rerun the official protocol checks |
| Alternative MCP protocol conformance | **PASS with boundary** | Official `@modelcontextprotocol/client@2.3.1` passed the synthetic five-tool HTTP conformance and authorization checks; this does not replace official Inspector validation |
| Full-tree dependency security | **BLOCKED** | Resolve or independently disposition the 31 High development findings; do not suppress them |
| OAuth provider readiness | **BLOCKED** | Select and approve the managed provider and complete local callback/account-continuity design before external registration |
| Independent security review | **NOT RUN** | Reviewer must inspect source, evidence, dependency disposition, and operational configuration |
| Staging readiness | **NO-GO** | Requires all blocked gates, approved production-like configuration, and separate staging authorization |
| Production readiness | **NO-GO** | No production credentials, provider, deployment, or operational evidence was used |

## Rollback and feature-flag posture

The implementation has no schema migration dependency. The operational rollback is to keep `MCP_ENABLED` false and revert the MCP route/source and dependency changes in a reviewed change set. No database rollback is needed for this feature. Any future enablement must be staged behind the explicit flag, exact host/resource allowlists, verified OAuth configuration, monitoring, rate limits, and an operator-tested disable procedure.

## Final decision

**LOCAL READINESS: BLOCKED.** The focused MCP implementation is locally type-safe, its 27 Jest tests pass both with the existing runner and in a bounded natural-shutdown run, and the complete backend regression passes locally. Official Inspector protocol validation remains blocked by an unresolved npm dependency-resolution failure; the official client artifact itself contains the expected module. Development dependency High findings remain, and no independent security approval exists.

**INDEPENDENT REVIEW: NOT READY.** The package can be handed to a reviewer as a diagnostic package with the above blockers; it must not be represented as security-approved.

**STAGING/PRODUCTION: NO-GO.** Owner actions are: resolve the pinned Inspector package defect through a trusted/vendor-supported path and execute its protocol checks, disposition development advisories, approve the managed OAuth provider design, and obtain independent security review before any operational enablement.
