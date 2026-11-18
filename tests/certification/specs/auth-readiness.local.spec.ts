import { expect, test } from '@playwright/test';
import { waitForAuthenticatedRoute } from '../helpers/auth';

test.use({ storageState: { cookies: [], origins: [] } });

test('auth setup waits for matching client state and onboarding route', async ({ page, baseURL }) => {
  await page.route(new URL('/auth-readiness-fixture', baseURL).href, (route) => route.fulfill({
    contentType: 'text/html',
    body: '<main data-testid="scrolith-auth-state" data-auth-state="loading" data-follow-onboarding-required="true"></main>'
  }));
  await page.goto('/auth-readiness-fixture');

  const readiness = waitForAuthenticatedRoute(page);
  // A route transition can happen before UserContext has settled.
  await page.evaluate(() => window.history.replaceState({}, '', '/auth/follow-onboarding'));
  await page.evaluate(() => {
    const marker = document.querySelector('main');
    marker?.setAttribute('data-auth-state', 'authenticated');
  });
  expect(await readiness).toBe('onboarding');

  const completion = waitForAuthenticatedRoute(page, { requireOnboardingComplete: true });
  // Hydration and redirects can also happen in the opposite order.
  await page.evaluate(() => {
    const marker = document.querySelector('main');
    marker?.setAttribute('data-auth-state', 'loading');
    window.history.replaceState({}, '', '/member-home');
  });
  await page.evaluate(() => {
    const marker = document.querySelector('main');
    marker?.setAttribute('data-follow-onboarding-required', 'false');
    marker?.setAttribute('data-auth-state', 'authenticated');
  });
  expect(await completion).toBe('ready');
});
