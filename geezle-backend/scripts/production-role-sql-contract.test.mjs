import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const postgresRoot = resolve(backendRoot, '..', 'deploy', 'postgres');
const readSql = (name) => readFile(resolve(postgresRoot, name), 'utf8');

test('test-only role scripts still reject non-test/e2e database targets', async () => {
  for (const name of [
    'scrolith-runtime-migrator-roles.sql',
    'scrolith-runtime-migrator-handoff.sql',
    'scrolith-runtime-finalize.sql',
    'scrolith-runtime-enable.sql'
  ]) {
    const sql = await readSql(name);
    assert.match(sql, /SCROLITH_ROLE_SETUP_APPROVED/);
    assert.match(sql, /current_database\(\)\s*~\*\s*'\(test\|e2e\)'/);
  }
});

test('production scripts have a separate explicit approval and exact target guard', async () => {
  const names = [
    'scrolith-production-target-guard.sql',
    'scrolith-production-role-bootstrap.sql',
    'scrolith-production-migrator-enable.sql',
    'scrolith-production-migration-init.sql',
    'scrolith-production-role-handoff.sql',
    'scrolith-production-runtime-finalize.sql',
    'scrolith-production-runtime-enable.sql',
    'scrolith-production-user-language-preferences-rollback.sql'
  ];
  for (const name of names) {
    const sql = await readSql(name);
    if (name !== 'scrolith-production-target-guard.sql') {
      assert.match(sql, /\\ir scrolith-production-target-guard\.sql/);
    }
    assert.doesNotMatch(sql, /postgres(?:ql)?:\/\/[^\s"']+/i);
    assert.doesNotMatch(sql, /PASSWORD\s+'[^']+'/i);
  }

  const guard = await readSql('scrolith-production-target-guard.sql');
  assert.match(guard, /SCROLITH_PRODUCTION_CHANGE_APPROVED/);
  assert.match(guard, /current_database\(\)\s*=\s*'scrolith'/);
  assert.match(guard, /server_version_num/);
  assert.match(guard, /expected_server_fqdn/);
  assert.match(guard, /expected_source_commit/);
  assert.match(guard, /pg_stat_ssl[\s\S]*pg_backend_pid\(\)/);
});

test('production bootstrap and migration phases keep runtime NOLOGIN until the final transaction', async () => {
  const bootstrap = await readSql('scrolith-production-role-bootstrap.sql');
  const enableMigrator = await readSql('scrolith-production-migrator-enable.sql');
  const init = await readSql('scrolith-production-migration-init.sql');
  const handoff = await readSql('scrolith-production-role-handoff.sql');
  const enableRuntime = await readSql('scrolith-production-runtime-enable.sql');

  assert.match(bootstrap, /CREATE ROLE scrolith_runtime\s+NOLOGIN/);
  assert.match(bootstrap, /CREATE ROLE scrolith_migrator\s+NOLOGIN/);
  assert.match(bootstrap, /CREATE ROLE scrolith_backup\s+NOLOGIN/);
  assert.match(bootstrap, /REVOKE CONNECT, TEMPORARY ON DATABASE %I FROM PUBLIC/);
  assert.match(bootstrap, /bootstrap_public_acl/);
  assert.match(bootstrap, /aclexplode\(database_acl\)/);
  assert.match(enableMigrator, /ALTER ROLE scrolith_migrator LOGIN/);
  assert.match(enableMigrator, /scrolith_runtime.*NOT rolcanlogin/s);
  assert.match(init, /ALTER DEFAULT PRIVILEGES IN SCHEMA public/);
  assert.match(init, /REVOKE ALL ON TABLES FROM scrolith_runtime/);
  assert.match(init, /REVOKE ALL ON SEQUENCES FROM scrolith_runtime/);
  assert.doesNotMatch(init, /GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)[^;]*TO scrolith_runtime/i);
  assert.match(init, /GRANT SELECT, INSERT, TRUNCATE ON TABLES TO scrolith_backup/);
  assert.match(init, /GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO scrolith_backup/);
  assert.doesNotMatch(init, /CREATE\s+TABLE/i,
    'pre-migration initialization must leave the Prisma target schema empty');
  assert.match(init, /public schema remains empty for Prisma migrate deploy/);
  assert.match(init, /set_config\('scrolith\.bootstrap_admin_role', :'bootstrap_admin_role', false\)/);
  const initDoBodies = [...init.matchAll(/DO\s+\$[A-Za-z0-9_]*\$([\s\S]*?)\$[A-Za-z0-9_]*\$/g)]
    .map((match) => match[1]);
  assert.ok(initDoBodies.length >= 3, 'migration init contains its guarded DO blocks');
  assert.doesNotMatch(initDoBodies.join('\n'), /:'bootstrap_admin_role'/,
    'psql variables are not referenced inside dollar-quoted DO bodies');
  assert.match(handoff, /CREATE TABLE public\.scrolith_runtime_policy_state/);
  assert.match(handoff, /bootstrap_admin_role TEXT NOT NULL/);
  assert.match(handoff, /GRANT SELECT ON TABLE public\."_prisma_migrations"\s+TO :"bootstrap_admin_role"/);
  const handoffDoBodies = [...handoff.matchAll(/DO\s+\$[A-Za-z0-9_]*\$([\s\S]*?)\$[A-Za-z0-9_]*\$/g)]
    .map((match) => match[1]);
  assert.ok(handoffDoBodies.length >= 2, 'ownership handoff contains guarded DO blocks');
  assert.doesNotMatch(handoffDoBodies.join('\n'), /:'bootstrap_admin_role'/,
    'psql variables are not referenced inside dollar-quoted DO bodies');
  assert.match(enableRuntime, /bootstrap_admin <> current_user/);
  assert.match(enableRuntime, /rolname = 'scrolith_backup'[\s\S]*?NOT rolcanlogin/);
  assert.match(init, /current_user <> 'scrolith_migrator'/);
  assert.match(handoff, /pg_get_userbyid\(c\.relowner\) <> 'scrolith_migrator'/);
  assert.doesNotMatch(handoff, /^\\s*(?:REASSIGN OWNED|ALTER (?:TABLE|SEQUENCE|TYPE).*OWNER TO)/im);

  const disableMigratorAt = enableRuntime.indexOf('ALTER ROLE scrolith_migrator NOLOGIN;');
  const enableRuntimeAt = enableRuntime.indexOf('ALTER ROLE scrolith_runtime LOGIN;');
  assert.ok(disableMigratorAt >= 0 && enableRuntimeAt > disableMigratorAt);
  assert.ok(enableRuntime.indexOf('BEGIN;') < disableMigratorAt);
  assert.ok(enableRuntime.indexOf('COMMIT;') > enableRuntimeAt);
  assert.match(enableRuntime, /ownership_verified\s+AND\s+finalized/s);
  assert.match(enableRuntime, /scrolith_runtime', 'scrolith_migrator', 'scrolith_backup/);
  assert.match(enableRuntime, /runtime-deletable parent can cascade or rewrite protected financial\/history relations/);
});

test('production finalizer loads the explicit reviewed grant policy and retains fail-closed assertions', async () => {
  const production = (await readSql('scrolith-production-runtime-finalize.sql')).replace(/\r\n/g, '\n');
  const grants = await readSql('scrolith-production-runtime-grants.sql');
  assert.match(production, /\\ir scrolith-production-runtime-grants\.sql/);
  assert.match(grants, /GRANT SELECT ON TABLE/);
  assert.match(grants, /GRANT INSERT ON TABLE/);
  assert.match(grants, /GRANT DELETE ON TABLE/);
  assert.doesNotMatch(grants, /GRANT UPDATE ON TABLE/);
  assert.doesNotMatch(production, /GRANT UPDATE ON TABLE/);
  assert.match(production, /scrolith_backup.*NOLOGIN/s);
  assert.match(production, /PUBLIC retains explicit privileges/);
  assert.match(production, /migration_count = 143/);
  assert.match(production, /ownership_verified/);
  assert.match(production, /has_column_privilege\('scrolith_runtime', 'public\."AdPayment"', 'amount', 'UPDATE'\)/);
  assert.match(production, /has_column_privilege\('scrolith_runtime', 'public\."AdPayment"', 'currency', 'UPDATE'\)/);
  assert.match(production, /has_column_privilege\('scrolith_runtime', 'public\."AdPayment"', 'status', 'UPDATE'\)/);
  assert.match(production, /has_column_privilege\('scrolith_runtime', 'public\."AdPayment"', 'adId', 'UPDATE'\)/);
  assert.match(production, /runtime-deletable parent can cascade or rewrite protected financial\/history relations/);
  const finalizerDoBodies = [...production.matchAll(/DO\s+\$[A-Za-z0-9_]*\$([\s\S]*?)\$[A-Za-z0-9_]*\$/g)]
    .map((match) => match[1]);
  assert.doesNotMatch(finalizerDoBodies.join('\n'), /:'[A-Za-z_][A-Za-z0-9_]*'/,
    'psql variables are not interpolated inside dollar-quoted PL/pgSQL blocks');
});

test('User onboarding UPDATE grants are exact and have a guarded column-only rollback', async () => {
  const grants = await readSql('scrolith-production-runtime-grants.sql');
  const finalizer = await readSql('scrolith-production-runtime-finalize.sql');
  const rollback = await readSql('scrolith-production-user-language-preferences-rollback.sql');
  const userGrant = grants.match(/GRANT UPDATE \(([^)]*)\) ON TABLE :\"application_schema\"\.\"User\" TO :\"runtime_role\";/);
  assert.ok(userGrant, 'production grants include one explicit User column UPDATE statement');
  const granted = userGrant[1].split(',').map((column) => column.trim().replaceAll('\"', '')).sort();
  const expected = [
    'authSessionVersion', 'avatar', 'country', 'currency_preference_updated_at', 'email',
    'followOnboardingCompletedAt', 'followOnboardingRequired', 'isActive', 'isOnline',
    'isVerified', 'kycStatus', 'languagePreferencesConfirmed', 'languagePreferencesUpdatedAt',
    'lastLoginAt', 'lastSeenAt', 'loginApprovalWaivedById', 'loginApprovalWaivedReason',
    'loginApprovalWaivedUntil', 'name', 'passwordHash', 'preferred_currency',
    'profilePhotoFileId', 'refreshToken', 'role', 'understoodLanguages', 'updatedAt', 'username'
  ].sort();
  assert.deepEqual(granted, expected);
  assert.match(finalizer, /DO \$verify_user_update_allowlist\$/);
  for (const field of ['languagePreferencesConfirmed', 'languagePreferencesUpdatedAt', 'understoodLanguages', 'followOnboardingRequired', 'followOnboardingCompletedAt', 'updatedAt']) {
    assert.match(finalizer, new RegExp(`'${field}'`));
  }
  assert.match(finalizer, /has_table_privilege\('scrolith_runtime', 'public\.\"User\"', 'UPDATE'\)/);
  assert.match(rollback, /\\ir scrolith-production-target-guard\.sql/);
  assert.match(rollback, /current_user <> 'scrolith_migrator'/);
  const revoked = rollback.match(/REVOKE UPDATE \(([^)]*)\)/)?.[1];
  assert.ok(revoked);
  assert.deepEqual(revoked.split(',').map((column) => column.trim().replaceAll('\"', '')).sort(), [
    'languagePreferencesConfirmed', 'languagePreferencesUpdatedAt', 'understoodLanguages'
  ].sort());
  assert.match(rollback, /NOT has_column_privilege\('scrolith_runtime', 'public\.\"User\"', 'followOnboardingRequired', 'UPDATE'\)/);
  assert.match(rollback, /NOT has_column_privilege\('scrolith_runtime', 'public\.\"User\"', 'followOnboardingCompletedAt', 'UPDATE'\)/);
  assert.match(rollback, /NOT has_column_privilege\('scrolith_runtime', 'public\.\"User\"', 'updatedAt', 'UPDATE'\)/);
});

test('production operation inventory grants only reviewed financial field updates', async () => {
  const grants = await readSql('scrolith-production-runtime-grants.sql');
  const finalizer = await readSql('scrolith-production-runtime-finalize.sql');
  const matrix = await readFile(resolve(backendRoot, '..', 'docs', 'POSTGRES_RUNTIME_PERMISSION_MATRIX.md'), 'utf8');
  const combined = `${grants}\n${finalizer}`;
  for (const [table, allowed, denied] of [
    ['Wallet', ['balance', 'pendingClearance', 'escrowBalance', 'frozen'], ['userId', 'currency']],
    ['Transaction', ['status', 'description', 'metadata'], ['amount', 'currency', 'walletId']],
    ['AdPayment', ['amount', 'currency', 'status'], ['adId']],
    ['WalletFundingIntent', ['fxLockId', 'status'], ['amount', 'currency']],
    ['OrderPaymentIntent', ['fxLockId', 'status'], ['amount']],
    ['WithdrawalRequest', ['details', 'fxLockId', 'status'], ['amount', 'userId']],
    ['GcoinWallet', ['balance', 'lifetimeEarned', 'status'], ['userId', 'recipientId']],
    ['GcoinEarningEvent', ['reactionActive', 'reversedAt', 'reversalCount'], ['value']]
  ]) {
    const updateStatements = [...combined.matchAll(new RegExp(`GRANT UPDATE \\(([^)]*)\\)[^;]*?\\"${table}\\"[^;]*;`, 'gs'))];
    const columns = updateStatements.flatMap((match) => match[1].split(',').map((column) => column.trim().replaceAll('"', '')));
    for (const column of allowed) assert.ok(columns.includes(column), `${table}.${column} must be updateable`);
    for (const column of denied) assert.ok(!columns.includes(column), `${table}.${column} must not be updateable`);
  }
  for (const row of ['| `Wallet` |', '| `Transaction` |', '| `AdPayment` |', '| `WalletFundingIntent` |']) {
    assert.ok(matrix.includes(row), `permission matrix contains ${row}`);
  }
});

test('permission matrix exactly matches production runtime SELECT, INSERT, UPDATE-column, and DELETE grants', async () => {
  const grants = await readSql('scrolith-production-runtime-grants.sql');
  const finalizer = await readSql('scrolith-production-runtime-finalize.sql');
  const matrix = await readFile(resolve(backendRoot, '..', 'docs', 'POSTGRES_RUNTIME_PERMISSION_MATRIX.md'), 'utf8');
  const sql = `${grants}\n${finalizer}`;
  const tablePrivileges = new Map();
  const tableGrantPattern = /GRANT\s+(?<privileges>(?:SELECT|INSERT|DELETE)(?:\s*,\s*(?:SELECT|INSERT|DELETE))*)\s+ON TABLE\s+(?<targets>[\s\S]*?)\s+TO\s+:"runtime_role"\s*;/g;
  for (const match of sql.matchAll(tableGrantPattern)) {
    const privileges = match.groups.privileges.split(',').map((privilege) => privilege.trim());
    for (const target of match.groups.targets.matchAll(/:"application_schema"\."([^"]+)"/g)) {
      const effective = tablePrivileges.get(target[1]) ?? new Set();
      privileges.forEach((privilege) => effective.add(privilege));
      tablePrivileges.set(target[1], effective);
    }
  }

  const updateColumns = new Map();
  const updatePattern = /GRANT UPDATE\s*\((?<columns>[^)]*)\)\s*ON TABLE\s+:"application_schema"\."(?<table>[^"]+)"\s+TO\s+:"runtime_role"\s*;/gs;
  for (const match of sql.matchAll(updatePattern)) {
    const columns = updateColumns.get(match.groups.table) ?? new Set();
    match.groups.columns.split(',').map((column) => column.trim().replaceAll('"', '')).forEach((column) => columns.add(column));
    updateColumns.set(match.groups.table, columns);
  }

  const rows = matrix.split(/\r?\n/).filter((line) => /^\| `[^`]+` \|/.test(line));
  assert.equal(rows.length, 355, 'matrix lists every Prisma model table exactly once');
  assert.doesNotMatch(matrix, /^\|[^\n]*\| \? \|/m, 'matrix does not leave UPDATE permissions unknown');
  const matrixTables = new Set();
  for (const line of rows) {
    const fields = line.split('|').map((field) => field.trim());
    const table = fields[1].replaceAll('`', '');
    matrixTables.add(table);
    const expected = tablePrivileges.get(table) ?? new Set();
    for (const [field, privilege] of [[fields[2], 'SELECT'], [fields[3], 'INSERT'], [fields[5], 'DELETE']]) {
      assert.equal(field.startsWith('Yes'), expected.has(privilege), `${table} ${privilege} grant matches matrix`);
    }
    const declaredColumns = fields[4] === '—' ? [] : fields[4].split(',').map((column) => column.trim()).sort();
    const grantedColumns = [...(updateColumns.get(table) ?? new Set())].sort();
    assert.deepEqual(grantedColumns, declaredColumns, `${table} UPDATE columns match matrix`);
  }
  for (const table of tablePrivileges.keys()) assert.ok(matrixTables.has(table), `${table} grant is inventoried`);
  for (const table of updateColumns.keys()) assert.ok(matrixTables.has(table), `${table} column UPDATE grant is inventoried`);
});

test('release migration pin matches this checked source tree', async () => {
  const migrationRoot = resolve(backendRoot, 'prisma', 'migrations');
  const migrations = (await readdir(migrationRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.equal(migrations.length, 143);
  assert.equal(migrations.at(-1), '20261122100000_restrict_order_gig_history');

  for (const name of [
    'scrolith-production-role-handoff.sql',
    'scrolith-production-runtime-finalize.sql',
    'scrolith-production-runtime-enable.sql'
  ]) {
    const sql = await readSql(name);
    assert.match(sql, /20261122100000_restrict_order_gig_history/);
  }
});

test('Azure runbook inspects the manual migrator safely and verifies the exact execution', async () => {
  const guide = await readFile(resolve(backendRoot, '..', 'docs', 'AZURE_CONTAINER_APPS_RELEASE_GUIDE.md'), 'utf8');
  assert.match(guide, /az account show --query id/);
  assert.match(guide, /ExpectedMigratorImage/);
  assert.match(guide, /properties\.configuration\.triggerType/);
  assert.match(guide, /@sha256:\[0-9a-f\]\{64\}/);
  assert.match(guide, /container\.image -ne \$ExpectedMigratorImage/);
  assert.match(guide, /DATABASE_URL must be provided only by a Container Apps secret reference/);
  assert.match(guide, /fresh-database procedure requires no prior job executions/);
  assert.match(guide, /az containerapp job start[^\r\n]*--query name -o tsv/);
  assert.match(guide, /az containerapp job execution show[\s\S]*--job-execution-name \$ExecutionName/);
  assert.match(guide, /execution\.status -ne 'Succeeded'/);
  assert.match(guide, /concurrent executions/);
  assert.doesNotMatch(guide, /az containerapp job start[^\r\n]*--set-env-vars[^\r\n]*DATABASE_URL=/i);
  assert.doesNotMatch(guide, /(?:DATABASE_URL|PGPASSWORD)\s*=\s*postgres(?:ql)?:\/\//i);
});
