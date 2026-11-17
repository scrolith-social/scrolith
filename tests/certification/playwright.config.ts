/**
 * Phase 21.1.6 — Authenticated production certification Playwright config.
 *
 * Requires explicit loopback CERT_BASE_URL and CERT_API_BASE values.
 * Auth: CERT_STORAGE_STATE path, or CERT_EMAIL + CERT_PASSWORD via setup project.
 */
import { defineConfig, devices } from '@playwright/test';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { requireLoopbackTestUrl } from '../../scripts/certificationTarget.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, '../..');
const storageStatePath = resolve(
  process.env.CERT_STORAGE_STATE || join(tmpdir(), 'scrolith-certification', 'storage-state.json')
);
const resultsDir = resolve(
  process.env.CERT_RESULTS_DIR || join(tmpdir(), 'scrolith-certification', 'results')
);
const isInsideRepository = (path: string) => {
  const relativePath = relative(repositoryRoot, path);
  return relativePath === '' || (!isAbsolute(relativePath) && relativePath !== '..' && !relativePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`));
};
if (isInsideRepository(storageStatePath) || isInsideRepository(resultsDir)) {
  throw new Error('CERT_STORAGE_STATE and CERT_RESULTS_DIR must resolve outside the source repository.');
}
const hasStorage = existsSync(storageStatePath);
const hasCredentials = Boolean(
  (process.env.CERT_EMAIL || process.env.SCROLITH_CERT_EMAIL) &&
  (process.env.CERT_PASSWORD || process.env.SCROLITH_CERT_PASSWORD)
);
const authConfigured = hasStorage || hasCredentials;

const baseURL = requireLoopbackTestUrl(process.env.CERT_BASE_URL, 'CERT_BASE_URL');
requireLoopbackTestUrl(process.env.CERT_API_BASE, 'CERT_API_BASE');

export default defineConfig({
  testDir: join(here, 'specs'),
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [
    ['list'],
    ['json', { outputFile: join(resultsDir, 'cert-results.json') }],
    ['html', { outputFolder: join(resultsDir, 'html-report'), open: 'never' }]
  ],
  outputDir: join(resultsDir, 'test-output'),
  use: {
    baseURL,
    // CI uploads only the explicit allow-listed diagnostics produced by safeEvidence.ts.
    // Native Playwright traces/videos can contain auth headers, storage and response bodies.
    trace: process.env.CI ? 'off' : 'retain-on-failure',
    screenshot: process.env.CI ? 'off' : 'only-on-failure',
    video: process.env.CI ? 'off' : 'retain-on-failure',
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
    ...(hasStorage ? { storageState: storageStatePath } : {})
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      testDir: join(here, 'fixtures')
    },
    {
      name: 'desktop-chrome',
      dependencies: authConfigured ? ['setup'] : [],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        ...(authConfigured ? { storageState: storageStatePath } : {})
      }
    },
    {
      name: 'pixel-7',
      dependencies: authConfigured ? ['setup'] : [],
      use: {
        ...devices['Pixel 7'],
        ...(authConfigured ? { storageState: storageStatePath } : {})
      }
    },
    {
      name: 'iphone-15',
      dependencies: authConfigured ? ['setup'] : [],
      use: {
        ...devices['iPhone 15'],
        ...(authConfigured ? { storageState: storageStatePath } : {})
      }
    },
    {
      name: 'mobile-390',
      dependencies: authConfigured ? ['setup'] : [],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        userAgent:
          'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        ...(authConfigured ? { storageState: storageStatePath } : {})
      }
    }
  ]
});
