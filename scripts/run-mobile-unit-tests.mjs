import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const unitTestRoot = path.join(repositoryRoot, 'tests', 'unit');

if (!existsSync(unitTestRoot)) {
  console.error('Mobile unit-test directory tests/unit does not exist.');
  process.exit(1);
}

const discoverTests = (directory) => {
  const found = [];
  const entries = readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...discoverTests(entryPath));
    } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      found.push(entryPath);
    }
  }

  return found;
};

const testFiles = discoverTests(unitTestRoot);
if (testFiles.length === 0) {
  console.error('No maintained *.test.ts files were found under tests/unit.');
  process.exit(1);
}

console.log(`Running ${testFiles.length} mobile/unit test files.`);
const result = spawnSync(
  process.execPath,
  ['--import', 'tsx', '--test', ...testFiles],
  { cwd: repositoryRoot, stdio: 'inherit', windowsHide: true },
);

if (result.error) {
  console.error(`Failed to launch the Node test runner: ${result.error.message}`);
  process.exitCode = 1;
} else if (result.status === null) {
  console.error(`Node test runner terminated without an exit code (signal: ${result.signal ?? 'unknown'}).`);
  process.exitCode = 1;
} else {
  process.exitCode = result.status;
}
