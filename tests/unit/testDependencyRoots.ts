import { existsSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));

/**
 * Resolve source trees that are intentionally kept outside this frontend-only
 * repository. Values may be absolute paths or paths relative to this repo.
 * Keeping these roots explicit avoids coupling tests to a particular worktree
 * layout while still exercising the real backend/mobile artifacts.
 */
export function resolveTestDependencyRoot(environmentVariable: string, label: string): string {
  const configured = process.env[environmentVariable]?.trim();
  if (!configured) {
    throw new Error(
      `[frontend-sync-tests] ${environmentVariable} is required to read ${label}. ` +
        'Set it to the canonical dependency root (absolute or repo-relative).'
    );
  }

  const dependencyRoot = isAbsolute(configured)
    ? configured
    : resolve(repositoryRoot, configured);

  if (!existsSync(dependencyRoot) || !statSync(dependencyRoot).isDirectory()) {
    throw new Error(
      `[frontend-sync-tests] ${environmentVariable} does not point to a directory: ${dependencyRoot}`
    );
  }

  return dependencyRoot;
}

export function resolveTestDependencyFile(
  dependencyRoot: string,
  relativePath: string,
  label: string
): string {
  const filePath = join(dependencyRoot, relativePath);
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    throw new Error(
      `[frontend-sync-tests] Missing ${label} at ${filePath}. ` +
        'Check the configured canonical dependency root.'
    );
  }

  return filePath;
}
