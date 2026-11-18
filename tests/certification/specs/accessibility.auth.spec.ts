import { test, expect } from '@playwright/test';
import { requireAuthOrSkip } from '../helpers/env';
import { CERT_ROUTES } from '../helpers/routes';
import {
  assertContrastSample,
  assertFocusableActions,
  assertKeyboardTabOrder,
  assertReducedMotionRespected,
  assertTouchTargets,
  runCardA11yChecks
} from '../helpers/a11y';
import { assertRequiredPostControls, postCards, selectCertificationPostCard, skipOrFailWhenFeedFixtureMissing, waitForFeed } from '../helpers/postCard';
import { watchSafeApiEvents, writeSafeBrowserEvidence } from '../helpers/safeEvidence';

test.describe('Accessibility — authenticated cert', () => {
  test.beforeEach(() => {
    requireAuthOrSkip(test);
  });

  test('reduced motion, contrast sample, keyboard and touch targets', async ({ page }, testInfo) => {
    const apiWatch = watchSafeApiEvents(page);
    await assertReducedMotionRespected(page);
    await page.goto(CERT_ROUTES.memberHome, { waitUntil: 'domcontentloaded' });
    await waitForFeed(page);
    await assertContrastSample(page);

    const order = await assertKeyboardTabOrder(page, 10);
    expect(order.length).toBeGreaterThan(0);

    const cards = postCards(page);
    if ((await cards.count()) === 0) {
      await skipOrFailWhenFeedFixtureMissing(test, 0, 'No post cards for a11y controls outside seeded CI runs', async () => {
        await apiWatch.settle();
        await writeSafeBrowserEvidence(page, testInfo, 'member_home_feed', apiWatch.events);
      });
      return;
    }
    const card = await selectCertificationPostCard(page, cards.first());
    await assertRequiredPostControls(card);
    await assertFocusableActions(card);
    await assertTouchTargets(card);
    await runCardA11yChecks(page);
  });
});
