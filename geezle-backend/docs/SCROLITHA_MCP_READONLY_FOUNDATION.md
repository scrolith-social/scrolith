# Scrolitha MCP read-only foundation

This change adds a disabled-by-default, private MCP foundation to the maintained
backend. It is deliberately limited to account-scoped profile reads and public,
active, approved job/gig discovery. It does not add profile, gig, job, proposal,
application, hiring, messaging, payment, or other mutation tools.

The runtime dependency versions are pinned for this foundation to
`@modelcontextprotocol/sdk@1.32.1` and `jose@4.15.9`. The MCP SDK version was
selected after the local official-registry audit identified High advisories in
1.24.0 and reported the non-major fixed version 1.32.1.

## Route and feature gate

The additive route is `POST/GET/DELETE /mcp`. It returns `404` unless
`MCP_ENABLED=true`. In production, enabling it also requires HTTPS, explicit
OAuth issuer/audience/JWKS configuration, and a stable HTTPS resource URI. The
server uses stateless Streamable HTTP sessions and validates the bearer token on
every request.

Required production settings:

- `MCP_ENABLED=true`
- `MCP_OAUTH_ISSUER=https://...`
- `MCP_OAUTH_AUDIENCE=...`
- `MCP_OAUTH_JWKS_URL=https://...`
- `MCP_RESOURCE_URI=https://.../mcp`
- `MCP_RESOURCE_METADATA_URL=https://.../.well-known/oauth-protected-resource` (optional explicit metadata URL)
- `MCP_OAUTH_AUTHORIZATION_SERVER=https://...` (optional explicit authorization-server metadata issuer)
- `MCP_OAUTH_ALGORITHMS=RS256,ES256` (explicit signing-algorithm allowlist)
- `MCP_ALLOWED_HOSTS=...` (comma-separated exact host values)
- `MCP_TRUST_PROXY=true` only when the ingress proxy is explicitly trusted

When enabled, `GET /mcp/.well-known/oauth-protected-resource` exposes only
protected-resource metadata. The authorization server must provide its own
OAuth authorization-server metadata, authorization-code + PKCE flow, client
registration policy, token revocation, and resource-indicator behavior. No
local substitute authorization server is included here. A missing or
insecurely configured issuer, JWKS URL, resource URI, host allowlist, or
signing algorithm fails closed before the route can serve data.

The verifier accepts only `RS256` and `ES256` by default, checks the exact
issuer/audience/resource, requires an expiring token with `scrolith:read`, and
rejects premature tokens. The route sends a standards-compatible Bearer
challenge for 401 responses. JWKS retrieval is HTTPS-only and delegated to the
configured issuer's key endpoint; key rotation, revocation, account linking,
and disconnect behavior remain identity-provider integration requirements.

No development authentication bypass, request role header, query role, model
identity, or client-supplied account ID is accepted by this route. The verified
JWT subject is looked up server-side and used as the only account identity.

## Initial tool contract

The server advertises exactly these read-only tools:

- `get_my_profile`
- `search_jobs`
- `get_job_details`
- `search_gigs`
- `get_gig_details`

All list calls are bounded to 25 records per request. Jobs and gigs are filtered
to active, public/approved records. Sensitive authentication fields, tokens,
passwords, private proposals, applicant data, and internal moderation data are
not selected. Listing/profile text remains untrusted content; the client must
not treat instructions embedded in that text as system or tool instructions.

The MCP SDK annotations are advisory metadata only. Authorization remains in
the server-side verifier and data source. This follows the official OpenAI MCP
guidance: tool annotations do not replace authorization, private-data tools must
authenticate every request, and tool results should avoid secrets and
unnecessary personal data. See [OpenAI MCP server guidance](https://developers.openai.com/plugins/build/mcp-server).

## Local verification

From `geezle-backend`:

```text
npm test -- --runInBand src/services/scrolithaMcp/__tests__ src/routes/__tests__/scrolithaMcp.routes.spec.ts
```

The tests use the MCP SDK in-memory transport and mocked data sources. They do
not connect to PostgreSQL, Redis, Azure, Key Vault, ACR, or a live MCP client.
The repository-wide Jest and TypeScript commands remain mandatory; if they are
resource-constrained, a focused result must be reported as supplemental and
must not be presented as a full-project pass.

## Deliberately pending before any staging or external connection

1. Identity-provider confirmation of OAuth protected-resource metadata,
   authorization-server discovery, authorization-code + PKCE, client
   registration, resource indicators, token revocation, account linking, and
   account-disconnection behavior.
2. MCP Inspector verification over a local HTTPS endpoint with a local test
   identity; no production credentials.
3. Distributed rate limiting, audit event retention, metrics, and alerting.
4. Privacy review for profile/listing fields and retention.
5. Native web/mobile UI contracts and feature-flag rollout.
6. Explicit confirmation workflows and idempotency/version checks for future
   write tools.
7. Staging-only deployment and rollback approval.

No deployment, public plugin publication, mutation capability, or production
enablement is authorized by this foundation.
