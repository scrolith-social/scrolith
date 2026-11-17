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
  const pendingListObservations: Array<{ status: number; ids: string[]; payloadParseFailed: boolean }> = [];
  const pendingListReads: Promise<void>[] = [];
  const diagnosticsStartedAt = Date.now();
  const onPendingApprovalList = (response: import('@playwright/test').Response) => {
    const url = new URL(response.url());
    if (response.request().method() !== 'GET' || !url.pathname.endsWith('/api/security/login-approvals/pending')) return;
    const read = response.json().then((payload: any) => {
      const pending = payload?.data?.pendingApprovals;
      const ids = Array.isArray(pending)
        ? pending.map((item: { id?: unknown }) => String(item?.id || '')).filter(Boolean)
        : [];
      pendingListObservations.push({ status: response.status(), ids, payloadParseFailed: false });
    }).catch(() => {
      pendingListObservations.push({ status: response.status(), ids: [], payloadParseFailed: true });
    });
    pendingListReads.push(read);
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

    // WebKit correctly suspends polling in a background page. Bring the trusted
    // app forward, then remount its normal authenticated UI so the overlay's
    // initial pending-list request is deterministic across browser lifecycles.
    // This exercises the real session and API path; it does not inject approval
    // state or bypass the server authorization check.
    await page.bringToFront();
    const trustedPendingResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === 'GET' && url.pathname.endsWith('/api/security/login-approvals/pending');
    }, { timeout: 30_000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    const pendingResponse = await trustedPendingResponse;
    expect(pendingResponse.status(), 'the trusted session must receive the authenticated pending-approval list').toBe(200);
    await expect.poll(() => isLikelyAuthenticated(page), {
      timeout: 30_000,
      message: 'The trusted browser session must remain server-validated after the app remounts.'
    }).toBe(true);
    await Promise.allSettled(pendingListReads);
    // A mobile page can have an older pending-list poll in flight when it is
    // reloaded. A successful response without this newly-created ID is not the
    // authorization evidence this test needs; wait for a fresh list response
    // that contains this exact pending attempt.
    await expect.poll(
      () => pendingListObservations.some(
        (observation) => observation.status === 200 && observation.ids.includes(loginAttemptId)
      ),
      {
        timeout: 30_000,
        intervals: [250, 500, 1_000],
        message: 'The authenticated pending-approval list must include the exact new-device attempt.'
      }
    ).toBe(true);
    const matchingApprovalResponse = pendingListObservations.find(
      (observation) => observation.status === 200 && observation.ids.includes(loginAttemptId)
    );
    expect(matchingApprovalResponse?.status, 'the exact pending approval must appear in the successful authenticated list response').toBe(200);

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
      await Promise.allSettled(pendingListReads);
      const statusCounts = new Map<number, number>();
      for (const observation of pendingListObservations) {
        statusCounts.set(observation.status, (statusCounts.get(observation.status) || 0) + 1);
      }
      const matchingAttemptResponses = loginAttemptId
        ? pendingListObservations.filter((observation) => observation.ids.includes(loginAttemptId)).length
        : 0;
      const failedRequestCount = trustedApiWatch.events.filter(
        (event) => event.kind === 'request_failed' && event.route === 'approval_list'
      ).length;
      await writeSafeBrowserEvidence(page, testInfo, 'device_approval', [
        ...trustedApiWatch.events,
        ...(newDeviceApiWatch?.events || [])
      ], {
        approvalPolling: {
          responseCount: pendingListObservations.length,
          statusCounts: Array.from(statusCounts.entries()).map(([status, count]) => ({ status, count })),
          payloadParseFailures: pendingListObservations.filter((observation) => observation.payloadParseFailed).length,
          pendingRowCount: pendingListObservations.reduce((total, observation) => total + observation.ids.length, 0),
          matchingAttemptResponses,
          failedRequestCount,
          elapsedMs: Math.max(0, Date.now() - diagnosticsStartedAt)
        }
      }).catch(() => undefined);
    }
    await deviceContext?.close();
  }
});
