import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// Disposable-DB regression for the separate runtime enable gate. Run after the
// role bootstrap and before finalization, with explicit approval and a dedicated
// scrolith_*test/e2e database. This test never writes application data.
const rawDatabaseUrl = process.env.DATABASE_URL;
const approved = process.env.SCROLITH_ROLE_SETUP_APPROVED === 'true';
let databaseUrl;
try {
  databaseUrl = rawDatabaseUrl ? new URL(rawDatabaseUrl) : null;
} catch {
  databaseUrl = null;
}

const host = databaseUrl?.hostname.replace(/^\[|\]$/g, '').toLowerCase();
const databaseName = databaseUrl?.pathname.replace(/^\/+/, '');
const username = databaseUrl?.username ? decodeURIComponent(databaseUrl.username) : '';
const dockerContainer = process.env.SCROLITH_ROLE_TEST_DOCKER_CONTAINER?.trim();
const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
const dedicatedTestName = /^scrolith[-_][a-z0-9_-]*(?:test|e2e)[a-z0-9_-]*$/i;
const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const enableSql = resolve(backendRoot, 'deploy', 'postgres', 'scrolith-runtime-enable.sql');

const stateQuery = `
SELECT CASE
  WHEN current_user NOT IN ('scrolith_runtime', 'scrolith_migrator')
   AND NOT (SELECT rolcanlogin FROM pg_roles WHERE rolname = 'scrolith_runtime')
   AND EXISTS (
     SELECT 1 FROM public.scrolith_runtime_policy_state
      WHERE singleton AND NOT finalized AND finalized_at IS NULL
   )
  THEN 'safe-before-enable'
  ELSE 'unsafe-before-enable'
END || '|' || (
  SELECT COUNT(*)::text FROM pg_stat_activity WHERE usename = 'scrolith_runtime'
);
`;

function runPsql(args) {
  const env = { ...process.env, PGSSLMODE: 'disable' };
  if (databaseUrl?.password) env.PGPASSWORD = decodeURIComponent(databaseUrl.password);
  else delete env.PGPASSWORD;

  const psqlArgs = ['-X', '-v', 'ON_ERROR_STOP=1'];
  if (!dockerContainer) psqlArgs.push('-h', host, '-p', databaseUrl?.port || '5432');
  psqlArgs.push('-U', username, '-d', databaseName, ...args);

  if (dockerContainer) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(dockerContainer)) {
      throw new Error('SCROLITH_ROLE_TEST_DOCKER_CONTAINER must be a simple container name or ID');
    }
    const dockerArgs = ['exec', '-i', '-e', 'PGSSLMODE=disable'];
    if (env.PGPASSWORD) dockerArgs.push('-e', 'PGPASSWORD');
    const dockerPsqlArgs = [...psqlArgs];
    let input;
    const fileArgument = dockerPsqlArgs.indexOf('-f');
    if (fileArgument !== -1 && dockerPsqlArgs[fileArgument + 1]) {
      input = readFileSync(dockerPsqlArgs[fileArgument + 1], 'utf8');
      dockerPsqlArgs[fileArgument + 1] = '-';
    }
    dockerArgs.push(dockerContainer, 'psql', ...dockerPsqlArgs);
    return spawnSync('docker', dockerArgs, {
      encoding: 'utf8', env, input, timeout: 30_000, windowsHide: true,
    });
  }

  return spawnSync(process.env.PSQL_BIN || 'psql', psqlArgs, {
    encoding: 'utf8', env, timeout: 30_000, windowsHide: true,
  });
}

test('enable guard exits nonzero and preserves NOLOGIN until finalization', () => {
  assert.equal(approved, true, 'set SCROLITH_ROLE_SETUP_APPROVED=true for this disposable test only');
  assert.ok(databaseUrl, 'DATABASE_URL must be a valid PostgreSQL URL');
  assert.ok(['postgres:', 'postgresql:'].includes(databaseUrl.protocol), 'DATABASE_URL must use PostgreSQL');
  assert.ok(localHosts.has(host), 'DATABASE_URL host must be loopback');
  assert.ok(dedicatedTestName.test(databaseName), 'database name must be dedicated scrolith_*test/e2e');
  assert.ok(username, 'DATABASE_URL must include a database administrator username');
  if (process.env.SCROLITH_ROLE_TEST_DOCKER_CONTAINER) {
    assert.ok(dockerContainer, 'Docker container selector must not be empty');
  }

  const before = runPsql(['-qAt', '-c', stateQuery]);
  assert.equal(before.error, undefined, 'psql precondition query must start successfully');
  assert.equal(before.status, 0, 'psql precondition query must succeed');
  assert.equal(before.stdout.trim(), 'safe-before-enable|0', 'runtime must be NOLOGIN, unfinalized, and session-free');

  const unapproved = runPsql([
    '-v', `database_name=${databaseName}`,
    '-f', enableSql,
  ]);
  assert.equal(unapproved.error, undefined, 'unapproved psql invocation must start successfully');
  assert.notEqual(unapproved.status, 0, 'missing explicit approval must return nonzero');
  assert.match(unapproved.stderr, /explicit disposable-database approval is required/i);

  const afterUnapproved = runPsql(['-qAt', '-c', stateQuery]);
  assert.equal(afterUnapproved.error, undefined, 'psql state query after unapproved attempt must start');
  assert.equal(afterUnapproved.status, 0, 'psql state query after unapproved attempt must succeed');
  assert.equal(afterUnapproved.stdout.trim(), 'safe-before-enable|0', 'unapproved attempt must not change runtime state');

  const rejected = runPsql([
    '-v', 'SCROLITH_ROLE_SETUP_APPROVED=true',
    '-v', `database_name=${databaseName}`,
    '-f', enableSql,
  ]);
  assert.equal(rejected.error, undefined, 'psql enable invocation must start successfully');
  assert.notEqual(rejected.status, 0, 'a rejected enable attempt must return a nonzero process status');
  assert.match(rejected.stderr, /runtime policy finalizer has not completed/i);

  const after = runPsql(['-qAt', '-c', stateQuery]);
  assert.equal(after.error, undefined, 'psql postcondition query must start successfully');
  assert.equal(after.status, 0, 'psql postcondition query must succeed');
  assert.equal(after.stdout.trim(), 'safe-before-enable|0', 'failed enable must leave runtime NOLOGIN and session-free');
});
