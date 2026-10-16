import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = resolve(backendRoot, 'prisma/schema.prisma');
const prismaPackagePath = resolve(backendRoot, 'node_modules/prisma/package.json');

function fail(message) {
  throw new Error(message);
}

if (!existsSync(prismaPackagePath)) {
  fail('Prisma CLI package manifest is missing; install the locked backend dependencies first.');
}

const prismaPackage = JSON.parse(readFileSync(prismaPackagePath, 'utf8'));
const prismaBin = typeof prismaPackage.bin === 'string'
  ? prismaPackage.bin
  : prismaPackage.bin?.prisma;

if (typeof prismaBin !== 'string' || prismaBin.length === 0) {
  fail('The installed Prisma package does not declare a prisma CLI binary.');
}

const prismaCliPath = resolve(dirname(prismaPackagePath), prismaBin);
if (!existsSync(prismaCliPath)) {
  fail('The installed Prisma CLI binary declared by package.json is missing.');
}

function runPrismaDiff(args) {
  const result = spawnSync(
    process.execPath,
    [prismaCliPath, 'migrate', 'diff', ...args, '--script', '--exit-code'],
    {
      cwd: backendRoot,
      env: process.env,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024
    }
  );

  if (result.error) {
    fail(`Prisma CLI could not be started (${result.error.code || result.error.name}).`);
  }

  return {
    status: result.status,
    output: `${result.stdout || ''}\n${result.stderr || ''}`
  };
}

function expectStatus(name, result, expected) {
  if (result.status !== expected) {
    fail(`${name}: expected Prisma exit code ${expected}; received ${result.status ?? 'no exit code'}.`);
  }
}

let temporaryDirectory;
try {
  if (!existsSync(schemaPath)) fail('The configured Prisma schema file is missing.');

  const unchanged = runPrismaDiff([
    '--from-schema', schemaPath,
    '--to-schema', schemaPath
  ]);
  expectStatus('No-difference case', unchanged, 0);

  temporaryDirectory = mkdtempSync(join(tmpdir(), 'scrolith-prisma-diff-'));
  const driftedSchemaPath = join(temporaryDirectory, 'drifted.prisma');
  const driftedSchema = [
    readFileSync(schemaPath, 'utf8'),
    '',
    'model PrismaDiffExitCodeProbe {',
    '  id String @id',
    '}',
    ''
  ].join('\n');
  writeFileSync(driftedSchemaPath, driftedSchema, { encoding: 'utf8', flag: 'wx' });

  const difference = runPrismaDiff([
    '--from-schema', schemaPath,
    '--to-schema', driftedSchemaPath
  ]);
  expectStatus('Deliberate-difference case', difference, 2);
  if (!difference.output.includes('PrismaDiffExitCodeProbe')) {
    fail('Deliberate-difference case returned 2 without SQL identifying the injected model.');
  }

  const invalidSchema = join(temporaryDirectory, 'missing.prisma');
  const comparisonError = runPrismaDiff([
    '--from-schema', invalidSchema,
    '--to-schema', schemaPath
  ]);
  expectStatus('Comparison-error case', comparisonError, 1);

  console.log('PRISMA_DIFF_EXIT_CODE_CASES=empty:0,deliberate-difference:2,comparison-error:1');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Prisma diff exit-code validation failed.');
  process.exitCode = 1;
} finally {
  if (temporaryDirectory) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}
