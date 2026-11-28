# Scrolith production database metadata inspector

## Status and boundary

This document describes a **proposal for review**. It does not authorize or perform production SQL, create an Azure role, Key Vault secret, Container Apps Job, identity, role assignment, or image. No production database connection or production job execution was made while preparing this proposal. The existing `cae-scrolith-sea-prod` environment and network-only private-DNS/TCP preflight were reported by the owner; the inspector role, secret, image, and job are not verified as deployed.

Do not use the existing authentication bootstrap jobs (`scrolith_bootstrap`) or schema-owning migrator job. They are broader than this read-only inspection. Do not reuse an existing role or credentials. The proposal is for the checked-in `deploy/postgres/scrolith-production-user-language-preferences-inspect.sql` only.

## What the report can read

The report is wrapped in a read-only transaction. It reads PostgreSQL catalogs and these specific metadata columns only:

| Relation | Allowed columns |
|---|---|
| `public.scrolith_runtime_policy_state` | `singleton`, `source_commit`, `migration_count`, `last_migration`, `ownership_verified`, `finalized`, `finalized_at`, `bootstrap_admin_role` |
| `public."_prisma_migrations"` | `migration_name`, `finished_at`, `rolled_back_at` |

It also checks role attributes/memberships, the current session's TLS state, public-schema relation ownership, and effective/raw ACL metadata. It does not select `public."User"` rows or any application data. The disposable test put a unique sentinel in a synthetic User row and confirmed that the report output did not contain it.

The inspector receives only database `CONNECT`, `public` schema `USAGE`, and column-level `SELECT` for the columns above. It receives no table-level `SELECT`, application-row access, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`, schema `CREATE`, database `CREATE`/`TEMPORARY`, sequence privileges, or `SECURITY DEFINER` execution. The setup, login-enable, and cleanup scripts fail closed on unexpected column grants, database/schema privileges, PUBLIC sequence grants, or PUBLIC-executable `SECURITY DEFINER` functions in `public`. They also reject unexpected role membership and attributes.

The only public function found in repository migrations is `set_updated_at()`, a trigger-only invoker-rights function. The inspector cannot read or update its table and cannot call a trigger function as an ordinary SQL function. The scripts still test for executable `SECURITY DEFINER` functions and effective sequence access, because production may contain objects not represented by the checked-in migrations.

## Required target and TLS

Use the canonical host `psql-scrolith-prod-sea-2026.postgres.database.azure.com`, port `5432`, database `scrolith`, and PostgreSQL client `sslmode=verify-full`. The owner-reported VNet preflight resolved private DNS and established TCP connectivity; this does not prove database authentication or SQL authorization. The job must use that DNS hostname (never the resolved IP), and the VNet private DNS must resolve it to the private endpoint. Keep the current Azure PostgreSQL root CA bundle in the pinned client image and review it when Microsoft rotates its CA chain. Microsoft documents `verify-full` as checking the certificate chain and matching the hostname; it recommends maintaining the Azure root certificates ([TLS guidance](https://learn.microsoft.com/azure/postgresql/security/security-tls)).

The SQL target guard requires an explicit operator approval variable, the expected hostname, an approved 40-character source SHA, PostgreSQL 17, a writable primary session, and TLS. The client must independently enforce `verify-full`; the SQL variable alone does not authenticate the server hostname.

## Proposed identity and role lifecycle

The setup SQL creates `scrolith_inspector` as `NOLOGIN`, with no superuser, database/role creation, replication, bypass-RLS, or inheritance attributes. It grants only the access listed above. On PostgreSQL 16+, PostgreSQL gives the CREATEROLE actor an administrative membership edge on a role it creates; the scripts assert the sole expected non-inheriting, non-settable creator membership and reject additional memberships. Use the same approved database administrator for setup, password handoff, enable, and cleanup unless a disposable Azure-compatible test verifies the intended operator handoff first.

The setup actor must be an authorized non-superuser with `CREATEROLE` plus the database/schema/object grant authority needed for the exact grants. Do not use `scrolith_runtime`, `scrolith_migrator`, or the inspector account as setup actor. Azure Database for PostgreSQL Flexible Server is a managed service: its administrator is not a true PostgreSQL superuser. Confirm the actor's effective capabilities and object ownership before any separately approved production change; do not add the inspector to `azure_pg_admin`. See Microsoft's [access-management documentation](https://learn.microsoft.com/en-us/azure/postgresql/security/security-access-control).

1. Review the exact source SHA, report, setup SQL, production target guard, Bicep, image digest, and ACL preflight with the database owner. Run the read-only inspection SQL first through an independently approved read-only path if one exists; this proposal does not assume one exists.
2. Only after a separate explicit production-change approval, an authorized database operator may run `scrolith-production-inspector-role-setup.sql` with `SCROLITH_PRODUCTION_CHANGE_APPROVED=true`, the verified FQDN, and approved source SHA. It creates a NOLOGIN role and exact column grants in one transaction. Stop if any precondition or assertion fails.
3. Set a unique high-entropy password using an interactive `psql` `\password scrolith_inspector` prompt, with terminal echo disabled. Do not put a password in a command, environment dump, SQL file, shell history, ticket, or log. Store it only as a versioned Key Vault secret using the approved secure secret-entry procedure; do not use CLI `--value`.
4. Run the separate `scrolith-production-inspector-role-enable.sql` only after the exact ACL checks pass. It enables LOGIN transactionally and does not embed a password.
5. Build the `inspector.Dockerfile` from the exact reviewed repository commit with the repository-root context, scan the resulting immutable digest, and retain the image provenance and unsuppressed scan. Validate the image reference as `sha256:` followed by exactly 64 lowercase hexadecimal characters before supplying it to Bicep. The Docker Engine was unavailable during this proposal run; **no final inspector image digest/build/scan is available**, so the job must not be deployed or run yet.
6. After image review, separately approved infrastructure authorization, and identity-scope review, deploy `scrolith-production-db-inspector-job.bicep` into the existing `cae-scrolith-sea-prod`. The template references (does not create) the environment, uses a manual job with one completion, one replica, zero retries, and a 120-second execution timeout. It has no ingress and uses the canonical verified TLS hostname. It pins the container image by digest and references a versioned Key Vault secret through a dedicated user-assigned identity. No such job, secret, or identity assignment has been created by this task.
7. An authorized trusted operator may start the job only after validating the job's immutable image, environment, command, identity attachments, secret reference, FQDN, and network. Collect only the complete successful inspection report and job outcome. Never enable shell tracing, dump environment, or capture psql stderr into application logs.
8. After evidence is reviewed, stop/confirm no active inspection execution, run the guarded cleanup SQL as the authorized creator/admin, verify `scrolith_inspector` and its grants are gone, then separately remove the temporary job, versioned Key Vault secret, and dedicated identity assignments only under owner approval. Keep audit evidence without storing the password.

### Safe command shape (future use only)

The following are templates, **not commands to run now**. They intentionally contain no password. Use a secure terminal and approved operator identity; `psql -W` prompts interactively. The source SHA and production approval are explicit inputs, not a substitute for change approval. Validate every image digest with `^sha256:[0-9a-f]{64}$`; Bicep length decorators alone do not validate hexadecimal syntax.

```powershell
$env:PGHOST = 'psql-scrolith-prod-sea-2026.postgres.database.azure.com'
$env:PGPORT = '5432'
$env:PGDATABASE = 'scrolith'
$env:PGSSLMODE = 'verify-full'
$env:PGSSLROOTCERT = '<reviewed-Azure-root-CA-bundle-path>'
$env:PGCONNECT_TIMEOUT = '10'

psql -X -W -v ON_ERROR_STOP=1 `
  -v SCROLITH_PRODUCTION_CHANGE_APPROVED=true `
  -v expected_server_fqdn=$env:PGHOST `
  -v expected_source_commit='<approved-40-hex-source-sha>' `
  -f .\deploy\postgres\scrolith-production-inspector-role-setup.sql
```

After the secure password handoff and versioned Key Vault secret creation, run the separate enable script with the same guarded connection settings. Do not place secret values in CLI arguments. Only after the candidate image has been built and scanned, and the job has passed review, start the job with no execution-template override. Azure Container Apps job-start permission is **credential-equivalent**: the start API can override image, command, and environment, and the job's managed identities are available to the execution. Microsoft explicitly warns that start permission can expose job secrets; built-in Jobs Operator/Contributor roles are too broad for this use. Use a narrowly scoped custom role and grant it only to a trusted, time-limited operator after approval ([Container Apps job permissions](https://learn.microsoft.com/azure/container-apps/jobs?tabs=azure-resource-manager)). Do not give general developers or CI identities job-start access.

## Log and data handling

The wrapper buffers standard output and emits it only if `psql` exits successfully. That output is the complete inspection report. On failure it suppresses psql stderr and emits no partial report, leaving the job's failure status visible. Do not add `set -x`, environment printing, SQL debug output, or application-row queries. The report is metadata and still should be stored only in the approved access-controlled evidence location. ACA/platform operational metadata may include job identity, image, timing, and exit status; it must not be configured to capture environment or secret contents.

The job has no network ingress. Its VNet reachability and private DNS are prerequisites. The password is mounted by Container Apps as a secret-backed environment variable and is not baked into the image or Bicep source. Keep the Key Vault reference versioned and grant the dedicated identity access only to that secret version/object, using the narrowest supported Key Vault data-plane scope. Keep the ACR pull identity scoped to the production registry and attach only those two identities required by the job.

## Local validation evidence and limits

The proposal was tested against a task-owned disposable PostgreSQL 17.6 cluster on loopback port 55432, using TLS `verify-full`, a synthetic non-superuser CREATEROLE administrator, a synthetic 143-row migration ledger, synthetic marker metadata, and a synthetic User row containing a private sentinel. Tests covered exact grants, NOLOGIN-to-LOGIN handoff, report contents, denied User-row/private-column reads, denied writes/DDL/TEMP, transactional failure rollback, unexpected User column ACLs, PUBLIC TEMP drift, a PUBLIC-executable `SECURITY DEFINER` function, PUBLIC sequence privileges, and guarded cleanup. The report did not contain the sentinel, and the test database/roles were removed.

This is local PostgreSQL evidence only. The disposable cluster's local authentication setup does not validate Azure password authentication or Key Vault secret delivery. It does not verify the production server's current marker, migration ledger, ownership, role/ACL state, Key Vault permissions, Container Apps network path, image, Azure Flexible Server behavior, or production authentication. The prior owner-reported network check tested DNS and TCP only. Do not run role setup or the report in production as part of this PR. Before any later production action, require an owner-approved read-only preflight and a separately reviewed, explicit change window.

## Rollback and stop conditions

- If setup fails, its transaction must leave no inspector role or grants. Preserve the failure status; inspect offline and do not retry blindly.
- If password setup, enablement, image scan, identity, network, or report validation fails, keep the role NOLOGIN or run the guarded cleanup from the same approved administrator. Do not start the job.
- If cleanup detects active sessions or any ACL/membership drift, stop and inspect manually; do not widen grants or force-drop the role.
- If the exact production marker/source SHA, migration count, role state, hostname, TLS, or ownership does not match the approved release, do not continue. Prepare a separate database cutover/reconciliation plan.
- Job start authorization, access to its Key Vault secret, and the job's user-assigned identities are privileged capabilities. Revoke temporary operator/identity permissions and clean up the job/secret only after verifying no execution is active.

This proposal does not establish production readiness or authorize role creation, job deployment, or production inspection.
