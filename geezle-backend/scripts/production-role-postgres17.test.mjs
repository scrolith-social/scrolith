import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const enabled = process.env.SCROLITH_RUN_PRODUCTION_ROLE_PG17 === '1';
const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(backendRoot, '..');
const postgresScripts = resolve(repositoryRoot, 'deploy', 'postgres');
const defaultSourceSha = '15ca15c9b1ce462a8a140090cf45c0354d762ce6';
const sourceSha = process.env.SCROLITH_ROLE_TEST_SOURCE_SHA ?? defaultSourceSha;
const incrementalReleaseSha = process.env.SCROLITH_ROLE_TEST_INCREMENTAL_SOURCE_SHA
  ?? '1111111111111111111111111111111111111111';
const expectedFqdn = 'scrolith-validation.postgres.database.azure.com';
const dockerImage = process.env.SCROLITH_PG17_TEST_IMAGE ?? 'postgres:17';
const evidenceRoot = process.env.SCROLITH_ROLE_VALIDATION_EVIDENCE_DIR
  ?? join(os.tmpdir(), 'scrolith-production-role-pg17-evidence');
const scriptNames = [
  'scrolith-production-target-guard.sql',
  'scrolith-production-role-bootstrap.sql',
  'scrolith-production-migrator-enable.sql',
  'scrolith-production-migration-init.sql',
  'scrolith-production-role-handoff.sql',
  'scrolith-production-runtime-finalize.sql',
  'scrolith-production-runtime-grants.sql',
  'scrolith-production-runtime-enable.sql',
  'scrolith-production-user-language-preferences-inspect.sql',
  'scrolith-production-user-language-preferences-apply.sql',
  'scrolith-production-user-language-preferences-preflight.sql',
  'scrolith-production-user-language-preferences-rollback.sql'
];

const redact = (value) => String(value)
  .replace(/postgres(?:ql)?:\/\/[^\s"'`]+/gi, '[REDACTED_DATABASE_URL]')
  .replace(/((?:password|token|secret)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]');

test('production PostgreSQL role bootstrap, migrations, finalization and runtime grants on a fresh PG17 database', {
  skip: enabled ? false : 'set SCROLITH_RUN_PRODUCTION_ROLE_PG17=1 to create a task-owned disposable PostgreSQL 17 container'
}, async () => {
  assert.match(sourceSha, /^[0-9a-f]{40}$/, 'the recorded migration marker input must be a SHA-shaped value');
  assert.match(incrementalReleaseSha, /^[0-9a-f]{40}$/, 'the incremental release input must be a SHA-shaped value');
  assert.notEqual(incrementalReleaseSha, sourceSha, 'the incremental code release must be distinct from the existing policy-marker commit');
  await mkdir(evidenceRoot, { recursive: true });
  const runId = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const containerName = `scrolith-role-pg17-${runId}`;
  const tempRoot = await mkdtemp(join(os.tmpdir(), 'scrolith-role-pg17-'));
  const logLines = [];
  const resultSummary = {
    sourceSha,
    postgresImage: dockerImage,
    containerName,
    migrationsExpected: 143,
    steps: []
  };
  let containerStarted = false;

  function run(label, executable, args, options = {}) {
    const started = Date.now();
    const result = spawnSync(executable, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      input: options.input,
      encoding: 'utf8',
      timeout: options.timeout ?? 120000,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true
    });
    const output = redact(`${result.stdout ?? ''}${result.stderr ?? ''}`);
    const exitCode = result.status ?? (result.error ? 124 : 1);
    const step = { label, exitCode, durationMs: Date.now() - started };
    resultSummary.steps.push(step);
    logLines.push(`## ${label}\nexit=${exitCode} durationMs=${step.durationMs}\n${output.trim()}\n`);
    if (result.error) logLines.push(`spawnError=${redact(result.error.message)}\n`);
    if (options.expectFailure) {
      assert.notEqual(exitCode, 0, `${label} unexpectedly succeeded`);
    } else {
      assert.equal(exitCode, 0, `${label} failed:\n${output}`);
    }
    return { ...step, output };
  }

  const docker = (label, args, options = {}) => run(label, 'docker', args, options);
  const execDocker = (label, args, options = {}) => docker(label, ['exec', ...args], options);
  const psqlArgs = (role, database, more = []) => [
    'exec', '-i', '-e', 'PGSSLMODE=require', containerName,
    'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-v', 'SCROLITH_PRODUCTION_CHANGE_APPROVED=true',
    '-v', `expected_server_fqdn=${expectedFqdn}`,
    '-v', `expected_source_commit=${sourceSha}`,
    '-h', '127.0.0.1', '-p', '5432', '-U', role, '-d', database,
    ...more
  ];
  const psql = (label, role, database, sql) => docker(label, psqlArgs(role, database), { input: sql });
  const psqlFile = (label, role, file, vars = []) => docker(label, psqlArgs(role, 'scrolith', [
    ...vars.flatMap(([key, value]) => ['-v', `${key}=${value}`]),
    '-f', file
  ]));
  const query = (label, role, sql, database = 'scrolith') => docker(label, psqlArgs(role, database, ['-A', '-t']), { input: sql }).output.trim();
  const expectDenied = (label, sql, expectedText) => {
    const result = docker(label, psqlArgs('scrolith_runtime', 'scrolith'), {
      input: `${sql.replace(/;?\s*$/, ';')}\n`,
      expectFailure: true
    });
    if (expectedText) assert.match(result.output, expectedText, `${label} failed for an unexpected reason`);
    return result;
  };

  async function makeSqlCopy(name, mutate) {
    const dir = join(tempRoot, name);
    await mkdir(dir, { recursive: true });
    for (const script of scriptNames) {
      let contents = await readFile(join(postgresScripts, script), 'utf8');
      if (mutate && script === mutate.file) contents = mutate.apply(contents);
      await writeFile(join(dir, script), contents, 'utf8');
    }
    docker(`copy ${name} role SQL into the task-owned container`, ['cp', dir, `${containerName}:/tmp/${name}`]);
    return `/tmp/${name}`;
  }

  try {
    const image = docker('inspect locally available PostgreSQL 17 image without pulling', [
      'image', 'inspect', dockerImage, '--format', '{{.Id}} {{index .RepoDigests 0}}'
    ]);
    resultSummary.postgresImageId = image.output.trim().split(/\s+/)[0];
    assert.match(resultSummary.postgresImageId, /^sha256:[0-9a-f]{64}$/);

    docker('create fresh task-owned PostgreSQL 17 container with loopback-only ephemeral port and tmpfs data', [
      'run', '-d', '--pull=never', '--name', containerName,
      '--label', 'com.scrolith.validation.owner=production-db-role-pg17-20261121',
      '--publish', '127.0.0.1::5432',
      '--tmpfs', '/var/lib/postgresql/data:rw,noexec,nosuid,size=1g',
      '-e', 'POSTGRES_HOST_AUTH_METHOD=trust',
      '--entrypoint', 'bash', dockerImage, '-c',
      'openssl req -x509 -newkey rsa:2048 -nodes -keyout /tmp/pg-server.key -out /tmp/pg-server.crt -days 1 -subj /CN=localhost >/dev/null 2>&1 && chown postgres:postgres /tmp/pg-server.key /tmp/pg-server.crt && chmod 600 /tmp/pg-server.key && exec /usr/local/bin/docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/tmp/pg-server.crt -c ssl_key_file=/tmp/pg-server.key'
    ]);
    containerStarted = true;

    const mapped = docker('resolve only the task container ephemeral loopback port', ['port', containerName, '5432/tcp']);
    const portMatch = mapped.output.match(/127\.0\.0\.1:(\d+)/);
    assert.ok(portMatch, `expected loopback-only mapped PostgreSQL port, received ${mapped.output}`);
    const hostPort = Number(portMatch[1]);
    resultSummary.hostPort = hostPort;

    const waitStart = Date.now();
    let ready = false;
    while (Date.now() - waitStart < 45000) {
      const probe = spawnSync('docker', ['exec', containerName, 'pg_isready', '-h', '127.0.0.1', '-p', '5432', '-U', 'postgres', '-d', 'postgres'], {
        encoding: 'utf8', windowsHide: true, timeout: 5000
      });
      if (probe.status === 0) { ready = true; break; }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
    }
    if (!ready) {
      const state = spawnSync('docker', ['inspect', containerName, '--format', '{{.State.Status}}/{{.State.ExitCode}}'], {
        encoding: 'utf8', windowsHide: true, timeout: 10000
      });
      const startupLogs = spawnSync('docker', ['logs', containerName], {
        encoding: 'utf8', windowsHide: true, timeout: 10000
      });
      logLines.push(`## failed PostgreSQL startup diagnostics\nstate=${redact(state.stdout ?? '').trim()}\n${redact(`${startupLogs.stdout ?? ''}${startupLogs.stderr ?? ''}`).trim()}\n`);
      assert.fail(`task-owned PostgreSQL 17 did not become ready within 45 seconds; state=${redact(state.stdout ?? '').trim()}; logs=${redact(`${startupLogs.stdout ?? ''}${startupLogs.stderr ?? ''}`).trim()}`);
    }
    logLines.push(`## wait for task-owned PostgreSQL 17\nexit=0 durationMs=${Date.now() - waitStart}\n`);

    docker('create synthetic Azure administrator role and fresh empty scrolith database', [
      'exec', '-i', '-e', 'PGSSLMODE=require', containerName,
      'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', '5432', '-U', 'postgres', '-d', 'postgres'
    ], {
      input: `CREATE ROLE azure_pg_admin NOLOGIN;\nCREATE ROLE synthetic_bootstrap_admin LOGIN CREATEROLE CREATEDB NOINHERIT;\nGRANT azure_pg_admin TO synthetic_bootstrap_admin WITH ADMIN OPTION, INHERIT FALSE, SET FALSE;\nCREATE DATABASE scrolith OWNER synthetic_bootstrap_admin;\n`
    });

    const normalDir = await makeSqlCopy('role-sql-normal');
    const bootstrap = psqlFile('production role bootstrap as synthetic Flexible Server administrator over TLS', 'synthetic_bootstrap_admin', `${normalDir}/scrolith-production-role-bootstrap.sql`);
    assert.doesNotMatch(bootstrap.output, /no privileges could be revoked[^\n]*public|public[^\n]*no privileges could be revoked/i,
      'conditional bootstrap PUBLIC ACL cleanup should not issue a no-op revoke');
    let states = query('verify all roles start NOLOGIN', 'synthetic_bootstrap_admin', `SELECT string_agg(rolname || ':' || CASE WHEN rolcanlogin THEN 'LOGIN' ELSE 'NOLOGIN' END, ',' ORDER BY rolname) FROM pg_roles WHERE rolname IN ('scrolith_runtime','scrolith_migrator','scrolith_backup');`);
    assert.equal(states, 'scrolith_backup:NOLOGIN,scrolith_migrator:NOLOGIN,scrolith_runtime:NOLOGIN');

    psqlFile('separately enable migrator only', 'synthetic_bootstrap_admin', `${normalDir}/scrolith-production-migrator-enable.sql`);
    states = query('verify migrator LOGIN while runtime and backup stay NOLOGIN', 'synthetic_bootstrap_admin', `SELECT string_agg(rolname || ':' || CASE WHEN rolcanlogin THEN 'LOGIN' ELSE 'NOLOGIN' END, ',' ORDER BY rolname) FROM pg_roles WHERE rolname IN ('scrolith_runtime','scrolith_migrator','scrolith_backup');`);
    assert.equal(states, 'scrolith_backup:NOLOGIN,scrolith_migrator:LOGIN,scrolith_runtime:NOLOGIN');

    psqlFile('initialize default ACL policy as migrator before Prisma creates schema objects', 'scrolith_migrator', `${normalDir}/scrolith-production-migration-init.sql`, [['bootstrap_admin_role', 'synthetic_bootstrap_admin']]);

    const dbUrl = `postgresql://scrolith_migrator@127.0.0.1:${hostPort}/scrolith?sslmode=require`;
    const isolatedEnv = {
      PATH: process.env.PATH,
      SYSTEMROOT: process.env.SYSTEMROOT,
      WINDIR: process.env.WINDIR,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      USERPROFILE: process.env.USERPROFILE,
      DATABASE_URL: dbUrl,
      DOTENV_CONFIG_PATH: join(tempRoot, 'empty.env'),
      DOTENV_CONFIG_QUIET: 'true',
      NODE_ENV: 'production'
    };
    await writeFile(isolatedEnv.DOTENV_CONFIG_PATH, '', 'utf8');
    const prismaCli = resolve(backendRoot, 'node_modules', 'prisma', 'build', 'index.js');
    const migrationArgs = [prismaCli, 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'];
    run('apply all Prisma migrations on fresh disposable PostgreSQL 17', process.execPath, migrationArgs, {
      cwd: backendRoot, env: isolatedEnv, timeout: 600000
    });
    let migrationCount = query('count completed migrations after first deploy', 'scrolith_migrator', `SELECT count(*)::text FROM public."_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;`);
    assert.equal(migrationCount, '143');
    run('replay Prisma migrate deploy and confirm it is idempotent', process.execPath, migrationArgs, {
      cwd: backendRoot, env: isolatedEnv, timeout: 600000
    });
    migrationCount = query('count completed migrations after replay', 'scrolith_migrator', `SELECT count(*)::text FROM public."_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;`);
    assert.equal(migrationCount, '143');

    const handoff = psqlFile('ownership handoff and 143-migration ledger verification', 'scrolith_migrator', `${normalDir}/scrolith-production-role-handoff.sql`, [['bootstrap_admin_role', 'synthetic_bootstrap_admin']]);
    assert.doesNotMatch(handoff.output, /no privileges could be revoked[^\n]*public|public[^\n]*no privileges could be revoked/i,
      'ownership handoff should not issue a no-op PUBLIC revoke');
    const failedFinalizerDir = await makeSqlCopy('role-sql-fail-finalizer', {
      file: 'scrolith-production-runtime-finalize.sql',
      apply: (contents) => {
        const marker = '\nDO $verify_policy$';
        assert.ok(contents.includes(marker), 'failure injection point is present in the temporary test copy');
        return contents.replace(marker, '\nSELECT 1 / 0; -- test-only failure after role grants\nDO $verify_policy$');
      }
    });
    const failedFinalizer = await run('inject temporary mid-finalizer failure after grants and verify whole-transaction rollback', 'docker', psqlArgs('scrolith_migrator', 'scrolith', [
      '-v', 'bootstrap_admin_role=synthetic_bootstrap_admin',
      '-f', `${failedFinalizerDir}/scrolith-production-runtime-finalize.sql`
    ]), { expectFailure: true });
    assert.match(failedFinalizer.output, /division by zero/i);
    states = query('verify finalizer failure leaves runtime NOLOGIN and marker pending', 'synthetic_bootstrap_admin', `SELECT (SELECT CASE WHEN rolcanlogin THEN 'LOGIN' ELSE 'NOLOGIN' END FROM pg_roles WHERE rolname='scrolith_runtime') || ':' || (SELECT finalized::text FROM public.scrolith_runtime_policy_state WHERE singleton);`);
    assert.equal(states, 'NOLOGIN:false');
    const grantAfterFailure = query('verify column grants from failed finalizer did not persist', 'synthetic_bootstrap_admin', `SELECT has_column_privilege('scrolith_runtime','public."Wallet"','balance','UPDATE')::text;`);
    assert.equal(grantAfterFailure, 'false');

    const normalFinalizer = psqlFile('retry normal finalizer; capture public ACL warning behavior', 'scrolith_migrator', `${normalDir}/scrolith-production-runtime-finalize.sql`, [['bootstrap_admin_role', 'synthetic_bootstrap_admin']]);
    assert.doesNotMatch(normalFinalizer.output, /no privileges could be revoked/i,
      'conditional ACL revokes should avoid the harmless empty-ACL NOTICE on the tested PG17 baseline');
    resultSummary.publicAclNoOpNotice = 'not observed in bootstrap, handoff, or finalizer; PUBLIC revokes are conditional on an extant ACL';
    const markerAfterFinalize = query('verify finalizer marker committed while runtime stays NOLOGIN', 'synthetic_bootstrap_admin', `SELECT (SELECT CASE WHEN rolcanlogin THEN 'LOGIN' ELSE 'NOLOGIN' END FROM pg_roles WHERE rolname='scrolith_runtime') || ':' || (SELECT finalized::text FROM public.scrolith_runtime_policy_state WHERE singleton);`);
    assert.equal(markerAfterFinalize, 'NOLOGIN:true');

    const failedEnableDir = await makeSqlCopy('role-sql-fail-enable', {
      file: 'scrolith-production-runtime-enable.sql',
      apply: (contents) => {
        const marker = '\nCOMMIT;';
        assert.ok(contents.includes(marker), 'runtime enable transaction commit marker exists in test copy');
        return contents.replace(marker, '\nSELECT 1 / 0; -- test-only failure before commit\nCOMMIT;');
      }
    });
    const failedEnable = await run('inject separate runtime-enable transaction failure and verify login changes roll back', 'docker', psqlArgs('synthetic_bootstrap_admin', 'scrolith', [
      '-f', `${failedEnableDir}/scrolith-production-runtime-enable.sql`
    ]), { expectFailure: true });
    assert.match(failedEnable.output, /division by zero/i);
    states = query('verify failed enable left migrator LOGIN and runtime NOLOGIN', 'synthetic_bootstrap_admin', `SELECT string_agg(rolname || ':' || CASE WHEN rolcanlogin THEN 'LOGIN' ELSE 'NOLOGIN' END, ',' ORDER BY rolname) FROM pg_roles WHERE rolname IN ('scrolith_runtime','scrolith_migrator','scrolith_backup');`);
    assert.equal(states, 'scrolith_backup:NOLOGIN,scrolith_migrator:LOGIN,scrolith_runtime:NOLOGIN');

    psqlFile('enable runtime only after finalized marker and all checks pass', 'synthetic_bootstrap_admin', `${normalDir}/scrolith-production-runtime-enable.sql`);
    states = query('verify final login handoff', 'synthetic_bootstrap_admin', `SELECT string_agg(rolname || ':' || CASE WHEN rolcanlogin THEN 'LOGIN' ELSE 'NOLOGIN' END, ',' ORDER BY rolname) FROM pg_roles WHERE rolname IN ('scrolith_runtime','scrolith_migrator','scrolith_backup');`);
    assert.equal(states, 'scrolith_backup:NOLOGIN,scrolith_migrator:NOLOGIN,scrolith_runtime:LOGIN');

    const privilegeCounts = query('compare effective table grants to reviewed matrix totals', 'synthetic_bootstrap_admin', `
      SELECT 'select=' || count(*) FILTER (WHERE has_table_privilege('scrolith_runtime', c.oid, 'SELECT')) ||
             ',insert=' || count(*) FILTER (WHERE has_table_privilege('scrolith_runtime', c.oid, 'INSERT')) ||
             ',delete=' || count(*) FILTER (WHERE has_table_privilege('scrolith_runtime', c.oid, 'DELETE')) ||
             ',table_update=' || count(*) FILTER (WHERE has_table_privilege('scrolith_runtime', c.oid, 'UPDATE'))
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
         AND c.relname NOT IN ('_prisma_migrations','scrolith_runtime_policy_state');
    `);
    resultSummary.effectiveGrantCounts = privilegeCounts;
    const columnUpdateTableCount = query('count tables with explicit runtime column UPDATE grants', 'synthetic_bootstrap_admin', `
      SELECT count(DISTINCT a.attrelid)::text
        FROM pg_attribute a
        JOIN pg_class c ON c.oid=a.attrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace
        CROSS JOIN LATERAL aclexplode(a.attacl) x
       WHERE n.nspname='public' AND a.attnum>0 AND NOT a.attisdropped
         AND x.grantee=(SELECT oid FROM pg_roles WHERE rolname='scrolith_runtime')
         AND x.privilege_type='UPDATE';
    `);
    assert.equal(columnUpdateTableCount, '227');
    resultSummary.columnUpdateTables = Number(columnUpdateTableCount);

    const cascadeRisks = query('inventory runtime-deletable parents with destructive FKs into protected history', 'synthetic_bootstrap_admin', `
      WITH protected(name) AS (VALUES
        ('User'),('Order'),('Wallet'),('Transaction'),('WalletFundingIntent'),('PaymentSettlement'),
        ('OrderPaymentIntent'),('OrderPaymentSettlement'),('AdPayment'),('GcoinEarningEvent'),
        ('GcoinWallet'),('GcoinTransaction'),('GcoinConversionRequest'),('WithdrawalRequest'),('Escrow'),('FxLock'),
        ('FoundingPartnerProgram'),('FoundingPartner'),('FoundingPartnerEnrollmentPayment'),
        ('FoundingPartnerProfitPeriod'),('FoundingPartnerProfitSource'),('FoundingPartnerDistributionRun'),
        ('FoundingPartnerDistribution'),('FoundingPartnerAuditLog'))
      SELECT count(*)::text
        FROM pg_constraint fk
        JOIN pg_class child ON child.oid=fk.conrelid JOIN pg_namespace child_ns ON child_ns.oid=child.relnamespace
        JOIN pg_class parent ON parent.oid=fk.confrelid JOIN pg_namespace parent_ns ON parent_ns.oid=parent.relnamespace
        JOIN protected p ON p.name=child.relname
       WHERE fk.contype='f' AND child_ns.nspname='public' AND parent_ns.nspname='public'
         AND fk.confdeltype IN ('c','n','d')
         AND has_table_privilege('scrolith_runtime',parent.oid,'DELETE');
    `);
    assert.equal(cascadeRisks, '0', 'no runtime-deletable parent may cascade or rewrite protected history');
    resultSummary.destructiveHistoryCascadeCount = Number(cascadeRisks);

    const publicGrants = query('verify no explicit PUBLIC object or column ACL remains in public schema', 'synthetic_bootstrap_admin', `
      SELECT ((
        SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault(CASE WHEN c.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,c.relowner))) a
        LEFT JOIN pg_depend e ON e.classid='pg_class'::regclass AND e.objid=c.oid AND e.deptype='e'
        WHERE n.nspname='public' AND e.objid IS NULL AND a.grantee=0
      ) + (
        SELECT count(*) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        CROSS JOIN LATERAL aclexplode(a.attacl) x
        WHERE n.nspname='public' AND a.attnum>0 AND NOT a.attisdropped AND x.grantee=0
      ))::text;
    `);
    assert.equal(publicGrants, '0');

    const setupSql = `
      INSERT INTO public."User" ("id","email","followOnboardingRequired","createdAt","updatedAt") VALUES
        ('role-test-user-1','role-test-1@local.invalid',true,now(),now()),
        ('role-test-user-2','role-test-2@local.invalid',false,now(),now());
      INSERT INTO public."Gig" ("id","title","slug","description","price","deliveryTime","userId","createdAt","updatedAt") VALUES
        ('role-test-linked-gig','Synthetic linked gig','role-test-linked-gig','Disposable role test gig',10,2,'role-test-user-1',now(),now()),
        ('role-test-unlinked-gig','Synthetic unlinked gig','role-test-unlinked-gig','Disposable role test gig',10,2,'role-test-user-1',now(),now());
      INSERT INTO public."Order" ("id","gigId","clientId","freelancerId","amount","createdAt","updatedAt") VALUES
        ('role-test-order-1','role-test-linked-gig','role-test-user-2','role-test-user-1',10,now(),now());
      INSERT INTO public."Wallet" ("id","userId","updatedAt") VALUES
        ('role-test-wallet-1','role-test-user-1',now());
      INSERT INTO public."Transaction" ("id","walletId","userId","type","amount","currency","createdAt","updatedAt") VALUES
        ('role-test-transaction-1','role-test-wallet-1','role-test-user-1','DEPOSIT',1,'USD',now(),now());
      INSERT INTO public."CommunityAd" ("id","creatorId","title","body","placement","createdAt","updatedAt") VALUES
        ('role-test-paid-ad','role-test-user-1','Synthetic ad','Local permission test','feed',now(),now()),
        ('role-test-unpaid-ad','role-test-user-1','Synthetic unpaid ad','Local permission test','feed',now(),now());
      INSERT INTO public."AdPayment" ("id","adId","amount","currency","status")
        VALUES ('role-test-ad-payment-1','role-test-paid-ad',12.50,'USD','completed');
      INSERT INTO public."WalletFundingIntent" ("id","userId","walletId","provider","amount","currency","status","createdAt","updatedAt")
        VALUES ('role-test-funding-intent-1','role-test-user-1','role-test-wallet-1','synthetic',5,'USD','SUCCEEDED',now(),now());
      INSERT INTO public."PaymentSettlement" ("id","provider","providerReferenceId","intentId")
        VALUES ('role-test-settlement-1','synthetic','role-test-provider-ref','role-test-funding-intent-1');
      INSERT INTO public."WithdrawalRequest" ("id","userId","amount","method","details","updatedAt")
        VALUES ('role-test-withdrawal-1','role-test-user-1',1,'synthetic','{"case":"local"}'::jsonb,now());
      INSERT INTO public."GcoinWallet" ("id","userId","recipientId","updatedAt")
        VALUES ('role-test-gcoin-wallet-1','role-test-user-2','role-test-user-2',now());
      INSERT INTO public."GcoinTransaction" ("id","userId","type","amount")
        VALUES ('role-test-gcoin-transaction-1','role-test-user-2','synthetic',1);
    `;
    psql('runtime inserts supported synthetic account and representative financial rows', 'scrolith_runtime', 'scrolith', setupSql);

    psql('runtime can execute supported balance, status, FX/provider, withdrawal-detail, Gcoin, AdPayment, language-preference, and onboarding updates', 'scrolith_runtime', 'scrolith', `
      UPDATE public."Wallet" SET "balance"="balance"+1 WHERE "id"='role-test-wallet-1';
      UPDATE public."Transaction" SET "status"='COMPLETED', "description"='synthetic status update' WHERE "id"='role-test-transaction-1';
      UPDATE public."WalletFundingIntent" SET "status"="status", "fxLockId"=NULL WHERE "id"='role-test-funding-intent-1';
      UPDATE public."WithdrawalRequest" SET "details"="details", "status"="status" WHERE "id"='role-test-withdrawal-1';
      UPDATE public."GcoinWallet" SET "balance"="balance"+1 WHERE "id"='role-test-gcoin-wallet-1';
      UPDATE public."AdPayment" SET "amount"="amount", "currency"="currency", "status"="status" WHERE "id"='role-test-ad-payment-1';
      UPDATE public."User" SET "understoodLanguages"=ARRAY['en'], "languagePreferencesConfirmed"=true, "languagePreferencesUpdatedAt"=now(), "updatedAt"=now() WHERE "id"='role-test-user-1';
      UPDATE public."User" SET "followOnboardingRequired"=false, "followOnboardingCompletedAt"=now(), "updatedAt"=now() WHERE "id"='role-test-user-1';
      UPDATE public."OrderPaymentIntent" SET "status"="status", "fxLockId"="fxLockId" WHERE false;
      UPDATE public."GcoinEarningEvent" SET "reactionActive"="reactionActive", "reversalCount"="reversalCount" WHERE false;
    `);

    const onboardingWrite = query('verify language preference and onboarding values persisted under runtime role', 'scrolith_runtime', `
      SELECT array_to_string("understoodLanguages", ',') || ':' || "languagePreferencesConfirmed"::text || ':' ||
             ("languagePreferencesUpdatedAt" IS NOT NULL)::text || ':' || "followOnboardingRequired"::text || ':' ||
             ("followOnboardingCompletedAt" IS NOT NULL)::text
        FROM public."User" WHERE "id"='role-test-user-1';
    `);
    assert.equal(onboardingWrite, 'en:true:true:false:true');
    const onboardingPrivilegeState = query('assert exact User onboarding columns and no table-wide UPDATE', 'synthetic_bootstrap_admin', `
      SELECT has_table_privilege('scrolith_runtime','public."User"','UPDATE')::text || ':' ||
             has_column_privilege('scrolith_runtime','public."User"','understoodLanguages','UPDATE')::text || ':' ||
             has_column_privilege('scrolith_runtime','public."User"','languagePreferencesConfirmed','UPDATE')::text || ':' ||
             has_column_privilege('scrolith_runtime','public."User"','languagePreferencesUpdatedAt','UPDATE')::text || ':' ||
             has_column_privilege('scrolith_runtime','public."User"','followOnboardingRequired','UPDATE')::text || ':' ||
             has_column_privilege('scrolith_runtime','public."User"','followOnboardingCompletedAt','UPDATE')::text || ':' ||
             has_column_privilege('scrolith_runtime','public."User"','updatedAt','UPDATE')::text || ':' ||
             has_column_privilege('scrolith_runtime','public."User"','twoFactorSecret','UPDATE')::text;
    `);
    assert.equal(onboardingPrivilegeState, 'false:true:true:true:true:true:true:false');

    const linkedGigDelete = expectDenied('runtime cannot delete an order-linked gig or detach order history', `DELETE FROM public."Gig" WHERE "id"='role-test-linked-gig'`, /violates foreign key constraint|still referenced/i);
    assert.match(linkedGigDelete.output, /Order_gigId_fkey/i);
    const preservedGigLink = query('verify linked order still references its original gig', 'scrolith_runtime', `SELECT "gigId" FROM public."Order" WHERE "id"='role-test-order-1';`);
    assert.equal(preservedGigLink, 'role-test-linked-gig');
    psql('runtime can hard-delete an unreferenced gig', 'scrolith_runtime', 'scrolith', `DELETE FROM public."Gig" WHERE "id"='role-test-unlinked-gig';`);

    const paidAdDelete = expectDenied('paid CommunityAd delete is stopped by restrictive AdPayment FK and does not erase history', `DELETE FROM public."CommunityAd" WHERE "id"='role-test-paid-ad'`, /violates foreign key constraint|still referenced/i);
    assert.match(paidAdDelete.output, /AdPayment/i);
    psql('runtime can delete an unpaid CommunityAd through supported cleanup path', 'scrolith_runtime', 'scrolith', `DELETE FROM public."CommunityAd" WHERE "id"='role-test-unpaid-ad';`);

    for (const [label, sql, expected] of [
      ['Wallet identity or currency update is denied', `UPDATE public."Wallet" SET "currency"="currency" WHERE false`, /permission denied/i],
      ['Transaction amount update is denied', `UPDATE public."Transaction" SET "amount"="amount" WHERE false`, /permission denied/i],
      ['Transaction currency update is denied', `UPDATE public."Transaction" SET "currency"="currency" WHERE false`, /permission denied/i],
      ['Funding intent amount update is denied', `UPDATE public."WalletFundingIntent" SET "amount"="amount" WHERE false`, /permission denied/i],
      ['Funding intent currency update is denied', `UPDATE public."WalletFundingIntent" SET "currency"="currency" WHERE false`, /permission denied/i],
      ['unapproved User security-field update is denied while narrow preference updates are allowed', `UPDATE public."User" SET "twoFactorSecret"=NULL WHERE "id"='role-test-user-1'`, /permission denied/i],
      ['Withdrawal amount update is denied', `UPDATE public."WithdrawalRequest" SET "amount"="amount" WHERE false`, /permission denied/i],
      ['Withdrawal owner update is denied', `UPDATE public."WithdrawalRequest" SET "userId"="userId" WHERE false`, /permission denied/i],
      ['Gcoin wallet owner update is denied', `UPDATE public."GcoinWallet" SET "userId"="userId" WHERE false`, /permission denied/i],
      ['AdPayment foreign-key update is denied', `UPDATE public."AdPayment" SET "adId"="adId" WHERE false`, /permission denied/i],
      ['Transaction delete is denied', `DELETE FROM public."Transaction" WHERE "id"='role-test-transaction-1'`, /permission denied/i],
      ['settlement delete is denied', `DELETE FROM public."PaymentSettlement" WHERE "id"='role-test-settlement-1'`, /permission denied/i],
      ['AdPayment delete is denied', `DELETE FROM public."AdPayment" WHERE "id"='role-test-ad-payment-1'`, /permission denied/i],
      ['OrderPaymentIntent delete is denied', `DELETE FROM public."OrderPaymentIntent" WHERE false`, /permission denied/i],
      ['Gcoin transaction delete is denied', `DELETE FROM public."GcoinTransaction" WHERE "id"='role-test-gcoin-transaction-1'`, /permission denied/i],
      ['Gcoin wallet delete is denied', `DELETE FROM public."GcoinWallet" WHERE "id"='role-test-gcoin-wallet-1'`, /permission denied/i],
      ['user parent delete is denied before any account cascade', `DELETE FROM public."User" WHERE "id"='role-test-user-1'`, /permission denied/i],
      ['wallet delete is denied', `DELETE FROM public."Wallet" WHERE "id"='role-test-wallet-1'`, /permission denied/i],
      ['financial table truncate is denied', `TRUNCATE public."Wallet"`, /permission denied/i],
      ['runtime cannot write Prisma migration history', `UPDATE public."_prisma_migrations" SET migration_name=migration_name WHERE false`, /permission denied/i],
      ['runtime cannot create schema objects', `CREATE TABLE public.role_test_forbidden (id integer)`, /permission denied/i],
      ['runtime cannot become the migrator', `SET ROLE scrolith_migrator`, /permission denied|cannot set role/i]
    ]) expectDenied(label, sql, expected);

    psql('clone the finalized schema to a test-named database for actual authenticated HTTP regression', 'synthetic_bootstrap_admin', 'postgres', `
      CREATE DATABASE scrolith_role_e2e TEMPLATE scrolith OWNER synthetic_bootstrap_admin;
    `);
    const httpEnv = {
      ...isolatedEnv,
      DATABASE_URL: `postgresql://scrolith_runtime@127.0.0.1:${hostPort}/scrolith_role_e2e?sslmode=disable`,
      NODE_ENV: 'test',
      APP_RUNTIME: 'test',
      SCROLITH_ROLE_HTTP_TEST_APPROVED: 'true',
      TEST_DB_PORT: String(hostPort),
      TEST_DB_PROJECT: 'local-only',
      TEST_DB_NAME: 'scrolith_role_e2e',
      REDIS_TEST_MODE: 'local',
      REDIS_RATE_LIMIT_FAIL_CLOSED: 'true',
      ALLOW_DEV_AUTH_BYPASS: 'false',
      DISABLE_BACKGROUND_WORKERS: 'true',
      SCROLITH_MONEY_MOVEMENT_ENABLED: 'false',
      EXTERNAL_PLATFORM_API_ENABLED: 'false',
      SCROLITHA_PROVIDER: 'disabled',
      UPLOAD_DRIVER: 'local',
      JWT_SECRET: randomBytes(48).toString('base64url')
    };
    run('authenticated language-preference save, onboarding completion, reload, and denied-column HTTP regression on disposable cloned PG17 under scrolith_runtime', process.execPath, [
      resolve(backendRoot, 'node_modules', 'jest', 'bin', 'jest.js'),
      '--config', 'jest.config.cjs', '--runInBand', '--runTestsByPath',
      'src/__tests__/profile.runtime-role.integration.test.ts', '--testTimeout=60000'
    ], { cwd: backendRoot, env: httpEnv, timeout: 180000 });

    const finalMigrationState = query('record exact migration count, marker state, and effective roles', 'synthetic_bootstrap_admin', `
      SELECT (SELECT count(*)::text FROM public."_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) || ':' ||
             (SELECT finalized::text FROM public.scrolith_runtime_policy_state WHERE singleton) || ':' ||
             (SELECT string_agg(rolname || '=' || CASE WHEN rolcanlogin THEN 'LOGIN' ELSE 'NOLOGIN' END, ',' ORDER BY rolname)
                FROM pg_roles WHERE rolname IN ('scrolith_runtime','scrolith_migrator','scrolith_backup'));
    `);
    assert.equal(finalMigrationState, '143:true:scrolith_backup=NOLOGIN,scrolith_migrator=NOLOGIN,scrolith_runtime=LOGIN');
    resultSummary.finalState = finalMigrationState;
    resultSummary.runtimeOperations = 'synthetic inserts, language preference and follow-onboarding updates/reloads, exact User allowlist, forbidden security-column update, financial field denial, direct and cascading-delete protection including restrictive Order-to-Gig retention, DDL/ledger denial passed';

    psql('temporarily enable migrator only inside disposable existing-database permission test', 'synthetic_bootstrap_admin', 'scrolith', 'ALTER ROLE scrolith_migrator LOGIN;');
    const repeatedFinalizer = docker('confirm first-launch full finalizer rejects an already initialized active database', psqlArgs('scrolith_migrator', 'scrolith', [
      '-v', 'bootstrap_admin_role=synthetic_bootstrap_admin',
      '-f', `${normalDir}/scrolith-production-runtime-finalize.sql`
    ]), { expectFailure: true });
    assert.match(repeatedFinalizer.output, /runtime remains NOLOGIN/);

    psql('simulate recorded existing-database ACL state by removing only the three missing language columns', 'scrolith_migrator', 'scrolith', `
      REVOKE UPDATE ("languagePreferencesConfirmed", "languagePreferencesUpdatedAt", "understoodLanguages")
        ON TABLE public."User" FROM scrolith_runtime;
    `);
    const baselineUserState = query('verify disposable existing state has only the three missing User UPDATE columns', 'synthetic_bootstrap_admin', `
      SELECT has_table_privilege('scrolith_runtime','public."User"','UPDATE')::text || ':' ||
             has_column_privilege('scrolith_runtime','public."User"','languagePreferencesConfirmed','UPDATE')::text || ':' ||
             has_column_privilege('scrolith_runtime','public."User"','languagePreferencesUpdatedAt','UPDATE')::text || ':' ||
             has_column_privilege('scrolith_runtime','public."User"','understoodLanguages','UPDATE')::text || ':' ||
             has_column_privilege('scrolith_runtime','public."User"','followOnboardingRequired','UPDATE')::text || ':' ||
             has_column_privilege('scrolith_runtime','public."User"','followOnboardingCompletedAt','UPDATE')::text || ':' ||
             has_column_privilege('scrolith_runtime','public."User"','updatedAt','UPDATE')::text || ':' ||
             has_table_privilege('scrolith_runtime','public."User"','DELETE')::text || ':' ||
             has_table_privilege('scrolith_runtime','public."User"','TRUNCATE')::text;
    `);
    assert.equal(baselineUserState, 'false:false:false:false:true:true:true:false:false');

    const effectiveAclFingerprintSql = `
      SELECT md5(
        COALESCE((
          SELECT string_agg(c.relname || ':' || p.privilege || ':' ||
                   has_table_privilege('scrolith_runtime', c.oid, p.privilege)::text,
                   '|' ORDER BY c.relname, p.privilege)
            FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(privilege)
           WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
        ), '') || '/' || COALESCE((
          SELECT string_agg(c.relname || '.' || a.attname || ':' || p.privilege || ':' ||
                   has_column_privilege('scrolith_runtime', c.oid, a.attnum, p.privilege)::text,
                   '|' ORDER BY c.relname, a.attnum, p.privilege)
            FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            JOIN pg_attribute a ON a.attrelid=c.oid
            CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) p(privilege)
           WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
             AND a.attnum > 0 AND NOT a.attisdropped
             AND NOT (c.relname='User' AND a.attname = ANY(ARRAY[
               'languagePreferencesConfirmed','languagePreferencesUpdatedAt','understoodLanguages'
             ]))
        ), '')
      );
    `;
    const aclFingerprintBefore = query('capture effective public-schema privileges before the incremental procedure', 'synthetic_bootstrap_admin', effectiveAclFingerprintSql);

    const readOnlyInspection = docker('run prepared read-only existing-database role, marker, ownership, and ACL inspection on disposable PG17', psqlArgs('synthetic_bootstrap_admin', 'scrolith', [
      '-A', '-t', '-f', `${normalDir}/scrolith-production-user-language-preferences-inspect.sql`
    ]));
    assert.match(readOnlyInspection.output, /Connection and target facts/);
    assert.ok(readOnlyInspection.output.includes(sourceSha));
    assert.match(readOnlyInspection.output, /143/);
    assert.match(readOnlyInspection.output, /understoodLanguages/);
    assert.equal(query('verify read-only inspection did not change effective runtime ACLs', 'synthetic_bootstrap_admin', effectiveAclFingerprintSql), aclFingerprintBefore);
    const wrongMarkerApply = docker('reject incremental grant when the declared existing policy marker SHA is wrong', psqlArgs('scrolith_migrator', 'scrolith', [
      '-v', `expected_source_commit=${incrementalReleaseSha}`,
      '-v', `expected_policy_source_commit=${'0'.repeat(40)}`,
      '-f', `${normalDir}/scrolith-production-user-language-preferences-apply.sql`
    ]), { expectFailure: true });
    assert.match(wrongMarkerApply.output, /existing finalized policy marker does not match/);
    psql('create a test-only PUBLIC ACL drift to verify fail-closed handling', 'scrolith_migrator', 'scrolith',
      'GRANT SELECT ON TABLE public."User" TO PUBLIC;');
    const publicAclApply = docker('reject an existing database with PUBLIC privileges on User', psqlArgs('scrolith_migrator', 'scrolith', [
      '-v', 'expected_source_commit=' + incrementalReleaseSha,
      '-v', 'expected_policy_source_commit=' + sourceSha,
      '-f', normalDir + '/scrolith-production-user-language-preferences-apply.sql'
    ]), { expectFailure: true });
    assert.match(publicAclApply.output, /PUBLIC retains unexpected User table or column privileges/);
    assert.equal(query('verify PUBLIC ACL rejection changed no target User updates', 'synthetic_bootstrap_admin',
      "SELECT has_column_privilege('scrolith_runtime','public.\"User\"','languagePreferencesConfirmed','UPDATE')::text || ':' || " +
      "has_column_privilege('scrolith_runtime','public.\"User\"','languagePreferencesUpdatedAt','UPDATE')::text || ':' || " +
      "has_column_privilege('scrolith_runtime','public.\"User\"','understoodLanguages','UPDATE')::text;"), 'false:false:false');
    psql('remove only the synthetic PUBLIC ACL drift after its rejection test', 'scrolith_migrator', 'scrolith',
      'REVOKE SELECT ON TABLE public."User" FROM PUBLIC;');
    assert.equal(query('verify baseline effective ACL restored after PUBLIC drift test', 'synthetic_bootstrap_admin', effectiveAclFingerprintSql), aclFingerprintBefore);
    assert.equal(query('verify wrong marker attempt changed no User privileges', 'synthetic_bootstrap_admin', `
      SELECT has_column_privilege('scrolith_runtime','public."User"','languagePreferencesConfirmed','UPDATE')::text || ':' ||
             has_column_privilege('scrolith_runtime','public."User"','languagePreferencesUpdatedAt','UPDATE')::text || ':' ||
             has_column_privilege('scrolith_runtime','public."User"','understoodLanguages','UPDATE')::text;
    `), 'false:false:false');

    psql('create a partial target-column state to verify fail-closed handling', 'scrolith_migrator', 'scrolith', `
      GRANT UPDATE ("languagePreferencesConfirmed")
        ON TABLE public."User" TO scrolith_runtime;
    `);
    const partialGrantApply = docker('reject an existing database with a partial language-column grant', psqlArgs('scrolith_migrator', 'scrolith', [
      '-v', `expected_source_commit=${incrementalReleaseSha}`,
      '-v', `expected_policy_source_commit=${sourceSha}`,
      '-f', `${normalDir}/scrolith-production-user-language-preferences-apply.sql`
    ]), { expectFailure: true });
    assert.match(partialGrantApply.output, /language-preference UPDATE columns are partially granted/);
    assert.equal(query('verify partial-grant guard leaves the original partial ACL unchanged', 'synthetic_bootstrap_admin', `
      SELECT has_column_privilege('scrolith_runtime','public."User"','languagePreferencesConfirmed','UPDATE')::text || ':' ||
             has_column_privilege('scrolith_runtime','public."User"','languagePreferencesUpdatedAt','UPDATE')::text || ':' ||
             has_column_privilege('scrolith_runtime','public."User"','understoodLanguages','UPDATE')::text;
    `), 'true:false:false');
    assert.equal(query('verify partial-grant guard preserves all non-target public ACLs', 'synthetic_bootstrap_admin', effectiveAclFingerprintSql), aclFingerprintBefore);
    psql('restore the synthetic pre-procedure ACL after partial-state assertion', 'scrolith_migrator', 'scrolith', `
      REVOKE UPDATE ("languagePreferencesConfirmed")
        ON TABLE public."User" FROM scrolith_runtime;
    `);
    assert.equal(query('verify partial-state setup was fully rolled back to the baseline ACL', 'synthetic_bootstrap_admin', `
      SELECT has_column_privilege('scrolith_runtime','public."User"','languagePreferencesConfirmed','UPDATE')::text || ':' ||
             has_column_privilege('scrolith_runtime','public."User"','languagePreferencesUpdatedAt','UPDATE')::text || ':' ||
             has_column_privilege('scrolith_runtime','public."User"','understoodLanguages','UPDATE')::text;
    `), 'false:false:false');

    psqlFile('apply guarded three-column permission increment to a disposable initialized PostgreSQL 17 state', 'scrolith_migrator', `${normalDir}/scrolith-production-user-language-preferences-apply.sql`, [
      ['expected_source_commit', incrementalReleaseSha],
      ['expected_policy_source_commit', sourceSha]
    ]);
    const appliedState = query('assert incremental grant preserves exact User allowlist and active role state', 'synthetic_bootstrap_admin', `
      SELECT has_table_privilege('scrolith_runtime','public."User"','UPDATE')::text || ':' ||
             has_column_privilege('scrolith_runtime','public."User"','languagePreferencesConfirmed','UPDATE')::text || ':' ||
             has_column_privilege('scrolith_runtime','public."User"','languagePreferencesUpdatedAt','UPDATE')::text || ':' ||
             has_column_privilege('scrolith_runtime','public."User"','understoodLanguages','UPDATE')::text || ':' ||
             has_column_privilege('scrolith_runtime','public."User"','followOnboardingRequired','UPDATE')::text || ':' ||
             has_column_privilege('scrolith_runtime','public."User"','followOnboardingCompletedAt','UPDATE')::text || ':' ||
             has_column_privilege('scrolith_runtime','public."User"','updatedAt','UPDATE')::text || ':' ||
             has_table_privilege('scrolith_runtime','public."User"','DELETE')::text || ':' ||
             has_table_privilege('scrolith_runtime','public."User"','TRUNCATE')::text || ':' ||
             (SELECT string_agg(rolname || '=' || CASE WHEN rolcanlogin THEN 'LOGIN' ELSE 'NOLOGIN' END, ',' ORDER BY rolname)
                FROM pg_roles WHERE rolname IN ('scrolith_runtime','scrolith_migrator','scrolith_backup'));
    `);
    assert.equal(appliedState, 'false:true:true:true:true:true:true:false:false:scrolith_backup=NOLOGIN,scrolith_migrator=LOGIN,scrolith_runtime=LOGIN');
    assert.equal(query('verify existing effective privileges outside the three approved columns were preserved', 'synthetic_bootstrap_admin', effectiveAclFingerprintSql), aclFingerprintBefore);

    psqlFile('retry incremental grant idempotently on the same initialized state', 'scrolith_migrator', `${normalDir}/scrolith-production-user-language-preferences-apply.sql`, [
      ['expected_source_commit', incrementalReleaseSha],
      ['expected_policy_source_commit', sourceSha]
    ]);
    assert.equal(query('verify idempotent retry preserves the applied ACL', 'synthetic_bootstrap_admin', `
      SELECT has_column_privilege('scrolith_runtime','public."User"','languagePreferencesConfirmed','UPDATE')::text || ':' ||
             has_column_privilege('scrolith_runtime','public."User"','languagePreferencesUpdatedAt','UPDATE')::text || ':' ||
             has_column_privilege('scrolith_runtime','public."User"','understoodLanguages','UPDATE')::text;
    `), 'true:true:true');

    psqlFile('execute focused existing-database rollback on disposable PostgreSQL 17', 'scrolith_migrator', `${normalDir}/scrolith-production-user-language-preferences-rollback.sql`, [
      ['expected_source_commit', incrementalReleaseSha],
      ['expected_policy_source_commit', sourceSha]
    ]);
    const rollbackState = query('verify focused rollback removes only the three increment columns', 'synthetic_bootstrap_admin', `
      SELECT has_table_privilege('scrolith_runtime','public."User"','UPDATE')::text || ':' ||
             has_column_privilege('scrolith_runtime','public."User"','understoodLanguages','UPDATE')::text || ':' ||
             has_column_privilege('scrolith_runtime','public."User"','languagePreferencesConfirmed','UPDATE')::text || ':' ||
             has_column_privilege('scrolith_runtime','public."User"','languagePreferencesUpdatedAt','UPDATE')::text || ':' ||
             has_column_privilege('scrolith_runtime','public."User"','followOnboardingRequired','UPDATE')::text || ':' ||
             has_column_privilege('scrolith_runtime','public."User"','followOnboardingCompletedAt','UPDATE')::text || ':' ||
             has_column_privilege('scrolith_runtime','public."User"','updatedAt','UPDATE')::text || ':' ||
             has_table_privilege('scrolith_runtime','public."User"','DELETE')::text || ':' ||
             has_table_privilege('scrolith_runtime','public."User"','TRUNCATE')::text;
    `);
    assert.equal(rollbackState, 'false:false:false:false:true:true:true:false:false');
    assert.equal(query('verify focused rollback preserves every other effective public-schema privilege', 'synthetic_bootstrap_admin', effectiveAclFingerprintSql), aclFingerprintBefore);
    resultSummary.rollbackState = rollbackState;
    resultSummary.rollbackOperations = 'existing-state marker mismatch rejected without ACL changes; exact three-column grant applied and safely retried; focused rollback removed only the three added columns, preserving onboarding, updatedAt, all other effective public-schema privileges, runtime login, and migration ownership';

    psqlFile('restore the tested incremental grant as the final disposable candidate state', 'scrolith_migrator', `${normalDir}/scrolith-production-user-language-preferences-apply.sql`, [
      ['expected_source_commit', incrementalReleaseSha],
      ['expected_policy_source_commit', sourceSha]
    ]);
    psql('restore migrator NOLOGIN after disposable existing-database permission test', 'synthetic_bootstrap_admin', 'scrolith', 'ALTER ROLE scrolith_migrator NOLOGIN;');
    psql('runtime can update exactly the three language-preference fields after the increment', 'scrolith_runtime', 'scrolith', `
      UPDATE public."User" SET "understoodLanguages"="understoodLanguages",
        "languagePreferencesConfirmed"="languagePreferencesConfirmed",
        "languagePreferencesUpdatedAt"="languagePreferencesUpdatedAt" WHERE false;
    `);
    psql('incremental grant preserves onboarding and updatedAt UPDATE operations', 'scrolith_runtime', 'scrolith', `
      UPDATE public."User" SET "followOnboardingRequired"="followOnboardingRequired",
        "followOnboardingCompletedAt"="followOnboardingCompletedAt", "updatedAt"="updatedAt" WHERE false;
    `);
    assert.equal(query('verify final incremental state keeps application roles at original login state', 'synthetic_bootstrap_admin', `
      SELECT string_agg(rolname || '=' || CASE WHEN rolcanlogin THEN 'LOGIN' ELSE 'NOLOGIN' END, ',' ORDER BY rolname)
        FROM pg_roles WHERE rolname IN ('scrolith_runtime','scrolith_migrator','scrolith_backup');
    `), 'scrolith_backup=NOLOGIN,scrolith_migrator=NOLOGIN,scrolith_runtime=LOGIN');
    resultSummary.incrementalState = 'User targeted columns granted; all pre-existing User and public-schema runtime privileges preserved; runtime LOGIN/migrator NOLOGIN/backup NOLOGIN';
    const currentContainer = docker('verify task container label and image before cleanup', ['inspect', containerName, '--format', '{{index .Config.Labels "com.scrolith.validation.owner"}} {{.Image}}']);
    assert.match(currentContainer.output, /^production-db-role-pg17-20261121\s+sha256:/);
  } finally {
    const exists = spawnSync('docker', ['inspect', containerName], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    if (exists.status === 0) {
      const labels = spawnSync('docker', ['inspect', containerName, '--format', '{{index .Config.Labels "com.scrolith.validation.owner"}}'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
      if (labels.status === 0 && labels.stdout.trim() === 'production-db-role-pg17-20261121') {
        const removed = spawnSync('docker', ['rm', '-f', containerName], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
        logLines.push(`## remove task-owned disposable PostgreSQL container\nexit=${removed.status ?? 1}\n${redact(`${removed.stdout ?? ''}${removed.stderr ?? ''}`).trim()}\n`);
        if (removed.status !== 0) resultSummary.cleanupFailure = redact(`${removed.stdout ?? ''}${removed.stderr ?? ''}`);
      } else {
        resultSummary.cleanupFailure = 'container existed but task ownership label did not match; left untouched';
      }
    }
    await rm(tempRoot, { recursive: true, force: true });
    const logPath = join(evidenceRoot, `pg17-role-validation-${runId}.log`);
    const summaryPath = join(evidenceRoot, `pg17-role-validation-${runId}.json`);
    await writeFile(logPath, logLines.join('\n'), 'utf8');
    await writeFile(summaryPath, `${JSON.stringify(resultSummary, null, 2)}\n`, 'utf8');
    console.log(`Disposable PostgreSQL 17 validation evidence: ${basename(logPath)} / ${basename(summaryPath)}`);
  }

  assert.equal(containerStarted, true, 'task-owned local PostgreSQL container was created for the run');
});
