import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

process.env.NODE_ENV = 'test';
process.env.APP_RUNTIME = 'test';
process.env.DISABLE_BACKGROUND_WORKERS = 'true';

process.env.TEST_DB_KIND = process.env.TEST_DB_KIND || 'local-postgres';
process.env.TEST_DB_PROJECT = process.env.TEST_DB_PROJECT || 'local-only';
process.env.TEST_DB_INSTANCE = process.env.TEST_DB_INSTANCE || 'local-postgres-test';
process.env.TEST_DB_NAME = process.env.TEST_DB_NAME || 'scrolith_test';

try {
  const dotenv = await import('dotenv');
  dotenv.config({ path: '.env.test', override: false });
} catch {
  // dotenv is best-effort for local test database commands.
}

if (!process.env.DATABASE_URL?.trim()) {
  console.error('[test-db] DATABASE_URL must target an explicitly configured disposable test database.');
  process.exit(1);
}

await import('./test-db-guard.mjs');

const args = process.argv.slice(2);
if (args.length === 0 || (args.length === 1 && args[0] === '--guard-only')) {
  process.exit(0);
}

const prismaCli = resolve(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');
if (!existsSync(prismaCli)) {
  console.error('[test-db] Installed Prisma CLI entrypoint is unavailable.');
  process.exit(1);
}
const result = spawnSync(process.execPath, [prismaCli, ...args], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
  shell: false
});

if (result.error) {
  console.error('[test-db] Unable to start the installed Prisma CLI.');
  process.exit(1);
}

process.exit(result.status ?? 1);
