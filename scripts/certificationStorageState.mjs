import { readFileSync } from 'node:fs';

/** Read a server-issued browser token from a Playwright state for one origin. */
export function readStorageStateTokenFromFile(filePath, expectedOrigin) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new Error('invalid_storage_state_path');
  }
  if (typeof expectedOrigin !== 'string' || !expectedOrigin.trim()) {
    throw new Error('invalid_storage_state_origin');
  }

  let state;
  try {
    state = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    throw new Error('storage_state_unreadable');
  }

  const originState = Array.isArray(state?.origins)
    ? state.origins.find((entry) => entry?.origin === expectedOrigin)
    : undefined;
  const entries = Array.isArray(originState?.localStorage) ? originState.localStorage : [];
  for (const key of ['token', 'accessToken']) {
    const value = entries.find((entry) => entry?.name === key)?.value;
    if (typeof value === 'string' && value.trim()) return value;
  }

  throw new Error('storage_state_missing_origin_token');
}
