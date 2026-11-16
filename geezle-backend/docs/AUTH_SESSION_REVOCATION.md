# First-party authentication sessions

## Session model

First-party access JWTs are signed with HS256 and include the user identity, a
random 32-byte `sid`, the user's `authSessionVersion` (`sv`), and an expiration.
The default JWT lifetime is seven days (`JWT_EXPIRES_IN` may set another
approved lifetime). Session creation and the corresponding `AuthSession` row
are committed in one database transaction. The database stores only a
domain-separated SHA-256 hash of `sid`, never the bearer token or raw session
identifier.

Protected HTTP and Socket.IO authentication verifies the signature and claims,
then checks the session row, expiration, revocation timestamp, current user
status, and session version in PostgreSQL. Legacy JWTs without the required
session claims are rejected and require the user to sign in again. A database
failure on a protected HTTP request returns `503`; it must not fall back to
signature-only authentication. Socket.IO rejects authentication when session
state cannot be verified and disconnects an established socket on a failed
revalidation.

## Revocation behavior

- `POST /api/auth/logout` revokes the authenticated session identified by the
  request's verified token. A different device session remains active.
- `POST /api/auth/logout-all` increments the user's session version, revokes
  active session rows, clears the legacy `User.refreshToken` field, and expires
  outstanding login-approval attempts and OAuth completion codes in the same
  database transaction.
- Password reset/change, administrative password reset, staff password reset
  or deactivation, and account moderation/deactivation use the same all-session
  revocation transaction.
- Login, MFA, approved-device, and OAuth completion contexts are bound to the
  session version. If logout-all or a password/security action changes that
  version while a context is in progress, the context cannot issue a new token.
- Socket events revalidate the durable session. The current API instance also
  disconnects matching local sockets after a logout. Other instances discover
  revocation through PostgreSQL polling; the default interval is two seconds,
  bounded to one through five seconds. This is eventual socket disconnection,
  not instantaneous cross-instance push delivery.

Expired session and OAuth-code rows are retained until 24 hours after expiry,
then opportunistically pruned. The API attempts cleanup at startup and every
six hours. A cleanup failure is logged without weakening authentication.

## Refresh-token distinction

This first-party API does not currently expose a user refresh-token endpoint.
`User.refreshToken` is a legacy field and is cleared during all-device
revocation. OAuth completion codes are short-lived, one-time login handoffs,
not refresh tokens. The Developer Platform's OAuth access/refresh tokens are a
separate application-grant system; first-party logout does not revoke those
grants. Users or administrators must use that system's client-grant revocation
flow to disconnect an external application. Do not treat a successful
first-party logout test as proof that a Developer Platform grant was revoked.

## Migration and deployment sequence

Apply `20261116120000_add_durable_auth_sessions` before deploying code that
reads or writes the new session tables and version columns. The migration is
additive: it adds the user version, adds the approval-attempt version, and
creates session and OAuth-code tables. It also expires outstanding legacy
approval attempts because those rows were not bound to a session version.

Deploy the new authentication code as a coordinated cutover. Do not leave a
pre-session API revision serving authenticated traffic after the new revision
is active: the old revision has no durable revocation check and can continue
accepting a revoked signed JWT. Route traffic only to the new revision after
its readiness checks pass, and drain/scale the old revision to zero before
considering the security cutover complete. Existing legacy sessions will be
rejected and users will need to authenticate again.

The schema addition is forward-compatible for application rollout, but a
rollback to pre-session application code is **not** security-safe: old code
does not enforce revocation. If the new revision must be withdrawn, keep
authenticated traffic disabled or use a corrected version that retains the
session checks. Do not drop the session tables, reset session versions, or
re-enable legacy signature-only authentication as a rollback shortcut.

## Operations and validation

- Keep `JWT_SECRET` in the approved server-side secret store; never put it in a
  `VITE_*` variable, source, browser logs, or test output.
- Apply migrations with the dedicated migrator identity. The application
  runtime identity needs only its reviewed table privileges; do not give it
  schema ownership or migration privileges.
- Monitor authentication `503` responses and database connectivity. Do not
  make readiness appear healthy by bypassing session-store checks.
- Test logout with both cookie and bearer clients, logout-all, password reset,
  device approval, MFA, OAuth one-time exchange, malformed/expired/forged
  tokens, concurrent requests, socket event/reconnect behavior, and a second
  API instance against a disposable shared database before release.
- No user refresh endpoint is currently available to test for first-party
  refresh-token replay. This is an explicit product/API limitation, not a
  passing refresh-token revocation test.

This document describes local candidate behavior. It does not establish
production deployment, managed-database permissions, multi-instance Socket.IO
delivery, or release readiness.
