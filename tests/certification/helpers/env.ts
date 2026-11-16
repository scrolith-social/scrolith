import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export const CERT_BASE_URL = process.env.CERT_BASE_URL || '';

export const CERT_STORAGE_STATE =
  process.env.CERT_STORAGE_STATE || join(tmpdir(), 'scrolith-certification', 'storage-state.json');

export const CERT_EMAIL = process.env.CERT_EMAIL || process.env.SCROLITH_CERT_EMAIL || '';
export const CERT_PASSWORD = process.env.CERT_PASSWORD || process.env.SCROLITH_CERT_PASSWORD || '';

export const FEED_IDENTITY_MS = Math.max(
  5_000,
  Number(process.env.CERT_FEED_IDENTITY_MS || 60_000) || 60_000
);

export const hasAuthStorage = () => existsSync(CERT_STORAGE_STATE);

export const hasAuthCredentials = () => Boolean(CERT_EMAIL && CERT_PASSWORD);

export const canRunAuthenticated = () => hasAuthStorage() || hasAuthCredentials();

export const requireAuthOrSkip = (test: { skip: (condition?: boolean, description?: string) => void }) => {
  if (!canRunAuthenticated()) {
    test.skip(
      true,
      'Authenticated cert requires CERT_STORAGE_STATE file or CERT_EMAIL + CERT_PASSWORD'
    );
  }
};
