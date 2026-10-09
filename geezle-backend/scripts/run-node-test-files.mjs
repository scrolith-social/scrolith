import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

process.env.NODE_ENV = 'test';
process.env.APP_RUNTIME = 'test';
process.env.DISABLE_BACKGROUND_WORKERS = 'true';
process.env.DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://scrolith_test:local_test_password@127.0.0.1:55432/scrolith_test';
process.env.SHADOW_DATABASE_URL =
  process.env.SHADOW_DATABASE_URL ||
  'postgresql://scrolith_test:local_test_password@127.0.0.1:55432/scrolith_shadow';
process.env.TEST_DB_KIND = process.env.TEST_DB_KIND || 'local-postgres';
process.env.TEST_DB_PROJECT = process.env.TEST_DB_PROJECT || 'local-only';
process.env.TEST_DB_INSTANCE = process.env.TEST_DB_INSTANCE || 'local-postgres-test';
process.env.TEST_DB_NAME = process.env.TEST_DB_NAME || 'scrolith_test';

await import('./test-db-guard.mjs');

const collectNodeTestFiles = (dir) => {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'dist') {
        files.push(...collectNodeTestFiles(fullPath));
      }
      continue;
    }
    if (!/\.(test|spec)\.ts$/.test(entry.name)) {
      continue;
    }
    const source = readFileSync(fullPath, 'utf8');
    if (source.includes("from 'node:test'") || source.includes('from "node:test"')) {
      files.push(relative(process.cwd(), fullPath));
    }
  }
  return files;
};

const nodeTestFiles = ['src', 'tests']
  .filter((dir) => statSync(dir, { throwIfNoEntry: false })?.isDirectory())
  .flatMap(collectNodeTestFiles);

const testTimeoutMs = Number.parseInt(process.env.NODE_TEST_TIMEOUT_MS || '120000', 10);

for (const file of nodeTestFiles) {
  console.log(`[node:test] ${file}`);
  // These files are runtime node:test contracts. Type-checking every isolated
  // child process makes the aggregate runner appear hung; `build` and
  // `build:prod` provide the type-safety gate separately.
  const result = spawnSync(process.execPath, ['--require', 'ts-node/register/transpile-only', file], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
    shell: false,
    timeout: testTimeoutMs,
    killSignal: 'SIGTERM'
  });

  if (result.error?.code === 'ETIMEDOUT') {
    console.error(`[node:test] timed out after ${testTimeoutMs}ms: ${file}`);
    process.exit(1);
  }

  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}
