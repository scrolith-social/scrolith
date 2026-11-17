import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';

type SafeApiEvent = {
  kind: 'response' | 'request_failed';
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OTHER';
  route: 'feed' | 'auth_me' | 'follow_onboarding' | 'login' | 'approval_list' | 'approval_exchange' | 'notifications' | 'human_verification';
  status?: number;
  durationMs?: number;
  failure?: 'timeout' | 'connection' | 'aborted' | 'other';
  itemCount?: number;
  responseShape?: 'items_array' | 'missing_items' | 'invalid_json';
  authUserRecordPresent?: boolean;
  authOnboardingFlagPresent?: boolean;
  authOnboardingRequired?: boolean;
};

const SAFE_ROUTES = new Map<string, SafeApiEvent['route']>([
  ['/api/discovery/v2/member-feed', 'feed'],
  ['/api/auth/me', 'auth_me'],
  ['/api/auth/follow-onboarding', 'follow_onboarding'],
  ['/api/auth/login', 'login'],
  ['/api/security/login-approvals/pending', 'approval_list'],
  ['/api/auth/login/approval/exchange', 'approval_exchange'],
  ['/api/notifications', 'notifications'],
  ['/api/human-verification/create', 'human_verification']
]);

const safeMethod = (method: string): SafeApiEvent['method'] =>
  ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
    ? (method as SafeApiEvent['method'])
    : 'OTHER';

const failureKind = (text: string): NonNullable<SafeApiEvent['failure']> => {
  if (/timeout|timed out/i.test(text)) return 'timeout';
  if (/connection refused|connection reset|dns|name not resolved/i.test(text)) return 'connection';
  if (/abort|cancel/i.test(text)) return 'aborted';
  return 'other';
};

export type SafeApiWatch = {
  events: SafeApiEvent[];
  settle: () => Promise<void>;
};

export type SafeBrowserDiagnostics = {
  approvalPolling?: {
    responseCount: number;
    statusCounts: Array<{ status: number; count: number }>;
    payloadParseFailures: number;
    pendingRowCount: number;
    matchingAttemptResponses: number;
    failedRequestCount: number;
    elapsedMs: number;
  };
};

export function watchSafeApiEvents(page: Page): SafeApiWatch {
  const events: SafeApiEvent[] = [];
  const pending: Promise<void>[] = [];
  const requestStartedAt = new WeakMap<object, number>();
  page.on('request', (request) => {
    try {
      if (SAFE_ROUTES.has(new URL(request.url()).pathname)) requestStartedAt.set(request, Date.now());
    } catch {
      // Ignore non-URL requests; their URL is never retained.
    }
  });
  page.on('response', (response) => {
    let route: SafeApiEvent['route'] | undefined;
    try {
      route = SAFE_ROUTES.get(new URL(response.url()).pathname);
    } catch {
      return;
    }
    if (!route || events.length >= 120) return;
    const event: SafeApiEvent = {
      kind: 'response',
      method: safeMethod(response.request().method()),
      route,
      status: response.status()
    };
    const startedAt = requestStartedAt.get(response.request());
    if (startedAt !== undefined) event.durationMs = Math.max(0, Date.now() - startedAt);
    events.push(event);
    if (route === 'feed' && response.ok()) {
      pending.push(response
        .json()
        .then((body: unknown) => {
          const directItems = body && typeof body === 'object' ? (body as { items?: unknown }).items : undefined;
          const nestedData = body && typeof body === 'object' ? (body as { data?: unknown }).data : undefined;
          const nestedItems = nestedData && typeof nestedData === 'object' ? (nestedData as { items?: unknown }).items : undefined;
          const items = Array.isArray(directItems) ? directItems : nestedItems;
          if (Array.isArray(items)) {
            event.itemCount = items.length;
            event.responseShape = 'items_array';
          } else {
            event.responseShape = 'missing_items';
          }
        })
        .catch(() => {
          event.responseShape = 'invalid_json';
        }));
    }
    if (route === 'auth_me' && response.ok()) {
      pending.push(response
        .json()
        .then((body: unknown) => {
          const root = body && typeof body === 'object' ? body as Record<string, unknown> : {};
          const data = root.data && typeof root.data === 'object' ? root.data as Record<string, unknown> : {};
          const nestedData = data.data && typeof data.data === 'object' ? data.data as Record<string, unknown> : {};
          const candidates = [root.user, data.user, nestedData.user, data, root];
          const user = candidates.find((candidate) =>
            candidate && typeof candidate === 'object' && typeof (candidate as Record<string, unknown>).id === 'string'
          ) as Record<string, unknown> | undefined;
          if (!user) {
            event.authUserRecordPresent = false;
            return;
          }
          const camelFlagPresent = Object.prototype.hasOwnProperty.call(user, 'followOnboardingRequired');
          const snakeFlagPresent = Object.prototype.hasOwnProperty.call(user, 'follow_onboarding_required');
          event.authUserRecordPresent = true;
          event.authOnboardingFlagPresent = camelFlagPresent || snakeFlagPresent;
          event.authOnboardingRequired = Boolean(user.followOnboardingRequired ?? user.follow_onboarding_required);
        })
        .catch(() => {
          // Response bodies and parse errors are deliberately never retained.
        }));
    }
  });
  page.on('requestfailed', (request) => {
    let route: SafeApiEvent['route'] | undefined;
    try {
      route = SAFE_ROUTES.get(new URL(request.url()).pathname);
    } catch {
      return;
    }
    if (!route || events.length >= 120) return;
    const event: SafeApiEvent = {
      kind: 'request_failed',
      method: safeMethod(request.method()),
      route,
      failure: failureKind(request.failure()?.errorText || '')
    };
    const startedAt = requestStartedAt.get(request);
    if (startedAt !== undefined) event.durationMs = Math.max(0, Date.now() - startedAt);
    events.push(event);
  });
  return { events, settle: async () => { await Promise.allSettled(pending); } };
}
export async function writeSafeBrowserEvidence(
  page: Page,
  testInfo: TestInfo,
  scenario: 'device_approval' | 'member_home_feed' | 'notifications' | 'signup_hv',
  apiEvents: SafeApiEvent[],
  diagnostics?: SafeBrowserDiagnostics
) {
  const outputRoot = process.env.CERT_RESULTS_DIR;
  if (!outputRoot) throw new Error('CERT_RESULTS_DIR is required for safe browser evidence.');
  const safeDir = join(outputRoot, 'safe-evidence');
  mkdirSync(safeDir, { recursive: true });
  const suffix = createHash('sha256').update(testInfo.testId).digest('hex').slice(0, 12);
  const project = testInfo.project.name.replace(/[^a-z0-9_-]/gi, '_').slice(0, 40);
  const stem = `${scenario}-${project}-${suffix}`;

  const pageState = await page
    .evaluate(() => {
      const count = (selector: string) => document.querySelectorAll(selector).length;
      const hasLocalStorageValue = (key: string) => {
        try {
          return Boolean(localStorage.getItem(key));
        } catch {
          return false;
        }
      };
      const localTokenKeyPresent = hasLocalStorageValue('token');
      const localAccessTokenKeyPresent = hasLocalStorageValue('accessToken');
      const localScrolithTokenKeyPresent = hasLocalStorageValue('scrolith_token');
      const tokenCookiePresent = (() => {
        try {
          return document.cookie.split(';').some((part) => part.trim().startsWith('Scrolith_token='));
        } catch {
          return false;
        }
      })();
      const localAuthPresent = localTokenKeyPresent || localAccessTokenKeyPresent || localScrolithTokenKeyPresent || tokenCookiePresent;
      const storedUserPresent = (() => {
        try {
          return Boolean(localStorage.getItem('user'));
        } catch {
          return false;
        }
      })();
      const storedUser = (() => {
        try {
          const raw = localStorage.getItem('user');
          return raw ? JSON.parse(raw) as Record<string, unknown> : null;
        } catch {
          return null;
        }
      })();
      const path = location.pathname;
      const safePath = ['/', '/member-home', '/m/home', '/auth/follow-onboarding', '/auth/login', '/auth/signup'].includes(path)
        ? path
        : 'other';
      const route = path === '/' ? 'member_home' :
        path === '/notifications' ? 'notifications' :
          path === '/auth/login' ? 'login' :
            path === '/auth/signup' ? 'signup' : 'other';
      return {
        route,
        safePath,
        readyState: document.readyState,
        visibility: document.visibilityState,
        authenticatedStoragePresent: localAuthPresent,
        localTokenKeyPresent,
        localAccessTokenKeyPresent,
        localScrolithTokenKeyPresent,
        tokenCookiePresent,
        storedUserPresent,
        storedUserIdPresent: Boolean(storedUser && typeof storedUser.id === 'string' && storedUser.id.trim()),
        storedUserOnboardingFlagPresent: Boolean(storedUser && (
          Object.prototype.hasOwnProperty.call(storedUser, 'followOnboardingRequired') ||
          Object.prototype.hasOwnProperty.call(storedUser, 'follow_onboarding_required')
        )),
        storedUserOnboardingRequired: Boolean(storedUser?.followOnboardingRequired ?? storedUser?.follow_onboarding_required),
        clientAuthState: ['loading', 'authenticated', 'anonymous'].includes(
          document.querySelector('[data-testid="scrolith-auth-state"]')?.getAttribute('data-auth-state') || ''
        )
          ? document.querySelector('[data-testid="scrolith-auth-state"]')?.getAttribute('data-auth-state')
          : 'unavailable',
        clientFollowOnboardingRequired: ['true', 'false', 'unknown'].includes(
          document.querySelector('[data-testid="scrolith-auth-state"]')?.getAttribute('data-follow-onboarding-required') || ''
        )
          ? document.querySelector('[data-testid="scrolith-auth-state"]')?.getAttribute('data-follow-onboarding-required')
          : 'unavailable',
        followOnboardingRoute: path.startsWith('/auth/follow-onboarding'),
        memberHomeMarkerCount: count('[data-testid="scrolith-member-home"]'),
        mobileHomeMarkerCount: count('[data-testid="scrolith-mobile-home"]'),
        postCardCount: count('[data-testid="enterprise-post-card"], [data-post-card-design="21.1.5"], article.scrolith-post-card'),
        mainCount: count('main, [role="main"]'),
        loginFormCount: count('form input[type="password"]'),
        loadingIndicatorCount: count('[aria-busy="true"], [role="progressbar"], [data-testid*="loading"]'),
        alertCount: count('[role="alert"]'),
        approvalDialogCount: count('[role="dialog"]'),
        documentBodyPresent: Boolean(document.body)
      };
    })
    .catch(() => ({ route: 'unavailable', safePath: 'other', readyState: 'unavailable', visibility: 'unavailable', authenticatedStoragePresent: false, localTokenKeyPresent: false, localAccessTokenKeyPresent: false, localScrolithTokenKeyPresent: false, tokenCookiePresent: false, storedUserPresent: false, storedUserIdPresent: false, storedUserOnboardingFlagPresent: false, storedUserOnboardingRequired: false, clientAuthState: 'unavailable', clientFollowOnboardingRequired: 'unavailable', followOnboardingRoute: false, memberHomeMarkerCount: 0, mobileHomeMarkerCount: 0, postCardCount: 0, mainCount: 0, loginFormCount: 0, loadingIndicatorCount: 0, alertCount: 0, approvalDialogCount: 0, documentBodyPresent: false }));

  const sanitizedEvents = apiEvents.slice(-120).map((event) => ({ ...event }));
  const evidencePath = join(safeDir, `${stem}.json`);
  writeFileSync(
    evidencePath,
    JSON.stringify(
      {
        schemaVersion: 1,
        scenario,
        project,
        testIdHash: suffix,
        pageState,
        apiEvents: sanitizedEvents,
        ...(diagnostics ? { diagnostics } : {})
      },
      null,
      2
    ),
    { encoding: 'utf8', mode: 0o600 }
  );

  const screenshotPath = join(safeDir, `${stem}.png`);
  await page.screenshot({
    path: screenshotPath,
    fullPage: false,
    animations: 'disabled',
    mask: [
      page.locator('header'),
      page.locator('nav'),
      page.locator('input'),
      page.locator('[data-testid*="user" i]'),
      page.locator('[data-testid*="profile" i]'),
      page.locator('[aria-label*="account" i]'),
      page.getByText(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i),
      page.locator('article [data-testid="post-header"]'),
      page.locator('article [data-testid="translatable-post-text"]'),
      page.locator('img, video')
    ],
    maskColor: '#000000'
  }).catch(() => undefined);
}
