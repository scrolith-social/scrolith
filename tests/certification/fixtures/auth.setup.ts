import { test as setup, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  CERT_BASE_URL,
  CERT_EMAIL,
  CERT_PASSWORD,
  CERT_STORAGE_STATE,
  canRunAuthenticated,
  hasAuthStorage
} from '../helpers/env';
import {
  completeFollowOnboardingIfRequired,
  isLikelyAuthenticated,
  loginViaUi
} from '../helpers/auth';

setup('authenticate for certification suite', async ({ page }) => {
  setup.skip(!canRunAuthenticated(), 'No CERT_STORAGE_STATE or CERT_EMAIL/CERT_PASSWORD');
  expect(process.env.CERT_BASE_URL, 'Set CERT_BASE_URL explicitly before running authenticated browser certification').toBeTruthy();
  const baseHost = new URL(CERT_BASE_URL).hostname.toLowerCase();
  expect(
    ['localhost', '127.0.0.1', '[::1]', '::1'].includes(baseHost),
    'Authenticated certification must use the approved local loopback server'
  ).toBe(true);

  // Prefer a verified, already-authenticated browser session when provided.
  // A real signup UI session is a valid trusted first device; attempting a
  // second UI login here can correctly trigger device approval with no trusted
  // session left to approve it.
  if (hasAuthStorage()) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/\/auth\/login/, { timeout: 15_000 });
    expect(
      await isLikelyAuthenticated(page),
      'CERT_STORAGE_STATE must contain an authenticated Scrolith session'
    ).toBe(true);
    await completeFollowOnboardingIfRequired(page);
    await page.context().storageState({ path: CERT_STORAGE_STATE });
    return;
  }

  mkdirSync(dirname(CERT_STORAGE_STATE), { recursive: true });
  // Exercise the real browser login/session path; API login and token injection
  // do not establish device approval or prove that the UI can authenticate.
  await loginViaUi(page, CERT_EMAIL, CERT_PASSWORD);

  // Never save an anonymous state as a successful authentication fixture.
  await expect(page).not.toHaveURL(/\/auth\/login/, { timeout: 15_000 });
  expect(
    await isLikelyAuthenticated(page),
    'Certification login must establish an authenticated Scrolith session'
  ).toBe(true);
  await completeFollowOnboardingIfRequired(page);
  await page.context().storageState({ path: CERT_STORAGE_STATE });
});
