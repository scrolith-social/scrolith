# Scrolitha MCP Phase 1.1 validation and security report

Date: 2026-10-16 (Asia/Singapore)

Status: **BLOCKED — local review evidence is strong, but required external OAuth and MCP Inspector validation remain pending.**

Worktree: `C:\Projects\.worktrees\scrolitha-ai-mcp-foundation-20261016`

Branch: `codex/scrolitha-ai-mcp-foundation-20261016`

Base: `ad7f0cee0acb728882926edf2560516542cdff58`

No Azure, staging, production, live database, live identity, secret, GitHub, or deployment operation was used.

## Scope and architecture

The implementation remains disabled by default and exposes exactly five read-only tools:

- `get_my_profile`
- `search_jobs`
- `get_job_details`
- `search_gigs`
- `get_gig_details`

The route is mounted at `/mcp` before the broad application JSON parser, uses a 1 MiB strict body limit, permits only GET/POST/DELETE, creates a stateless SDK server/transport per request, authenticates every data request, and closes the server after handling the request. MCP data access is lazy when disabled, so disabled-route tests do not initialize Prisma.

The data layer binds profile reads to the verified JWT subject, returns only selected profile fields, and filters jobs/gigs to active, visible/public/approved records. It does not select password hashes, refresh tokens, MFA secrets, private proposals, applicants, moderation data, or other authentication values. No mutation tool or write query was added.

## Security corrections

- Corrected all five tool registrations to use the type-erased SDK registration helper; this removes the known SDK conditional-type expansion problem without changing runtime schemas.
- Added exact HTTPS issuer, JWKS, and resource validation; explicit `RS256,ES256` algorithm allowlisting; expiry and not-before checks; subject length bounds; exact issuer/audience/resource matching; required `scrolith:read` scope; and malformed Bearer-header handling.
- Added exact host/optional-port validation, wildcard/URL rejection, production HTTPS enforcement, 401 Bearer challenges, unsupported-method rejection, and protected-resource metadata at `/mcp/.well-known/oauth-protected-resource`.
- Added local synthetic RSA/JWKS signature-negative coverage. No request role, query role, client-supplied account ID, or development authentication bypass is used by the MCP route.
- Pinned the MCP SDK at `@modelcontextprotocol/sdk@1.32.1` after the official npm audit reported High advisories in `1.24.0`. `jose` remains pinned at `4.15.9`; it was not reported by the audit.

The protected-resource metadata endpoint does not implement an identity provider. Authorization-server discovery, authorization-code + PKCE, client registration, resource-indicator issuance, token revocation, key rotation operations, account linking, and account disconnection remain requirements of the approved external identity provider and are not claimed complete.

## Changed files

Tracked files modified:

- `geezle-backend/package.json`
- `geezle-backend/package-lock.json`
- `geezle-backend/src/server.ts`

New implementation, tests, validation configuration, and documentation:

- `geezle-backend/docs/SCROLITHA_MCP_READONLY_FOUNDATION.md`
- `geezle-backend/docs/SCROLITHA_MCP_PHASE1_1_VALIDATION.md`
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

No Prisma schema, migration, frontend, mobile, CI, Azure, or production configuration file was changed.

## Executed validation

| Check | Command / evidence | Result |
|---|---|---|
| Clean dependency install | `npm.cmd ci --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org` | PASS, exit 0 |
| Direct dependency resolution | `npm.cmd ls @modelcontextprotocol/sdk jose --depth=0` | PASS: SDK 1.32.1, jose 4.15.9 |
| Focused TypeScript | `NODE_OPTIONS=--max-old-space-size=8192 .\\node_modules\\.bin\\tsc.cmd --project tsconfig.scrolitha-mcp.json --pretty false --noErrorTruncation` | PASS, exit 0 |
| Full backend TypeScript | `NODE_OPTIONS=--max-old-space-size=8192 npm.cmd run build -- --pretty false` | PASS, exit 0 |
| MCP Jest suite | `NODE_OPTIONS=--max-old-space-size=4096 .\\node_modules\\.bin\\jest.cmd --config jest.scrolitha-mcp.config.cjs --runInBand --detectOpenHandles` | PASS: 4 suites, 23 tests, exit 0 |
| Formatting/error scan | `git diff --check` | PASS, exit 0 |
| SDK in-memory protocol | MCP SDK `InMemoryTransport`: initialize, discovery, annotations, authenticated calls, error result | PASS in Jest |
| Local HTTP protocol | Streamable HTTP initialize with synthetic principal and mocked data source | PASS in Jest |
| Auth negative tests | Claims, expiry, not-before, issuer, audience, resource, scope, malformed header, invalid synthetic RSA signature, HTTPS/algorithm configuration | PASS in Jest |
| Data boundary tests | Mocked Prisma predicates and selected fields; no database connection | PASS in Jest |
| MCP Inspector | `npm.cmd exec --yes --package=@modelcontextprotocol/inspector@2.11.0 -- mcp-inspector --cli --help` | NOT RUN: package/CLI install did not become usable after repeated bounded attempts; stopped without bypassing the boundary |

The Inspector result is not reclassified as a successful protocol test. The local SDK and HTTP tests are supplemental evidence, not a substitute for the required Inspector run.

## Dependency vulnerability results

The official npm registry audit was run after the SDK upgrade:

- Production scope: exit 1; 0 critical, 7 high, 31 moderate, 1 low.
- Full tree: exit 1; 1 critical, 44 high, 34 moderate, 3 low.
- `@modelcontextprotocol/sdk` no longer appears in the post-upgrade High/critical findings.
- `jose@4.15.9` does not appear in the audit findings.

The remaining findings are existing backend/development dependency issues, including `compression`, `prisma`/`@prisma/config`, `sharp`, `@fastify/busboy`, Jest packages, and development tooling. They were not suppressed or changed as part of this MCP correction and require separate dependency-owner review before any production release decision.

The configured npm mirror audit attempt is not evidence: it failed with HTTP 404 because that mirror does not implement the npm audit endpoint. The npmjs.org result above is the authoritative local audit used here.

## Regression and boundary assessment

- Route behavior is additive and feature-gated; `MCP_ENABLED` must be explicitly enabled.
- Disabled-route tests return 404 even with malformed MCP host configuration and do not initialize the data source.
- No database schema or migration change exists.
- No production or Azure configuration was enabled.
- No live external requests are made by the local tests; JWKS behavior is covered only with synthetic local keys or configuration validation.
- Existing backend full TypeScript compilation passes under the explicitly recorded 8 GiB Node heap. A normal default-heap build was previously resource-constrained and is not used as the passing evidence.
- No full repository Jest regression suite was run in this phase; the scoped MCP suite and full build were run. Broader backend tests may require their separately authorized disposable PostgreSQL/Redis environment.

## Remaining blockers and next authorized steps

1. Run MCP Inspector against a local HTTPS service using synthetic credentials and record its version, protocol negotiation, discovery, call, invalid-parameter, and cleanup evidence.
2. Obtain the approved external OAuth provider configuration and verify protected-resource metadata, authorization-server discovery, authorization-code + PKCE, resource indicators, registration policy, revocation, key rotation, account linking, and disconnect behavior.
3. Complete independent privacy/security review of profile and public-listing fields, retention, rate limiting, monitoring, and logging.
4. Dispose of or separately remediate the remaining npm High/Critical findings; no exception is granted here.
5. Only after those blockers are closed may staging enablement, identity configuration, or deployment review begin.

Rollback remains simple because the route is disabled by default and no database migration was added: revert the isolated source/dependency changes or leave `MCP_ENABLED` unset/false. No deployment, push, merge, or production action was performed.
