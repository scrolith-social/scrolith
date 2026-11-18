import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const finalMigration = '20261116120000_add_durable_auth_sessions';
const safeNamePrefix = 'scrolith_auth_upgrade_test_';
const dbName = `${safeNamePrefix}${randomUUID().replaceAll('-', '').slice(0, 12)}`;
const sensitiveUrl = /(?:postgres|postgresql):\/\/[^\s"'`]+/gi;
let admin;
let target;
let createdDatabase = false;
let rolesCreated = false;
let tempRoot;
const roleSqlRoot = resolve(repoRoot, '..', 'deploy', 'postgres');

function parseLoopbackPostgresUrl(value, expectedDatabase, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} is missing or invalid.`);
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const database = parsed.pathname.replace(/^\/+/, '');
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    !['localhost', '127.0.0.1', '::1'].includes(host) ||
    Number(parsed.port || 5432) !== 5432 ||
    (expectedDatabase && database !== expectedDatabase)
  ) {
    throw new Error(`${label} must refer to the task's loopback PostgreSQL service and expected database.`);
  }
  return parsed;
}

function runPrisma(cliPath, configPath, cwd, env, migrationLabel) {
  const result = spawnSync(process.execPath, [cliPath, 'migrate', 'deploy', '--config', configPath], {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 15 * 60 * 1000,
    maxBuffer: 8 * 1024 * 1024,
    shell: false
  });
  if (result.error || result.status !== 0) {
    const output = `${result.stdout || ''}${result.stderr || ''}`.replace(sensitiveUrl, '[DATABASE URL REDACTED]');
    if (output.trim()) console.error(output.trim());
    throw new Error(`${migrationLabel} migration deploy failed with exit ${result.status ?? 'unknown'}.`);
  }
  console.log(`${migrationLabel} migration deploy passed.`);
}

function redactOutput(value) {
  return String(value || '')
    .replace(sensitiveUrl, '[DATABASE URL REDACTED]')
    .replace(/\b(?:sk_live_|sk_test_|rk_live_|whsec_)[A-Za-z0-9_-]+/gi, '[PROVIDER TEST VALUE REDACTED]');
}

function runPsql(connectionUrl, args, label) {
  const parsed = new URL(connectionUrl);
  const psqlEnv = { ...process.env, PGSSLMODE: 'disable' };
  psqlEnv.PGHOST = parsed.hostname.replace(/^\[|\]$/g, '');
  psqlEnv.PGPORT = parsed.port || '5432';
  psqlEnv.PGUSER = decodeURIComponent(parsed.username);
  psqlEnv.PGDATABASE = parsed.pathname.replace(/^\/+/, '');
  if (parsed.password) psqlEnv.PGPASSWORD = decodeURIComponent(parsed.password);
  else delete psqlEnv.PGPASSWORD;

  const result = spawnSync(process.env.PSQL_BIN || 'psql', ['-X', '-v', 'ON_ERROR_STOP=1', ...args], {
    cwd: repoRoot,
    env: psqlEnv,
    encoding: 'utf8',
    timeout: 5 * 60 * 1000,
    maxBuffer: 8 * 1024 * 1024,
    shell: false,
    windowsHide: true
  });
  if (result.error || result.status !== 0) {
    const output = redactOutput(`${result.stdout || ''}${result.stderr || ''}`);
    if (output.trim()) console.error(output.trim());
    throw new Error(`${label} failed with exit ${result.status ?? 'unknown'}.`);
  }
  console.log(`${label} passed.`);
}

function runExpectedPsqlFailure(connectionUrl, args, label, expectedMessage) {
  const parsed = new URL(connectionUrl);
  const psqlEnv = { ...process.env, PGSSLMODE: 'disable' };
  psqlEnv.PGHOST = parsed.hostname.replace(/^\[|\]$/g, '');
  psqlEnv.PGPORT = parsed.port || '5432';
  psqlEnv.PGUSER = decodeURIComponent(parsed.username);
  psqlEnv.PGDATABASE = parsed.pathname.replace(/^\/+/, '');
  if (parsed.password) psqlEnv.PGPASSWORD = decodeURIComponent(parsed.password);
  else delete psqlEnv.PGPASSWORD;

  const result = spawnSync(process.env.PSQL_BIN || 'psql', ['-X', '-v', 'ON_ERROR_STOP=1', ...args], {
    cwd: repoRoot,
    env: psqlEnv,
    encoding: 'utf8',
    timeout: 5 * 60 * 1000,
    maxBuffer: 8 * 1024 * 1024,
    shell: false,
    windowsHide: true
  });
  const output = redactOutput(`${result.stdout || ''}${result.stderr || ''}`);
  if (result.error || result.status === 0 || !output.includes(expectedMessage)) {
    if (output.trim()) console.error(output.trim());
    throw new Error(`${label} did not fail with its expected synthetic error (exit ${result.status ?? 'unknown'}).`);
  }
  console.log(`${label} failed safely as expected (exit ${result.status}): ${expectedMessage}.`);
}

async function readRolePolicyState(connectionUrl) {
  const client = new pg.Client({ connectionString: connectionUrl, connectionTimeoutMillis: 10_000 });
  await client.connect();
  try {
    const result = await client.query(`
      SELECT r.rolcanlogin,
             s.finalized,
             s.finalized_at IS NULL AS finalized_at_is_null,
             has_table_privilege('scrolith_runtime', 'public."Transaction"', 'UPDATE') AS transaction_table_update,
             (SELECT COUNT(*)::int FROM pg_stat_activity WHERE usename = 'scrolith_runtime') AS runtime_sessions
        FROM pg_catalog.pg_roles r
        CROSS JOIN public.scrolith_runtime_policy_state s
       WHERE r.rolname = 'scrolith_runtime' AND s.singleton
    `);
    if (result.rowCount !== 1) throw new Error('Could not read the disposable runtime-role policy state.');
    return result.rows[0];
  } finally {
    await client.end();
  }
}

function runNode(args, cwd, env, label, timeout = 5 * 60 * 1000) {
  const result = spawnSync(process.execPath, args, {
    cwd,
    env,
    encoding: 'utf8',
    timeout,
    maxBuffer: 16 * 1024 * 1024,
    shell: false,
    windowsHide: true
  });
  const output = redactOutput(`${result.stdout || ''}${result.stderr || ''}`);
  if (result.error || result.status !== 0) {
    if (output.trim()) console.error(output.trim());
    throw new Error(`${label} failed with exit ${result.status ?? 'unknown'}.`);
  }
  const summary = output.trim().split(/\r?\n/).filter(Boolean).slice(-8).join('\n');
  if (summary) console.log(summary);
  console.log(`${label} passed.`);
}

try {
  if (
    process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.CI !== 'true' ||
    process.env.NODE_ENV !== 'test' ||
    process.env.APP_RUNTIME !== 'test' ||
    process.env.DISABLE_BACKGROUND_WORKERS !== 'true' ||
    process.env.TEST_DB_KIND !== 'local-disposable' ||
    process.env.TEST_DB_PROJECT !== 'local-only' ||
    process.env.TEST_DB_INSTANCE !== 'local-disposable-postgres-test'
  ) {
    throw new Error('Refusing migration/role validation outside the explicitly marked disposable GitHub Actions test job.');
  }

  const templateUrl = parseLoopbackPostgresUrl(process.env.DATABASE_URL, process.env.TEST_DB_NAME, 'DATABASE_URL');
  const adminUrl = parseLoopbackPostgresUrl(process.env.PG_ADMIN_URL, 'postgres', 'PG_ADMIN_URL');
  if (adminUrl.username !== templateUrl.username) {
    throw new Error('The disposable test database bootstrap and migration roles must be the same CI-only account.');
  }
  const migrationsRoot = resolve(repoRoot, 'prisma', 'migrations');
  const migrationDirs = (await readdir(migrationsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  if (migrationDirs.length !== 143 || migrationDirs[141] !== finalMigration) {
    throw new Error('Expected the reviewed 141-to-142 upgrade plus additive media outbox migration.');
  }

  const tempBase = await mkdtemp(join(repoRoot, '.tmp-auth-session-upgrade-'));
  tempRoot = tempBase;
  const prismaRoot = join(tempRoot, 'prisma');
  const tempMigrations = join(prismaRoot, 'migrations');
  await mkdir(tempMigrations, { recursive: true });
  await cp(resolve(repoRoot, 'prisma', 'schema.prisma'), join(prismaRoot, 'schema.prisma'));
  await cp(resolve(repoRoot, 'prisma', 'migrations', 'migration_lock.toml'), join(tempMigrations, 'migration_lock.toml'));
  for (const migration of migrationDirs.slice(0, 141)) {
    await cp(resolve(migrationsRoot, migration), join(tempMigrations, migration), { recursive: true });
  }
  const configPath = join(tempRoot, 'prisma.config.ts');
  await cp(resolve(repoRoot, 'prisma.config.ts'), configPath);

  admin = new pg.Client({ connectionString: adminUrl.toString(), connectionTimeoutMillis: 10_000 });
  await admin.connect();
  const existingRoles = await admin.query(
    "SELECT rolname FROM pg_catalog.pg_roles WHERE rolname IN ('scrolith_runtime', 'scrolith_migrator')"
  );
  if (existingRoles.rowCount !== 0) {
    throw new Error('Disposable PostgreSQL service unexpectedly contains Scrolith runtime/migrator roles.');
  }
  const existing = await admin.query('SELECT 1 FROM pg_catalog.pg_database WHERE datname = $1', [dbName]);
  if (existing.rowCount !== 0) throw new Error('Generated disposable database name unexpectedly exists.');
  await admin.query(`CREATE DATABASE "${dbName}"`);
  createdDatabase = true;
  rolesCreated = true;

  const targetUrl = new URL(templateUrl);
  targetUrl.pathname = `/${dbName}`;
  process.env.DATABASE_URL = targetUrl.toString();
  process.env.TEST_DB_NAME = dbName;
  process.env.TEST_DB_PORT = '5432';
  await import('./test-db-guard.mjs');

  const cliPath = resolve(repoRoot, 'node_modules', 'prisma', 'build', 'index.js');
  const migrationEnv = { ...process.env, DATABASE_URL: targetUrl.toString() };
  delete migrationEnv.SHADOW_DATABASE_URL;
  runPrisma(cliPath, configPath, tempRoot, migrationEnv, '141-migration');

  target = new pg.Client({ connectionString: targetUrl.toString(), connectionTimeoutMillis: 10_000 });
  await target.connect();
  const applied141 = await target.query(
    'SELECT COUNT(*)::int AS count FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL'
  );
  if (applied141.rows[0]?.count !== 141) throw new Error('Disposable schema did not reach migration 141.');

  const userId = `auth-upgrade-user-${dbName.slice(-12)}`;
  const now = new Date();
  await target.query(
    'INSERT INTO "User" ("id", "email", "createdAt", "updatedAt") VALUES ($1, $2, $3, $3)',
    [userId, `${userId}@example.invalid`, now]
  );

  const approvals = [
    { id: 'pending', status: 'PENDING', consumedAt: null },
    { id: 'approved-open', status: 'APPROVED', consumedAt: null },
    { id: 'approved-consumed', status: 'APPROVED', consumedAt: now }
  ];
  for (const approval of approvals) {
    const tokenHash = createHash('sha256').update(`${dbName}:${approval.id}`).digest('hex');
    await target.query(
      `INSERT INTO "LoginApprovalAttempt"
        ("id", "userId", "requestedDeviceId", "approvalTokenHash", "status", "expiresAt", "consumedAt", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
      [
        `${dbName}-${approval.id}`,
        userId,
        `synthetic-device-${approval.id}`,
        tokenHash,
        approval.status,
        new Date(now.getTime() + 60 * 60 * 1000),
        approval.consumedAt,
        now
      ]
    );
  }

  const approvedRoleArgs = ['-v', 'SCROLITH_ROLE_SETUP_APPROVED=true', '-v', `database_name=${dbName}`];
  runPsql(
    targetUrl.toString(),
    [...approvedRoleArgs, '-f', resolve(roleSqlRoot, 'scrolith-runtime-migrator-roles.sql')],
    'Runtime/migrator role bootstrap'
  );

  const guardEnv = {
    ...process.env,
    DATABASE_URL: targetUrl.toString(),
    TEST_DB_NAME: dbName,
    TEST_DB_PORT: '5432',
    SCROLITH_ROLE_SETUP_APPROVED: 'true',
    PSQL_BIN: process.env.PSQL_BIN || 'psql'
  };
  runNode(
    ['--test', resolve(repoRoot, 'scripts', 'runtime-role-enable-guard.test.mjs')],
    repoRoot,
    guardEnv,
    'Pre-finalization runtime NOLOGIN/enable guard'
  );

  runPsql(
    targetUrl.toString(),
    [...approvedRoleArgs, '-f', resolve(roleSqlRoot, 'scrolith-runtime-migrator-handoff.sql')],
    'Migrator ownership handoff'
  );

  const migratorPassword = randomBytes(32).toString('hex');
  const passwordStatement = await admin.query(
    'SELECT format(\'ALTER ROLE %I PASSWORD %L\', $1::text, $2::text) AS statement',
    ['scrolith_migrator', migratorPassword]
  );
  await admin.query(passwordStatement.rows[0].statement);
  const migratorUrl = new URL(targetUrl);
  migratorUrl.username = 'scrolith_migrator';
  migratorUrl.password = migratorPassword;

  const pendingDirs = join(tempMigrations, finalMigration);
  await cp(resolve(migrationsRoot, finalMigration), pendingDirs, { recursive: true });
  await target.end();
  target = undefined;
  const migratorEnv = { ...process.env, DATABASE_URL: migratorUrl.toString(), TEST_DB_NAME: dbName, TEST_DB_PORT: '5432' };
  delete migratorEnv.SHADOW_DATABASE_URL;
  runPrisma(cliPath, configPath, tempRoot, migratorEnv, '142-populated-upgrade as scrolith_migrator');

  target = new pg.Client({ connectionString: targetUrl.toString(), connectionTimeoutMillis: 10_000 });
  await target.connect();
  const applied142 = await target.query(
    'SELECT COUNT(*)::int AS count FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL'
  );
  if (applied142.rows[0]?.count !== 142) throw new Error('Disposable schema did not reach migration 142.');

  const result = await target.query(
    'SELECT "id", "status", "consumedAt", "authSessionVersion" FROM "LoginApprovalAttempt" WHERE "userId" = $1 ORDER BY "id"',
    [userId]
  );
  const bySuffix = new Map(result.rows.map((row) => [row.id.slice(dbName.length + 1), row]));
  if (bySuffix.get('pending')?.status !== 'EXPIRED' || bySuffix.get('approved-open')?.status !== 'EXPIRED') {
    throw new Error('Migration 142 did not expire outstanding synthetic approval challenges.');
  }
  if (bySuffix.get('approved-consumed')?.status !== 'APPROVED' || !bySuffix.get('approved-consumed')?.consumedAt) {
    throw new Error('Migration 142 unexpectedly changed a consumed synthetic approval challenge.');
  }
  if (result.rows.some((row) => row.authSessionVersion !== 0)) {
    throw new Error('Migration 142 did not apply the safe zero session-version default.');
  }

  for (const migration of migrationDirs.slice(142)) {
    await cp(resolve(migrationsRoot, migration), join(tempMigrations, migration), { recursive: true });
  }
  runPrisma(cliPath, configPath, tempRoot, migratorEnv, '143-media-outbox as scrolith_migrator');

  const beforeInjectedFailure = await readRolePolicyState(migratorUrl.toString());
  if (
    beforeInjectedFailure.rolcanlogin !== false ||
    beforeInjectedFailure.finalized !== false ||
    beforeInjectedFailure.finalized_at_is_null !== true ||
    beforeInjectedFailure.transaction_table_update !== true ||
    beforeInjectedFailure.runtime_sessions !== 0
  ) {
    throw new Error('Unexpected runtime role/grant state before synthetic finalizer failure injection.');
  }
  const finalizerSource = await readFile(resolve(roleSqlRoot, 'scrolith-runtime-finalize.sql'), 'utf8');
  const firstFinalGrant = `GRANT UPDATE ("status", "description", "metadata", "updatedAt")
  ON TABLE :"application_schema"."Transaction" TO :"runtime_role";`;
  if (finalizerSource.split(firstFinalGrant).length !== 2) {
    throw new Error('Could not uniquely locate the reviewed first finalizer grant for failure injection.');
  }
  const injectedFinalizer = finalizerSource.replace(
    firstFinalGrant,
    `${firstFinalGrant}\nDO $synthetic_finalizer_failure$ BEGIN RAISE EXCEPTION 'synthetic finalizer failure injection'; END $synthetic_finalizer_failure$;`
  );
  const failureSqlPath = join(tempRoot, 'finalizer-synthetic-failure.sql');
  await writeFile(failureSqlPath, injectedFinalizer, { encoding: 'utf8', flag: 'wx' });
  runExpectedPsqlFailure(
    migratorUrl.toString(),
    [...approvedRoleArgs, '-f', failureSqlPath],
    'Mid-finalizer synthetic failure injection',
    'synthetic finalizer failure injection'
  );
  const afterInjectedFailure = await readRolePolicyState(migratorUrl.toString());
  if (JSON.stringify(afterInjectedFailure) !== JSON.stringify(beforeInjectedFailure)) {
    throw new Error('The failed finalizer did not roll back its grants and marker atomically.');
  }
  console.log('After injected finalizer failure: runtime NOLOGIN, no runtime sessions, finalized=false, and pre-finalizer UPDATE grant fingerprint unchanged.');

  runPsql(
    migratorUrl.toString(),
    [...approvedRoleArgs, '-f', resolve(roleSqlRoot, 'scrolith-runtime-finalize.sql')],
    'Runtime privilege finalizer as scrolith_migrator'
  );

  const runtimePassword = randomBytes(32).toString('hex');
  const runtimePasswordStatement = await admin.query(
    'SELECT format(\'ALTER ROLE %I PASSWORD %L\', $1::text, $2::text) AS statement',
    ['scrolith_runtime', runtimePassword]
  );
  await admin.query(runtimePasswordStatement.rows[0].statement);
  runExpectedPsqlFailure(
    migratorUrl.toString(),
    [...approvedRoleArgs, '-f', resolve(roleSqlRoot, 'scrolith-runtime-enable.sql')],
    'Separate runtime enable rejected for migrator role',
    'only a separate bootstrap administrator'
  );
  const afterRejectedEnable = await readRolePolicyState(migratorUrl.toString());
  if (
    afterRejectedEnable.rolcanlogin !== false ||
    afterRejectedEnable.finalized !== true ||
    afterRejectedEnable.finalized_at_is_null !== false ||
    afterRejectedEnable.runtime_sessions !== 0
  ) {
    throw new Error('Rejected separate enable attempt changed runtime login or finalization state.');
  }
  console.log('After rejected separate enable: runtime remains NOLOGIN with finalized marker committed and no runtime sessions.');
  runPsql(
    targetUrl.toString(),
    [...approvedRoleArgs, '-f', resolve(roleSqlRoot, 'scrolith-runtime-enable.sql')],
    'Separate runtime login enable step'
  );

  const roleState = await target.query(`
    SELECT r.rolcanlogin,
           s.finalized,
           s.finalized_at IS NOT NULL AS finalized_at_present
      FROM pg_catalog.pg_roles r
      CROSS JOIN public.scrolith_runtime_policy_state s
     WHERE r.rolname = 'scrolith_runtime' AND s.singleton
  `);
  if (roleState.rows[0]?.rolcanlogin !== true || roleState.rows[0]?.finalized !== true || roleState.rows[0]?.finalized_at_present !== true) {
    throw new Error('Runtime login was not enabled after the committed finalizer marker.');
  }

  for (const [file, label] of [
    ['scrolith-runtime-permissions.test.sql', 'Core runtime privilege regression'],
    ['scrolith-runtime-community-permissions.test.sql', 'Community/FoundingPartner runtime privilege regression']
  ]) {
    runPsql(
      targetUrl.toString(),
      [...approvedRoleArgs, '-f', resolve(roleSqlRoot, file)],
      label
    );
  }

  const runtimeUrl = new URL(targetUrl);
  runtimeUrl.username = 'scrolith_runtime';
  runtimeUrl.password = runtimePassword;
  const httpTestEnv = {
    ...process.env,
    DATABASE_URL: runtimeUrl.toString(),
    TEST_DB_NAME: dbName,
    TEST_DB_PORT: '5432',
    TEST_DB_KIND: 'local-disposable',
    TEST_DB_PROJECT: 'local-only',
    TEST_DB_INSTANCE: 'local-disposable-postgres-test',
    NODE_ENV: 'test',
    APP_RUNTIME: 'test',
    DISABLE_BACKGROUND_WORKERS: 'true',
    SCROLITH_ROLE_HTTP_TEST_APPROVED: 'true',
    SCROLITH_MONEY_MOVEMENT_ENABLED: 'false',
    STRIPE_WEBHOOK_SECRET: `whsec_local_synthetic_${randomBytes(24).toString('hex')}`
  };
  httpTestEnv.ALLOW_DEV_AUTH_BYPASS = 'false';
  httpTestEnv.ALLOW_DEV_ADMIN_BYPASS = 'false';
  runNode(
    [
      resolve(repoRoot, 'node_modules', 'jest', 'bin', 'jest.js'),
      '--config', 'jest.config.cjs', '--runInBand', '--runTestsByPath',
      'src/__tests__/community.financial-history.runtime.integration.test.ts',
      '--testTimeout=180000'
    ],
    repoRoot,
    httpTestEnv,
    'Actual-server financial-history HTTP regression under scrolith_runtime',
    15 * 60 * 1000
  );

  console.log('141-to-142 populated upgrade passed as scrolith_migrator: pending and unconsumed approved challenges expired; consumed approval remained unchanged.');
} catch (error) {
  const message = error instanceof Error ? error.message : 'unknown failure';
  console.error(`[migration-upgrade] ${message.replace(sensitiveUrl, '[DATABASE URL REDACTED]')}`);
  process.exitCode = 1;
} finally {
  try {
    await target?.end();
  } catch {
    console.error('[migration-upgrade] target client close failed.');
    process.exitCode = 1;
  }
  if (admin && createdDatabase) {
    try {
      await admin.query(
        'SELECT pg_terminate_backend(pid) FROM pg_catalog.pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
        [dbName]
      );
      await admin.query(`DROP DATABASE "${dbName}"`);
      console.log('Task-owned disposable migration database removed.');
    } catch {
      console.error('[migration-upgrade] task-owned disposable database cleanup failed.');
      process.exitCode = 1;
    }
  }
  if (admin && rolesCreated) {
    try {
      await admin.query(`
        DO $cleanup_roles$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'scrolith_runtime') THEN
            ALTER ROLE scrolith_runtime NOLOGIN;
          END IF;
        END
        $cleanup_roles$
      `);
      await admin.query(
        "SELECT pg_terminate_backend(pid) FROM pg_catalog.pg_stat_activity WHERE usename IN ('scrolith_runtime', 'scrolith_migrator') AND pid <> pg_backend_pid()"
      );
      await admin.query('DROP ROLE IF EXISTS scrolith_runtime, scrolith_migrator');
      const remainingRoles = await admin.query(
        "SELECT COUNT(*)::int AS count FROM pg_catalog.pg_roles WHERE rolname IN ('scrolith_runtime', 'scrolith_migrator')"
      );
      if (remainingRoles.rows[0]?.count !== 0) throw new Error('Task-created database roles remain after cleanup.');
      console.log('Task-created runtime and migrator roles removed from the disposable PostgreSQL service.');
    } catch {
      console.error('[migration-upgrade] task-created disposable role cleanup failed.');
      process.exitCode = 1;
    }
  }
  try {
    await admin?.end();
  } catch {
    console.error('[migration-upgrade] admin client close failed.');
    process.exitCode = 1;
  }
  if (tempRoot) {
    try {
      await rm(tempRoot, { recursive: true, force: true });
    } catch {
      console.error('[migration-upgrade] temporary migration copy cleanup failed.');
      process.exitCode = 1;
    }
  }
}
