import { test, expect } from '@playwright/test';
import { requireAuthOrSkip } from '../helpers/env';
import { CERT_ROUTES, isValidAuthDestination } from '../helpers/routes';
import { assertLayoutNoProductOverflow } from '../helpers/postCard';

test.describe('Notifications — authenticated cert', () => {
  test.beforeEach(() => {
    requireAuthOrSkip(test);
  });

  test('notifications surface loads without layout break', async ({ page }, testInfo) => {
    await page.goto(CERT_ROUTES.notifications, { waitUntil: 'domcontentloaded' });
    await expect
      .poll(
        async () => {
          const text = (await page.locator('body').innerText().catch(() => '')) || '';
          return /notification|inbox|no new|nothing|all caught up/i.test(text);
        },
        { timeout: 30_000, message: 'wait for the authenticated notifications screen to finish loading' }
      )
      .toBe(true);

    const url = page.url();
    testInfo.annotations.push({ type: 'landedUrl', description: url });
    expect(isValidAuthDestination(url, 'notifications'), `unexpected route ${url}`).toBe(true);

    // Empty notification list is valid for QA accounts
    const bodyText = (await page.locator('body').innerText().catch(() => '')) || '';
    expect(bodyText.trim().length, 'the authenticated notifications route should render a visible surface').toBeGreaterThan(0);
    expect(
      /notification|inbox|no new|nothing|all caught up/i.test(bodyText),
      'the authenticated surface should show notifications or a clear empty state'
    ).toBe(true);
    testInfo.annotations.push({
      type: 'bodyLength',
      description: String(bodyText.length)
    });
    if (bodyText.trim().length === 0) {
      testInfo.annotations.push({
        type: 'classification',
        description: 'missing_qa_data:empty_notifications_allowed'
      });
    }

    // Layout / a11y smoke — component scoped
    await assertLayoutNoProductOverflow(page);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    // Focus should move without throwing
    const active = await page.evaluate(() => document.activeElement?.tagName || null);
    expect(active, 'keyboard navigation should retain a focused element').not.toBeNull();
    testInfo.annotations.push({ type: 'activeElement', description: String(active) });
  });
});
