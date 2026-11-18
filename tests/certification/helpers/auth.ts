import { expect, type Page, type APIRequestContext } from '@playwright/test';
import { CERT_API_BASE, CERT_BASE_URL, CERT_EMAIL, CERT_PASSWORD } from './env';

const isLoopbackUrl = (value: string) => {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
  } catch {
    return false;
  }
};

/** Answer only the supported arithmetic challenge visibly rendered by a local test app. */
export async function answerLocalHumanVerification(
  page: Page,
  verification = page.getByTestId('scrolith-human-verification')
): Promise<string> {
  await verification.waitFor({ state: 'visible', timeout: 15_000 });
  const options = verification.getByRole('group', { name: 'Answer options' });
  await options.waitFor({ state: 'visible', timeout: 15_000 });
  const display = await verification.locator('p.text-2xl').innerText();
  const expression = display.match(/^\s*(\d+)\s*([+-])\s*(\d+)\s*$/);
  if (!expression) throw new Error('Local Human Verification fixture must render its supported visible arithmetic challenge');
  const left = Number(expression[1]);
  const right = Number(expression[3]);
  const answer = String(expression[2] === '+' ? left + right : left - right);
  const answerButton = options.getByRole('button', { name: `Select ${answer}`, exact: true });
  await answerButton.scrollIntoViewIfNeeded();
  await expect(answerButton).toBeVisible();
  await expect(answerButton).toBeEnabled();
  const supportsTouch = await page.evaluate(() => navigator.maxTouchPoints > 0);
  if (supportsTouch) {
    // Locator.tap revalidates and scrolls the target at dispatch time; a raw
    // coordinate tap can miss after mobile viewport/layout movement.
    await answerButton.tap();
  } else {
    await answerButton.click();
  }
  await verification.getByRole('status').filter({ hasText: /verified/i }).waitFor({ state: 'visible', timeout: 10_000 });
  return answer;
}

/** Solve only the challenge visibly rendered by an explicitly local test app. */
export async function solveLocalHumanVerification(page: Page) {
  if (process.env.CERT_LOCAL_HV_SOLVER !== 'true') return;
  if (!isLoopbackUrl(CERT_BASE_URL)) {
    throw new Error('CERT_LOCAL_HV_SOLVER requires an explicitly configured loopback CERT_BASE_URL');
  }

  await answerLocalHumanVerification(page);
}

/**
 * UI login against the certification base URL.
 * Prefer storage state generation for CI (scripts/phase2116-generate-storage-state.mjs).
 */
export async function loginViaUi(page: Page, email = CERT_EMAIL, password = CERT_PASSWORD) {
  if (!email || !password) {
    throw new Error('CERT_EMAIL and CERT_PASSWORD are required for UI login');
  }
  await page.goto('/auth/login', { waitUntil: 'domcontentloaded' });
  await solveLocalHumanVerification(page);

  const emailInput = page
    .locator('input[type="email"], input[name="email"], input[autocomplete="username"]')
    .first();
  const passwordInput = page
    .locator('input[type="password"], input[name="password"], input[autocomplete="current-password"]')
    .first();

  await emailInput.fill(email);
  await passwordInput.fill(password);

  const submit = page
    .locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Log in")')
    .first();
  await submit.click();

  await page.waitForURL((url) => !url.pathname.includes('/auth/login'), { timeout: 45_000 });
}

type AuthenticatedRoute = 'onboarding' | 'ready';

/** Read auth, onboarding and URL together so a render cannot change the decision between reads. */
export async function waitForAuthenticatedRoute(
  page: Page,
  options: { requireOnboardingComplete?: boolean } = {}
): Promise<AuthenticatedRoute> {
  const snapshot: { route?: AuthenticatedRoute } = {};
  await expect.poll(async () => {
    snapshot.route = await page.evaluate((requireOnboardingComplete) => {
      const root = document.querySelector('[data-testid="scrolith-auth-state"]');
      if (root?.getAttribute('data-auth-state') !== 'authenticated') return undefined;

      const path = window.location.pathname;
      const onboardingRoute = /^\/auth\/follow-onboarding(?:\/|$)/.test(path);
      const onboardingRequired = root.getAttribute('data-follow-onboarding-required');

      if (onboardingRequired === 'true' && onboardingRoute && !requireOnboardingComplete) {
        return 'onboarding' as const;
      }
      if (onboardingRequired === 'false' && !onboardingRoute && !/^\/auth\/(?:login|signup)(?:\/|$)/.test(path)) {
        return 'ready' as const;
      }
      return undefined;
    }, options.requireOnboardingComplete ?? false).catch(error => {
      // Navigation can replace the execution context between samples.
      if (error instanceof Error && /Execution context was destroyed|Cannot find context/i.test(error.message)) {
        return undefined;
      }
      throw error;
    });
    return snapshot.route;
  }, {
    timeout: 30_000,
    message: 'The validated session must hydrate and reach the route required by Follow Onboarding.'
  }).toBeDefined();

  if (!snapshot.route) throw new Error('Authenticated certification route did not settle');
  return snapshot.route;
}

/** Complete the real Follow Onboarding flow before a certification state is saved. */
export async function completeFollowOnboardingIfRequired(page: Page) {
  if (await waitForAuthenticatedRoute(page) === 'ready') return;

  const languages = page.getByRole('group', { name: 'Available languages' });
  await expect(languages, 'Follow Onboarding must render its language selector').toBeVisible();
  await expect(page.getByLabel('Loading recommendations')).toBeHidden({ timeout: 30_000 });
  const english = languages.getByRole('button', { name: /English/i }).first();
  await expect(english, 'the standard English option must be available in local certification').toBeVisible();
  if (await english.getAttribute('aria-pressed') !== 'true') await english.click();

  const progress = page.getByRole('progressbar');
  await expect(progress).toBeVisible();
  await expect
    .poll(async () => (await progress.getAttribute('aria-label'))?.includes('Languages done') === true)
    .toBe(true);
  const getFollowCounts = async () => {
    const label = await progress.getAttribute('aria-label');
    const match = label?.match(/Follows\s+(\d+)\s+of\s+(\d+)\s+required/i);
    if (!match) throw new Error('Follow Onboarding progress did not expose its required follow count');
    return { current: Number(match[1]), required: Number(match[2]) };
  };

  let counts = await getFollowCounts();
  while (counts.current < counts.required) {
    const follow = page.getByRole('button', { name: /^Follow / }).first();
    await expect(
      follow,
      'local certification needs at least one eligible synthetic recommendation to complete onboarding'
    ).toBeVisible();
    await follow.click();
    await expect.poll(async () => (await getFollowCounts()).current).toBeGreaterThan(counts.current);
    counts = await getFollowCounts();
  }

  const continueButton = page.getByRole('button', { name: 'Continue to feed', exact: true });
  await expect(continueButton).toBeEnabled();
  await continueButton.click();
  await waitForAuthenticatedRoute(page, { requireOnboardingComplete: true });
}

/**
 * Optional API login when the public API allows credential grant from the cert origin.
 * Returns token string or null.
 */
export async function loginViaApi(
  request: APIRequestContext,
  email = CERT_EMAIL,
  password = CERT_PASSWORD
): Promise<string | null> {
  if (!email || !password) return null;
  // Never infer a production API host for credential-based certification.
  // A caller must explicitly supply the API origin for the intended test environment.
  const apiBase = process.env.CERT_API_BASE;
  if (!apiBase) return null;
  try {
    const res = await request.post(`${apiBase.replace(/\/$/, '')}/auth/login`, {
      data: { email, password },
      failOnStatusCode: false
    });
    if (!res.ok()) return null;
    const body = await res.json().catch(() => ({} as any));
    return (
      body?.token ||
      body?.accessToken ||
      body?.data?.token ||
      body?.data?.accessToken ||
      null
    );
  } catch {
    return null;
  }
}

export async function injectToken(page: Page, token: string, user?: Record<string, unknown>) {
  await page.addInitScript(
    ({ token: t, user: u }) => {
      try {
        localStorage.setItem('token', t);
        if (u) localStorage.setItem('user', JSON.stringify(u));
      } catch {
        /* ignore */
      }
    },
    { token, user: user || { id: 'cert-user', email: CERT_EMAIL } }
  );
}

export async function isLikelyAuthenticated(page: Page) {
  if (!isLoopbackUrl(CERT_API_BASE)) return false;
  try {
    return await page.evaluate(async (apiBase) => {
      try {
        const token = localStorage.getItem('token') || localStorage.getItem('accessToken');
        if (!token) return false;
        const response = await fetch(`${apiBase.replace(/\/+$/, '')}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
          credentials: 'omit'
        });
        return response.status === 200;
      } catch {
        return false;
      }
    }, CERT_API_BASE);
  } catch {
    // A navigation can destroy the execution context while the login approval
    // exchange redirects to the authenticated route. The caller's poll retries
    // and still requires an HTTP 200 from the local /auth/me endpoint.
    return false;
  }
}

/**
 * Confirms the application auth bootstrap has hydrated its own client state.
 * A valid bearer token alone is insufficient: route guards also depend on the
 * UserContext user record being loaded from the authenticated API response.
 */
export async function isClientAuthenticated(page: Page) {
  return page.getByTestId('scrolith-auth-state')
    .getAttribute('data-auth-state')
    .then((state) => state === 'authenticated')
    .catch(() => false);
}

export { CERT_BASE_URL };
