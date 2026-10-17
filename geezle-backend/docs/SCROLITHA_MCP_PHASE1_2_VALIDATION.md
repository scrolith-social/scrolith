# Scrolitha MCP Phase 1.2 validation and security report

Date: 2026-10-16 (Asia/Singapore)

Status: **READY FOR SOURCE REVIEW; NOT READY FOR STAGING REVIEW**

No Azure, staging, production, live database, live identity, secret, GitHub, or deployment operation was used.

## Scope and baseline

- Worktree: `C:\Projects\.worktrees\scrolitha-ai-mcp-foundation-20261016`
- Branch: `codex/scrolitha-ai-mcp-foundation-20261016`
- Base and current HEAD before commit: `ad7f0cee0acb728882926edf2560516542cdff58`
- The Phase 1.1 changes remain uncommitted. The original worktrees were not modified.
- Phase 1.2 made only the MCP result-shape hardening, its regression test, and this report.

The endpoint remains disabled by default. It exposes exactly five read-only tools:

1. `get_my_profile`
2. `search_jobs`
3. `get_job_details`
4. `search_gigs`
5. `get_gig_details`

## Phase 1.2 source correction

`scrolithaMcp.server.ts` now guarantees that MCP `structuredContent` is a JSON object. Object-shaped data is returned unchanged; a non-object value is wrapped as `{ "data": value }`. This prevents an array returned by a future data-source implementation from producing an invalid MCP tool result. `scrolithaMcp.server.spec.ts` contains a regression test for an array-shaped search result.

This does not broaden data access, add a tool, add a write, or change the five-tool public contract.

## Official MCP Inspector verification

The pinned tool was installed in an isolated temporary directory and run with a portable Node runtime compatible with its declared engine:

- Node: `v22.19.0`
- `@modelcontextprotocol/inspector`: `2.11.0`
- Temporary Inspector directory: `D:\DevData\scrolitha-mcp-phase1-2-inspector2219`
- Temporary local server: `D:\DevData\scrolitha-mcp-phase1-2-server.cjs`
- Endpoint: loopback-only `http://127.0.0.1:6277/mcp`
- Data and bearer token: synthetic only

The host's default Node `v22.18.0` does not satisfy the Inspector's `>=22.19.0` requirement. A portable `v22.19.0` runtime was used for this local test only. No live endpoint was contacted.

Commands and outcomes:

| Check | Result | Exit |
|---|---:|---:|
| Inspector version | PASS (`2.11.0`) | 0 |
| `tools/list --strict` | PASS; exactly five tools, no schema portability errors | 0 |
| `get_my_profile` with synthetic bearer token | PASS; subject-bound synthetic profile only | 0 |
| `search_jobs` with bounded arguments | PASS; object-shaped paginated result | 0 |
| `search_gigs` with bounded arguments | PASS; object-shaped paginated result | 0 |
| Missing `jobId` for `get_job_details` | PASS negative test; MCP invalid-params/tool-error response | 5 |
| Unknown `jobId` | PASS negative test; sanitized unavailable-record tool error | 5 |
| Invalid bearer token | PASS negative boundary; Inspector received authentication challenge and did not call a tool | 3 |

Representative command:

```powershell
& 'D:\DevData\scrolitha-mcp-phase1-2-node2219\runtime\node-v22.19.0-win-x64\node.exe' `
  'D:\DevData\scrolitha-mcp-phase1-2-inspector2219\node_modules\@modelcontextprotocol\inspector\clients\launcher\build\index.js' `
  --cli --transport http --server-url 'http://127.0.0.1:6277/mcp' `
  --header 'Authorization: Bearer synthetic-inspector-token' `
  --method tools/list --strict --format json --quiet
```

An earlier attempt using the host Node version was not used as evidence. The compatible-runtime run above is the authoritative Inspector result.

## Local implementation validation

| Check | Command/result |
|---|---|
| Focused Jest | `NODE_OPTIONS=--max-old-space-size=4096 .\\node_modules\\.bin\\jest.cmd --config jest.scrolitha-mcp.config.cjs --runInBand --detectOpenHandles`; **PASS**, 4 suites, 24 tests, exit 0 |
| MCP TypeScript | `NODE_OPTIONS=--max-old-space-size=8192 .\\node_modules\\.bin\\tsc.cmd --project tsconfig.scrolitha-mcp.json --pretty false --noErrorTruncation`; **PASS**, exit 0 |
| Full backend build | `NODE_OPTIONS=--max-old-space-size=8192 npm.cmd run build -- --pretty false`; **PASS**, exit 0 |
| Dependency resolution | `npm.cmd ls @modelcontextprotocol/sdk jose --depth=0`; **PASS**, SDK 1.32.1 and jose 4.15.9, exit 0 |
| Patch whitespace | `git diff --check`; **PASS**, exit 0 |

The scoped tests use mocked Prisma data access or synthetic in-memory data. They do not prove live PostgreSQL permissions, live identity mapping, or Azure ingress behavior.

## OAuth and account-linking readiness

Verified locally:

- Protected-resource metadata is served only when MCP is enabled and contains no credentials or tokens.
- Runtime JWT verification requires an exact HTTPS issuer, audience, HTTPS JWKS URL, explicit `RS256`/`ES256` algorithm allowlisting, expiry/not-before validation, exact resource validation when configured, and the required `scrolith:read` scope.
- Authentication is per request. The account subject comes from the verified token; no request account ID, role hint, query parameter, or development bypass is used by the MCP route.
- No authorization-code flow or provider credential was contacted.

Not implemented or not verified:

- Authorization-server metadata from a real provider.
- Authorization-code + PKCE S256, resource indicators, client registration policy, consent, revocation, key rotation, account linking, and disconnect behavior.
- Provider-specific per-tool OAuth security declarations. The pinned SDK exposes route-level bearer authentication and tool annotations, but no verified provider contract for these declarations is present in this repository.
- Exact issuer, JWKS, client ID, redirect URI, scopes, account-linking policy, or production/staging credentials.

Therefore external account linking and staging enablement remain **BLOCKED** until an approved compatible OAuth provider is supplied and independently tested. No production endpoint or credential was invented.

## Security review findings

### Positive controls verified from source and local tests

- `MCP_ENABLED` is required; disabled mode returns 404 and does not initialize the Prisma data source.
- Production mode requires exact allowed hosts, a resource URI, and HTTPS (or an explicitly trusted proxy configuration).
- SDK DNS-rebinding protection is enabled when allowed hosts are configured.
- Only GET, POST, and DELETE are accepted; JSON bodies are strict and limited to 1 MiB.
- Zod bounds limit search text to 120 characters, IDs to 128 characters, result pages to 25, and offsets to 10,000.
- Tool annotations mark every tool read-only and non-destructive; no mutation query exists.
- Data access selects only approved profile/listing fields and filters listing data to active/public/approved records.
- Password hashes, refresh tokens, MFA secrets, private proposals, moderation data, and other authentication values are not selected.
- Per-request transports and servers are closed in `finally`; logs contain only sanitized error names.
- The local process uses synthetic data and no external network dependency.

### Pending security controls before staging

1. Restrict and monitor egress to the configured JWKS host. The URL is HTTPS-validated but is still an operator-controlled remote fetch target; it must be an owner-approved identity host with DNS/egress controls and rotation evidence.
2. Use `MCP_TRUST_PROXY=true` only behind the documented trusted ingress. Otherwise forwarded headers must not make an HTTP request appear secure.
3. Add an edge/shared rate-limit policy or other cross-instance control before multi-replica enablement. The current limiter is in-process.
4. Decide whether browser-origin requests are supported. If they are, add and test an explicit Origin allowlist; do not use wildcard CORS. If clients are non-browser, keep browser access out of the deployment contract.
5. Complete privacy review for the profile fields, email exposure, listing text, retention, logs, and downstream model handling. Returned text is untrusted content and must not be treated as instructions.
6. Verify database statement timeouts, pool limits, cancellation, and observability under bounded concurrent load. The local unit suite does not prove those live operational controls.
7. Verify that development authentication routes and administrator bypasses remain unavailable in staging/production configurations.

## Dependency vulnerability triage

Machine-readable npm audit evidence was captured from the official npm registry:

- Production report: `D:\DevData\scrolitha-mcp-phase1-2-inspector2219\production-audit.json`, SHA-256 `53B743A477C1D6A733FFEA085CA6C1DA84D1D72EDFB338F68396DFEFE463C26E`, 24,814 bytes.
- Full report: `D:\DevData\scrolitha-mcp-phase1-2-inspector2219\full-audit.json`, SHA-256 `0107571726795E7E44F833B578899DCF445BE4070DA1F32CBE19204720BAC4CA`, 59,469 bytes.

Commands:

```powershell
npm.cmd audit --omit=dev --registry=https://registry.npmjs.org --audit-level=high --json
npm.cmd audit --registry=https://registry.npmjs.org --json
```

Both commands returned npm's vulnerability exit code `1`, not an operational parse failure.

Summary:

| Scope | Critical | High | Moderate | Low | Total | MCP SDK finding | jose finding |
|---|---:|---:|---:|---:|---:|---:|---:|
| Production | 0 | 7 | 31 | 1 | 39 | No | No |
| Full tree | 1 | 44 | 34 | 3 | 82 | No | No |

The production High/Critical inventory is:

| Package | Installed | Severity | Direct | Reported affected range / path | Disposition |
|---|---:|---:|---:|---|---|
| `@fastify/busboy` | 3.2.0 | High | No | `<=3.2.1` | Dependency-owner remediation and runtime reachability review |
| `@prisma/config` | 7.10.0 | High | No | `6.13.0-dev.1 - 7.10.0 || 8.1.0-dev.1 - 8.1.0-dev.4`, via `deepmerge-ts` | Preserve Prisma 7.10.0 pending approved fix; review Prisma advisory before upgrade |
| `compression` | 1.8.1 | High | Yes | `<1.8.2` | Upgrade/remediate with backend regression tests |
| `deepmerge-ts` | 7.1.5 | High | No | `<8.0.0`, via Prisma config | Remediate with Prisma-compatible dependency update |
| `mysql2` | 3.15.3 | High | No | `<=3.23.0`, via Prisma | Confirm actual adapter exposure and Prisma-compatible fix |
| `prisma` | 7.10.0 | High | Yes | `6.13.0-dev.1 - 7.10.0 || 8.0.0-rc.3 - 8.1.0-dev.6` | No blind upgrade; separate Prisma/security-owner decision |
| `sharp` | 0.35.4 | High | Yes | `<0.35.5` | Upgrade and run image/media regression tests |

The full-tree High/Critical inventory is captured in the full JSON evidence. It includes `@fastify/busboy`, the Jest 29.7.0 family, `@prisma/config`, `@types/jest` 29.5.14, `babel-jest`, `brace-expansion` 1.1.12, `braces` 3.0.3, `browserslist` 4.28.1, `chokidar` 5.0.0, `create-jest`, `deepmerge-ts`, `expect`, `form-data` 4.0.5, critical `handlebars` 4.7.9, `js-yaml` 3.14.2, `micromatch` 4.0.8, `minimatch` 3.1.2, `mysql2`, `picomatch` 2.3.1, `prisma`, `sharp`, and `ts-node-dev` 2.0.0. The report marks direct versus transitive reachability and affected ranges; no finding was suppressed.

`@modelcontextprotocol/sdk@1.32.1` was introduced deliberately and is absent from the High/Critical audit inventory. `jose@4.15.9` is also absent. A major jose upgrade was not applied: current jose 5/6 packages are ESM-oriented (`jose@6` declares `type: module`), while this backend's current CommonJS/ts-jest build uses the pinned 4.x API. A major upgrade requires a separate module-compatibility review and is not justified by the current audit result alone.

The remaining production findings are a release blocker for staging enablement until remediated or formally dispositioned by the dependency and security owners. `npm audit fix --force` was not used.

## File inventory and review boundary

Tracked files modified in the worktree:

- `geezle-backend/package.json`
- `geezle-backend/package-lock.json`
- `geezle-backend/src/server.ts`

Untracked implementation, tests, configuration, and reports:

- `geezle-backend/docs/SCROLITHA_MCP_READONLY_FOUNDATION.md`
- `geezle-backend/docs/SCROLITHA_MCP_PHASE1_1_VALIDATION.md`
- `geezle-backend/docs/SCROLITHA_MCP_PHASE1_2_VALIDATION.md`
- `geezle-backend/jest.scrolitha-mcp.config.cjs`
- `geezle-backend/tsconfig.scrolitha-mcp.json`
- `geezle-backend/src/routes/scrolithaMcp.routes.ts`
- `geezle-backend/src/routes/__tests__/scrolithaMcp.routes.spec.ts`
- `geezle-backend/src/services/scrolithaMcp/scrolithaMcp.auth.ts`
- `geezle-backend/src/services/scrolithaMcp/scrolithaMcp.data.ts`
- `geezle-backend/src/services/scrolithaMcp/scrolithaMcp.server.ts`
- `geezle-backend/src/services/scrolithaMcp/scrolithaMcp.types.ts`
- `geezle-backend/src/services/scrolithaMcp/__tests__/scrolithaMcp.auth.spec.ts`
- `geezle-backend/src/services/scrolithaMcp/__tests__/scrolithaMcp.data.spec.ts`
- `geezle-backend/src/services/scrolithaMcp/__tests__/scrolithaMcp.server.spec.ts`

No Prisma schema, migration, frontend, mobile, Azure, production configuration, CI workflow, credential, or secret file was changed.

The review patch was generated outside the worktree so the worktree remains uncommitted:

- Patch: `D:\DevData\scrolitha-mcp-phase1-2-inspector2219\scrolitha-mcp-phase1-2.patch`
- File count: 17 authorized files

The patch headers were checked against the explicit 17-file allowlist. The final size and SHA-256 are reported separately because embedding a patch hash inside the patch would make the hash self-referential. The normal worktree `git diff --check` was clean. The patch is review-only; no files were staged or committed.

## Final gates

| Gate | Result | Reason |
|---|---|---|
| Local source implementation | PASS | Focused tests, TypeScript, build, Inspector, and diff checks pass |
| MCP Inspector protocol evidence | PASS | Pinned Inspector 2.11.0 on Node 22.19.0 completed synthetic HTTP checks |
| OAuth provider interoperability | BLOCKED | No approved provider metadata, client, PKCE flow, token/revocation or account-link evidence |
| Dependency security gate | BLOCKED | Existing production 7 High findings and full-tree 1 Critical/44 High remain |
| Independent security review | PENDING | Requires reviewer inspection of source, audit evidence, OAuth design, and pending controls |
| Staging enablement | NO-GO | Must remain disabled until OAuth, dependency, privacy, operational DoS, and owner approvals close |

**READY FOR SOURCE REVIEW: YES.**

**READY FOR STAGING REVIEW: NO.**

No push, merge, deployment, identity configuration, provider registration, database connection, or runtime enablement was performed. Rollback remains leaving `MCP_ENABLED` unset/false or reverting the isolated source/dependency changes.
