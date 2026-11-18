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
  isClientAuthenticated,
  isLikelyAuthenticated,
  loginViaUi
} from '../helpers/auth';
import { watchSafeApiEvents, writeSafeBrowserEvidence } from '../helpers/safeEvidence';

setup('authenticate for certification suite', async ({ page }, testInfo) => {
  setup.skip(!canRunAuthenticated(), 'No CERT_STORAGE_STATE or CERT_EMAIL/CERT_PASSWORD');
  expect(process.env.CERT_BASE_URL, 'Set CERT_BASE_URL explicitly before running authenticated browser certification').toBeTruthy();
  const baseHost = new URL(CERT_BASE_URL).hostname.toLowerCase();
  expect(
    ['localhost', '127.0.0.1', '[::1]', '::1'].includes(baseHost),
    'Authenticated certification must use the approved local loopback server'
  ).toBe(true);

  const apiWatch = watchSafeApiEvents(page);
  try {
    // Prefer a verified, already-authenticated browser session when provided.
    // A real signup UI session is a valid trusted first device; attempting a
    // second UI login here can correctly trigger device approval with no trusted
    // session left to approve it.
    if (hasAuthStorage()) {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await expect.poll(() => isLikelyAuthenticated(page), {
        timeout: 30_000,
        message: 'CERT_STORAGE_STATE must contain a server-validated Scrolith session; /api/auth/me must return HTTP 200'
      }).toBe(true);
      await expect.poll(() => isClientAuthenticated(page), {
        timeout: 30_000,
        message: 'The Scrolith UserContext must finish loading the authenticated user before state is saved.'
      }).toBe(true);
      await expect(page).not.toHaveURL(/\/auth\/login/, { timeout: 15_000 });
      await completeFollowOnboardingIfRequired(page);
      await expect.poll(() => isLikelyAuthenticated(page), {
        timeout: 15_000,
        message: 'The server session must remain valid after Follow Onboarding.'
      }).toBe(true);
      await expect.poll(() => isClientAuthenticated(page), {
        timeout: 15_000,
        message: 'Follow Onboarding must preserve the hydrated authenticated user.'
      }).toBe(true);
      await page.context().storageState({ path: CERT_STORAGE_STATE });
      return;
    }

    mkdirSync(dirname(CERT_STORAGE_STATE), { recursive: true });
    // Exercise the real browser login/session path; API login and token injection
    // do not establish device approval or prove that the UI can authenticate.
    await loginViaUi(page, CERT_EMAIL, CERT_PASSWORD);

    // Never save an anonymous state as a successful authentication fixture.
    await expect(page).not.toHaveURL(/\/auth\/login/, { timeout: 15_000 });
    await expect.poll(() => isLikelyAuthenticated(page), {
      timeout: 30_000,
      message: 'Certification login must establish a server-validated Scrolith session; /api/auth/me must return HTTP 200'
    }).toBe(true);
    await expect.poll(() => isClientAuthenticated(page), {
      timeout: 30_000,
      message: 'The Scrolith UserContext must finish loading before authenticated state is saved.'
    }).toBe(true);
    await completeFollowOnboardingIfRequired(page);
    await expect.poll(() => isLikelyAuthenticated(page)).toBe(true);
    await expect.poll(() => isClientAuthenticated(page)).toBe(true);
    await page.context().storageState({ path: CERT_STORAGE_STATE });
  } catch (error) {
    await apiWatch.settle();
    await writeSafeBrowserEvidence(page, testInfo, 'member_home_feed', apiWatch.events).catch(() => undefined);
    throw error;
  }
});
