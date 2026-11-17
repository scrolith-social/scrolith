import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { CERT_BASE_URL, CERT_EMAIL, CERT_PASSWORD } from '../helpers/env';
import { isLikelyAuthenticated, solveLocalHumanVerification } from '../helpers/auth';
import { watchSafeApiEvents, writeSafeBrowserEvidence } from '../helpers/safeEvidence';

const isLoopback = (value: string | undefined) => {
  if (!value) return false;
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  } catch {
    return false;
  }
};

test('a trusted local session approves a signed-in login from a new device', async ({ page, browser }, testInfo) => {
  test.skip(!isLoopback(CERT_BASE_URL), 'Requires an explicitly configured loopback CERT_BASE_URL');
  test.skip(!CERT_EMAIL || !CERT_PASSWORD, 'Requires a synthetic local certification account');

  const trustedApiWatch = watchSafeApiEvents(page);
  const pendingApprovalIds = new Set<string>();
  const pendingListObservations: Array<{ status: number; ids: string[] }> = [];
  const onPendingApprovalList = (response: import('@playwright/test').Response) => {
    const url = new URL(response.url());
    if (response.request().method() !== 'GET' || !url.pathname.endsWith('/api/security/login-approvals/pending')) return;
    void response.json().then((payload: any) => {
      const pending = payload?.data?.pendingApprovals;
      const ids = Array.isArray(pending)
        ? pending.map((item: { id?: unknown }) => String(item?.id || '')).filter(Boolean)
        : [];
      for (const id of ids) pendingApprovalIds.add(id);
      pendingListObservations.push({ status: response.status(), ids });
    }).catch(() => {
      pendingListObservations.push({ status: response.status(), ids: [] });
    });
  };
  // Observe before starting the second-device login. The trusted page may poll
  // and receive the new row before the login response returns on mobile browsers.
  page.on('response', onPendingApprovalList);
  let deviceContext: BrowserContext | undefined;
  let newDevicePage: Page | undefined;
  let newDeviceApiWatch: ReturnType<typeof watchSafeApiEvents> | undefined;
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/\/auth\/login(?:[/?#]|$)/);
    await expect.poll(() => isLikelyAuthenticated(page), {
      message: 'The trusted device must have a server-validated authenticated synthetic session.'
    }).toBe(true);
    const projectUse = testInfo.project.use as Record<string, unknown>;
    const viewport = projectUse.viewport as { width: number; height: number } | undefined;
    deviceContext = await browser.newContext({
      baseURL: CERT_BASE_URL,
      // Do not inherit the trusted fixture user's storage state: this context
      // represents the genuinely new device whose login must be approved.
      storageState: { cookies: [], origins: [] },
      ...(viewport ? { viewport } : {}),
      isMobile: projectUse.isMobile === true,
      hasTouch: projectUse.hasTouch === true
    });

    newDevicePage = await deviceContext.newPage();
    newDeviceApiWatch = watchSafeApiEvents(newDevicePage);
    await newDevicePage.goto('/auth/login', { waitUntil: 'domcontentloaded' });
    await solveLocalHumanVerification(newDevicePage);

    await newDevicePage
      .locator('input[type="email"], input[name="email"], input[autocomplete="username"]')
      .first()
      .fill(CERT_EMAIL);
    await newDevicePage
      .locator('input[type="password"], input[name="password"], input[autocomplete="current-password"]')
      .first()
      .fill(CERT_PASSWORD);

    const loginResponsePromise = newDevicePage.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === 'POST' && url.pathname.endsWith('/api/auth/login');
    });
    await newDevicePage
      .locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Log in")')
      .first()
      .click();

    const loginResponse = await loginResponsePromise;
    expect(loginResponse.status()).toBe(200);
    const loginOutcome = await loginResponse.json();
    expect(loginOutcome.requiresLoginApproval).toBe(true);
    expect(loginOutcome.code).toBe('LOGIN_APPROVAL_REQUIRED');
    const loginAttemptId = String(loginOutcome.loginApproval?.id || '');
    expect(loginAttemptId, 'the new-device login must return its pending approval identifier').not.toBe('');
    await expect(newDevicePage.getByText('Waiting for trusted-device approval', { exact: true })).toBeVisible();

    // WebKit correctly suspends polling in a background page. Return to the
    // trusted device so its visibility handler refreshes the authenticated list.
    // Match the new attempt so an older empty polling response cannot satisfy
    // this waiter before the login-approval request has propagated.
    await page.bringToFront();
    await expect.poll(() => pendingApprovalIds.has(loginAttemptId), {
      timeout: 30_000,
      message: 'The trusted session must observe this exact pending approval, including if its response arrived before foregrounding.'
    }).toBe(true);
    const matchingApprovalResponse = pendingListObservations.find((observation) => observation.ids.includes(loginAttemptId));
    expect(matchingApprovalResponse?.status, 'the matching pending approval must come from a successful list response').toBe(200);

    const approvalDialog = page.getByRole('dialog', { name: 'New sign-in request' });
    await expect(approvalDialog).toBeVisible({ timeout: 45_000 });

    const exchangeResponsePromise = newDevicePage.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === 'POST' && url.pathname.endsWith('/api/auth/login/approval/exchange');
    });
    await approvalDialog.getByRole('button', { name: 'Approve' }).click();
    const exchangeResponse = await exchangeResponsePromise;
    expect(exchangeResponse.status()).toBe(200);
    await expect(newDevicePage).not.toHaveURL(/\/auth\/login(?:[/?#]|$)/, { timeout: 30_000 });
    await expect.poll(() => isLikelyAuthenticated(newDevicePage!)).toBe(true);
    const apiBase = String(process.env.CERT_API_BASE || '');
    expect(isLoopback(apiBase), 'Authenticated verification must use the explicit loopback API origin').toBe(true);
    const currentUserStatus = await newDevicePage.evaluate(async (base) => {
      const token = localStorage.getItem('token') || localStorage.getItem('accessToken');
      if (!token) return 0;
      const response = await fetch(`${base.replace(/\/+$/, '')}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'omit'
      });
      return response.status;
    }, apiBase);
    expect(currentUserStatus).toBe(200);
  } finally {
    page.off('response', onPendingApprovalList);
    if (testInfo.status !== testInfo.expectedStatus) {
      await trustedApiWatch.settle();
      await newDeviceApiWatch?.settle();
      await writeSafeBrowserEvidence(page, testInfo, 'device_approval', [
        ...trustedApiWatch.events,
        ...(newDeviceApiWatch?.events || [])
      ]).catch(() => undefined);
    }
    await deviceContext?.close();
  }
});
