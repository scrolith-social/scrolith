# Scrolitha AI MCP Phase 1.3 validation, OAuth readiness, and independent-review report

Date: 2026-10-16 (Asia/Singapore)

Status: **LOCAL SOURCE REVIEW READY; STAGING AND PRODUCTION ENABLEMENT BLOCKED**

No Azure, staging, production, live database, live identity provider, secret,
GitHub, deployment, or external MCP endpoint was accessed. The MCP route remains
disabled unless explicitly enabled by configuration.

## 1. Executive summary

The existing Phase 1.0–1.2 implementation provides five read-only MCP tools behind
a stateless Streamable HTTP route. The route validates externally issued bearer JWTs
and binds every data lookup to the verified JWT subject. It does not implement an
authorization server, OAuth authorization-code flow, PKCE, consent, client
registration, account linking, or revocation.

Local results:

- clean dependency installation: PASS;
- focused MCP tests: 4 suites, 25 tests, PASS;
- MCP TypeScript validation: PASS;
- normal backend TypeScript build: PASS;
- dependency resolution: PASS;
- whitespace check: PASS.

Release blockers:

1. no approved real OAuth/OIDC provider contract is configured or verified;
2. production dependency audit reports 7 High findings;
3. full-tree audit reports 1 Critical and 44 High findings;
4. privacy review and operational rate-limit/egress controls are incomplete;
5. the Phase 1.3 MCP Inspector rerun was not completed because local process
   orchestration was rejected by the execution environment;
6. no independent security reviewer has signed off.

## 2. Baseline and artifact integrity

| Item | Result |
|---|---|
| Worktree | C:\Projects\.worktrees\scrolitha-ai-mcp-foundation-20261016 |
| Branch | codex/scrolitha-ai-mcp-foundation-20261016 |
| Base/current HEAD | ad7f0cee0acb728882926edf2560516542cdff58 |
| Worktree state | Existing uncommitted MCP implementation; no reset, clean, commit, push, or merge performed |
| Phase 1.2 patch | PASS; 17 authorized files, SHA-256 611FBF5B8190B23BB4BF15733AA24C37D59A24EF3D8C0B69ED45201A220D2163 |
| Phase 1.2 report | PASS; SHA-256 8D4A0B669A2A35B13F109DBE65A3471B10DEAD5A69444E5A6EF090A802460604 |
| Current source versus Phase 1.2 patch | CHANGED; the Phase 1.3 profile correction makes the old patch stale for exact source reconstruction |

The recorded Phase 1.2 artifact hashes match exactly. The old patch remains
preserved for traceability and was not overwritten.

### Current inventory

The original 17-file MCP inventory remains present:

- geezle-backend/package.json
- geezle-backend/package-lock.json
- geezle-backend/src/server.ts
- geezle-backend/docs/SCROLITHA_MCP_READONLY_FOUNDATION.md
- geezle-backend/docs/SCROLITHA_MCP_PHASE1_1_VALIDATION.md
- geezle-backend/docs/SCROLITHA_MCP_PHASE1_2_VALIDATION.md
- geezle-backend/jest.scrolitha-mcp.config.cjs
- geezle-backend/tsconfig.scrolitha-mcp.json
- geezle-backend/src/routes/scrolithaMcp.routes.ts
- geezle-backend/src/routes/__tests__/scrolithaMcp.routes.spec.ts
- geezle-backend/src/services/scrolithaMcp/scrolithaMcp.auth.ts
- geezle-backend/src/services/scrolithaMcp/scrolithaMcp.data.ts
- geezle-backend/src/services/scrolithaMcp/scrolithaMcp.server.ts
- geezle-backend/src/services/scrolithaMcp/scrolithaMcp.types.ts
- geezle-backend/src/services/scrolithaMcp/__tests__/scrolithaMcp.auth.spec.ts
- geezle-backend/src/services/scrolithaMcp/__tests__/scrolithaMcp.data.spec.ts
- geezle-backend/src/services/scrolithaMcp/__tests__/scrolithaMcp.server.spec.ts

This Phase 1.3 report is the additional documentation file. The only source
correction made during this phase is in scrolithaMcp.data.ts, with regression
coverage in scrolithaMcp.data.spec.ts.

## 3. Identity-provider findings

The maintained backend uses its existing Scrolith authentication system for web
and mobile sessions. Source references include authentication routes/controllers,
JWT middleware, password/2FA/passkey flows, and existing OAuth application-login
code. The MCP implementation does not reuse a verified OIDC authorization server
because no MCP-compatible provider contract was found in the local source.

The MCP layer currently supports:

- exact HTTPS issuer, audience, JWKS URL, and optional resource validation;
- RS256 and ES256 algorithm allowlisting;
- expiry and not-before checks;
- required scrolith:read scope;
- exact bearer-header parsing;
- per-request verification;
- subject-derived server-side account lookup.

The MCP layer does not currently provide or verify:

- authorization-server discovery metadata from a real provider;
- authorization-code flow with PKCE S256;
- resource indicators at the provider;
- predefined-client, CIMD, or DCR policy;
- user consent and account-linking policy;
- token revocation and disconnect behavior;
- provider key rotation and emergency key-revocation evidence;
- staging or production issuer, audience, JWKS, client, or redirect values.

A synthetic JWT/JWKS test is not evidence of real-provider interoperability. No
production identity-provider URL or client was invented.

## 4. OAuth protected-resource status

GET /mcp/.well-known/oauth-protected-resource is implemented as a protected-
resource metadata endpoint. When MCP is disabled it is unavailable. When enabled,
it returns only the configured resource, authorization-server URL, the
scrolith:read scope, and bearer-header support. It does not expose client
secrets, tokens, passwords, or private keys.

Required operational values remain placeholders and require owner approval:

    MCP_ENABLED=true
    MCP_OAUTH_ISSUER=https://<approved-provider>
    MCP_OAUTH_AUDIENCE=<approved-audience>
    MCP_OAUTH_JWKS_URL=https://<approved-provider>/.well-known/jwks.json
    MCP_RESOURCE_URI=https://<approved-mcp-host>/mcp
    MCP_OAUTH_AUTHORIZATION_SERVER=https://<approved-provider>
    MCP_OAUTH_ALGORITHMS=RS256,ES256
    MCP_REQUIRED_READ_SCOPE=scrolith:read
    MCP_ALLOWED_HOSTS=<exact-hosts>
    MCP_TRUST_PROXY=true only behind an approved trusted ingress

No value above is operationally verified. MCP must remain disabled until the
provider owner, security owner, and privacy owner approve the complete contract.

## 5. Account identity and profile contract

The verified JWT sub is the sole account identifier passed to the data source.
The MCP client cannot supply an account ID, role, query parameter, or request
header to select another account.

Phase 1.3 removed the internal account role from the profile query and response.
The query still returns account ID, email, display name, and selected profile
fields. Email and profile fields remain subject to privacy-owner approval before
external use.

No _meta["openai/profile"] declaration exists in the current source. No
unverified convention was added. If the approved client contract requires that
metadata, it must be defined against the real authenticated subject and reviewed
before implementation.

Two synthetic accounts were tested independently. Each lookup used its own
verified-subject value, and the returned profile was not mixed with the other
account.

## 6. Five-tool authorization and visibility matrix

| Tool | Authentication and boundary | Evidence |
|---|---|---|
| get_my_profile | Required bearer JWT and scrolith:read; verified subject only; inactive accounts unavailable; role and authentication secrets excluded | PASS |
| search_jobs | Required bearer JWT and scrolith:read; active, visible, public, approved jobs; bounded query/page/offset | PASS |
| get_job_details | Required bearer JWT and scrolith:read; active, visible, public, approved job by bounded ID | PASS |
| search_gigs | Required bearer JWT and scrolith:read; active, approved gigs; bounded query/page/offset | PASS |
| get_gig_details | Required bearer JWT and scrolith:read; active, approved gig by bounded ID | PASS |

All five tools are annotated read-only and non-destructive. No mutation tool,
database write, arbitrary SQL, or user-supplied account selector exists.

Remaining limitations:

- local HTTP tests use an injected synthetic verifier rather than a real provider;
- live database permissions and row-level visibility are not verified;
- concurrent multi-user access is covered only by local subject-binding tests;
- listing text is untrusted content and requires downstream prompt-injection handling;
- profile email and descriptive fields require privacy minimization approval;
- provider-side consent, revocation, and disconnect behavior remain untested.

## 7. Security controls and findings

### Verified controls

- MCP_ENABLED is false unless explicitly enabled.
- Disabled mode returns 404 and does not initialize the Prisma MCP data source.
- Exact hosts are required; wildcards, URLs, credentials, and unsafe host values
  are rejected.
- Production-mode HTTPS is required unless an explicitly trusted proxy is used.
- Request bodies are strict JSON and limited to 1 MiB.
- Search limits are bounded to 25 records and offset 10,000.
- IDs and search text have explicit length limits.
- Only approved public/profile fields are selected.
- Password hashes, refresh tokens, MFA secrets, private proposals, moderation
  records, and unrelated authentication data are not selected.
- Tool calls validate the bearer token on every request.
- Errors are sanitized and transports are closed in finally blocks.

### Remaining findings

| Priority | Finding | Status | Required action |
|---|---|---|---|
| P0 | Production audit contains 7 High findings | BLOCKED | Remediate or obtain explicit security-owner disposition |
| P0 | Full dependency tree contains 1 Critical and 44 High findings | BLOCKED | Inventory reachability and remediate; no suppression |
| P1 | No verified OAuth provider, PKCE, consent, revocation, or client policy | BLOCKED | Supply provider contract and interoperability evidence |
| P1 | JWKS URL is operator-controlled and only syntax-validated | PENDING | Restrict to approved identity host and control egress/DNS |
| P1 | MCP production checks depend on NODE_ENV rather than the complete managed-runtime policy | PENDING | Align enablement and HTTPS checks with the central production-runtime guard |
| P1 | Rate limiting is process-local | PENDING | Add approved shared rate limiting before multi-replica enablement |
| P1 | Privacy review of email/profile/listing fields is incomplete | PENDING | Approve minimum profile contract, retention, and downstream handling |
| P1 | Browser-origin and CORS contract is undefined | PENDING | Keep browser use out of the contract or add an exact Origin allowlist |
| P2 | Provider key rotation and emergency revocation are undocumented | PENDING | Add operational runbook and evidence requirements |

## 8. Dependency audit register

Commands executed against the official npm registry:

    npm.cmd audit --omit=dev --registry=https://registry.npmjs.org --audit-level=high
    npm.cmd audit --registry=https://registry.npmjs.org

| Scope | Critical | High | Moderate | Low | Total | Exit |
|---|---:|---:|---:|---:|---:|---:|
| Production dependencies | 0 | 7 | 31 | 1 | 39 | 1 |
| Full dependency tree | 1 | 44 | 34 | 3 | 82 | 1 |

The exit code 1 represents reported vulnerabilities, not an audit-service
failure. No npm audit fix --force was used.

Production High findings identified:

- @fastify/busboy 3.2.0, transitive, multipart DoS/CRLF issues;
- @prisma/config 7.10.0 through deepmerge-ts 7.1.5;
- compression 1.8.1, direct, premature-response memory DoS;
- deepmerge-ts 7.1.5, transitive through Prisma configuration;
- mysql2 3.15.3, transitive Prisma tooling path;
- prisma 7.10.0, direct tooling dependency with related config/mysql2 paths;
- sharp 0.35.4, direct, librsvg-related vulnerability.

The full-tree report additionally includes Critical handlebars 4.7.9 and High
findings in the Jest/tooling, brace-expansion, browserslist, form-data, js-yaml,
minimatch, picomatch, and related transitive paths. Exact advisory URLs and
dependency paths are retained in:

- D:\DevData\scrolitha-mcp-phase1-2-inspector2219\production-audit.json
- D:\DevData\scrolitha-mcp-phase1-2-inspector2219\full-audit.json

The MCP SDK 1.32.1 and jose 4.15.9 were not listed as High/Critical findings.
The Prisma 7 and CommonJS compatibility boundary prevents an unreviewed major
dependency upgrade.

## 9. Validation evidence

| Check | Result | Exit/evidence |
|---|---|---|
| Clean dependency install | PASS | npm ci --ignore-scripts --no-audit --no-fund, exit 0; 989 packages added |
| Focused MCP Jest | PASS | 4 suites, 25 tests, 0 skipped, exit 0 |
| MCP TypeScript project | PASS | tsc --project tsconfig.scrolitha-mcp.json, exit 0 |
| Normal backend build | PASS | npm run build -- --pretty false, exit 0 |
| SDK/Jose resolution | PASS | npm ls @modelcontextprotocol/sdk jose --depth=0, exit 0 |
| git diff --check | PASS | exit 0 |
| Official production audit | FAIL/blocked gate | 39 findings, exit 1 |
| Official full audit | FAIL/blocked gate | 82 findings, exit 1 |
| MCP Inspector Phase 1.3 rerun | NOT RUN | local background-process orchestration was rejected; no external endpoint contacted |
| OAuth provider interoperability | NOT RUN/BLOCKED | no approved real provider or credentials |
| Live PostgreSQL permission tests | NOT RUN | prohibited |
| Azure/staging tests | NOT RUN | prohibited |
| Full backend regression suite | NOT RUN | outside focused MCP validation scope |

The prior Phase 1.2 Inspector result remains historical evidence only: Node 22.19.0
with Inspector 2.11.0 passed synthetic local protocol checks. It is not relabeled
as a Phase 1.3 rerun.

## 10. Independent-review requirements

The independent reviewer must inspect the current uncommitted source, not only
the Phase 1.2 patch. Review must cover:

1. JWT issuer, audience, resource, algorithm, expiry, and JWKS behavior;
2. provider authorization-code + PKCE design;
3. subject-to-account binding and account-linking policy;
4. profile-field minimization and privacy retention;
5. all five tool visibility filters and cross-account isolation;
6. prompt-injection handling for untrusted listing/profile text;
7. host, proxy, CORS, rate-limit, and egress behavior;
8. dependency advisories and remediation/exception records;
9. feature-flag isolation and disabled-by-default behavior;
10. rollback, key rotation, revocation, monitoring, and incident response.

No independent approval is claimed.

## 11. Final gate matrix

| Requirement | Status |
|---|---|
| Five read-only tools implemented | PASS |
| No mutation capability added | PASS |
| Account identity derived from verified token subject | PASS |
| Internal role removed from profile response | PASS |
| Local MCP security tests | PASS, 25/25 |
| MCP TypeScript and backend build | PASS |
| OAuth protected-resource metadata | PASS locally; provider values unverified |
| Real OAuth authorization-code + PKCE | BLOCKED |
| Current production dependency gate | BLOCKED |
| Privacy approval | PENDING |
| Operational rate limiting/egress/monitoring | PENDING |
| MCP Inspector Phase 1.3 rerun | NOT RUN |
| Independent security review | PENDING |
| Staging readiness | NO-GO |

## 12. Recommended next action

Keep /mcp disabled. The next safe work item is a separately reviewed OAuth
provider integration design supplying exact issuer, audience, JWKS, resource,
client-registration, redirect, PKCE, consent, revocation, account-linking, and
disconnect requirements. In parallel, remediate or formally disposition the
production High findings and the full-tree Critical/High findings.

No commit, push, merge, deployment, provider registration, secret creation,
database access, or runtime enablement was performed.

**Phase 1.3 local implementation review: PARTIAL PASS**

**Phase 1.3 staging readiness: BLOCKED / NO-GO**
