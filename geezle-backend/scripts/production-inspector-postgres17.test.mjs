import assert from 'node:assert/strict';
import { lookup } from 'node:dns/promises';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const enabled = process.env.SCROLITH_RUN_PRODUCTION_INSPECTOR_PG17 === '1';
const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(backendRoot, '..');
const postgresRoot = resolve(repositoryRoot, 'deploy', 'postgres');
const approvedGuardFqdn = 'scrolith-inspector-test.postgres.database.azure.com';
const syntheticReleaseSha = '1111111111111111111111111111111111111111';
const syntheticPolicySha = '2222222222222222222222222222222222222222';
const finalMigration = '20261122100000_restrict_order_gig_history';
const syntheticUserSentinel = 'INSPECTION_SENTINEL_PRIVATE_ROW';
const ownedRoles = ['scrolith_inspector', 'scrolith_runtime', 'scrolith_migrator', 'scrolith_backup'];

const testFixtureSql = String.raw`
CREATE TABLE public.scrolith_runtime_policy_state (
  singleton boolean PRIMARY KEY,
  source_commit text NOT NULL,
  migration_count integer NOT NULL,
  last_migration text NOT NULL,
  ownership_verified boolean NOT NULL,
  finalized boolean NOT NULL,
  finalized_at timestamptz,
  bootstrap_admin_role text NOT NULL
);
INSERT INTO public.scrolith_runtime_policy_state VALUES
  (true, '${syntheticReleaseSha}', 143, '${finalMigration}', true, true, now(), 'synthetic_inspector_admin');

CREATE TABLE public."_prisma_migrations" (
  id text PRIMARY KEY,
  checksum text NOT NULL,
  migration_name text NOT NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  rolled_back_at timestamptz,
  logs text,
  applied_steps_count integer NOT NULL
);
INSERT INTO public."_prisma_migrations"
  (id, checksum, migration_name, started_at, finished_at, rolled_back_at, logs, applied_steps_count)
SELECT i::text, repeat('a', 64),
       CASE WHEN i = 143 THEN '${finalMigration}' ELSE '20260000000000_synthetic_' || lpad(i::text, 3, '0') END,
       now(), now(), NULL, 'synthetic test ledger row', 1
  FROM generate_series(1, 143) AS i;

CREATE TABLE public."User" (
  id text PRIMARY KEY,
  email text NOT NULL,
  "understoodLanguages" text[],
  "languagePreferencesConfirmed" boolean,
  "languagePreferencesUpdatedAt" timestamptz,
  "followOnboardingRequired" boolean,
  "followOnboardingCompletedAt" timestamptz,
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "privateNote" text NOT NULL
);
INSERT INTO public."User" (id, email, "understoodLanguages", "privateNote")
VALUES ('synthetic-user-1', 'synthetic-user@example.invalid', ARRAY['en'], '${syntheticUserSentinel}');
CREATE TABLE public.synthetic_other_relation (id integer PRIMARY KEY, private_data text NOT NULL);
INSERT INTO public.synthetic_other_relation VALUES (1, 'synthetic-only');

GRANT SELECT ON TABLE public."User" TO scrolith_runtime;
GRANT UPDATE (
  "understoodLanguages", "languagePreferencesConfirmed", "languagePreferencesUpdatedAt",
  "followOnboardingRequired", "followOnboardingCompletedAt", "updatedAt"
) ON TABLE public."User" TO scrolith_runtime;
`;

function onlySafeEnvironment(user, database, passfile) {
  const env = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATHEXT']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  env.PGHOST = process.env.PGHOST;
  env.PGPORT = process.env.PGPORT;
  env.PGUSER = user;
  env.PGDATABASE = database;
  env.PGSSLMODE = 'verify-full';
  env.PGSSLROOTCERT = process.env.PGSSLROOTCERT;
  env.PGAPPNAME = 'scrolith-disposable-inspector-pg17-test';
  env.PGCONNECT_TIMEOUT = '5';
  env.PGPASSFILE = passfile;
  return env;
}

function psqlArgs(extra) {
  return ['-X', '-w', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate', '-A', '-t', '-q', ...extra];
}

function runPsql(psqlPath, args, env, label, expectedFailure, steps, options = {}) {
  const result = spawnSync(psqlPath, psqlArgs(args), {
    env,
    cwd: repositoryRoot,
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
    ...options
  });
  const code = result.status ?? (result.error ? 124 : 1);
  steps.push({ label, exitCode: code, expectedFailure: Boolean(expectedFailure) });
  const safeError = (result.stderr ?? '').split(/\r?\n/)
    .map((line) => line.match(/ERROR:\s+([0-9A-Z]{5})/))
    .find(Boolean)?.[1];
  if (expectedFailure) assert.notEqual(code, 0, label + ' was expected to fail');
  else assert.equal(code, 0, label + ' failed' + (safeError ? ' (SQLSTATE ' + safeError + ')' : ' (output intentionally withheld)'));
  return result.stdout ?? '';
}

test('production inspector role and report on disposable TLS PostgreSQL 17', {
  skip: enabled ? false : 'set SCROLITH_RUN_PRODUCTION_INSPECTOR_PG17=1 for a loopback-only disposable PG17 cluster'
}, async () => {
  assert.equal(process.env.PGHOST, 'localhost', 'the harness accepts only the dedicated localhost TLS endpoint');
  const port = Number(process.env.PGPORT);
  assert.ok(Number.isInteger(port) && port > 1024 && port !== 5432, 'use the task-owned nonstandard local PostgreSQL port');
  assert.equal(process.env.PGDATABASE, 'postgres', 'start only from the disposable cluster maintenance database');
  assert.equal(process.env.PGUSER, 'synthetic_inspector_admin', 'use only the dedicated non-superuser test administrator');
  assert.equal(process.env.PGSSLMODE, 'verify-full', 'TLS hostname verification must be enabled');
  assert.ok(process.env.PGSSLROOTCERT, 'set the local test CA certificate path');
  await access(process.env.PGSSLROOTCERT);
  const resolvedHosts = await lookup(process.env.PGHOST, { all: true });
  assert.ok(resolvedHosts.length > 0 && resolvedHosts.every((entry) => entry.address === '127.0.0.1' || entry.address === '::1'),
    'localhost must resolve exclusively to loopback addresses');

  const psqlPath = process.env.SCROLITH_PSQL;
  assert.ok(psqlPath && isAbsolute(psqlPath), 'SCROLITH_PSQL must point to an explicit local psql executable');
  await access(psqlPath);
  const evidenceRoot = resolve(process.env.SCROLITH_INSPECTOR_EVIDENCE_DIR || '');
  assert.ok(process.env.SCROLITH_INSPECTOR_EVIDENCE_DIR, 'set an evidence directory outside the worktree');
  const evidenceRelative = relative(repositoryRoot, evidenceRoot);
  assert.ok(evidenceRelative === '..' || evidenceRelative.startsWith('..' + sep) || isAbsolute(evidenceRelative),
    'evidence must remain outside the repository worktree');
  await mkdir(evidenceRoot, { recursive: true });

  const tempRoot = await mkdtemp(resolve(os.tmpdir(), 'scrolith-inspector-pg17-'));
  const passfile = resolve(tempRoot, 'intentionally-absent-passfile');
  const fixturePath = resolve(tempRoot, 'synthetic-fixture.sql');
  await writeFile(fixturePath, testFixtureSql, { encoding: 'utf8', flag: 'wx' });
  const steps = [];
  const summary = {
    postgresMajor: 17,
    database: 'scrolith',
    transport: 'TLS verify-full over localhost loopback',
    syntheticOnly: true,
    reportContainsApplicationRows: false,
    steps
  };
  let rolesCreated = false;
  let databaseCreated = false;
  let nonownerRoleCreated = false;
  let inspectorCleaned = false;
  let databaseCleaned = false;
  const maintenanceEnv = onlySafeEnvironment('synthetic_inspector_admin', 'postgres', passfile);
  const dbEnv = onlySafeEnvironment('synthetic_inspector_admin', 'scrolith', passfile);

  try {
    const startup = runPsql(psqlPath, ['-c', "SELECT current_setting('server_version_num') || '|' || current_user"], maintenanceEnv,
      'verify local PostgreSQL 17 and synthetic administrator', false, steps).trim();
    assert.match(startup, /^17\d{4}\|synthetic_inspector_admin$/);
    const safeStart = runPsql(psqlPath, ['-c', "SELECT (current_user='synthetic_inspector_admin' AND current_database()='postgres' AND (SELECT rolsuper=false AND rolcreatedb AND rolcreaterole FROM pg_roles WHERE rolname=current_user))::text"], maintenanceEnv,
      'verify non-superuser disposable administrator capabilities', false, steps).trim();
    assert.equal(safeStart, 'true');

    const preexisting = runPsql(psqlPath, ['-c', "SELECT (EXISTS (SELECT 1 FROM pg_database WHERE datname='scrolith'))::text || '|' || COALESCE((SELECT string_agg(rolname, ',' ORDER BY rolname) FROM pg_roles WHERE rolname = ANY(ARRAY['scrolith_inspector','scrolith_runtime','scrolith_migrator','scrolith_backup'])), '')"], maintenanceEnv,
      'verify the fixed-name database and test roles are absent before fixture creation', false, steps).trim();
    assert.equal(preexisting, 'false|', 'refuse to overwrite an existing database or role');

    runPsql(psqlPath, ['-c', 'BEGIN; CREATE ROLE scrolith_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS; CREATE ROLE scrolith_migrator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS; CREATE ROLE scrolith_backup NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS; COMMIT;'], maintenanceEnv,
      'create disposable Scrolith roles', false, steps);
    rolesCreated = true;
    runPsql(psqlPath, ['-c', 'CREATE DATABASE scrolith OWNER synthetic_inspector_admin;'], maintenanceEnv,
      'create disposable scrolith database', false, steps);
    databaseCreated = true;
    runPsql(psqlPath, ['-c', 'REVOKE CONNECT, TEMPORARY ON DATABASE scrolith FROM PUBLIC;'], maintenanceEnv,
      'model initialized production database PUBLIC ACL policy', false, steps);
    runPsql(psqlPath, ['-f', fixturePath], dbEnv,
      'create synthetic marker, migration ledger, User ACL fixture, and sentinel row', false, steps);

    const targetConfig = [
      '-v', 'SCROLITH_PRODUCTION_CHANGE_APPROVED=true',
      '-v', 'expected_server_fqdn=' + approvedGuardFqdn,
      '-v', 'expected_source_commit=' + syntheticReleaseSha
    ];
    runPsql(psqlPath, ['-c', 'GRANT TEMPORARY ON DATABASE scrolith TO PUBLIC;'], maintenanceEnv,
      'introduce temporary PUBLIC privilege drift in disposable database', false, steps);
    const publicTempAttempt = runPsql(psqlPath, [...targetConfig, '-f', resolve(postgresRoot, 'scrolith-production-inspector-role-setup.sql')], dbEnv,
      'prove setup rejects PUBLIC TEMP privilege before role creation', true, steps);
    assert.doesNotMatch(publicTempAttempt, /INSPECTION_SENTINEL_PRIVATE_ROW/);
    const afterPublicDrift = runPsql(psqlPath, ['-c', "SELECT (SELECT count(*)=0 FROM pg_roles WHERE rolname='scrolith_inspector')::text"], maintenanceEnv,
      'verify PUBLIC drift rejection created no partial inspector role', false, steps).trim();
    assert.equal(afterPublicDrift, 'true');
    runPsql(psqlPath, ['-c', 'REVOKE TEMPORARY ON DATABASE scrolith FROM PUBLIC;'], maintenanceEnv,
      'restore the synthetic database ACL after negative test', false, steps);

    runPsql(psqlPath, ['-c', "CREATE FUNCTION public.synthetic_inspector_definer_probe() RETURNS integer LANGUAGE sql SECURITY DEFINER AS 'SELECT 1';"], dbEnv,
      'create a disposable SECURITY DEFINER function with PostgreSQL default PUBLIC EXECUTE', false, steps);
    const definerAttempt = runPsql(psqlPath, [...targetConfig, '-f', resolve(postgresRoot, 'scrolith-production-inspector-role-setup.sql')], dbEnv,
      'prove setup rejects PUBLIC-executable SECURITY DEFINER functions', true, steps);
    assert.doesNotMatch(definerAttempt, /INSPECTION_SENTINEL_PRIVATE_ROW/);
    const afterDefinerDrift = runPsql(psqlPath, ['-c', "SELECT (SELECT count(*)=0 FROM pg_roles WHERE rolname='scrolith_inspector')::text"], maintenanceEnv,
      'verify SECURITY DEFINER drift rejection created no role', false, steps).trim();
    assert.equal(afterDefinerDrift, 'true');
    runPsql(psqlPath, ['-c', 'DROP FUNCTION public.synthetic_inspector_definer_probe();'], dbEnv,
      'remove only the synthetic SECURITY DEFINER probe', false, steps);

    runPsql(psqlPath, ['-c', 'CREATE SEQUENCE public.synthetic_inspector_public_sequence; GRANT USAGE ON SEQUENCE public.synthetic_inspector_public_sequence TO PUBLIC;'], dbEnv,
      'create a disposable public sequence privilege drift', false, steps);
    const sequenceAttempt = runPsql(psqlPath, [...targetConfig, '-f', resolve(postgresRoot, 'scrolith-production-inspector-role-setup.sql')], dbEnv,
      'prove setup rejects PUBLIC sequence privileges', true, steps);
    assert.doesNotMatch(sequenceAttempt, /INSPECTION_SENTINEL_PRIVATE_ROW/);
    const afterSequenceDrift = runPsql(psqlPath, ['-c', "SELECT (SELECT count(*)=0 FROM pg_roles WHERE rolname='scrolith_inspector')::text"], maintenanceEnv,
      'verify sequence drift rejection created no role', false, steps).trim();
    assert.equal(afterSequenceDrift, 'true');
    runPsql(psqlPath, ['-c', 'REVOKE USAGE ON SEQUENCE public.synthetic_inspector_public_sequence FROM PUBLIC; DROP SEQUENCE public.synthetic_inspector_public_sequence;'], dbEnv,
      'remove only the synthetic public-sequence drift', false, steps);

    runPsql(psqlPath, ['-c', 'BEGIN; CREATE ROLE synthetic_inspector_nonowner LOGIN CREATEROLE NOSUPERUSER NOCREATEDB NOINHERIT NOREPLICATION NOBYPASSRLS; GRANT CONNECT ON DATABASE scrolith TO synthetic_inspector_nonowner; COMMIT;'], maintenanceEnv,
      'create a disposable non-owner CREATEROLE actor', false, steps);
    nonownerRoleCreated = true;
    const nonownerEnv = onlySafeEnvironment('synthetic_inspector_nonowner', 'scrolith', passfile);
    runPsql(psqlPath, [...targetConfig, '-f', resolve(postgresRoot, 'scrolith-production-inspector-role-setup.sql')], nonownerEnv,
      'prove CREATEROLE without database/object grant authority cannot leave a partial role', true, steps);
    const afterGrantFailure = runPsql(psqlPath, ['-c', "SELECT (SELECT count(*)=0 FROM pg_roles WHERE rolname='scrolith_inspector')::text"], maintenanceEnv,
      'verify transactional setup failure rolled back CREATE ROLE', false, steps).trim();
    assert.equal(afterGrantFailure, 'true');
    runPsql(psqlPath, ['-c', 'REVOKE CONNECT ON DATABASE scrolith FROM synthetic_inspector_nonowner;'], maintenanceEnv,
      'remove only the test role database-connect grant', false, steps);
    runPsql(psqlPath, ['-c', 'DROP ROLE synthetic_inspector_nonowner;'], maintenanceEnv,
      'remove only the synthetic non-owner CREATEROLE test role', false, steps);
    nonownerRoleCreated = false;

    runPsql(psqlPath, [...targetConfig, '-f', resolve(postgresRoot, 'scrolith-production-inspector-role-setup.sql')], dbEnv,
      'create the NOLOGIN inspector with exact column grants', false, steps);
    const noLogin = runPsql(psqlPath, ['-c', "SELECT (rolcanlogin=false AND rolsuper=false AND rolcreatedb=false AND rolcreaterole=false AND rolinherit=false AND rolbypassrls=false)::text FROM pg_roles WHERE rolname='scrolith_inspector'"], maintenanceEnv,
      'assert inspector remains NOLOGIN after setup', false, steps).trim();
    assert.equal(noLogin, 'true');

    runPsql(psqlPath, ['-c', "CREATE FUNCTION public.synthetic_inspector_definer_probe() RETURNS integer LANGUAGE sql SECURITY DEFINER AS 'SELECT 1';"], dbEnv,
      'inject SECURITY DEFINER drift after role setup', false, steps);
    runPsql(psqlPath, [...targetConfig, '-f', resolve(postgresRoot, 'scrolith-production-inspector-role-enable.sql')], dbEnv,
      'prove LOGIN handoff refuses PUBLIC-executable SECURITY DEFINER drift', true, steps);
    const noLoginAfterDefiner = runPsql(psqlPath, ['-c', "SELECT (rolcanlogin=false)::text FROM pg_roles WHERE rolname='scrolith_inspector'"], maintenanceEnv,
      'verify SECURITY DEFINER rejection leaves LOGIN disabled', false, steps).trim();
    assert.equal(noLoginAfterDefiner, 'true');
    runPsql(psqlPath, ['-c', 'DROP FUNCTION public.synthetic_inspector_definer_probe();'], dbEnv,
      'remove only the synthetic SECURITY DEFINER drift', false, steps);

    runPsql(psqlPath, ['-c', 'CREATE SEQUENCE public.synthetic_inspector_public_sequence; GRANT USAGE ON SEQUENCE public.synthetic_inspector_public_sequence TO PUBLIC;'], dbEnv,
      'inject public sequence drift after role setup', false, steps);
    runPsql(psqlPath, [...targetConfig, '-f', resolve(postgresRoot, 'scrolith-production-inspector-role-enable.sql')], dbEnv,
      'prove LOGIN handoff refuses PUBLIC sequence privileges', true, steps);
    const noLoginAfterSequence = runPsql(psqlPath, ['-c', "SELECT (rolcanlogin=false)::text FROM pg_roles WHERE rolname='scrolith_inspector'"], maintenanceEnv,
      'verify sequence rejection leaves LOGIN disabled', false, steps).trim();
    assert.equal(noLoginAfterSequence, 'true');
    runPsql(psqlPath, ['-c', 'REVOKE USAGE ON SEQUENCE public.synthetic_inspector_public_sequence FROM PUBLIC; DROP SEQUENCE public.synthetic_inspector_public_sequence;'], dbEnv,
      'remove only the synthetic public-sequence drift before normal enablement', false, steps);

    runPsql(psqlPath, ['-c', 'GRANT SELECT ("privateNote") ON TABLE public."User" TO scrolith_inspector;'], dbEnv,
      'inject column-level application data ACL drift in disposable fixture', false, steps);
    runPsql(psqlPath, [...targetConfig, '-f', resolve(postgresRoot, 'scrolith-production-inspector-role-enable.sql')], dbEnv,
      'prove login handoff refuses unapproved column-level User access', true, steps);
    const stillNoLogin = runPsql(psqlPath, ['-c', "SELECT (rolcanlogin=false)::text FROM pg_roles WHERE rolname='scrolith_inspector'"], maintenanceEnv,
      'verify failed enable remains NOLOGIN', false, steps).trim();
    assert.equal(stillNoLogin, 'true');
    runPsql(psqlPath, ['-c', 'REVOKE SELECT ("privateNote") ON TABLE public."User" FROM scrolith_inspector;'], dbEnv,
      'remove only the synthetic column ACL drift', false, steps);

    runPsql(psqlPath, [...targetConfig, '-f', resolve(postgresRoot, 'scrolith-production-inspector-role-enable.sql')], dbEnv,
      'enable inspector LOGIN after exact ACL assertions', false, steps);
    const effective = runPsql(psqlPath, ['-c', "SELECT has_database_privilege('scrolith_inspector','scrolith','CONNECT')::text || '|' || has_database_privilege('scrolith_inspector','scrolith','CREATE')::text || '|' || has_database_privilege('scrolith_inspector','scrolith','TEMPORARY')::text || '|' || has_schema_privilege('scrolith_inspector','public','USAGE')::text || '|' || has_schema_privilege('scrolith_inspector','public','CREATE')::text || '|' || has_table_privilege('scrolith_inspector','public.\"User\"','SELECT')::text || '|' || has_table_privilege('scrolith_inspector','public.\"User\"','UPDATE')::text || '|' || has_column_privilege('scrolith_inspector','public.\"User\"','privateNote','SELECT')::text"], maintenanceEnv,
      'assert effective inspector privilege boundary', false, steps, { env: dbEnv }).trim();
    assert.equal(effective, 'true|false|false|true|false|false|false|false');
    const noFunctionOrSequencePrivilege = runPsql(psqlPath, ['-c', "SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef AND has_function_privilege('scrolith_inspector',p.oid,'EXECUTE'))::text || '|' || EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND CASE WHEN c.relkind='S' THEN has_sequence_privilege('scrolith_inspector',c.oid,'USAGE,SELECT,UPDATE') ELSE false END)::text"], maintenanceEnv,
      'assert no inherited SECURITY DEFINER execution or sequence access', false, steps).trim();
    assert.equal(noFunctionOrSequencePrivilege, 'false|false');

    const inspectorEnv = onlySafeEnvironment('scrolith_inspector', 'scrolith', passfile);
    const report = runPsql(psqlPath, ['-f', resolve(postgresRoot, 'scrolith-production-user-language-preferences-inspect.sql')], inspectorEnv,
      'execute the checked-in read-only inspection report as a direct TLS inspector login', false, steps);
    assert.match(report, /scrolith_inspector[\s\S]*\|\s*t\s*\|/);
    assert.match(report, /143/);
    assert.match(report, /understoodLanguages/);
    assert.ok(!report.includes(syntheticUserSentinel), 'report must never contain the synthetic application-row sentinel');
    await writeFile(resolve(evidenceRoot, 'inspection-report-local.txt'), report, { encoding: 'utf8' });

    runPsql(psqlPath, ['-c', "CREATE FUNCTION public.synthetic_inspector_definer_probe() RETURNS integer LANGUAGE sql SECURITY DEFINER AS 'SELECT 1';"], dbEnv,
      'inject SECURITY DEFINER drift before cleanup', false, steps);
    runPsql(psqlPath, [...targetConfig, '-f', resolve(postgresRoot, 'scrolith-production-inspector-role-cleanup.sql')], dbEnv,
      'prove cleanup refuses PUBLIC-executable SECURITY DEFINER drift', true, steps);
    const unchangedAfterDefinerCleanupRejection = runPsql(psqlPath, ['-c', "SELECT rolcanlogin::text || '|' || has_function_privilege('scrolith_inspector','public.synthetic_inspector_definer_probe()','EXECUTE')::text FROM pg_roles WHERE rolname='scrolith_inspector'"], dbEnv,
      'verify SECURITY DEFINER cleanup refusal leaves role unchanged', false, steps).trim();
    assert.equal(unchangedAfterDefinerCleanupRejection, 'true|true');
    runPsql(psqlPath, ['-c', 'DROP FUNCTION public.synthetic_inspector_definer_probe();'], dbEnv,
      'remove the synthetic SECURITY DEFINER drift before subsequent cleanup tests', false, steps);

    runPsql(psqlPath, ['-c', 'CREATE SEQUENCE public.synthetic_inspector_public_sequence; GRANT USAGE ON SEQUENCE public.synthetic_inspector_public_sequence TO PUBLIC;'], dbEnv,
      'inject sequence drift before cleanup', false, steps);
    runPsql(psqlPath, [...targetConfig, '-f', resolve(postgresRoot, 'scrolith-production-inspector-role-cleanup.sql')], dbEnv,
      'prove cleanup refuses PUBLIC sequence privileges', true, steps);
    const unchangedAfterSequenceCleanupRejection = runPsql(psqlPath, ['-c', "SELECT rolcanlogin::text || '|' || has_sequence_privilege('scrolith_inspector','public.synthetic_inspector_public_sequence','USAGE')::text FROM pg_roles WHERE rolname='scrolith_inspector'"], dbEnv,
      'verify sequence cleanup refusal leaves role unchanged', false, steps).trim();
    assert.equal(unchangedAfterSequenceCleanupRejection, 'true|true');
    runPsql(psqlPath, ['-c', 'REVOKE USAGE ON SEQUENCE public.synthetic_inspector_public_sequence FROM PUBLIC; DROP SEQUENCE public.synthetic_inspector_public_sequence;'], dbEnv,
      'remove the synthetic public-sequence drift before subsequent cleanup tests', false, steps);

    const denied = [
      ['deny User application-row read', 'SELECT email FROM public."User" LIMIT 1;'],
      ['deny User private-column read', 'SELECT "privateNote" FROM public."User" LIMIT 1;'],
      ['deny unapproved Prisma ledger column', 'SELECT logs FROM public."_prisma_migrations" LIMIT 1;'],
      ['deny marker update', 'BEGIN; UPDATE public.scrolith_runtime_policy_state SET finalized=false; ROLLBACK;'],
      ['deny ledger insert', "BEGIN; INSERT INTO public.\"_prisma_migrations\" (id,checksum,migration_name,started_at,applied_steps_count) VALUES ('x',repeat('b',64),'x',now(),1); ROLLBACK;"],
      ['deny ledger delete', 'BEGIN; DELETE FROM public."_prisma_migrations"; ROLLBACK;'],
      ['deny persistent DDL', 'BEGIN; CREATE TABLE public.inspector_probe(id integer); ROLLBACK;'],
      ['deny temporary-table creation', 'BEGIN; CREATE TEMP TABLE inspector_probe(id integer); ROLLBACK;']
    ];
    for (const [label, sql] of denied) {
      runPsql(psqlPath, ['-c', sql], inspectorEnv, label, true, steps);
    }
    runPsql(psqlPath, ['-c', 'SELECT singleton, source_commit, migration_count, last_migration, ownership_verified, finalized, finalized_at, bootstrap_admin_role FROM public.scrolith_runtime_policy_state; SELECT migration_name, finished_at, rolled_back_at FROM public."_prisma_migrations" LIMIT 1;'], inspectorEnv,
      'allow only reviewed marker and migration metadata columns', false, steps);

    runPsql(psqlPath, ['-c', 'GRANT SELECT ("privateNote") ON TABLE public."User" TO scrolith_inspector;'], dbEnv,
      'inject column-level ACL drift before cleanup', false, steps);
    runPsql(psqlPath, [...targetConfig, '-f', resolve(postgresRoot, 'scrolith-production-inspector-role-cleanup.sql')], dbEnv,
      'prove cleanup refuses application-column ACL drift', true, steps);
    const unchangedAfterCleanupRejection = runPsql(psqlPath, ['-c', "SELECT rolcanlogin::text || '|' || has_column_privilege('scrolith_inspector','public.\"User\"','privateNote','SELECT')::text FROM pg_roles WHERE rolname='scrolith_inspector'"], dbEnv,
      'verify failed cleanup made no partial changes', false, steps).trim();
    assert.equal(unchangedAfterCleanupRejection, 'true|true');
    runPsql(psqlPath, ['-c', 'REVOKE SELECT ("privateNote") ON TABLE public."User" FROM scrolith_inspector;'], dbEnv,
      'remove the synthetic column ACL drift before cleanup', false, steps);
    runPsql(psqlPath, [...targetConfig, '-f', resolve(postgresRoot, 'scrolith-production-inspector-role-cleanup.sql')], dbEnv,
      'run guarded exact-grant inspector cleanup after closing inspector sessions', false, steps);
    inspectorCleaned = true;
    const absent = runPsql(psqlPath, ['-c', "SELECT (count(*)=0)::text FROM pg_roles WHERE rolname='scrolith_inspector'"], maintenanceEnv,
      'verify inspector role and login are removed', false, steps).trim();
    assert.equal(absent, 'true');
  } finally {
    if (databaseCreated) {
      runPsql(psqlPath, ['-c', 'DROP DATABASE scrolith WITH (FORCE);'], maintenanceEnv,
        'remove the task-owned disposable synthetic database', false, steps);
      databaseCleaned = true;
      databaseCreated = false;
    }
    const dropNames = [];
    if (nonownerRoleCreated) dropNames.push('synthetic_inspector_nonowner');
    if (rolesCreated) dropNames.push(...ownedRoles);
    if (dropNames.length) {
      runPsql(psqlPath, ['-c', 'DROP ROLE IF EXISTS ' + dropNames.join(',') + ';'], maintenanceEnv,
        'remove only roles created by this task-owned harness', false, steps);
    }
    summary.inspectorCleaned = inspectorCleaned;
    summary.cleanupCompleted = databaseCleaned;
    await writeFile(resolve(evidenceRoot, 'inspector-pg17-summary.json'), JSON.stringify(summary, null, 2) + '\n', { encoding: 'utf8' });
    await rm(tempRoot, { recursive: true, force: true });
  }
});
