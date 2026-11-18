import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { CERT_BASE_URL, requireAuthOrSkip } from '../helpers/env';
import { watchSafeApiEvents, writeSafeBrowserEvidence } from '../helpers/safeEvidence';
import type { SafeApiWatch } from '../helpers/safeEvidence';

const CERT_API_BASE = process.env.CERT_API_BASE || '';

const isLoopback = (value: string) => {
  try {
    const url = new URL(value);
    return (
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase()) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
};

async function signOutFromVisibleNavigation(page: Page) {
  const viewport = page.viewportSize();
  const mobileViewport = Boolean(viewport && viewport.width < 768);

  if (mobileViewport) {
    // MobileHome is lazy-loaded after the authenticated entry route resolves.
    // Do not select the desktop navbar while that responsive shell is mounting:
    // its profile button can sit beneath the mobile quick-menu hit target.
    await expect(page.getByTestId('scrolith-mobile-home'), 'mobile account navigation requires the signed-in mobile home shell').toBeVisible({ timeout: 30_000 });
    const mobileProfile = page.getByRole('button', { name: 'Open profile', exact: true });
    await expect(mobileProfile, 'mobile logout must use the mobile profile control').toBeVisible({ timeout: 30_000 });
    await mobileProfile.click();
    const accountSheet = page.getByRole('dialog', { name: 'Account' });
    await expect(accountSheet).toBeVisible();
    // The accessible name includes the visible label and its explanatory text.
    await accountSheet.getByRole('button', { name: /^Logout\b/ }).click();
    return;
  }

  const desktopAccountMenu = page.getByRole('button', { name: 'Open account menu', exact: true });
  await expect(desktopAccountMenu, 'desktop logout must use the desktop account menu').toBeVisible({ timeout: 30_000 });
  await desktopAccountMenu.click();
  await page.getByRole('menu', { name: 'Account menu' }).getByRole('button', { name: /^sign out$/i }).click();
}

test.describe('Logout revokes the current authenticated session', () => {
  const safeApiWatchByPage = new WeakMap<Page, SafeApiWatch>();

  test.beforeEach(() => {
    requireAuthOrSkip(test);
  });

  test.beforeEach(({ page }) => {
    safeApiWatchByPage.set(page, watchSafeApiEvents(page));
  });

  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status === testInfo.expectedStatus) return;
    const safeApiWatch = safeApiWatchByPage.get(page);
    await safeApiWatch?.settle();
    try {
      await writeSafeBrowserEvidence(page, testInfo, 'logout', safeApiWatch?.events ?? []);
    } catch {
      // Preserve the original assertion failure if local evidence cannot be written.
    }
  });

  test('network failure signs out locally and clearly reports that server revocation was not confirmed', async ({ page, request }) => {
    test.skip(!isLoopback(CERT_BASE_URL), 'Requires an explicitly configured loopback CERT_BASE_URL');
    test.skip(!CERT_API_BASE || !isLoopback(CERT_API_BASE), 'Requires an explicitly configured loopback CERT_API_BASE');

    const protectedUrl = `${CERT_API_BASE.replace(/\/+$/, '')}/auth/me`;
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/\/auth\/login(?:[/?#]|$)/);

    const originalToken = await page.evaluate(() => {
      const storedToken = window.localStorage.getItem('token');
      if (storedToken) return storedToken;
      const tokenCookie = document.cookie
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith('Scrolith_token='));
      return tokenCookie ? decodeURIComponent(tokenCookie.slice('Scrolith_token='.length)) : null;
    });
    expect(originalToken, 'authenticated browser state must contain a session token').toBeTruthy();

    await page.route('**/api/auth/logout', (route) => route.abort('failed'));
    await signOutFromVisibleNavigation(page);
    await page.waitForURL((url) =>
      url.pathname === '/auth/login' && url.searchParams.get('logout') === 'revocation-unconfirmed'
    );
    await expect(page.getByRole('alert')).toContainText(/server could not confirm session revocation/i);
    await expect
      .poll(() => page.evaluate(() => window.localStorage.getItem('token')))
      .toBeNull();

    // The injected network failure never reached the API, so the server-side
    // session must remain valid and the UI must disclose that fact.
    const stillValid = await request.get(protectedUrl, {
      headers: { Authorization: `Bearer ${originalToken}` },
      failOnStatusCode: false
    });
    expect(stillValid.status()).toBe(200);
  });

  test('sign out revokes the server session and rejects replay of the same token', async ({ page, request }) => {
    test.skip(!isLoopback(CERT_BASE_URL), 'Requires an explicitly configured loopback CERT_BASE_URL');
    test.skip(!CERT_API_BASE || !isLoopback(CERT_API_BASE), 'Requires an explicitly configured loopback CERT_API_BASE');

    const apiBase = CERT_API_BASE.replace(/\/+$/, '');
    const protectedUrl = `${apiBase}/auth/me`;

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/\/auth\/login(?:[/?#]|$)/);

    // Keep the original synthetic token only in memory for the replay check;
    // never include it in test output, annotations, or failure messages.
    const originalToken = await page.evaluate(() => {
      const storedToken = window.localStorage.getItem('token');
      if (storedToken) return storedToken;
      const tokenCookie = document.cookie
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith('Scrolith_token='));
      return tokenCookie ? decodeURIComponent(tokenCookie.slice('Scrolith_token='.length)) : null;
    });
    expect(originalToken, 'authenticated browser state must contain a session token').toBeTruthy();

    const beforeLogout = await request.get(protectedUrl, {
      headers: { Authorization: `Bearer ${originalToken}` },
      failOnStatusCode: false
    });
    expect(beforeLogout.status()).toBe(200);

    const logoutResponse = page.waitForResponse((response) => {
      try {
        return new URL(response.url()).pathname.endsWith('/auth/logout');
      } catch {
        return false;
      }
    });

    await signOutFromVisibleNavigation(page);

    const response = await logoutResponse;
    expect(response.status()).toBe(200);
    await expect(page).toHaveURL(/\/auth\/login(?:[/?#]|$)/);
    await expect
      .poll(() => page.evaluate(() => window.localStorage.getItem('token')))
      .toBeNull();

    const replay = await request.get(protectedUrl, {
      headers: { Authorization: `Bearer ${originalToken}` },
      failOnStatusCode: false
    });
    expect(replay.status()).toBe(401);
  });
});
