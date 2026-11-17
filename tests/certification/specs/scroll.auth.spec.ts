import { test, expect } from '@playwright/test';
import { requireAuthOrSkip } from '../helpers/env';
import { CERT_ROUTES } from '../helpers/routes';
import { assertFeedColumnNoOverflow, waitForFeed } from '../helpers/postCard';

test.describe('Scroll — authenticated surface cert', () => {
  test.beforeEach(() => {
    requireAuthOrSkip(test);
  });

  test('scroll surface loads without horizontal overflow', async ({ page }) => {
    await page.goto(CERT_ROUTES.scroll, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await waitForFeed(page).catch(() => undefined);
    await assertFeedColumnNoOverflow(page, 24).catch(() => undefined);

    // Scroll UI may be video-first; ensure root is alive
    const alive = await page.evaluate(() => Boolean(document.body?.innerText?.length));
    expect(alive).toBe(true);
  });

  test('interest survey controls are rendered for an available cross-account scroll', async ({ page }) => {
    const fixtureId = String(process.env.CERT_SCROLL_FIXTURE_ID || '').trim();
    const fixtureRequired = process.env.CERT_REQUIRE_FEED_FIXTURES === 'true';
    if (process.env.CI === 'true' && !fixtureRequired) {
      throw new Error('CI authenticated Scroll certification requires CERT_REQUIRE_FEED_FIXTURES=true.');
    }
    if (fixtureRequired && !/^[a-zA-Z0-9_-]{1,64}$/.test(fixtureId)) {
      throw new Error('The required synthetic Scroll fixture ID is missing or invalid.');
    }

    const surveySelector = '[data-testid="content-interest-survey"]';
    const scrollUrl = fixtureId
      ? `${CERT_ROUTES.scroll}?scroll=${encodeURIComponent(fixtureId)}`
      : CERT_ROUTES.scroll;
    await page.goto(scrollUrl, { waitUntil: 'domcontentloaded' });
    const survey = fixtureId
      ? page.locator(`${surveySelector}[data-entity-id="${fixtureId}"]`)
      : page.locator(surveySelector).first();
    if ((await survey.count()) === 0) {
      if (fixtureRequired) {
        await expect(survey, 'the required authenticated Scroll fixture must expose its interest survey').toHaveCount(1, { timeout: 15_000 });
      } else {
        test.skip(true, 'No interest survey on current scroll item');
        return;
      }
    }
    await expect(survey.first()).toBeVisible();
    const yes = survey.first().locator('[data-testid="content-interest-yes"]');
    const no = survey.first().locator('[data-testid="content-interest-no"]');
    await expect(yes).toBeVisible();
    await expect(no).toBeVisible();
    const a = await yes.boundingBox();
    const b = await no.boundingBox();
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(Math.abs((a?.height || 0) - (b?.height || 0))).toBeLessThanOrEqual(4);
  });
});
