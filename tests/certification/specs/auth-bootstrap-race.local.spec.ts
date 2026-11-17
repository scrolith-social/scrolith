import { test, expect } from '@playwright/test';
import { requireAuthOrSkip } from '../helpers/env';
import { isClientAuthenticated } from '../helpers/auth';

const isCurrentUserRequest = (url: string) => {
  try {
    const parsed = new URL(url);
    return parsed.pathname.endsWith('/api/auth/me');
  } catch {
    return false;
  }
};

test('a stale StrictMode auth check cannot clear the current validated session', async ({ page }) => {
  requireAuthOrSkip(test);

  let authMeRequestCount = 0;
  let firstRequestSettled = false;
  let secondSuccessResolve: (() => void) | undefined;
  const secondSuccess = new Promise<void>((resolve) => {
    secondSuccessResolve = resolve;
  });
  let settleFirstResolve: (() => void) | undefined;
  const settleFirst = new Promise<void>((resolve) => {
    settleFirstResolve = resolve;
  });

  page.on('response', (response) => {
    if (
      isCurrentUserRequest(response.url()) &&
      response.request().method() === 'GET' &&
      response.status() === 200 &&
      authMeRequestCount >= 2
    ) {
      secondSuccessResolve?.();
    }
  });

  await page.route('**/api/auth/me', async (route) => {
    authMeRequestCount += 1;
    if (authMeRequestCount === 1) {
      // React StrictMode can start an effect, clean it up, then start the
      // current effect. If the stale request is still issued, let the current
      // request validate successfully before returning a late 401 for the
      // obsolete request. The obsolete result must not clear shared auth.
      const concurrentBootstrapObserved = await Promise.race([
        secondSuccess.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2_000))
      ]);
      if (concurrentBootstrapObserved) {
        // Allow the successful current request's response handler to finish
        // before the stale response is delivered.
        await new Promise((resolve) => setTimeout(resolve, 150));
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Synthetic stale auth validation' })
        });
      } else {
        await route.continue();
      }
      firstRequestSettled = true;
      settleFirstResolve?.();
      return;
    }
    await route.continue();
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => authMeRequestCount > 0, {
    message: 'The app must validate its stored session against the local auth endpoint.'
  }).toBe(true);
  await settleFirst;
  expect(firstRequestSettled).toBe(true);
  await expect.poll(() => isClientAuthenticated(page), {
    timeout: 10_000,
    message: 'A completed stale auth check must not replace the current authenticated UserContext.'
  }).toBe(true);
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem('token')))).toBe(true);
});
