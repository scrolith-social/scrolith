import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

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

try {
  const dotenv = await import('dotenv');
  dotenv.config({ path: '.env.test', override: false });
} catch {
  // dotenv is best-effort for local test database commands.
}

await import('./test-db-guard.mjs');

const args = process.argv.slice(2);
if (args.length === 0 || (args.length === 1 && args[0] === '--guard-only')) {
  process.exit(0);
}

const require = createRequire(import.meta.url);
const packageSearchPaths = require.resolve.paths('prisma') || [];
const prismaManifestPath = packageSearchPaths
  .map((searchPath) => join(searchPath, 'prisma', 'package.json'))
  .find((candidate) => existsSync(candidate));

if (!prismaManifestPath) {
  console.error('Unable to locate the installed Prisma package manifest. Run npm ci first.');
  process.exit(1);
}

let prismaManifest;
try {
  prismaManifest = JSON.parse(readFileSync(prismaManifestPath, 'utf8'));
} catch (error) {
  console.error(`Unable to read the Prisma package manifest: ${error.message}`);
  process.exit(1);
}

const prismaBin = typeof prismaManifest.bin === 'string'
  ? prismaManifest.bin
  : prismaManifest.bin?.prisma;
if (typeof prismaBin !== 'string' || prismaBin.length === 0) {
  console.error('The installed Prisma package manifest does not declare bin.prisma.');
  process.exit(1);
}

const prismaCli = resolve(dirname(prismaManifestPath), prismaBin);
try {
  if (!statSync(prismaCli).isFile()) {
    throw new Error('declared CLI path is not a file');
  }
} catch (error) {
  console.error(`The Prisma CLI declared by the package manifest is unavailable: ${error.message}`);
  process.exit(1);
}

const result = spawnSync(process.execPath, [prismaCli, ...args], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
  shell: false
});

if (result.error) {
  console.error(`Unable to start the local Prisma CLI: ${result.error.message}`);
  process.exit(1);
}

if (result.signal) {
  console.error(`The local Prisma CLI was terminated by signal ${result.signal}.`);
  process.exit(1);
}

if (result.status === null) {
  console.error('The local Prisma CLI did not return an exit status.');
  process.exit(1);
}

process.exit(result.status ?? 1);
