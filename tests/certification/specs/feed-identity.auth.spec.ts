import { expect, test } from '@playwright/test';
import { FEED_IDENTITY_MS, requireAuthOrSkip } from '../helpers/env';
import { CERT_ROUTES } from '../helpers/routes';
import { assertFeedIdentityStable, runFeedIdentityProbe } from '../helpers/feedIdentity';
import { watchSafeApiEvents, writeSafeBrowserEvidence } from '../helpers/safeEvidence';

/**
 * Automates the operator 60s feed-identity certification.
 * Override duration with CERT_FEED_IDENTITY_MS (default 60000).
 */
test.describe('Feed identity — 60s stability', () => {
  test.beforeEach(() => {
    requireAuthOrSkip(test);
  });

  // Run surfaces independently so one failure does not skip WebKit community/scroll.
  test.describe.configure({ mode: 'parallel' });

  test('Member Home identity stable under soft activity', async ({ page }, testInfo) => {
    test.setTimeout(FEED_IDENTITY_MS + 90_000);
    const apiWatch = watchSafeApiEvents(page);
    await page.goto(CERT_ROUTES.memberHome, { waitUntil: 'domcontentloaded' });
    let evidenceWritten = false;
    try {
      const result = await runFeedIdentityProbe(page, {
        surface: 'member_home',
        durationMs: FEED_IDENTITY_MS
      });
      if (result.failed) {
        await apiWatch.settle();
        await writeSafeBrowserEvidence(page, testInfo, 'member_home_feed', apiWatch.events);
        evidenceWritten = true;
        expect(result.failed, 'Member Home feed identity certification failed; inspect the sanitized evidence artifact.').toBe(false);
      }
      testInfo.annotations.push({
        type: 'feedIdentity',
        description: JSON.stringify({ surface: result.surface, durationMs: result.durationMs, samples: result.samples, failed: false })
      });
      expect(result.initial, 'expected a seeded initial Member Home post').toBeTruthy();
      expect(result.final, 'the Member Home post remained present throughout the identity window').toBeTruthy();
      if (result.initial && result.final) {
        if (result.initial.postId && result.final.postId) expect(result.final.postId).toBe(result.initial.postId);
        expect(result.final.fingerprint).toBe(result.initial.fingerprint);
      }
    } catch (error) {
      if (!evidenceWritten) {
        await apiWatch.settle();
        await writeSafeBrowserEvidence(page, testInfo, 'member_home_feed', apiWatch.events).catch(() => undefined);
      }
      throw error;
    }
  });

  test('Community identity stable under soft activity', async ({ page }, testInfo) => {
    test.setTimeout(FEED_IDENTITY_MS + 90_000);
    await page.goto(CERT_ROUTES.community, { waitUntil: 'domcontentloaded' });
    const result = await assertFeedIdentityStable(page, {
      surface: 'community',
      durationMs: FEED_IDENTITY_MS
    });
    testInfo.annotations.push({ type: 'feedIdentity', description: JSON.stringify(result) });
  });

  test('Scroll surface does not crash during identity window', async ({ page }, testInfo) => {
    test.setTimeout(FEED_IDENTITY_MS + 90_000);
    await page.goto(CERT_ROUTES.scroll, { waitUntil: 'domcontentloaded' });
    // Scroll is video-first; run shorter soft stability on URL + root
    const started = Date.now();
    const href0 = page.url();
    while (Date.now() - started < Math.min(FEED_IDENTITY_MS, 30_000)) {
      await page.waitForTimeout(3_000);
      await page.evaluate(() => {
        window.dispatchEvent(new Event('focus'));
      });
      const alive = await page.evaluate(() => Boolean(document.body));
      if (!alive) throw new Error('scroll_root_dead');
    }
    testInfo.annotations.push({
      type: 'scrollIdentity',
      description: JSON.stringify({ href0, href1: page.url(), ms: Date.now() - started })
    });
  });
});
