import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const runnerPath = resolve(repositoryRoot, 'deploy', 'postgres', 'run-production-inspector.sh');
const shellPath = process.platform === 'win32'
  ? null
  : (process.env.SCROLITH_INSPECTOR_TEST_SHELL || '/bin/sh');

const safePgEnvironment = (path) => ({
  PATH: path,
  PGHOST: 'psql-scrolith-prod-sea-2026.postgres.database.azure.com',
  PGPORT: '5432',
  PGDATABASE: 'scrolith',
  PGUSER: 'scrolith_inspector',
  PGSSLMODE: 'verify-full',
  PGSSLROOTCERT: '/etc/ssl/certs/ca-certificates.crt',
  PGPASSWORD: 'synthetic-test-only-not-a-real-credential',
});

async function runWrapper(fakePsqlBody) {
  const tempRoot = await mkdtemp(resolve(os.tmpdir(), 'scrolith-inspector-wrapper-'));
  try {
    const binRoot = resolve(tempRoot, 'bin');
    await mkdir(binRoot);
    const psqlPath = resolve(binRoot, 'psql');
    const fakePsql = `#!/bin/sh\n${fakePsqlBody}\n`;
    await writeFile(psqlPath, fakePsql, { encoding: 'utf8', flag: 'wx' });
    await chmod(psqlPath, 0o700);

    const env = safePgEnvironment(`${binRoot}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`);
    const result = spawnSync(shellPath, [runnerPath], {
      cwd: repositoryRoot,
      env,
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    return {
      status: result.status,
      error: result.error,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

test('successful wrapper emits only the complete report and no psql stderr', {
  skip: shellPath ? false : 'a POSIX shell is required; CI sets SCROLITH_INSPECTOR_TEST_SHELL=/bin/sh',
}, async () => {
  const report = 'INSPECTOR_REPORT_BEGIN\nsynthetic metadata summary\nINSPECTOR_REPORT_END\n';
  const result = await runWrapper(
    `printf '%s' '${report.replaceAll("'", "'\\''")}'\nprintf '%s\\n' 'synthetic psql stderr must be suppressed' >&2`,
  );

  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, report);
  assert.equal(result.stderr, '');
});

test('failed wrapper emits no partial report or psql stderr and preserves failure status', {
  skip: shellPath ? false : 'a POSIX shell is required; CI sets SCROLITH_INSPECTOR_TEST_SHELL=/bin/sh',
}, async () => {
  const result = await runWrapper(
    "printf '%s\\n' 'PARTIAL_INSPECTION_REPORT_MUST_NOT_ESCAPE'\nprintf '%s\\n' 'synthetic psql failure detail must be suppressed' >&2\nexit 23",
  );

  assert.equal(result.error, undefined);
  assert.equal(result.status, 23);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});

test('wrapper contract keeps the report buffered until psql succeeds', async () => {
  const source = await readFile(runnerPath, 'utf8');
  assert.match(source, /psql -X -q -w -v ON_ERROR_STOP=1 --file=\/opt\/scrolith\/inspect\.sql >"\$report_file" 2>\/dev\/null/);
  assert.match(source, /then\n  cat "\$report_file"\nelse\n  exit \$\?/);
  assert.doesNotMatch(source, /set -x|\btee\s/);
});
