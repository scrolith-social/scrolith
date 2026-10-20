# SCROLITHA AI MCP — Phase 1.4 Validation and Release-Blocker Report

**Validation date:** 2026-10-16 08:05 UTC
**Worktree:** `C:\Projects\.worktrees\scrolitha-ai-mcp-foundation-20261016`
**Branch:** `codex/scrolitha-ai-mcp-foundation-20261016`
**HEAD:** `ad7f0cee0acb728882926edf2560516542cdff58`
**Mode:** local development and disposable/static validation only

## Executive result

**Phase 1.4 implementation review status: PARTIAL PASS.**

The five read-only MCP tools remain present and the focused MCP boundary now has
27/27 passing tests. A managed-runtime correction makes HTTPS and required
resource configuration fail closed when `K_SERVICE` is present even if
`NODE_ENV` is accidentally `test` or `development`. Production dependencies
have zero High/Critical findings under the release gate
`npm audit --omit=dev --audit-level=high`.

This is not staging-ready. No real OAuth authorization server has been selected
or interoperably tested, the full dependency tree retains unresolved
development-only High findings, the complete backend Jest run is not green in
this environment, and no independent security approval exists. `/mcp` remains
disabled unless explicitly enabled and fully configured.

## Baseline and preservation

The reviewed Phase 1.3 report was read-only verified before this work. Its
SHA-256 is:

`41F9A44D7C9B66DFEB0AE77299F52FB94F18247F2F0702CA4B1381757DE208A8`

The starting commit and branch were unchanged at inspection time. Existing
uncommitted MCP work was preserved; no reset, clean, commit, push, merge,
deployment, database access, provider registration, or secret retrieval was
performed.

The pre-existing worktree also contained the Phase 1.1–1.3 reports and the
read-only foundation source. They were retained and are included in the review
inventory below; they were not rewritten.

## Implemented changes

### Runtime fail-closed correction

`src/routes/scrolithaMcp.routes.ts` now treats a non-empty `K_SERVICE` managed
runtime marker as production-like in addition to the existing production-runtime
helper. Therefore an enabled MCP route requires exact allowed hosts and a
resource URI, and rejects insecure requests, even when `NODE_ENV` is incorrectly
set to `test` or `development`.

`src/routes/__tests__/scrolithaMcp.routes.spec.ts` adds regression coverage for
both managed-runtime conditions. Environment variables are restored in `finally`
blocks.

### Dependency corrections

The package manifest and lockfile preserve Prisma 7 and update only the reviewed
security-sensitive ranges:

- `@prisma/client` and `prisma`: `7.10.0` → `7.10.1`;
- `compression`: `1.8.1` → `1.8.2`;
- `sharp`: `0.35.4` → `0.35.5`;
- transitive security overrides: `@fastify/busboy`, `handlebars`, `form-data`,
  `browserslist`, `js-yaml`, `brace-expansion`, `minimatch`, and `picomatch`.

The changes were resolved from the official npm registry without
`npm audit fix --force`, a Prisma major-version change, or audit suppression.
The lockfile has expected registry URL normalization and platform-specific
`sharp` package updates in addition to the security updates; this must be
reviewed before publication.

## OAuth architecture decision

### Verified current state

The maintained Scrolith application has user login integrations and passkeys,
but the reviewed code does not expose a maintained MCP authorization server
that issues authorization codes or access tokens. The development OAuth routes
are not an approved operational authorization server and remain excluded from
this design.

The MCP implementation is a resource server. It validates issuer, audience,
JWKS, algorithm allowlists, `exp`, `nbf`, the required `scrolith:read` scope,
optional resource binding, and the verified token subject. The five tools use
that subject and do not accept an arbitrary account selector.

### Recommendation

Use a dedicated, security-approved managed OIDC/OAuth authorization server as
the MCP authorization server, with Scrolith remaining the resource server and
authoritative account/subject-linking boundary. Do not build a second internal
authorization server and do not reuse the development OAuth routes.

No provider, tenant, client, issuer, redirect URI, secret, or production
configuration is approved or verified by this report. The recommendation is an
architecture decision only; provider interoperability remains blocked.

The intended contract is:

1. MCP client discovers Protected Resource Metadata from the MCP resource.
2. The metadata identifies exactly one approved authorization server and the
   `scrolith:read` scope.
3. The client uses Authorization Code with PKCE S256 against that provider.
4. The provider issues an access token whose `iss`, `aud`/resource, `sub`,
   expiry, not-before and scopes satisfy the resource-server contract.
5. Scrolith maps the verified `sub` to an active Scrolith account under an
   owner-approved linking policy; it never trusts a request header or tool
   argument for identity.
6. Token rotation, revocation, consent, logout, provider outage behavior and
   subject-link recovery are tested before enablement.

The MCP authorization material supports the resource-server half of the design:
[MCP TypeScript authorization guidance](https://ts.sdk.modelcontextprotocol.io/v2/serving/authorization),
[Protected Resource Metadata guidance](https://datatracker.ietf.org/doc/html/rfc9728),
and [OAuth security best current practice](https://datatracker.ietf.org/doc/rfc9700/).

### Operational configuration contract

The following values are required but intentionally have no real values in this
worktree:

| Variable | Requirement |
|---|---|
| `MCP_ENABLED` | Must remain unset/false by default; only explicit approved enablement may set true. |
| `MCP_OAUTH_ISSUER` | Exact HTTPS issuer from the approved provider. |
| `MCP_OAUTH_AUDIENCE` | Exact resource/API audience. |
| `MCP_OAUTH_JWKS_URL` | Exact HTTPS JWKS endpoint, with rotation and availability plan. |
| `MCP_RESOURCE_URI` | Exact HTTPS MCP resource identifier. |
| `MCP_OAUTH_AUTHORIZATION_SERVER` | Exact discovery authorization-server URL. |
| `MCP_OAUTH_ALGORITHMS` | Explicitly allowlisted signing algorithms; no `none` or algorithm fallback. |
| `MCP_REQUIRED_READ_SCOPE` | `scrolith:read`, pending provider interoperability. |
| `MCP_ALLOWED_HOSTS` | Exact host values only; no wildcard or URL values. |
| `MCP_TRUST_PROXY` | Only true behind an approved, trusted HTTPS proxy. |

Authorization-server metadata, client registration/CIMD policy, PKCE policy,
redirect URI, consent, token endpoint, refresh/revocation, and subject-linking
configuration remain provider-specific prerequisites and are not fabricated
here.

## Dependency security disposition

### Production scope

Command:

```text
npm audit --omit=dev --audit-level=high --registry=https://registry.npmjs.org --json
```

Result: **PASS, exit 0 for the High/Critical gate.** The report contained 0
Critical and 0 High, with 31 Moderate and 1 Low findings remaining. The plain
audit command still exits 1 because it reports Low/Moderate findings; that is
not an audit bypass and must remain visible to reviewers.

The corrected direct/transitive paths are `@fastify/busboy` 3.2.3,
`@prisma/config` 7.10.1 with `deepmerge-ts` 8.0.2, `mysql2` 3.24.4,
`compression` 1.8.2, and `sharp` 0.35.5.

### Full tree

Result after the compatible overrides: **FAIL for a zero High/Critical full-tree
gate, exit 1** — 0 Critical, 31 High, 36 Moderate, and 3 Low findings.

The formerly reported Handlebars Critical finding is remediated at 4.7.10.
The remaining High findings are development-tool paths, chiefly Jest 29 and
its Jest 30.2.0-or-earlier advisory range, `braces`/the `ts-node-dev` 2
watcher chain, and their transitive test tooling. npm proposes Jest 30.5.2,
which is a major upgrade and was not introduced without compatibility review.
No findings were suppressed. A separate dependency decision is required for
the remaining development tree; production readiness cannot be inferred from
the production-only PASS.

## Test and validation evidence

All commands below were executed locally in the backend module unless stated
otherwise. No live database, Azure resource, OAuth provider, or production
service was contacted.

| Check | Result | Evidence |
|---|---|---|
| Focused MCP Jest | PASS | `npm exec -- jest --config jest.scrolitha-mcp.config.cjs --runInBand`; 4 suites, 27 tests, 0 skipped, exit 0. |
| MCP TypeScript | PASS | `npm exec -- tsc --project tsconfig.scrolitha-mcp.json --pretty false`, exit 0. |
| Normal backend TypeScript build | PASS | `npm run build -- --pretty false`, exit 0. |
| Lockfile reproducibility | PASS | `npm ci --dry-run --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org`, exit 0. |
| Relevant auth/security regression | PASS | Five suites, 35 tests, 0 skipped, exit 0. |
| `git diff --check` | PASS | exit 0. |
| Production High/Critical audit | PASS | `npm audit --omit=dev --audit-level=high ...`, exit 0. |
| Full dependency audit | FAIL/blocked | `npm audit --audit-level=high ...`, exit 1; 31 High remain in dev tooling. |
| Full backend Jest suite | FAIL/INCOMPLETE | `npm test -- --passWithNoTests`, exit 1. Multiple suites fail before tests because the locally generated Prisma client requires an adapter while no disposable `DATABASE_URL` is configured; the process later reaches the Node heap limit. No complete Jest summary was produced. |
| MCP Inspector executable | NOT RUN | `npm ls @modelcontextprotocol/inspector --depth=0` exit 1; `npm exec --no -- mcp-inspector --help` exit 1 (“could not determine executable”). No Inspector protocol run was claimed. |
| Live OAuth interoperability | NOT RUN/BLOCKED | No approved provider, client, credentials, or callback environment. |
| Live database/Azure checks | NOT RUN | Prohibited by scope. |

The first attempted targeted regression command from the worktree root also
returned exit 1 because Jest found no module files there. It was immediately
rerun from `geezle-backend` and passed 35/35; the root invocation is retained
as a command-context error, not a source failure.

## Source inventory for independent review

Tracked modified files:

- `geezle-backend/package.json`
- `geezle-backend/package-lock.json`
- `geezle-backend/src/server.ts`

Untracked review-scope files:

- `geezle-backend/docs/SCROLITHA_MCP_PHASE1_1_VALIDATION.md`
- `geezle-backend/docs/SCROLITHA_MCP_PHASE1_2_VALIDATION.md`
- `geezle-backend/docs/SCROLITHA_MCP_PHASE1_3_VALIDATION.md`
- `geezle-backend/docs/SCROLITHA_MCP_READONLY_FOUNDATION.md`
- `geezle-backend/jest.scrolitha-mcp.config.cjs`
- `geezle-backend/tsconfig.scrolitha-mcp.json`
- `geezle-backend/src/routes/scrolithaMcp.routes.ts`
- `geezle-backend/src/routes/__tests__/scrolithaMcp.routes.spec.ts`
- all seven files under `geezle-backend/src/services/scrolithaMcp/` (four source,
  three test files)
- this report

No generated build output, credentials, private keys, application records, or
dependency caches belong in the review package. A static secret-pattern scan
found no private key or credential; the only bearer-like match was the
documented synthetic placeholder `synthetic-inspector-token` in the historical
Phase 1.2 report.

## Independent review package contents

Before handoff, create a patch outside the repository containing only the
inventory above and a SHA-256 manifest. The package must preserve the original
Phase 1.1–1.3 artifacts, exclude `node_modules`, caches, audit JSON files,
generated output, secrets and unrelated worktree changes, and identify this
report's final hash after writing it.

The generated local review patch is
`C:\Projects\scrolitha-ai-mcp-phase1-4-review.patch`. It contains exactly 19
review-scope files: three tracked modifications and 16 untracked MCP/report
files. Its final SHA-256 and byte size are reported with the handoff; the patch
is outside the Git worktree and was not staged.

## Release blockers and approvals

1. **OAuth provider approval:** owner and independent security reviewer must
   approve one provider contract, subject-linking policy, redirect/client policy,
   scopes, resource/audience, key rotation and revocation behavior.
2. **Interoperability evidence:** an approved disposable provider/test tenant
   must complete real authorization-code + PKCE, metadata discovery, token
   validation, expiry, wrong-audience, wrong-issuer, scope, rotation and revoke
   tests. No production credentials may be used.
3. **Full-tree dependency decision:** approve either a Jest 30 migration after
   compatibility testing or a documented development-only risk treatment for
   the unresolved Jest 29/ts-node-dev chain. No suppression is permitted.
4. **Full backend test environment:** provide an explicitly disposable local
   PostgreSQL/Redis configuration and Prisma generation mode compatible with the
   backend test harness; the current no-`DATABASE_URL` run is not evidence of a
   green full suite.
5. **Privacy/operations:** approve request logging redaction, rate limits,
   egress allowlists, abuse monitoring, token handling, and incident response.
6. **Independent review:** `@webskilldesign` must review the source, lockfile,
   OAuth contract, test evidence and package hashes. This report does not claim
   that approval.
7. **Staging:** remains **NO-GO**. Keep MCP disabled until all blockers and
   approvals close.

## Final decision

**SCROLITHA AI MCP PHASE 1.4: LOCAL SECURITY HARDENING COMPLETE; RELEASE BLOCKED.**

The source is ready for independent review of the local changes, not for
staging enablement or deployment. No commit, push, merge, OAuth registration,
secret creation, database operation or cloud action is authorized by this
work.
