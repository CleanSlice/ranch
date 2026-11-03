// CLEAN-205 / US4 at 390 px: cards with a ⋯ menu, a bottom sheet with a
// grab handle, chips in one scrolling row, a native sort select, and the
// explicit Reorder mode with its pinned bar.
//   PLAYWRIGHT_DIR=~/pw node specs/025-skills-redesign/e2e/sheet.mjs
import { ADMIN, checker, launch, login, newPage, noHorizontalScroll, sleep } from './lib.mjs';

const { check, done } = checker();
const browser = await launch();

try {
  const page = await newPage(browser, { width: 390, height: 844 });
  await login(page);
  await page.goto(ADMIN + '/skills', { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-skill-row]');
  check('no horizontal scroll at 390', await noHorizontalScroll(page));

  const slug = await page.locator('[data-skill-row]').first().getAttribute('data-skill-row');
  check('no drag handle outside Reorder mode', await page.locator('[data-skill-handle]').count() === 0);
  const menu = page.locator(`[data-skill-menu="${slug}"]`);
  const mb = await menu.boundingBox();
  check('⋯ button is 44×44', mb && mb.width >= 44 && mb.height >= 44, `${mb?.width}×${mb?.height}`);
  check('sort is a native select', await page.locator('select#skill-sort').count() === 1);
  const chipsRow = page.locator('[aria-label="Filter by group"]');
  check('chips scroll sideways, not the page', await chipsRow.evaluate((el) => getComputedStyle(el).overflowX === 'auto'));
  check('summary is a 2×2 grid', await page.locator('[data-skill-summary]').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length === 2));

  await page.locator(`[data-skill-row="${slug}"] button.font-semibold`).first().click();
  await sleep(500);
  const sheet = page.locator('[data-host="sheet"]');
  check('bottom sheet opens', await sheet.count() === 1);
  const h = await page.locator('[role="dialog"]').evaluate((el) => el.getBoundingClientRect().height / window.innerHeight);
  check('sheet is about 90% high', h > 0.85 && h <= 0.92, `${Math.round(h * 100)}%`);
  check('grab handle present', await page.locator('[role="dialog"] [aria-label="Close details"]').count() === 1);
  await page.locator('[role="dialog"] [aria-label="Close details"]').click();
  await sleep(500);
  check('handle button closes the sheet', await sheet.count() === 0);

  // ⋯ → Delete opens the sheet with the inline confirmation; Keep backs out.
  await menu.click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await sleep(500);
  check('⋯ → Delete opens the sheet with the confirmation', await page.locator('[data-host="sheet"] [data-skill-delete-confirm]').count() === 1);
  await page.locator('[data-action="keep"]').click();
  await sleep(200);
  check('Keep leaves the skill', await page.locator(`[data-skill-row="${slug}"]`).count() === 1);
  await page.keyboard.press('Escape');
  await sleep(400);

  // Reorder mode
  await page.locator('[data-action="reorder-mode"]').click();
  await sleep(200);
  check('Reorder shows the handles', await page.locator('[data-skill-handle]').count() > 0);
  await page.locator('[data-skill-handle]').first().focus();
  await page.keyboard.press('ArrowDown');
  await sleep(200);
  const bar = page.locator('[data-skill-order-bar]');
  check('pinned bar appears', await bar.count() === 1 && (await bar.evaluate((el) => getComputedStyle(el).position === 'fixed')));
  check('pinned bar has Cancel and Save order', (await bar.locator('[data-action="discard"]').textContent())?.trim() === 'Cancel' && (await bar.locator('[data-action="save-order"]').count()) === 1);
  await bar.locator('[data-action="discard"]').click();
  await sleep(200);
  check('Cancel discards the draft', await bar.count() === 0);
  check('no horizontal scroll in Reorder mode', await noHorizontalScroll(page));
} finally {
  await browser.close();
  done();
}
