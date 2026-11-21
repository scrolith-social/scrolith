# Scrolith Azure Container Apps release guide (Southeast Asia)

**Status: review-only candidate. No Azure resources, DNS records, images, or live data were changed.** This guide is not a deployment authorization or a production-readiness certification. Release is blocked until the items in [Known release blockers](#known-release-blockers) are closed and separately approved.

## 1. Source and candidate identity

This release candidate deliberately combines two separately maintained histories; it does **not** merge them together:

| Component | Candidate source | Pinned revision |
|---|---|---|
| Parent/backend base | `scrolith-social/scrolith`, `backend/main` | `923ca7e25d4ee36ee00aa415eae2b6a60fc9777b` |
| Local parent candidate commit | remediation worktree base (the parent worktree is modified) | `425a4111815465425e55a8e8ef2530cc49bc7eee` |
| Frontend base gitlink | `scrolith-social/scrolith`, `main` | `04ec1601cb1f58616d8d4c95269617e614974849` |
| Local frontend submodule commit | local-only fix for official-registry lockfile URLs and the admin-policy test | `30399bfbd555e325c790a92b75eb6fcde078ca70` |
| Frontend correction in the existing history | ancestor of the local frontend commit | `9fbbf40cd114cc8c4d349d653ebc781ba9b54dad` |

The parent repository records the frontend revision as a Git submodule gitlink. The remediation worktree points that gitlink to `30399bfbd555e325c790a92b75eb6fcde078ca70`. The canonical remote `main` still points to `04ec1601cb1f58616d8d4c95269617e614974849`; the local submodule commit has not been published and cannot yet be fetched by a clean clone. Its parent worktree changes also remain uncommitted. Therefore the image evidence below is for the exact local working snapshot, not for a clean, remotely reproducible release commit. Publish the reviewed frontend commit first and then publish a parent commit that pins it; do not use a branch name or floating submodule reference. `main` and `backend/main` are divergent; do not merge either branch wholesale.

Before any release build, verify the checkout and both pins:

```powershell
git rev-parse HEAD
git -C geezle rev-parse HEAD
git submodule status
git status --short
```

The release record must include the final parent commit, frontend gitlink SHA, backend image digest, frontend image digest, SBOMs, provenance, and the source-to-image build run. The SHAs above are inputs, not image digests.

## 2. Cloud Shell startup choice

For the Azure Cloud Shell **Getting started** prompt shown in the setup screenshot:

1. Choose **No storage account required** for a temporary Cloud Shell session. It avoids creating or mounting a separate Cloud Shell file share. This setting does not create or remove the application's Blob Storage account.
2. Leave **Use an existing private virtual network** unchecked unless the Azure owner has identified and approved an existing VNet specifically for Cloud Shell access. This application design uses a dedicated application VNet; Cloud Shell networking is a separate choice.
3. Select the intended subscription, then Apply.

Cloud Shell is an operator terminal, not the deployment architecture. Do not paste secret values into shell commands, scripts, terminal transcripts, or browser screenshots.

## 3. Target architecture

All resources should be in **Southeast Asia (`southeastasia`)**, subject to each SKU's availability and quota:

```text
Browser ──HTTPS──> Container App: frontend (Nginx :8080)
   │                         │
   └──HTTPS api.scrolith.com─┴──> Container App: API (:5000)
                                      ├── private PostgreSQL Flexible Server (PG 17)
                                      ├── private Azure Blob Storage
                                      ├── Azure Managed Redis (Entra auth)
                                      └── Key Vault secret references (managed identity)

ACR (digest-pinned images) ── AcrPull managed identity ──> Container Apps
```

Recommended initial topology:

- One Container Apps **workload-profiles v2** environment in Southeast Asia, Consumption profile for initial cost modeling.
- Separate externally reachable frontend and API apps. Frontend ingress target is **8080**; API target is **5000**. Only ACA ingress is public; PostgreSQL, Blob, Redis, and Key Vault should use private networking/private endpoints and private DNS as supported by the selected SKU/network topology.
- PostgreSQL Flexible Server 17, private VNet integration, TLS required, backups/PITR enabled. The application runtime and migration job must use separate database roles and separate Key Vault secrets.
- Blob Storage with public access disabled. Production uses `AZURE_STORAGE_ACCOUNT_URL`, `AZURE_STORAGE_CONTAINER`, and `AZURE_STORAGE_AUTH_MODE=managed_identity`; a connection string is rejected in production. The API uses a user-assigned managed identity. Local/test connection strings remain supported only outside production. Keep the container private; do not enable anonymous blob access to make URLs work.
- Azure Managed Redis with Microsoft Entra authentication for shared rate limiting and other Redis-backed controls. Use a dedicated user-assigned managed identity and the service's least-privilege data access policy. The API Bicep template attaches this identity and accepts its resource, client, and object IDs separately from the Blob/Key Vault API identity. Do not ship a Redis access key in an environment variable.
- Key Vault with Azure RBAC and managed identity references for app secrets. Give each Container App identity `Key Vault Secrets User` only at the required vault scope; use a distinct registry-pull identity with `AcrPull` on ACR. Prefer separate identities for the API, frontend, migration job, and registry pull.
- ACR Basic is a lower-cost option with public registry endpoint and identity-authenticated image pulls. If policy requires a private ACR endpoint, Premium is required and adds cost; recalculate before selecting it.
- Log Analytics / Azure Monitor diagnostic settings for Container Apps system and console logs, PostgreSQL, Redis, Key Vault, Storage, and activity/audit events. Apply retention and redaction policy; do not log authorization headers, tokens, connection strings, or full OAuth/webhook payloads.

The API deployment configuration in [`deploy/azure/api-containerapp-single-replica.bicep`](../deploy/azure/api-containerapp-single-replica.bicep) sets `minReplicas=1`, `maxReplicas=1`, and `activeRevisionsMode=Single`. It is an enforceable per-app limit only when the reviewed template is applied. Scheduled jobs now use a PostgreSQL session advisory lock as a best-effort cross-process overlap guard; the lock is released with its database session and does not provide durable queuing, fencing, or exactly-once completion if a worker fails mid-job. Socket.IO presence and rooms remain process-local, and no Redis Socket.IO adapter is configured. Keep the single-replica/single-active-revision topology; it limits concurrent copies but does not eliminate restart interruption or establish horizontal realtime correctness. Before scaling out, add and test durable job ownership/recovery and cross-replica Socket.IO presence/room behavior. Redis remains used for distributed rate limiting, with protected limits failing closed when Redis is unavailable.

The media-processing implementation is not yet Azure-ready. `mediaProcessingQueue.ts` supports disabled, in-process `inline_async`, and `cloud_tasks` modes. The `cloud_tasks` adapter calls Google Cloud Tasks and signs tasks for the Google-OIDC-protected `mediaWorkerApp`; it is not Azure Service Bus or an Azure Container Apps Job integration. `inline_async` is process-local, best-effort, and loses queued work on process exit. The worker entry point is not wired into the current Azure templates. Keep media processing disabled in the Azure candidate until an Azure-native durable queue/worker design (or an explicitly approved cross-cloud dependency) is implemented and tested for retries, deduplication, poison messages, shutdown, and recovery.

## 4. Images and reproducible builds

The Dockerfiles pin base images by digest, use `npm ci`, and specify the official npm registry. Frontend build-time API origins are explicit:

- `VITE_BACKEND_URL=https://api.scrolith.com`
- `VITE_API_URL=https://api.scrolith.com/api`
- `VITE_PUBLIC_APP_DOMAIN=scrolith.com`
- Vite base path `/` (the Docker build passes `--base=/`)

Build only from a clean, reviewed checkout of the exact parent commit and submodule gitlink. Use unique source-derived tags for traceability, then deploy **OCI digests**, never `latest` or another mutable tag. Tag names are not immutable; record the resolved digest and configure the Container App with `repository@sha256:<digest>`.

Example local build commands for a later approved release build (they do not push or deploy):

```powershell
docker build --pull -f deploy/docker/backend.Dockerfile --target runtime `
  -t <ACR_NAME>.azurecr.io/scrolith-backend:src-<PARENT_SHA> .

docker build --pull -f deploy/docker/backend.Dockerfile --target migrator `
  -t <ACR_NAME>.azurecr.io/scrolith-backend-migrator:src-<PARENT_SHA> .

docker build --pull -f deploy/docker/frontend.Dockerfile `
  --build-arg VITE_BACKEND_URL=https://api.scrolith.com `
  --build-arg VITE_API_URL=https://api.scrolith.com/api `
  --build-arg VITE_PUBLIC_APP_DOMAIN=scrolith.com `
  -t <ACR_NAME>.azurecr.io/scrolith-frontend:src-<PARENT_SHA> .
```

These are templates only. Do not push until the independent release gates pass. Scan both runtime images, generate SBOMs and provenance, check the compiled frontend for unintended hosts/secrets, and record their registry digests. The `migrator` target is a one-shot migration image and must never be used as the long-running API app.

## 5. Container App settings and health

| App | Ingress | Target | Initial replica policy | Probe |
|---|---|---:|---|---|
| Frontend | External HTTPS | `8080` | Minimum 1; initially maximum 1 | `/` |
| API | External HTTPS | `5000` | Minimum 1; maximum 1 until worker/socket gates close | `/api/health` liveness; `/api/readyz` readiness |

`/api/health` is the lightweight liveness endpoint. `/api/readyz` checks readiness dependencies including PostgreSQL; configure ACA readiness behavior from observed response and timeout measurements. Do not use a DB-dependent readiness failure as a liveness restart signal. Verify WebSocket and long-polling Socket.IO through ACA ingress; do not assume the HTTP health probe proves realtime connectivity.

Set the backend environment to `NODE_ENV=production` and `PORT=5000`. Set the frontend public build arguments above before building—these are public browser values, never secrets. Set explicit CORS origins to only `https://scrolith.com` and `https://www.scrolith.com`; configure the API's public URL as `https://api.scrolith.com`. Do not add temporary ACA revision hostnames to production CORS unless a separately reviewed staging configuration requires them.

## 6. Database, migration, storage, and identity setup

### PostgreSQL

Use only the production-specific scripts below for a freshly provisioned, empty PostgreSQL 17 `scrolith` database. The older [`scrolith-runtime-migrator-roles.sql`](../deploy/postgres/scrolith-runtime-migrator-roles.sql), handoff, finalizer, enable, and permission-test files intentionally remain disposable-test-only. Do not pass their test guards, edit them, or run them against Azure.

The production sequence is fail-closed: bootstrap creates both application roles as `NOLOGIN`; the migrator is enabled separately; it configures its own default privileges without creating any public-schema object; Prisma applies the reviewed migrations to the still-empty schema; the ownership handoff then verifies the ledger and object owners and creates the protected release marker transactionally; the existing reviewed grant-policy finalizer must commit; only then does one final transaction disable migrator login and enable runtime login. A failed step stops the sequence. Do not manually advance the policy marker, repair the ledger, transfer ownership broadly, or enable either role to “get past” a failed check.

The Azure Flexible Server administrator is not a PostgreSQL superuser. It must be the server administrator with `CREATEROLE`, membership in the restricted, Microsoft-managed `azure_pg_admin`, and ownership of this new database. PostgreSQL 17 automatically gives a non-superuser `CREATEROLE` role `ADMIN OPTION` membership on roles it creates, with `INHERIT FALSE` and `SET FALSE`; the scripts explicitly verify exactly those two creator-to-application-role memberships and reject other memberships. This administrative membership does not make the application roles inherit into or become settable by the administrator; it does mean that the creating administrator retains role-administration capability, so protect that administrator identity accordingly. During the post-migration handoff, the migrator grants that same administrator `SELECT` only on the migration ledger and policy marker, so the final role-enable transaction can independently check them; the runtime role receives neither grant. The procedure does not request superuser access, modify `azure_pg_admin`, grant the application roles membership in another role, or use `REASSIGN OWNED`. PostgreSQL objects are created by `scrolith_migrator`, so ownership is established at creation and then verified; no blanket owner transfer is needed. PostgreSQL requires a role to set its own default privileges (or be a member of that role), which is why `scrolith-production-migration-init.sql` must run as the migrator. Check Azure-specific behavior manually; local PostgreSQL cannot prove Azure administrator capabilities.

This account model follows [Microsoft's Flexible Server access-control guidance](https://learn.microsoft.com/en-us/azure/postgresql/security/security-access-control) and [PostgreSQL 17 role-creation semantics](https://www.postgresql.org/docs/17/role-attributes.html). In particular, `ADMIN OPTION` is powerful: the bootstrap administrator can grant a created role to another role (including itself), even though the automatic membership uses `INHERIT FALSE` and `SET FALSE`. The SQL verifies the expected membership state but cannot remove the administrator's underlying role-administration capability. Keep that credential in the restricted operator path and audit its use.

The runtime receives no table or sequence default privileges during migration. After the 143 migrations and ownership handoff, `scrolith-production-runtime-finalize.sql` loads the explicit [`scrolith-production-runtime-grants.sql`](../deploy/postgres/scrolith-production-runtime-grants.sql) inventory. The source-derived matrix in [`POSTGRES_RUNTIME_PERMISSION_MATRIX.md`](POSTGRES_RUNTIME_PERMISSION_MATRIX.md) records the reviewed operation by table: SELECT on 335 of 355 Prisma models, INSERT on 325, DELETE on 70, and column-scoped UPDATE on 227. The other models receive no such grant. Runtime has no table-level UPDATE, sequence UPDATE, TRUNCATE, REFERENCES, or TRIGGER privilege; financial history, account parents, settlements, wallets, and other protected tables have no direct DELETE. The finalizer and the separate runtime-enable transaction also reject any runtime-deletable parent whose `ON DELETE CASCADE`, `SET NULL`, or `SET DEFAULT` action could delete or rewrite a protected financial/history row.

The matrix is operation-level, not row-level authorization: table SELECT and INSERT are granted at table scope where production Prisma call sites require them, so the database role can read or insert any column on those granted tables. API authorization and validation remain essential. Financial balances are included only when the source has a corresponding write flow: wallet balance snapshots are updated by posting transactions; ledger amounts/currencies are insert-only; wallet identity/currency are not updateable; ad-payment amount/currency/status updates are used by provider reconciliation; and funding, order-payment, withdrawal, Gcoin, and settlement fields have explicit allowlists. AdPayment cannot be deleted, and its restrictive CommunityAd foreign key preserves paid-ad history while the ad-retention service archives paid ads and removes only unpaid ads. Read the matrix before changing a model write; this is a reviewed, fail-closed DML allowlist, not a claim of protection from a compromised API process that already holds the runtime credential.

### Preconditions and read-only target checks

- Provision PostgreSQL Flexible Server **17** with private VNet integration and a new, empty database named `scrolith`. The server administrator must own that database. Do not run this bootstrap on an existing database or on a server with pre-existing Scrolith roles or public-schema objects.
- Place the operator and any one-shot migrator job on a network path to the private server (same VNet, peered VNet, or approved VPN/ExpressRoute). Link the PostgreSQL private DNS zone to the client VNet and resolve the canonical server FQDN to the expected private address. Do not open public database access for this procedure. Cloud Shell must be attached to a network that can reach the private endpoint; a default ephemeral Cloud Shell without that route is not suitable.
- Install `psql` 17 and use Microsoft's currently supported root CA bundle. The command-line client must use `sslmode=verify-full`; the SQL guard also rejects a non-TLS session. If the selected private DNS setup prevents hostname validation, stop and review the DNS/certificate design rather than silently downgrading TLS.
- Confirm the exact approved source SHA below is the SHA containing these scripts and the 143-migration release. The SQL guard checks the declared SHA's format and stores it in a protected database marker; it cannot prove that a remote Git checkout or Azure resource is that SHA. Compare the Azure resource ID/FQDN, Git SHA, and migration image digest yourself.
- Obtain approval for the production database change and backup/restore plan before running the production bootstrap. The approval variable is an explicit operator acknowledgement, not an authorization mechanism.

The following PowerShell commands are **instructions for the authorized operator to run later**; they were not run for this local validation. The Azure CLI calls are read-only. The checks fail before SQL if subscription target, resource ID, region, server state/version, database, DNS route, or TLS CA file do not match. Enter the actual expected server resource ID and approved release SHA when prompted.

```powershell
$ErrorActionPreference = 'Stop'
$ExpectedSubscriptionId = Read-Host 'Owner-approved Azure subscription ID'
$ResourceGroup = Read-Host 'Azure resource group'
$ServerName = Read-Host 'PostgreSQL Flexible Server name'
$ExpectedServerResourceId = Read-Host 'Expected full PostgreSQL server resource ID'
$ExpectedPrivateAddress = Read-Host 'Expected PostgreSQL private IPv4 address from the approved network configuration'
$AdminLogin = Read-Host 'PostgreSQL server administrator login'
$ReleaseSha = Read-Host 'Approved 40-character Scrolith release SHA'
$ExpectedMigratorImage = Read-Host 'Approved migrator image reference including immutable sha256 digest'
$CaBundle = Read-Host 'Path to the current Microsoft/Azure PostgreSQL root CA bundle'
$MigrationJob = Read-Host 'Existing manually triggered migrator Container Apps Job name'

if ($ReleaseSha -notmatch '^[0-9a-f]{40}$') { throw 'Release SHA must be 40 lowercase hexadecimal characters.' }
if ($ExpectedMigratorImage -notmatch '^.+@sha256:[0-9a-f]{64}$') { throw 'Migrator image must be pinned by an exact sha256 digest.' }
if (-not (Test-Path -LiteralPath $CaBundle -PathType Leaf)) { throw 'The trusted root CA bundle is not available.' }

$activeSubscription = az account show --query id -o tsv
if ($LASTEXITCODE -ne 0 -or $activeSubscription -ne $ExpectedSubscriptionId) {
  throw 'The active Azure subscription does not match the owner-approved subscription.'
}

$serverJson = az postgres flexible-server show `
  --resource-group $ResourceGroup --name $ServerName `
  --query '{id:id,location:location,fqdn:fullyQualifiedDomainName,version:version,state:state,network:network}' -o json
if ($LASTEXITCODE -ne 0) { throw 'Could not read the target Flexible Server.' }
$server = ConvertFrom-Json -InputObject ($serverJson -join [Environment]::NewLine)
if ($server.id -ne $ExpectedServerResourceId) { throw 'Server resource ID differs from the owner-approved target.' }
if ($server.location -ne 'southeastasia' -or [string]$server.version -notmatch '^17' -or $server.state -ne 'Ready') {
  throw 'Server must be Ready, PostgreSQL 17, and in Southeast Asia.'
}
if ($server.fqdn -notmatch '^[a-z0-9-]+\.postgres\.database\.azure\.com$') { throw 'Unexpected server FQDN.' }

$databaseJson = az postgres flexible-server db show `
  --resource-group $ResourceGroup --server-name $ServerName --database-name scrolith -o json
if ($LASTEXITCODE -ne 0) { throw 'The scrolith database is not visible on the selected server.' }
$database = ConvertFrom-Json -InputObject ($databaseJson -join [Environment]::NewLine)
if ($database.name -ne 'scrolith') { throw 'Database name does not match the approved target.' }

$resolvedAddresses = @(Resolve-DnsName -Name $server.fqdn -Type A -ErrorAction Stop |
  Where-Object IPAddress | Select-Object -ExpandProperty IPAddress -Unique)
if ($resolvedAddresses.Count -ne 1 -or $resolvedAddresses[0] -ne $ExpectedPrivateAddress) {
  throw 'Private DNS does not resolve to the owner-approved database address.'
}
if (-not (Test-NetConnection -ComputerName $server.fqdn -Port 5432 -InformationLevel Quiet)) {
  throw 'The private PostgreSQL endpoint is not reachable on TCP 5432 from this network.'
}
Write-Output 'Private DNS address and TCP 5432 reachability verified.'
```

Proceed only when the expected private address is approved for the server's VNet and the checks succeed from the intended operator or job network. Azure Flexible Server private VNet access depends on the VNet route and linked private DNS zone; see [Microsoft's private networking guide](https://learn.microsoft.com/en-us/azure/postgresql/network/concepts-networking-private). This DNS/TCP evidence plus certificate-verifying TLS binds the client connection to the server identity; see [Microsoft's current TLS guidance](https://learn.microsoft.com/en-us/azure/postgresql/security/security-tls) and [psql TLS connection example](https://learn.microsoft.com/en-us/azure/postgresql/security/security-tls-how-to-connect). The SQL scripts' `expected_server_fqdn` is an operator-declared record, not a claim that SQL can inspect its DNS target.

Before any SQL changes, inspect the already-provisioned one-shot migration job and its history. This check is read-only and deliberately omits environment and secret values. The command fails closed unless the job is manual, has exactly one container with the exact owner-approved digest, uses only the image's built-in migration command, and resolves `DATABASE_URL` through a Key Vault secret reference. The Key Vault secret must be versioned, use the reviewed job identity, and grant that identity only the required secret-read permission. Confirm those identity/scope/version details in the portal without opening or copying the secret value. A new-database rollout expects no prior executions; if any history exists, stop and review it before bootstrapping.

```powershell
$jobJson = az containerapp job show --name $MigrationJob --resource-group $ResourceGroup `
  --query '{name:name,trigger:properties.configuration.triggerType,identity:identity,containers:properties.template.containers[].{name:name,image:image,command:command,args:args,env:env[].{name:name,secretRef:secretRef,hasInlineValue:contains(keys(@),''value'')}},secrets:properties.configuration.secrets[].{name:name,hasKeyVaultRef:contains(keys(@),''keyVaultUrl''),hasInlineValue:contains(keys(@),''value''),identity:identity}}' -o json
if ($LASTEXITCODE -ne 0) { throw 'The migrator job cannot be read; do not begin the database procedure.' }
$job = ConvertFrom-Json -InputObject ($jobJson -join [Environment]::NewLine)
if ($job.name -ne $MigrationJob -or $job.trigger -ne 'Manual' -or $job.containers.Count -ne 1) {
  throw 'The existing job identity, manual trigger, or single-container contract does not match.'
}
$container = $job.containers[0]
if ($container.image -ne $ExpectedMigratorImage -or $container.command -or $container.args) {
  throw 'The job image digest or its default Prisma migration command was overridden.'
}
$dbEnv = @($container.env | Where-Object name -eq 'DATABASE_URL')
if ($dbEnv.Count -ne 1 -or -not $dbEnv[0].secretRef -or $dbEnv[0].hasInlineValue) {
  throw 'DATABASE_URL must be provided only by a Container Apps secret reference.'
}
$dbSecret = @($job.secrets | Where-Object name -eq $dbEnv[0].secretRef)
if ($dbSecret.Count -ne 1 -or -not $dbSecret[0].hasKeyVaultRef -or $dbSecret[0].hasInlineValue) {
  throw 'DATABASE_URL secret must reference Key Vault; inline secret values are prohibited.'
}
$historyJson = az containerapp job execution list --name $MigrationJob --resource-group $ResourceGroup `
  --query '[].{name:name,status:properties.status}' -o json
if ($LASTEXITCODE -ne 0) { throw 'Could not read prior migration executions.' }
$history = @(ConvertFrom-Json -InputObject ($historyJson -join [Environment]::NewLine))
if ($history.Count -ne 0) { throw 'This fresh-database procedure requires no prior job executions; stop for owner review.' }
Write-Output 'Migrator job is manually triggered, digest-pinned, Key Vault-backed, and has no prior executions.'
```

### Bootstrap, migrate, and enable sequence

Run these commands from the exact approved checkout. `psql` prompts for the database account password; no password is passed as a command argument or environment variable. `PSQL_HISTORY=NUL` disables a local psql history file, and `-X` prevents local startup files from injecting commands. Do not enable PowerShell transcription for these interactive password steps. The `\password` meta-command prompts for the new role password without placing it in SQL history or logs. Enter the resulting connection secret only in the approved Key Vault secret UI/workflow, never in a CLI `--value` argument.

```powershell
$env:PGSSLMODE = 'verify-full'
$env:PGSSLROOTCERT = $CaBundle
$env:PSQL_HISTORY = 'NUL'
$SqlRoot = (Resolve-Path '.\deploy\postgres').Path

function Invoke-ScrolithRoleSql {
  param([string]$Role, [string]$File, [string[]]$Extra = @())
  $psqlArgs = @(
    '-X', '-W', '-h', $server.fqdn, '-p', '5432', '-U', $Role, '-d', 'scrolith',
    '-v', 'ON_ERROR_STOP=1',
    '-v', 'SCROLITH_PRODUCTION_CHANGE_APPROVED=true',
    '-v', "expected_server_fqdn=$($server.fqdn)",
    '-v', "expected_source_commit=$ReleaseSha"
  ) + $Extra + @('-f', $File)
  & psql @psqlArgs
  if ($LASTEXITCODE -ne 0) { throw "Role SQL failed: $([IO.Path]::GetFileName($File)) (exit $LASTEXITCODE). Stop; do not continue to the next phase." }
}

# 1. Bootstrap: both roles are created NOLOGIN. Any existing role/object aborts.
Invoke-ScrolithRoleSql $AdminLogin (Join-Path $SqlRoot 'scrolith-production-role-bootstrap.sql')

# 2. In an interactive psql session, set the migrator password securely:
psql -X -W -h $server.fqdn -p 5432 -U $AdminLogin -d scrolith
# At the psql prompt, type:  \password scrolith_migrator
# Enter the generated password at the hidden prompts, then type:  \q
# Store the full migrator database URL as a Key Vault secret using the secure UI.

# 3. Enable only the one-shot migrator. Runtime remains NOLOGIN.
Invoke-ScrolithRoleSql $AdminLogin (Join-Path $SqlRoot 'scrolith-production-migrator-enable.sql')

# 4. As the migrator, configure default privileges. This creates no public
#    object; Prisma must see an empty target schema for the first deploy.
Invoke-ScrolithRoleSql 'scrolith_migrator' (Join-Path $SqlRoot 'scrolith-production-migration-init.sql') `
  @('-v', "bootstrap_admin_role=$AdminLogin")

# 5. Start the already-verified manual job exactly once. Azure permits multiple
#    concurrent executions, so only one owner/operator may run this procedure.
$ExecutionName = [string](az containerapp job start --name $MigrationJob --resource-group $ResourceGroup --query name -o tsv)
if ($LASTEXITCODE -ne 0) { throw 'Migration job did not start.' }
$ExecutionName = $ExecutionName.Trim()
if ([string]::IsNullOrWhiteSpace($ExecutionName)) { throw 'Azure did not return this execution name; do not retry start blindly.' }
Write-Output "Started migration execution: $ExecutionName"

# Repeat this read-only status check until this exact execution is Succeeded.
# It fails closed on Running/Processing, Failed/Stopped, or unknown status.
$executionJson = az containerapp job execution show --name $MigrationJob --resource-group $ResourceGroup `
  --job-execution-name $ExecutionName `
  --query '{name:name,status:properties.status,startTime:properties.startTime,endTime:properties.endTime}' -o json
if ($LASTEXITCODE -ne 0) { throw 'Could not read the exact migration execution status.' }
$execution = ConvertFrom-Json -InputObject ($executionJson -join [Environment]::NewLine)
if ($execution.name -ne $ExecutionName) { throw 'Azure returned a different execution; stop and investigate.' }
if ($execution.status -ne 'Succeeded') { throw "The exact migration execution is $($execution.status); stop and do not continue." }

# 6. Once the migration job has exited successfully, verify ownership and the
#    full migration ledger. This transaction creates the marker only now.
Invoke-ScrolithRoleSql 'scrolith_migrator' (Join-Path $SqlRoot 'scrolith-production-role-handoff.sql') `
  @('-v', "bootstrap_admin_role=$AdminLogin")
# Apply the reviewed runtime grant policy only after the handoff commits.
Invoke-ScrolithRoleSql 'scrolith_migrator' (Join-Path $SqlRoot 'scrolith-production-runtime-finalize.sql')

# 7. Set the runtime password interactively, store its full URL as a separate
#    Key Vault secret, and verify the reference before enabling app traffic.
psql -X -W -h $server.fqdn -p 5432 -U $AdminLogin -d scrolith
# At the psql prompt, type:  \password scrolith_runtime
# Enter the generated password at the hidden prompts, then type:  \q

# 8. This is the only step that enables runtime login. It checks the exact
#    migration count, release marker, ownership, privilege policy and no sessions.
Invoke-ScrolithRoleSql $AdminLogin (Join-Path $SqlRoot 'scrolith-production-runtime-enable.sql')

# 9. Afterward, verify a successful TLS login as runtime using the Key Vault
#    reference in the approved application/job environment; query current_user,
#    current_database(), pg_stat_ssl for this session, and the approved grants.
Remove-Item Env:PGSSLMODE, Env:PGSSLROOTCERT, Env:PSQL_HISTORY
```

The manual migrator job must be configured outside this procedure with the exact immutable image digest, private network access, a versioned Key Vault reference, and no schedule or automatic trigger. Verify its managed identity and narrow Key Vault scope in the owner-approved portal. Do not put `DATABASE_URL` in a job command/argument, Bicep parameter, image, or log. If the job does not already exist with those properties, stop: the guide does not authorize creating Azure resources. Enter separate runtime and migrator full database URLs as Key Vault secret values through its secure UI. Use certificate validation (`verify-full`) and the official current root CA; never use `require` as a substitute for server identity verification. Microsoft documents manual job start and per-execution inspection in its [Container Apps job quickstart](https://learn.microsoft.com/en-us/azure/container-apps/jobs-get-started-cli) and [CLI reference](https://learn.microsoft.com/en-us/cli/azure/containerapp/job/execution?view=azure-cli-latest). Job starts can create concurrent executions, so capture the exact returned execution name and never infer success from a different/newest execution.

The new production SQL files are [`scrolith-production-target-guard.sql`](../deploy/postgres/scrolith-production-target-guard.sql), `scrolith-production-role-bootstrap.sql`, `scrolith-production-migrator-enable.sql`, `scrolith-production-migration-init.sql`, `scrolith-production-role-handoff.sql`, `scrolith-production-runtime-grants.sql`, `scrolith-production-runtime-finalize.sql`, and `scrolith-production-runtime-enable.sql`. Every production script requires explicit psql approval, the declared Azure FQDN, the approved release SHA, the exact writable database name, PostgreSQL 17, and a TLS session. The FQDN is syntax-checked by SQL; actual endpoint and certificate validation is performed by the operator's read-only Azure lookup, private DNS check, and `psql` `verify-full` connection.

This policy is pinned to **143 Prisma migration directories**, ending in `20261122100000_restrict_order_gig_history`. Migration 143 changes the `Order.gigId` foreign key from `ON DELETE SET NULL` to `ON DELETE RESTRICT`: the API hard-deletes only gigs without orders and deactivates linked gigs with `isActive=false` and `status=PAUSED`. This closes the race that previously detached order history. A later release with a changed migration set needs a separately reviewed production gate update; do not edit count/marker values ad hoc. The checked-in migration history includes drops/renames, so this first-launch sequence is for the verified fresh database only. Never run `migrate dev`, `migrate reset`, `db push`, seeds, or repair commands against production.

Local PostgreSQL 17 replay and permission checks do not establish that Azure's restricted administrator can perform every operation in the scripts, that ACA private networking/Key Vault references work, or that the deployed role grants match. Complete the manual Azure smoke and role/grant verification before application traffic is allowed. If any SQL phase fails, leave runtime `NOLOGIN`, stop the job if it is still running, preserve redacted diagnostics, and have the database owner review the failed phase before recovery; do not rerun bootstrap against partially initialized state.

### Blob Storage

Create a Standard General-purpose v2 Storage Account with Hot LRS, HTTPS-only, minimum TLS 1.2, public network access disabled after private endpoint/DNS verification, and anonymous blob access disabled. Create the private `uploads` container before starting the API; runtime no longer creates containers. Grant the API user-assigned identity `Storage Blob Data Contributor` only at the container scope, or a narrower validated data-plane role. Do not configure a production connection string. Production requires the standard account endpoint, `AZURE_STORAGE_AUTH_MODE=managed_identity`, and optionally the user-assigned identity client ID.

Azure file responses use the authenticated `/api/files/content/:id` route. Azure video-thumbnail references are stored internally and returned through the same route with `?variant=thumbnail`; access follows the parent file's existing public/private rules. Azure uploads are disk-backed, retain the 500 MiB per-file cap, reject when two Azure uploads are already active per API process, and stream Blob blocks using an 8 MiB buffer with SDK concurrency 2. Database-write failure triggers best-effort cleanup of uploaded blobs. This reduces in-process buffering but does not prove 500 MiB uploads are operationally acceptable; load, slow-client, and disk-capacity tests remain release gates. Keep the container private and configure soft delete/versioning and retention with the data owner.

### Redis and Key Vault

- Configure `REDIS_URL` as the private TLS endpoint from the selected Azure Managed Redis instance. Configure `REDIS_ENTRA_CLIENT_ID` and `REDIS_ENTRA_OBJECT_ID` from the dedicated managed identity. These are identifiers, not credentials. Grant that identity only the Redis data permissions required by the code and verify the chosen Redis SKU supports the required Entra policy and private networking.
- Configure ACA Key Vault references using a user-assigned managed identity available before app creation, or create the app identity first and then add references. Assign Key Vault Secrets User at the narrowest supported scope. Use versioned secret URIs for controlled releases or versionless URIs only with an explicit rotation/restart procedure.
- Enter secret **values** in the Azure Portal Key Vault secret blade or an approved secrets-management workflow. Do not pass secret values in CLI flags, source, parameter files, frontend build args, or shell history. Never export a secret to inspect it in a pipeline log.

## 7. Environment-variable checklist

Configure only what is approved and actually used. Names below are from this backend source; never print their values.

| Purpose | Variables / setting | Handling |
|---|---|---|
| Core API | `NODE_ENV`, `PORT`, `DATABASE_URL`, `JWT_SECRET` | `DATABASE_URL` and `JWT_SECRET` are Key Vault references. Runtime DB URL must use the restricted runtime role. |
| Public origin and browser access | `FRONTEND_URL=https://scrolith.com`, `FRONTEND_ORIGIN=https://scrolith.com`, `PUBLIC_APP_URL=https://scrolith.com`, `CORS_ALLOWED_ORIGINS=https://scrolith.com,https://www.scrolith.com` | Non-secret; exact HTTPS origins only. |
| Redis | `REDIS_URL`, `REDIS_ENTRA_CLIENT_ID`, `REDIS_ENTRA_OBJECT_ID` | Private TLS URI and identity IDs; do not use a Redis password/key fallback. Validate auth from the running API identity. |
| Uploads | `UPLOAD_DRIVER=azure_blob`, `AZURE_STORAGE_AUTH_MODE=managed_identity`, `AZURE_STORAGE_ACCOUNT_URL`, `AZURE_STORAGE_CONTAINER=uploads`, optional `AZURE_STORAGE_MANAGED_IDENTITY_CLIENT_ID` | No connection string in production. The API UAMI needs scoped Blob data-plane authorization. `AZURE_BLOB_BASE_URL` is not an authorization mechanism or a workaround for private access. |
| Optional OAuth | `GOOGLE_OAUTH_CALLBACK_URL`, `LINKEDIN_OAUTH_CALLBACK_URL` plus provider credentials/settings supported by the current auth configuration | Register exact callback URLs with the providers; do not enable a provider until client credentials, verified domains, consent, and account-linking behavior are approved. |
| Optional email | `EMAIL_PROVIDER`, `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASS`, `EMAIL_FROM_NAME`, `EMAIL_FROM_EMAIL`, `EMAIL_ENCRYPTION` (or the documented provider-specific names) | Secrets via Key Vault; test delivery with a dedicated sender and synthetic account before launch. |
| Optional AI | `SCROLITHA_PROVIDER=disabled` until a real approved endpoint is configured; otherwise `SCROLITHA_CORE_ENDPOINT`, `SCROLITHA_CORE_MODEL` and any required auth settings | Do not point at a local loopback/Ollama endpoint from Azure. Provider and privacy review required. |

`EXTERNAL_PLATFORM_API_ENABLED` is not introduced or set by this candidate. Keep the external-platform API unavailable/off; do not add a public developer integration gate as part of Azure setup. If the Developer Platform credential-hashing feature is later separately authorized, provision `DEV_PLATFORM_HASH_PEPPER` as a Key Vault secret with at least 32 UTF-8 bytes. The local fallback was removed; do not reintroduce a development fallback. Do not configure this feature merely to make this release start.

Do not configure Stripe, payout, wallet, SMTP, OAuth, KYC, push, or AI secrets until the respective provider/account, environment, feature authorization, and operational owner have been confirmed. `VITE_*` values are embedded in the public bundle and can never hold credentials.

## 8. Namecheap DNS and TLS (placeholders only)

Do not change current DNS until the owner approves a cutover window and the new services pass smoke tests. Azure must first return the exact app FQDNs, environment inbound IP, and domain-validation ID. Never guess or copy values from another environment.

| Type | Name/host | Value to enter only after Azure supplies it |
|---|---|---|
| `A` | `@` | `<EXACT_EXTERNAL_CONTAINER_APPS_ENVIRONMENT_INBOUND_IP>` |
| `TXT` | `asuid` | `<EXACT_APEX_DOMAIN_VERIFICATION_ID>` |
| `CNAME` | `www` | `<EXACT_FRONTEND_CONTAINER_APP_FQDN>` |
| `TXT` | `asuid.www` | `<EXACT_WWW_DOMAIN_VERIFICATION_ID>` |
| `CNAME` | `api` | `<EXACT_API_CONTAINER_APP_FQDN>` |
| `TXT` | `asuid.api` | `<EXACT_API_DOMAIN_VERIFICATION_ID>` |

Confirm Azure's Custom Domains blade specifies the record type/value for each hostname. For an apex custom domain, ACA uses an A record to the environment IP and a TXT `asuid` validation record; subdomains use a CNAME to the exact app FQDN and a corresponding `asuid.<subdomain>` TXT. Add/bind domains and managed certificates only after DNS verification. The Nginx frontend config redirects `www.scrolith.com` to `https://scrolith.com`; both domains must be correctly bound and TLS-secured.

The current Nginx config uses `api.scrolith.com` for preconnect and the frontend build uses the same API origin. Do not point public DNS to an ACA default FQDN permanently or alter MX, SPF, DKIM, or DMARC records used by Zoho.

## 9. Release validation and go/no-go gates

### Additional disposable PostgreSQL 17 role-procedure validation (2026-11-21)

This evidence is from a task-owned local PostgreSQL 17.11 container on an isolated Docker network. It does not verify Azure Flexible Server's restricted administrator behavior, Azure private networking, Container Apps, Key Vault, or any production database. The synthetic database was freshly created for this run and contained only the candidate schema/migration data.

- The production SQL contract suite passed **6/6 tests** with `node --test --test-reporter=spec scripts/production-role-sql-contract.test.mjs` after the runbook exact-execution check was added. Earlier in this task, the five SQL/migration contract cases passed before that documentation regression was added.
- Bootstrap created `scrolith_runtime` and `scrolith_migrator` with `NOLOGIN` and without superuser, createdb, createrole, replication, bypass-RLS, or inherited privileges. The separate migrator enable succeeded while runtime remained `NOLOGIN`; an attempted runtime connection before finalization was rejected by PostgreSQL as expected.
- Migration initialization succeeded without creating any public-schema object. Prisma `migrate deploy` applied **142/142** migrations, latest `20261116120000_add_durable_auth_sessions`; the second deploy replay exited successfully with no pending migrations. The first local implementation placed the marker before Prisma and produced Prisma P3005; it was corrected so marker creation occurs only in the post-migration ownership handoff.
- The handoff verified the complete migration ledger and migrator ownership, then committed a local test marker using `15ca15c9b1ce462a8a140090cf45c0354d762ce6` as a **synthetic input value**. The new SQL files are uncommitted and are not contained in that SHA; the test marker is not evidence that the SHA contains this procedure. For a separately approved operator run, use the exact commit that contains the reviewed SQL, application source, and migrator image build inputs, plus the immutable image digest built from that source. The runtime finalizer committed its grant policy. A synthetic exception injected into a temporary copy of the separate enable script after both role changes caused PostgreSQL to roll back the transaction: migrator stayed `LOGIN`, runtime stayed `NOLOGIN`. The subsequent normal enable succeeded, atomically setting migrator `NOLOGIN` and runtime `LOGIN`.
- Final runtime checks: database TLS session succeeded; runtime had schema USAGE but no schema CREATE or database TEMP, no superuser/role/database/replication/RLS bypass attributes, no migration-ledger or policy-marker read access, and could not `SET ROLE` to the migrator. Runtime was denied direct DELETE/TRUNCATE/TRIGGER on the inspected Wallet, Gcoin, transaction, funding, withdrawal, order-payment, settlement, ad-payment, and Gcoin-earning-history relations. It was denied UPDATE to protected amount/currency fields while selected workflow fields (for example transaction status, wallet balance, funding/payment status and FX lock, withdrawal details/status) remained updateable. The finalizer itself includes a broader schema-specific privilege assertion set; this local test is not proof that every application route works under the deployed role.
- An earlier closeout reported a nonfatal `no privileges could be revoked from public` notice during finalization. The exact line is not present in the retained evidence logs available for this review, so its originating statement is not independently confirmed. In the current scripts, bootstrap checks database/schema ACLs before any `PUBLIC` revoke, and the runtime finalizer checks each relation/column/sequence ACL before revoking; a no-op notice is therefore not expected on the fresh PostgreSQL 17 path. PostgreSQL's notice can mean a REVOKE matched no grant, but that alone does not prove the resulting policy is correct: inspect the source SHA, command, ACL, and effective privileges. The fresh 2026-11-22 run below did not emit the notice and verified the resulting `PUBLIC` ACL count. Azure ACL behavior remains untested.
- No Azure command, Azure SQL connection, live provider credential, database containing owner data, image push, or application deployment was used. The runbook's Azure CLI/portal instructions below remain unexecuted operator steps.

### Current disposable PostgreSQL 17 runtime-permission validation (2026-11-22)

This is local disposable-database evidence for the role procedure and current source changes. The test used the already available local PostgreSQL `17` Docker image, a task-owned container with tmpfs data and an ephemeral loopback-only port, and synthetic data. The recorded source SHA passed into the database marker was the base commit `15ca15c9b1ce462a8a140090cf45c0354d762ce6`; it identifies the test input only and does not contain these uncommitted changes. The test must be rerun with the final local commit SHA before treating that SHA as the tested source marker. No Azure-managed PostgreSQL behavior is established.

- PowerShell command: `$env:SCROLITH_RUN_PRODUCTION_ROLE_PG17='1'; $env:SCROLITH_ROLE_VALIDATION_EVIDENCE_DIR='D:\scrolith-role-validation-evidence-20261121'; $env:SCROLITH_ROLE_TEST_SOURCE_SHA='15ca15c9b1ce462a8a140090cf45c0354d762ce6'; node --test --test-reporter=spec scripts/production-role-postgres17.test.mjs`. Exit code **0**; Node test runner **1 passed, 0 failed, 0 skipped**; PostgreSQL 17 migration/permission sequence completed in approximately 59 seconds. Raw log: `pg17-role-validation-6604-1795279310640-f38905.log`, SHA-256 `36814BB4275576521FF3B50B67CD367B69FE00664784E2A5FF3589B959AD1E16`; structured summary: `pg17-role-validation-6604-1795279310640-f38905.json`, SHA-256 `684D90620D4F1D874D2868CA2E1D7F1E4DDEA09AB4CE32ED2B7226D497390EC1`. Both are outside the worktree.
- The fresh setup applied **143/143** migrations, then replayed `migrate deploy` with no pending migrations. The ownership handoff verified migration 143 (`20261122100000_restrict_order_gig_history`) and the policy marker. Final role state was runtime `LOGIN`, migrator `NOLOGIN`, and backup role `NOLOGIN`; no runtime ownership, schema-create, temp, migration-ledger, marker, role-switch, or DDL access was granted.
- Failure injection after grants caused the finalizer transaction to fail and roll back: runtime remained `NOLOGIN`, the policy marker remained pending, and none of that attempt's column grants persisted. Retrying the normal finalizer succeeded. A separate injected failure in runtime enable rolled back both login changes, leaving migrator `LOGIN` and runtime `NOLOGIN`; the subsequent normal enable succeeded. These injected SQL errors are expected negative-test outcomes; the harness itself exited 0.
- Effective grants matched the 355-model reviewed matrix: `SELECT=335`, `INSERT=325`, `DELETE=70`, table-level `UPDATE=0`, and explicit column-level `UPDATE` grants on **227** tables. The test found **0** runtime-deletable parent cascades into the protected financial/history relations and **0** explicit `PUBLIC` object/column ACL entries in `public`.
- Representative supported synthetic inserts and balance/status/provider/FX/withdrawal-detail/Gcoin/AdPayment updates succeeded. Tests denied sensitive balance identity, immutable amount/currency, ownership, settlement/ledger changes, direct history deletes, parent deletes that could erase history, `TRUNCATE`, migration-ledger changes, schema DDL, and `SET ROLE`. Deleting an order-linked gig failed under `Order_gigId_fkey` while preserving the link; an unlinked gig delete succeeded. A paid community-ad delete failed under `AdPayment_adId_fkey` and retained payment history; the supported unpaid-ad delete succeeded.
- The reported `no privileges could be revoked from public` notice was **not observed** during bootstrap, handoff, or finalization. The scripts conditionally issue `PUBLIC` revokes only when the corresponding ACL exists; the effective-ACL query then returned zero explicit public-schema object/column grants. If an Azure run emits the notice, the operator must stop and retain the exact SQL statement and server output for review; a benign no-op notice must not be inferred without confirming final effective privileges. Azure Flexible Server ACL and administrator behavior remains unverified.
- Harness cleanup removed its labeled task container. No persistent volume was used. This test does not prove every HTTP route succeeds under the deployed runtime role, Azure private connectivity/TLS/DNS, or the permissions available to the actual Azure server administrator.

### Historical local validation (through 2026-11-06; superseded below)

- The frontend lockfile was corrected to official `registry.npmjs.org` tarball URLs while preserving integrity metadata; exact Capacitor peer versions were reconciled, and the stale admin-role test now follows the maintained shared policy helper. The resulting local submodule commit is `30399bfbd555e325c790a92b75eb6fcde078ca70`; it is not on remote `main` yet. A clean frontend `npm ci` from the official registry installed 831 packages in about 253 seconds with lifecycle scripts enabled. Slow individual tarball responses explained the earlier apparent stall; no integrity or lifecycle failure was observed. The Dockerfiles explicitly select the official registry and retry slow fetches.
- Frontend production build passed with explicit API origins and root base path. Static inspection of generated assets found the expected `https://api.scrolith.com` origin, no staging ACA hostname, and no matches for checked private-key/payment-token markers; this heuristic is not a complete secret scan.
- Frontend certification unit tests: 54/54 passed. Mobile unit tests: 624/624 passed across 7 suites after setting the required local source-root variables. This is not Android/iOS native build validation.
- Backend focused tests: 6 suites, 35/35 tests passed (upload limits, concurrency limit, Azure upload persistence, Blob auth, Azure file access, media storage). The production TypeScript compilation and `npm run build:prod` passed as part of the container builder stage. The full backend Jest/browser integration suite was not run.
- Official npm registry production audits exited 0 with zero reported vulnerabilities for both applications. Frontend audit covered 274 production dependencies; backend audit covered 604. These exclude development dependencies and do not constitute a blanket dependency certification.
- All three Docker targets built successfully from the current local working snapshot. Local image IDs (not registry manifest digests) and sizes: frontend `sha256:6d9f3a40f71583b2da0a46bb5b4d4e3c7906f51c5a1d5178fc644a0c995011b7` (129,396,294 bytes); backend runtime `sha256:7d02542ea6fd66368565d8acc5989be84e6d2e73fdfdf5de4ed868d73957b9ac` (1,027,032,352 bytes); migrator `sha256:3cc680cf223d7131658a303102e09572e81bf2ec77fb7770bfe5f7380829d7d5` (1,291,032,039 bytes). Trivy 0.76.2, verified against Aqua Security's official release checksum, scanned all three images against the local vulnerability DB refreshed 2026-11-06: frontend and backend runtime reported zero; the migrator report contains High `braces@3.0.3` (CVE-2026-93687) and Medium `sprintf-js@1.0.3` (CVE-2026-97058). The current GitHub-reviewed advisories for both packages are withdrawn (braces on 2026-10-23 as not practically exploitable; sprintf-js on 2026-10-22); Trivy's refreshed DB still emits the records. Treat this as a scanner/advisory-feed discrepancy requiring documented reviewer disposition or a scanner DB correction—not as confirmation of an active vulnerability and not as a clean raw scan. Both packages arrive through development-dependency paths inherited by the migrator from the builder, making the migrator image 1.29 GB; a separately minimized migrator remains a follow-up. No images were pushed; no registry digest, SBOM, or provenance was produced.
- Frontend static container smoke returned HTTP 200 for `/` and `/login`. Backend container smoke against a disposable PostgreSQL 17 database and local Redis returned HTTP 200 for `/api/health` and `/api/readyz` in development mode with synthetic settings. A production-mode readiness attempt without Azure managed identity returned 429/not-ready, as expected for a missing protected Redis identity; actual Azure identity, Key Vault, private networking, and Blob access have not been tested. The backend Docker health probe had not completed its next interval at the time of inspection, so no `healthy` container status is claimed.
- Prisma clean replay applied all 139 migration directories to a fresh disposable PostgreSQL 17 database; the migration ledger contained 139 completed rows. Prisma schema validation and migration status passed. This establishes clean replay only, not effects on populated data or Azure networking.
- Disposable PostgreSQL role checks confirmed runtime can connect and has schema USAGE, but lacks schema CREATE, ownership, TRIGGER, TRUNCATE, migration-ledger access, and DELETE on `Transaction`, `GcoinTransaction`, `PaymentSettlement`, and `WalletFundingIntent`. Runtime UPDATE remains granted; source workflows update transaction status, so blanket UPDATE removal would break supported paths. No trigger makes those tables immutable; the deployed production role remains unverified. The migrator performed all 141 migrations. Temporary databases and roles were disposable-only.
- Focused Blob/auth/upload tests exercise mocked identity, private API authorization, bounded upload concurrency, and best-effort cleanup. Real Azure Blob authorization, slow-client/load behavior, process-crash temp cleanup, and deployed identity/network policy remain untested.
- Full browser flows (CORS/preflight, authenticated sign-in/OAuth, Socket.IO polling/WebSocket, upload/download against an authenticated UI) were not run in that earlier review.

### 2026-11-13 local validation update (current candidate; not a release approval)

- **Source identity:** root `425a4111815465425e55a8e8ef2530cc49bc7eee`; frontend gitlink and local submodule `30399bfbd555e325c790a92b75eb6fcde078ca70`. The frontend commit is not available from the canonical remote, so a clean external checkout cannot reproduce this candidate yet. All validation outputs are local and stored outside this worktree.
- **Frontend install/build:** a no-cache Docker build from the final local frontend working tree completed a clean `npm ci` (892 packages; lifecycle scripts and integrity checks enabled) and Vite production build. Local frontend image ID: `sha256:97ef5dffb80c04d9f43b4bea62a39192d80b080090d164eea66885d3710c2bf8`. Nginx configuration validation succeeded; static `/`, `/login`, `/signup`, and `/jobs` returned HTTP 200. The bundled assets contained the configured public API origin and no detected staging-host or secret-marker matches. This is local evidence for the dirty submodule working tree, not an externally reproducible immutable source build.
- **Frontend tests/types:** intended Vitest set passed 29 files / 157 tests; the explicit API-origin regression passed 1 file / 2 tests; certification unit suite passed 54/54; mobile unit suite passed 624/624 with explicit local source-root variables. The broad Vitest auto-discovery command failed because it picked up Jest-style files; it is not the intended runner. On 2026-11-15, `npm run typecheck:production` exited 2 with 135 diagnostics after removing a duplicate `is_featured` declaration; the field remains declared once. The earlier clean-main comparison (207 baseline / 187 candidate, zero candidate-only diagnostics) predates this run and is not a current same-snapshot differential. The 135 remaining diagnostics are not suppressed and the production typecheck is not passing.
- **Certification authentication:** the prior local Playwright run reported 43 passed, 11 skipped, 3 failed. Failures were an iPhone feed probe (`no_post_cards`) and two notification cases redirected to `/auth/login`. Review found setup swallowed a failed login assertion and wrote state anyway; when auth state was created during setup, dependent projects also failed to select that new state. The current local source now fails closed on missing login/token, supplies generated state to credentialed projects, stores it under the OS temporary directory, and requires explicit target/API origins rather than inferring the public API host. With no local certification credentials or authenticated storage state configured, the focused local-target rerun skipped all 8 tests; it is not a pass. Signup/Human Verification and device-approval are not proven by authenticated browser coverage.
- **Backend:** production audit against `registry.npmjs.org` reported zero vulnerabilities; the audited lockfile SHA-256 is `BCFCCC7D083E4F42F94775BF44D99CC2BE0F1079ED6931E6322C887B73C9211F`. Production build passed. Full Jest completed 215 suites (214 passed, 1 gated) and 1,338 tests (1,328 passed, 10 pending, 0 failed). All 10 pending tests are in the explicitly gated community financial-history runtime HTTP suite and require `SCROLITH_ROLE_HTTP_TEST_APPROVED=true` plus a disposable runtime-role target; they were not counted as passed. The API production image IDs are runtime `sha256:d39570a3d84c6db8492e1f0d58fc56952924ceb391aab7b7422bd89894839c6b` and migrator `sha256:f046697787d1ac45fe81434d018d5e52b13e5a00f96824c025cfc361da25144c`.
- **Images/scanner:** all three local images were built without cache from the final source available in this worktree. Trivy 0.76.2, using its database refreshed 2026-11-13 07:00 UTC, reported zero Critical/High/Medium/Low/Unknown vulnerabilities for the exact frontend (`sha256:97ef5dffb80c04d9f43b4bea62a39192d80b080090d164eea66885d3710c2bf8`), backend runtime (`sha256:d39570a3d84c6db8492e1f0d58fc56952924ceb391aab7b7422bd89894839c6b`), and migrator (`sha256:f046697787d1ac45fe81434d018d5e52b13e5a00f96824c025cfc361da25144c`) images. The final frontend raw Trivy JSON is stored outside the worktree with SHA-256 `65D301C2D72DB574EF8C8108A337C4F8024805418F757F3A0A0E5C6F37B3ECF2`; backend raw reports are preserved there as well. These are local image IDs, not registry manifest digests; no SBOM or provenance was generated. A rebuild from the externally published immutable source will still be required before publication.
- **Prisma/roles:** schema validation passed; all 141 migrations replayed on fresh disposable PostgreSQL 17, and synthetic populated schema upgrade 140→141 passed. Disposable bootstrap/handoff/finalizer, injected finalizer failure/retry, separate enable failure, and successful enable tests passed. This does not verify Azure-managed PostgreSQL grants or production data effects.
- **Readiness:** frontend static routes returned HTTP 200. In local development with disposable PostgreSQL and Redis, `/api/health` and `/api/readyz` returned 200. Without Azure managed identity, production-mode readiness returned 503 `NOT_READY`; this is expected locally, not an Azure verification. After a local Redis outage/recovery, readiness stayed not-ready until the task-owned API process was restarted, which remains a reconnection/operations risk.
- **Bicep/API origin:** local Bicep compilation succeeded without Azure login/resource operations. The API template maps `frontendOrigin` to `FRONTEND_URL`, `FRONTEND_ORIGIN`, and `PUBLIC_APP_URL`; payout return URLs read `PUBLIC_APP_URL` first, so the return-origin wiring is consistent.
- **Money-movement gate:** `SCROLITH_MONEY_MOVEMENT_ENABLED` is fail-closed when unset and must equal `true` to enable. `moneyMovementHardOff` is mounted before API route registration and returns 503 for writes matching the financial namespaces/action paths; focused unit coverage checks the default-off behavior and representative paths. This corrects the earlier statement that no server-side gate exists. It does not yet prove every financial route alias or internal service/worker entry point is covered; complete the route-by-route and integration audit before treating this as a release control. Prisma `walletFundingEnabled` and `paymentTestMode` defaults are UI/configuration data, not authorization controls. Keep the environment gate explicitly false, and keep the external integrations API unavailable unless a separately reviewed gate is added.
- **Budget:** Section 11 is the current estimate and supersedes the earlier $194.39 HA subtotal based on generic Managed Redis page rates. A fresh Southeast Asia Azure Retail Prices API query returned the consumption meter for Azure Managed Redis Balanced B0 at **$0.02/hour**, effective 2026-01-01; at 730 hours this is $14.60 for one node. The two-node HA figure is only a 2x planning extrapolation ($29.20), not a confirmed HA quote. With the Section 11 assumptions, priced subtotals are **$182.71/month non-HA** and **$197.31/month derived HA**, before private endpoints and variable usage. Private endpoint-hour/data-processing charges, Blob transactions, API requests, backup overage, and other variable charges remain unpriced. The estimate exceeds the $100 target and does **not** demonstrate safe headroom below the $200 ceiling. Use the subscription-specific Azure Pricing Calculator before approving any spend; public prices are not an account quote.
- **Security/operations:** private Azure identity, Blob authorization/networking, deployed database grants, full authenticated browser flows, OAuth/email/provider setup, Socket.IO scale-out, worker single-leader behavior, backup restore and production rollback remain unverified. A historical credential-shaped database URL may have been exposed; rotate it if it was valid. It was not printed or rewritten in history.

### Required before any image publication

1. Publish the reviewed frontend submodule commit before publishing a parent gitlink that references it; then rebuild from that clean immutable source commit. Repeat scans with a current Trivy release, produce SBOMs/provenance, record registry manifest digests, and inspect final Vite assets.
2. Run the full backend unit and disposable-DB suites; distinguish omitted tests from passing focused suites.
3. Test API CORS/preflight from the exact intended frontend origins, authentication/OAuth callback flows, Socket.IO polling and WebSocket, uploads/downloads, and DB readiness against isolated test infrastructure.
4. Independently review database migration permissions, Redis managed identity, Key Vault resolution, private DNS, ACA ingress and network security, and provider setup.
5. Close the remaining private-Blob deployment, worker duplication, Socket.IO scale-out, migration rollback/runtime-role, startup security-default, and email/OAuth ownership issues listed below.
6. Have an independent reviewer approve the source and an owner approve production configuration, cost ceiling, DNS cutover, monitoring alerts, backups, and rollback window.

### Historical release blockers (as documented before 2026-11-13)

- **High — database role scope (historical assessment):** earlier review found broad runtime UPDATE and incomplete financial-history protection. Later disposable-database work added a retention migration and role templates, but Azure grants and managed-database semantics remain unverified. Do not assume money movement is disabled: the current schema defaults `walletFundingEnabled` to true.
- **High — upload operations:** private Azure Blob access is implemented through managed identity and authenticated API content routes, and uploads are disk-backed/bounded in process. Real Azure identity/private-network authorization, load, slow-client, crash cleanup, and disk-exhaustion behavior have not been tested. Public containers are not an acceptable workaround.
- **High — background jobs:** scheduled workers may run in every replica and lack a verified distributed leader guard. Keep API max replicas at 1; this remains a single-instance availability and rolling-deployment duplication risk.
- **High — realtime scale:** no Socket.IO Redis adapter has been verified. Do not scale API or split traffic until tested.
- **High — database operations:** 141 migrations replay on empty PG17, but history includes destructive/renaming statements (including removal of legacy Gcoin settings columns). Existing-data migration, runtime-role least privilege, and backward-compatible rollback have not been approved.
- **High — release validation:** no authenticated Azure integration, real managed identity/Blob test, production migration rehearsal, full backend/browser suite, or cloud smoke test has run. The migrator's raw Trivy output still includes two records whose GitHub-reviewed advisories are withdrawn; independent disposition and a clean-source rebuild/scan remain outstanding. No SBOM, provenance, or registry digests exist.
- **Dependency audit:** official-registry production audits now report zero findings for both apps after scoped dependency corrections. Development dependencies and deprecation/maintenance risks still require review; record complete audit results separately before PR/release.
- **Medium — providers:** OAuth, SMTP/Zoho, Stripe, KYC, push, and AI provider credentials/settings are not verified. Do not infer readiness from source code.
- **Medium — external platform:** separate integration work is not enabled or part of this release. The candidate does not provision `DEV_PLATFORM_HASH_PEPPER`.

> **Historical scan note (superseded by the 2026-11-13 final scan above):** An earlier migrator scan reported `braces` and `sprintf-js` advisory records. The later Trivy 0.76.2 run against the refreshed database scanned the final local frontend, runtime, and migrator image IDs and reported zero findings in every severity. Keep the earlier raw report as historical evidence; do not use it instead of the final report. The unpublished frontend source pin, browser gap, Azure identity/network checks, lack of image SBOM/provenance, and cost uncertainty remain release blockers.

## 10. Rollback procedure

Rollback is an operational plan to review; do not execute without release-owner approval.

### Container Apps

1. Keep the previously approved app revision active and record its exact image digest and environment configuration before rollout.
2. Deploy the new digest as a new revision. For the first release, validate it on a non-production hostname/isolated environment before changing production DNS or traffic.
3. On failure, route 100% traffic back to the recorded previous healthy revision (or restore the previous digest as a new revision). Do not use a mutable tag to identify a rollback image.
4. Verify liveness/readiness, sign-in, API CORS, uploads, Socket.IO, error rate, latency, and logs before ending rollback monitoring.

### Database and Blob

- Do not run reverse SQL or `prisma migrate reset`. Before migration, take/verify a PostgreSQL backup and confirm PITR retention. If recovery is needed, restore to a **new** server at a selected point in time, validate it, and only then approve a connection cutover; never overwrite the original source server as the first recovery action.
- App rollback is safe only if the old app binary remains compatible with the migrated schema. Because this has not been proven for an existing populated database, require an explicit migration compatibility review before production migration.
- Enable Blob versioning/soft delete and retain recovery policy. Do not bulk-delete or rewrite blobs during a code rollback. Restore the prior app digest and keep the same private access policy.
- DNS rollback uses the recorded old DNS values and TTL. Change only the approved `@`, `www`, and `api` records; do not modify mail records. Wait for DNS/TTL propagation and verify TLS.

## 11. Indicative monthly cost (USD, Southeast Asia)

Planning estimate based on Microsoft public pricing sources checked **2026-11-14**, not a subscription quote. The owner-set planning target is **$100/month** and the absolute recurring ceiling is **$200/month**. Assumptions: 730 hours/month; API app 1 vCPU/2 GiB active all month; frontend app 0.25 vCPU/0.5 GiB idle all month; PostgreSQL Flexible Server B1ms and 32 GiB Premium SSD storage; one non-HA Azure Managed Redis Balanced B0; 20 GB Hot LRS Blob; 2 GB ACR stored layers; 50 GB outbound internet transfer; 5 GB Log Analytics ingestion; 10,000 Key Vault operations; and four private DNS zones. The public-list calculation does not apply account discounts or credits. It also does not credit subscription-level free allowances, so it is conservative for those items; the actual billing scope and allowance eligibility must be checked in the subscription calculator. Taxes, support, and high availability are excluded. Azure Cache for Redis Basic C0 is not assumed for a new account.

| Component | Assumption | Estimated monthly USD |
|---|---|---:|
| Container Apps frontend + API | API 1 vCPU/2 GiB active 730 hours; frontend 0.25 vCPU/0.5 GiB idle 730 hours; excludes request charges | **$118.26** |
| PostgreSQL Flexible Server compute | B1ms, $0.026/hour x 730 | $18.98 |
| PostgreSQL storage | 32 GiB at $0.138/GiB-month (Southeast Asia Retail Prices API record) | $4.42 |
| PostgreSQL backup | Assumes backup usage remains within the included allowance up to provisioned storage | $0 baseline; excess unpriced here |
| Azure Managed Redis | Southeast Asia Retail Prices API consumption meter for Balanced B0: $0.02/hour effective 2026-01-01; 730 hours. Two-node HA is estimated as 2x the one-node rate; verify topology pricing in the subscription calculator. Reservation meters are excluded. | $14.60 non-HA / $29.20 HA (HA derived) |
| ACR | Basic registry allowance, 2 GB stored layers within included tier capacity; $0.1666/day x 365/12 | $5.07 |
| Blob Storage | 20 GB Hot LRS at $0.02/GB-month; transactions excluded | $0.40 + transactions |
| Internet egress | 50 GB at a conservative $0.08/GB; no subscription-wide allowance assumed | $4.00 |
| Key Vault | 10,000 operations at $0.03/10,000 | $0.03 |
| Azure Monitor / Log Analytics | 5 GB at $2.99/GB; no free grant assumed | $14.95 |
| Private DNS zones | Four zones, provisionally budgeted at $0.50 per zone-month | $2.00 |
| Private endpoints | Blob and Redis are private-endpoint candidates; Key Vault may require another. PostgreSQL is planned with VNet private access, not a private endpoint. The Southeast Asia Retail Prices API returned Blob Private Endpoint Premium Data Processed at $0.004/GB; its $0.70/hour-enabled meter has `unitOfMeasure=1`, so the hourly basis is ambiguous. Redis/Key Vault endpoint hourly rates were not established. | **Not priced** |
| **Priced-assumption subtotal** | Includes four private DNS zones and conservative 50 GB egress / 5 GB logs; with one-node Redis: $182.71; with two-node HA Redis: $197.31 (HA is a derived estimate). Excludes private endpoints, Blob transactions, API request charges, backup overage, taxes, support, and other variable usage. | **$182.71 non-HA / $197.31 HA plus unpriced items** |

The public-rate subtotal is **not a complete quote**. It exceeds the $100 target by $82.71 for one-node Redis and by $97.31 for the derived two-node HA Redis estimate. The HA case leaves only $2.69 before private endpoints and variable charges; that is not demonstrated headroom, so the design is **not demonstrated to fit the $200 ceiling**. The Southeast Asia Retail Prices API record for Azure Managed Redis Balanced B0 is $0.02/hour (USD, consumption, effective 2026-01-01); 730 hours gives $14.60 for one node, and $29.20 for two nodes is a simple 2x estimate, not an independently confirmed HA quote. The public Managed Redis pricing page lists generic B0 one-node non-HA at $13.14/month and two-node HA at $26.28/month, so calculator confirmation is still required. The current API data reports PostgreSQL storage at $0.138/GiB-month; the ACR Basic public rate used here is $0.1666/day. The Retail Prices API returned Blob Private Endpoint Premium Data Processed at $0.004/GB, but its $0.70 “hour enabled” meter has `unitOfMeasure=1`, so I have not inferred a time unit or used it as an hourly charge; regional Redis and Key Vault endpoint-hour rates remain unconfirmed. Obtain an account-specific Azure Pricing Calculator estimate before approving the design. If a private endpoint is also added to the Container Apps environment, the November 2026 Southeast Asia management meter is $0.10/hour ($73/month) in addition to Private Link charges; the proposed topology keeps public ACA ingress and does not include that option. The 5 GB Log Analytics line is a gross planning allowance and must be recalculated for the selected log plan, billing scope, and region. PostgreSQL backup overage, Blob transactions/retention, outbound requests, active frontend CPU, scale-out, and higher logging can increase cost. This is not a production HA recommendation: B1ms PostgreSQL, one API replica, and the one-node Redis pricing option are single-instance choices.

Use the [Azure Pricing Calculator](https://azure.microsoft.com/pricing/calculator/) with the exact subscription, region, network topology, and selected SKUs. Use the official [Azure Retail Prices API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices) for repeatable public rate checks. Container Apps consumption pricing and free grants are documented [here](https://learn.microsoft.com/en-us/azure/container-apps/billing); PostgreSQL pricing is [here](https://azure.microsoft.com/en-us/pricing/details/postgresql/flexible-server/); Redis pricing is [here](https://azure.microsoft.com/en-us/pricing/details/managed-redis/); Private Link pricing is [here](https://azure.microsoft.com/en-us/pricing/details/private-link/).

## 12. Official operational references

- [Container Apps networking](https://learn.microsoft.com/en-us/azure/container-apps/networking)
- [Container Apps custom domains and managed certificates](https://learn.microsoft.com/en-us/azure/container-apps/custom-domains-managed-certificates)
- [Container Apps Key Vault references and managed identities](https://learn.microsoft.com/en-us/azure/container-apps/manage-secrets)
- [Container Apps managed-identity image pulls from ACR](https://learn.microsoft.com/en-us/azure/container-apps/managed-identity-image-pull)
- [PostgreSQL Flexible Server private networking](https://learn.microsoft.com/en-us/azure/postgresql/flexible-server/concepts-networking-private)
- [PostgreSQL backup and restore/PITR](https://learn.microsoft.com/en-us/azure/postgresql/backup-restore/concepts-backup-restore)
- [Azure Managed Redis private link](https://learn.microsoft.com/en-us/azure/redis/private-link)
- [Azure Managed Redis security and Entra authentication](https://learn.microsoft.com/en-us/azure/redis/secure-azure-managed-redis)
- [Azure Private Link pricing](https://azure.microsoft.com/en-us/pricing/details/private-link/)
- [Azure free services and bandwidth allowance](https://azure.microsoft.com/en-au/pricing/free-services)
- [Azure Monitor cost and usage](https://learn.microsoft.com/en-us/azure/azure-monitor/usage-estimated-costs)
- [Azure Monitor diagnostic settings for Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/log-options)
