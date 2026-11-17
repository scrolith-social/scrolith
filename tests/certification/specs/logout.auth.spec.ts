import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { CERT_BASE_URL, requireAuthOrSkip } from '../helpers/env';

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
  const desktopAccountMenu = page.getByRole('button', { name: 'Open account menu', exact: true });
  const mobileQuickMenu = page.getByRole('button', { name: 'Open menu', exact: true });

  await expect(
    desktopAccountMenu.or(mobileQuickMenu).first(),
    'the authenticated app must expose its responsive account navigation'
  ).toBeVisible({ timeout: 30_000 });

  if (await mobileQuickMenu.isVisible()) {
    await mobileQuickMenu.click();
    const quickMenu = page.getByRole('dialog', { name: 'Quick menu' });
    await expect(quickMenu).toBeVisible();
    await quickMenu.getByRole('button', { name: 'Logout', exact: true }).click();
    return;
  }

  await desktopAccountMenu.click();
  await page.getByRole('menu', { name: 'Account menu' }).getByRole('button', { name: /^sign out$/i }).click();
}

test.describe('Logout revokes the current authenticated session', () => {
  test.beforeEach(() => {
    requireAuthOrSkip(test);
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
