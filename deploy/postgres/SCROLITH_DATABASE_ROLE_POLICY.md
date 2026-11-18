# Scrolith PostgreSQL runtime and migrator roles

This policy separates application traffic from schema changes and preserves
financial evidence. The SQL files are guarded templates, not authorization to
modify a live database.

## Role boundaries

- `scrolith_runtime` is the application role. It is non-superuser,
  `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`, `NOBYPASSRLS`, and `NOINHERIT`.
  It starts `NOLOGIN`; it has no `CREATE` on `public`, does not own schema
  objects, and cannot access `_prisma_migrations`.
- `scrolith_migrator` is a non-superuser migration login with `USAGE, CREATE`
  on `public`. It owns the application tables, sequences, types, and routines
  it must alter during Prisma migrations.
- A separate bootstrap administrator creates roles and performs ownership
  handoff. Runtime never receives that authority or owns schema objects.
- Runtime login is enabled only after the migrator finalizer commits the
  private policy-state marker and a separate guarded enable script verifies it.
  The runtime credential must not be supplied to the application before that
  enable script succeeds. Failed finalization keeps the role `NOLOGIN`.
- The policy-state marker is inaccessible to `PUBLIC` and runtime; the migrator
  receives only the `SELECT`/`UPDATE` needed to verify and atomically finalize
  it. Runtime has no access to the marker.
- On an unfinalized setup, the bootstrap script changes runtime to `NOLOGIN`
  and terminates any existing runtime sessions before applying transitional
  grants. This is disruptive by design and requires a quiesced disposable test
  database and an administrator able to terminate those sessions; if draining
  fails, setup aborts before compatibility grants are applied.
- Test-fixture cleanup is done by the disposable test harness owner or by
  dropping the disposable database, never by granting runtime DELETE.

## Financial history and supported writes

Account deletion in the application is a soft deactivation (`User.isActive`
becomes false). There is no supported runtime hard-delete flow for the reviewed
payment, wallet, Gcoin, settlement, withdrawal, FX-lock, or Founding Partner
records. Runtime DELETE is revoked on those records and identifying parents;
restrictive foreign keys stop parent cascades from erasing retained evidence.

Paid community ads are archived (`ENDED`, `archivedAt`, `archivedById`,
`archiveReason`) when the creator or admin requests removal. `AdPayment` rows
stay linked to the ad and its identifying content; unpaid ads may still be
hard-deleted. `AdPayment.adId` uses `ON DELETE RESTRICT`, closing the race where
a payment is inserted while delete is in flight. Provider reconciliation
requires updates only to `AdPayment.status`, `amount`, and `currency`; ad and
transaction references are immutable to runtime. Hard-deleting an ad with
payment history is no longer a supported operation.

`GcoinEarningEvent` cannot be deleted by runtime, and its post relation uses
`ON DELETE RESTRICT`. Community-post deletion is already a soft status change.
Unlike records `reactionActive=false`, `reversedAt`, and an incremented
`reversalCount` in the same transaction as decrementing `likesCount`; re-like
reactivates the same idempotency row without clearing its reversal timestamp or
count. `value`, `credited`, event identity, and source post are immutable.
Account deactivation retains actor references. Development seed cleanup is an
elevated-owner action for an isolated disposable database, not an application
runtime flow.

Runtime inserts history and business records as required by the application.
Mutable fields are scoped to verified workflows:

- Wallet/Gcoin wallet balance snapshots, supported statuses and `updatedAt`.
- Transaction workflow status/description/metadata only.
- Funding and order-payment intents: FX-lock link, provider references/payload,
  expiry and status lifecycle fields only.
- Order and Escrow: status and documented provider/settlement lifecycle fields;
  economic amounts and parent/user identity are immutable.
- Withdrawal: FX-lock association, `details`, status and processing timestamp;
  `details` remains sensitive application data.
- Gcoin conversion: decision status and processing metadata only.
- Ad payment: provider-reconciled amount/currency/status only.
- Gcoin earning event: reaction lifecycle columns only.
- Founding Partner: exact-column grants are based on the current service/admin
  writes. Program status/enrollment count, partner activation metadata,
  provider/FX settlement lifecycle fields, open profit-source inputs/notes,
  profit-period workflow, distribution-run workflow, and distribution credit
  outcome fields are updateable. Principal amounts where immutable, currencies,
  ids, terms, encrypted tax data, source identity, idempotency keys, and audit
  events are not updateable by runtime.

Settlement receipts, Gcoin transaction rows, FX locks, and Founding Partner
audit events are insert-only. Database grants do not replace application
authorization or validate business transitions. Future tables get only
`SELECT, INSERT` by default; new update paths require explicit reviewed column
grants.

## Guarded disposable-database sequence

Use a newly created local database whose name includes `test` or `e2e`:

1. Apply migrations using the disposable bootstrap owner.
2. Run `scrolith-runtime-migrator-roles.sql` with explicit approval and the
   exact database name. It leaves runtime `NOLOGIN`, drains existing sessions,
   and is safe to repeat only before ownership handoff/finalization.
3. Run `scrolith-runtime-migrator-handoff.sql` as the bootstrap owner. It
   preflights unexpected owners, temporarily grants membership only as needed
   for ownership transfer, transfers non-extension objects, and revokes that
   temporary membership. It does not transfer database/schema ownership.
4. Run pending `prisma migrate deploy` as `scrolith_migrator`.
5. Run `scrolith-runtime-finalize.sql` as `scrolith_migrator`. It runs grants
   and assertions in one transaction, uses `ON_ERROR_STOP`, and sets the
   finalized marker only at the end. A failure rolls back and leaves runtime
   `NOLOGIN`.
6. Provision runtime credentials through the approved secret channel, then run
   `scrolith-runtime-enable.sql` as the separate bootstrap administrator. It
   refuses login enablement without the finalized marker.
7. Only then supply the runtime credential to the application. Run the SQL
   permission test and HTTP integration suite against the disposable database.
   Their fixtures are not cleaned with runtime permissions; discard the whole
   disposable database/container after evidence is captured.

Validation covers allowed payment/settlement and idempotency writes, soft
account deactivation, ad pay/delete/archive, Gcoin like/unlike/re-like and post
soft-delete, Founding Partner status/source/period/distribution workflow
columns, denied financial-field updates/deletes, denied direct and cascading
history deletion, and denied DDL/trigger/migration-ledger operations. It also
checks fresh and repeated setup, runtime login denial before finalization, and
failure behavior when finalization assertions fail.

These tests establish only local PostgreSQL behavior. They do not verify Azure
Database for PostgreSQL role capabilities, deployed grants, or production
runtime configuration. Those require independent review on the actual managed
service and remain release gates.
