// CLEAN-205 / US2 at 1440 px: drag with the mouse and save, move with the
// keyboard, Discard, roll back on a failed save, reload on a 409.
//   PLAYWRIGHT_DIR=~/pw node specs/025-skills-redesign/e2e/reorder.mjs
// Needs at least three skills in the library. Leaves the order as it found it.
import { ADMIN, checker, launch, login, newPage, noHorizontalScroll, sleep } from './lib.mjs';

const { check, done } = checker();
const browser = await launch();
const slugs = (page) => page.$$eval('[data-skill-row]', (els) => els.map((el) => el.getAttribute('data-skill-row')));

try {
  const page = await newPage(browser, { width: 1440, height: 900 });
  await login(page);
  await page.goto(ADMIN + '/skills', { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-skill-row]');
  const before = await slugs(page);
  check('at least three skills to work with', before.length >= 3, `${before.length} rows`);
  check('no horizontal scroll at 1440', await noHorizontalScroll(page));

  // --- mouse drag: row 1 below row 3
  const handle = page.locator(`[data-skill-handle="${before[0]}"]`);
  const target = page.locator(`[data-skill-row="${before[2]}"]`);
  const hb = await handle.boundingBox();
  const tb = await target.boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2, tb.y + tb.height - 4, { steps: 12 });
  check('drop indicator visible while dragging', await page.locator('[data-skill-drop-indicator]').count() === 1);
  await page.mouse.up();
  await sleep(200);
  const afterDrag = await slugs(page);
  check('row moved below the third', afterDrag[2] === before[0], afterDrag.slice(0, 3).join(' > '));
  check('moved badge on the dragged row', (await page.locator(`[data-skill-row="${before[0]}"]`).getAttribute('data-moved')) === '↓2');
  const barText = await page.locator('[data-skill-order-bar]').textContent();
  check('order bar counts positions', /List order changed: 3 positions moved/.test(barText ?? ''), barText?.trim());

  // --- Discard
  await page.locator('[data-action="discard"]').click();
  await sleep(150);
  check('Discard restores the order', (await slugs(page)).join() === before.join());
  check('order bar gone after Discard', await page.locator('[data-skill-order-bar]').count() === 0);

  // --- keyboard: ↓ on the first handle
  await page.locator(`[data-skill-handle="${before[0]}"]`).focus();
  await page.keyboard.press('ArrowDown');
  await sleep(150);
  const afterKey = await slugs(page);
  check('ArrowDown moves the row one place', afterKey[1] === before[0]);
  const live = await page.locator('[data-skill-live]').textContent();
  check('live region announces the move', live === `${before[0]} moved to position 2 of ${before.length}`, live);
  check('focus stays on the moved handle', await page.evaluate((s) => document.activeElement?.getAttribute('data-skill-handle') === s, before[0]));

  // --- failed save rolls back
  await page.route('**/skills/order', (route) => (route.request().method() === 'PATCH' ? route.fulfill({ status: 500, body: '{}' }) : route.continue()));
  await page.locator('[data-action="save-order"]').click();
  await sleep(400);
  check('500 → toast says it could not save', await page.getByText('Could not save the order').count() > 0);
  check('500 → order rolled back', (await slugs(page)).join() === before.join());
  await page.unroute('**/skills/order');

  // --- 409 reloads the list with a message
  await page.locator(`[data-skill-handle="${before[0]}"]`).focus();
  await page.keyboard.press('ArrowDown');
  await sleep(150);
  await page.route('**/skills/order', (route) =>
    route.request().method() === 'PATCH'
      ? route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ statusCode: 409, code: 'ORDER_CHANGED', message: 'The library order changed since you loaded it.' }) })
      : route.continue(),
  );
  await page.locator('[data-action="save-order"]').click();
  await sleep(600);
  check('409 → reload message', await page.getByText('Someone else changed the order. The list was reloaded.').count() > 0);
  check('409 → list back to the server order', (await slugs(page)).join() === before.join());
  await page.unroute('**/skills/order');

  // --- real save and restore
  await page.locator(`[data-skill-handle="${before[0]}"]`).focus();
  await page.keyboard.press('ArrowDown');
  await sleep(150);
  await page.locator('[data-action="save-order"]').click();
  await sleep(600);
  check('save → toast', await page.getByText('Order saved').count() > 0);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('[data-skill-row]');
  const persisted = await slugs(page);
  check('saved order survives a reload', persisted[1] === before[0], persisted.slice(0, 3).join(' > '));
  // Put it back.
  await page.locator(`[data-skill-handle="${before[0]}"]`).focus();
  await page.keyboard.press('ArrowUp');
  await sleep(150);
  await page.locator('[data-action="save-order"]').click();
  await sleep(600);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('[data-skill-row]');
  check('order restored for the next run', (await slugs(page)).join() === before.join());

  // --- Recently edited disables the handles
  await page.goto(ADMIN + '/skills?sort=recent', { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-skill-row]');
  check('handles disabled under Recently edited', await page.locator('[data-skill-handle]:disabled').count() === before.length);
  check('hint explains why', (await page.locator('[data-skill-handle]').first().getAttribute('title')) === 'Reordering is off while sorted by edit time');
} finally {
  await browser.close();
  done();
}
