import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(backendRoot, '..');
const postgresRoot = resolve(repositoryRoot, 'deploy', 'postgres');
const readSql = (name) => readFile(resolve(postgresRoot, name), 'utf8');

test('production inspector proposal is digest-pinned, read-only, and column-scoped', async () => {
  const setup = await readSql('scrolith-production-inspector-role-setup.sql');
  const enable = await readSql('scrolith-production-inspector-role-enable.sql');
  const cleanup = await readSql('scrolith-production-inspector-role-cleanup.sql');
  const inspect = await readSql('scrolith-production-user-language-preferences-inspect.sql');
  const guard = await readSql('scrolith-production-target-guard.sql');
  const dockerfile = await readFile(resolve(postgresRoot, 'inspector.Dockerfile'), 'utf8');
  const runner = await readFile(resolve(postgresRoot, 'run-production-inspector.sh'), 'utf8');
  const bicep = await readFile(resolve(repositoryRoot, 'deploy', 'azure', 'scrolith-production-db-inspector-job.bicep'), 'utf8');

  const grants = [...setup.matchAll(/GRANT SELECT \(([\s\S]*?)\)\s*ON TABLE ([^\s]+) TO scrolith_inspector;/g)];
  const markerGrant = grants.find((entry) => entry[2] === 'public.scrolith_runtime_policy_state');
  const ledgerGrant = grants.find((entry) => entry[2] === 'public."_prisma_migrations"');
  assert.ok(markerGrant, 'marker access must be an explicit column grant');
  assert.ok(ledgerGrant, 'migration-ledger access must be an explicit column grant');
  const columns = (value) => value.split(',').map((part) => part.trim()).filter(Boolean);
  assert.deepEqual(columns(markerGrant[1]), [
    'singleton', 'source_commit', 'migration_count', 'last_migration',
    'ownership_verified', 'finalized', 'finalized_at', 'bootstrap_admin_role'
  ]);
  assert.deepEqual(columns(ledgerGrant[1]), ['migration_name', 'finished_at', 'rolled_back_at']);

  assert.match(setup, /CREATE ROLE scrolith_inspector\s+NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS/);
  assert.match(setup, /has_database_privilege\('public', 'scrolith', 'CONNECT'\)/);
  assert.match(setup, /has_database_privilege\('public', 'scrolith', 'TEMPORARY'\)/);
  assert.match(setup, /p\.prosecdef[\s\S]*a\.grantee = 0[\s\S]*a\.privilege_type = 'EXECUTE'/,
    'setup must reject PUBLIC execution of SECURITY DEFINER functions');
  assert.match(setup, /c\.relkind = 'S'[\s\S]*a\.grantee = 0[\s\S]*a\.privilege_type IN \('USAGE', 'SELECT', 'UPDATE'\)/,
    'setup must reject PUBLIC sequence privileges');
  assert.match(setup, /has_database_privilege\('scrolith_inspector', 'scrolith', 'TEMPORARY'\)/);
  assert.match(setup, /has_function_privilege\('scrolith_inspector', p\.oid, 'EXECUTE'\)/);
  assert.match(setup, /CASE WHEN c\.relkind = 'S'[\s\S]*has_sequence_privilege\('scrolith_inspector', c\.oid, 'USAGE,SELECT,UPDATE'\)/);
  assert.match(setup, /BEGIN;[\s\S]*CREATE ROLE scrolith_inspector[\s\S]*DO \$inspector_assertions\$[\s\S]*COMMIT;/,
    'role creation, grants, and final assertions must commit atomically');
  assert.doesNotMatch(setup, /GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)\s+ON\s+ALL\s+TABLES/i);
  assert.doesNotMatch(setup, /GRANT\s+SELECT\s+ON\s+TABLE\s+public\."?User/i);
  assert.match(setup, /has_column_privilege\('scrolith_inspector', a\.attrelid, a\.attnum, p\.privilege_name\)/);

  for (const sql of [enable, cleanup]) {
    assert.match(sql, /has_database_privilege\('scrolith_inspector', 'scrolith', 'TEMPORARY'\)/);
    assert.match(sql, /has_function_privilege\('scrolith_inspector', p\.oid, 'EXECUTE'\)/);
    assert.match(sql, /CASE WHEN c\.relkind = 'S'[\s\S]*has_sequence_privilege\('scrolith_inspector', c\.oid, 'USAGE,SELECT,UPDATE'\)/);
    assert.match(sql, /has_column_privilege\('scrolith_inspector', a\.attrelid, a\.attnum, p\.privilege_name\)/);
    assert.match(sql, /public\."User"/);
  }
  assert.match(enable, /ALTER ROLE scrolith_inspector LOGIN;/);
  assert.match(enable, /ALTER ROLE scrolith_inspector LOGIN;[\s\S]*DO \$inspector_enable_assertion\$[\s\S]*COMMIT;/,
    'login enablement and its assertion must be one transaction');
  assert.doesNotMatch(setup + enable + cleanup, /PASSWORD\s+'[^']+'/i);
  assert.doesNotMatch(setup + enable + cleanup, /postgres(?:ql)?:\/\/[^\s"']+/i);
  assert.match(cleanup, /ALTER ROLE scrolith_inspector NOLOGIN;/);
  assert.match(cleanup, /REVOKE SELECT \([\s\S]*?\) ON TABLE public\.scrolith_runtime_policy_state FROM scrolith_inspector;/);
  assert.match(cleanup, /REVOKE SELECT \(migration_name, finished_at, rolled_back_at\)[\s\S]*?FROM scrolith_inspector;/);
  assert.match(cleanup, /DROP ROLE scrolith_inspector;/);

  assert.match(inspect, /BEGIN READ ONLY;/);
  assert.match(inspect, /ROLLBACK;/);
  assert.doesNotMatch(inspect, /SELECT\s+\*\s+FROM/i);
  assert.doesNotMatch(inspect, /FROM\s+public\."User"/i,
    'inspection may inspect User ACL metadata but must never select application rows');
  assert.match(inspect, /FROM pg_class/);
  assert.match(inspect, /FROM public\.scrolith_runtime_policy_state/);
  assert.match(inspect, /FROM public\."_prisma_migrations"/);

  assert.match(guard, /SCROLITH_PRODUCTION_CHANGE_APPROVED/);
  assert.match(guard, /expected_server_fqdn/);
  assert.match(guard, /expected_source_commit/);
  assert.match(guard, /pg_stat_ssl/);
  assert.ok(runner.includes("[ \"${PGSSLMODE:-}\" = 'verify-full' ]"));
  assert.ok(runner.includes("[ \"${PGHOST:-}\" = 'psql-scrolith-prod-sea-2026.postgres.database.azure.com' ]"));
  assert.match(runner, /psql -X -q -w -v ON_ERROR_STOP=1/);
  assert.match(runner, /2>\/dev\/null/);
  assert.match(runner, /then\n  cat "\$report_file"/);
  assert.doesNotMatch(runner, /set -x|env\s*$/m);
  assert.match(dockerfile, /FROM postgres:17-bookworm@sha256:[0-9a-f]{64}/);
  assert.match(dockerfile, /USER postgres/);
  assert.match(bicep, /Microsoft\.App\/managedEnvironments@[0-9-]+'\s+existing/);
  assert.match(bicep, /triggerType: 'Manual'/);
  assert.match(bicep, /replicaRetryLimit: 0/);
  assert.match(bicep, /@minLength\(71\)[\s\S]*@maxLength\(71\)/,
    'Bicep must reject digest strings with the wrong OCI sha256 length');
  assert.match(bicep, /scrolith-tools\/postgres-inspector@\$\{inspectorImageDigest\}/);
  assert.match(bicep, /PGSSLMODE', value: 'verify-full'/);
  assert.match(bicep, /PGPASSWORD', secretRef: containerSecretName/);
  assert.doesNotMatch(bicep, /\bingress\s*:/i);
  assert.doesNotMatch(bicep, /PGPASSWORD[^\n]*value\s*:/i);
});
