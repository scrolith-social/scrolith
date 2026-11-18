import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { answerLocalHumanVerification } from '../helpers/auth';
import { CERT_STORAGE_STATE } from '../helpers/env';
import { watchSafeApiEvents, writeSafeBrowserEvidence } from '../helpers/safeEvidence';

const isLoopback = (value: string | undefined) => {
  if (!value) return false;
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
  } catch {
    return false;
  }
};

test('local signup recovers from Human Verification service failure and completes a visible challenge', async ({ page }, testInfo) => {
  const email = String(process.env.SCROLITH_E2E_SIGNUP_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.SCROLITH_E2E_SIGNUP_PASSWORD || '');
  test.skip(!isLoopback(process.env.CERT_BASE_URL), 'Requires an explicitly configured loopback CERT_BASE_URL');
  test.skip(!email || password.length < 8, 'Requires synthetic local signup credentials in SCROLITH_E2E_SIGNUP_*');

  const apiWatch = watchSafeApiEvents(page);
  try {
    let createCalls = 0;
    await page.route('**/api/human-verification/create', async (route) => {
      createCalls += 1;
      // The service retries transient 5xx responses once. Keep both attempts
      // of the initial load unavailable so this test actually reaches the
      // rendered failure state before exercising the user's Refresh action.
      if (createCalls <= 2) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, error: 'Verification service had a temporary issue. Tap Refresh to try again.' })
        });
        return;
      }
      await route.continue();
    });

    await page.goto('/auth/signup', { waitUntil: 'domcontentloaded' });
    const verification = page.getByTestId('scrolith-human-verification');
    await expect(verification).toBeVisible();
    await expect(verification).toContainText(/verification.*temporary issue/i);
    expect(createCalls, 'initial challenge load should exhaust its one automatic retry').toBe(2);

    const refreshResponse = page.waitForResponse((response) =>
      response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/api/human-verification/create')
    );
    await verification.getByRole('button', { name: 'Refresh challenge' }).click();
    expect((await refreshResponse).status()).toBe(200);
    expect(createCalls, 'manual refresh should issue exactly one new challenge request').toBe(3);
    const answerOptions = verification.getByRole('group', { name: 'Answer options' });
    await expect(answerOptions).toBeVisible();

    await answerLocalHumanVerification(page, verification);
    await expect(verification.getByRole('status')).toContainText(/verified/i);

    const form = page.locator('form').filter({ has: page.locator('#terms') }).first();
    const textFields = form.locator('input[type="text"]');
    const passwordFields = form.locator('input[type="password"]');
    await textFields.nth(0).fill('Synthetic');
    await textFields.nth(1).fill('Pilot');
    await form.locator('input[type="email"]').fill(email);
    await passwordFields.nth(0).fill(password);
    await passwordFields.nth(1).fill(password);
    await form.locator('#terms').check();

    const registrationResponse = page.waitForResponse((response) =>
      response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/api/auth/register')
    );
    await form.locator('button[type="submit"]').click();
    const response = await registrationResponse;
    expect(response.status()).toBe(201);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(String(payload.user?.email || '').toLowerCase()).toBe(email);
    expect(typeof payload.token).toBe('string');
    const syntheticFeedText = `Synthetic feed identity certification ${Date.now()}`;
    const feedResponse = await page.request.post(new URL('/api/community/posts', String(process.env.CERT_BASE_URL)).toString(), {
      headers: { Authorization: `Bearer ${payload.token}` },
      data: { content: syntheticFeedText, visibility: 'public', tags: ['synthetic', 'certification'] }
    });
    expect(feedResponse.status()).toBe(200);
    const feedPayload = await feedResponse.json();
    expect(feedPayload.success).toBe(true);
    expect(typeof feedPayload.data?.id).toBe('string');
    await expect(page).not.toHaveURL(/\/auth\/signup(?:[/?#]|$)/);

  // Preserve the session established by the real signup UI as the first
  // trusted device for subsequent authenticated certification. This is not a
  // token-injection shortcut: the browser must already have persisted the
  // session as part of the successful registration flow.
    await expect.poll(() => page.evaluate(() => Boolean(
      localStorage.getItem('token') || localStorage.getItem('accessToken')
    ))).toBe(true);
    mkdirSync(dirname(CERT_STORAGE_STATE), { recursive: true });
    await page.context().storageState({ path: CERT_STORAGE_STATE });
  } catch (error) {
    await apiWatch.settle();
    await writeSafeBrowserEvidence(page, testInfo, 'signup_hv', apiWatch.events).catch(() => undefined);
    throw error;
  }
});
