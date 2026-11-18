import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = fileURLToPath(new URL('.', import.meta.url));

const runGuard = ({ url, port = '55432', name = 'scrolith_test', kind = 'local-disposable' }) => {
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    APP_RUNTIME: 'test',
    DISABLE_BACKGROUND_WORKERS: 'true',
    DATABASE_URL: url,
    TEST_DB_KIND: kind,
    TEST_DB_PROJECT: 'local-only',
    TEST_DB_INSTANCE: kind === 'local-postgres' ? 'local-postgres-test' : 'local-disposable-postgres-test',
    TEST_DB_NAME: name,
    TEST_DB_PORT: port
  };
  return spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./scripts/test-db-guard.mjs')"], {
    cwd: process.cwd(), env, encoding: 'utf8', timeout: 5000
  });
};

test('database guard accepts an explicitly marked loopback disposable database on configured port', () => {
  const result = runGuard({ url: 'postgresql://synthetic:synthetic@127.0.0.1:55432/scrolith_test' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Test database guard passed/);
});

test('database guard accepts a separately configured loopback port without relaxing markers', () => {
  const result = runGuard({
    url: 'postgresql://synthetic:synthetic@localhost:55433/scrolith_test', port: '55433'
  });
  assert.equal(result.status, 0, result.stderr);
});

test('database guard rejects the owner Marketplace port even with test-like credentials', () => {
  const result = runGuard({ url: 'postgresql://synthetic:synthetic@127.0.0.1:5432/scrolith_test' });
  assert.notEqual(result.status, 0);
});

test('database guard rejects remote hosts', () => {
  const result = runGuard({ url: 'postgresql://synthetic:synthetic@db.example.invalid:55432/scrolith_test' });
  assert.notEqual(result.status, 0);
});

test('database guard rejects a non-disposable database name', () => {
  const result = runGuard({
    url: 'postgresql://synthetic:synthetic@127.0.0.1:55432/scrolith', name: 'scrolith'
  });
  assert.notEqual(result.status, 0);
});

test('database guard rejects non-PostgreSQL URLs even on loopback', () => {
  const result = runGuard({
    url: 'mysql://synthetic:synthetic@127.0.0.1:55432/scrolith_test'
  });
  assert.notEqual(result.status, 0);
});

for (const runner of ['run-jest-full.mjs', 'run-test-db-command.mjs']) {
  test(`${runner} refuses to start without an explicit test database URL`, () => {
    const cwd = mkdtempSync(join(tmpdir(), 'scrolith-missing-db-url-'));
    const env = { ...process.env };
    for (const key of ['DATABASE_URL', 'TEST_DB_KIND', 'TEST_DB_PROJECT', 'TEST_DB_INSTANCE', 'TEST_DB_NAME', 'TEST_DB_PORT']) {
      delete env[key];
    }
    try {
      const result = spawnSync(process.execPath, [resolve(scriptsDir, runner), '--guard-only'], {
        cwd,
        env,
        encoding: 'utf8',
        timeout: 5000
      });
      const output = `${result.stdout || ''}${result.stderr || ''}`;
      assert.notEqual(result.status, 0, output);
      assert.match(output, /DATABASE_URL must target an explicitly configured disposable test database/);
      assert.doesNotMatch(output, /(?:postgres(?:ql)?|redis|mongodb(?:\+srv)?):\/\/[^\s]+/i);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
}
