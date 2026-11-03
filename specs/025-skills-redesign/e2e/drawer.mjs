// CLEAN-205 / US4 at 1024 px: the skill panel is a drawer — closed until a
// row is picked, closed by Esc with focus back on the row, by the backdrop,
// by Back; the URL carries ?skill only while it is open.
//   PLAYWRIGHT_DIR=~/pw node specs/025-skills-redesign/e2e/drawer.mjs
import { ADMIN, checker, launch, login, newPage, noHorizontalScroll, sleep } from './lib.mjs';

const { check, done } = checker();
const browser = await launch();

try {
  const page = await newPage(browser, { width: 1024, height: 800 });
  await login(page);
  await page.goto(ADMIN + '/skills', { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-skill-row]');
  check('no horizontal scroll at 1024', await noHorizontalScroll(page));
  check('no drawer without a selection', await page.locator('[data-host="drawer"]').count() === 0);
  check('no ?skill in the URL', !new URL(page.url()).searchParams.has('skill'));
  check('no sticky column at 1024', await page.locator('[data-host="column"]:visible').count() === 0);

  const slug = await page.locator('[data-skill-row]').first().getAttribute('data-skill-row');
  const title = page.locator(`[data-skill-row="${slug}"] button.font-semibold`).first();
  await title.click();
  await sleep(500);
  check('drawer opens on click', await page.locator('[data-host="drawer"]').count() === 1);
  check('drawer is a dialog', await page.locator('[role="dialog"] [data-host="drawer"]').count() === 1);
  check('?skill=<slug> in the URL', new URL(page.url()).searchParams.get('skill') === slug);
  const width = await page.locator('[role="dialog"]').evaluate((el) => el.getBoundingClientRect().width);
  check('drawer width is min(420px, 90vw)', Math.abs(width - 420) < 2, `${width}px`);
  check('focus is inside the drawer', await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')));

  await page.keyboard.press('Escape');
  await sleep(500);
  check('Esc closes the drawer', await page.locator('[data-host="drawer"]').count() === 0);
  check('Esc clears ?skill', !new URL(page.url()).searchParams.has('skill'));
  check('focus returns to the row', await page.evaluate((s) => document.activeElement?.closest(`[data-skill-row="${s}"]`) !== null, slug));

  await title.click();
  await sleep(500);
  await page.mouse.click(10, 400); // backdrop, left of the drawer
  await sleep(500);
  check('backdrop click closes the drawer', await page.locator('[data-host="drawer"]').count() === 0);

  await title.click();
  await sleep(500);
  await page.goBack();
  await sleep(500);
  check('Back closes the drawer', await page.locator('[data-host="drawer"]').count() === 0);
  check('still on /skills after Back', new URL(page.url()).pathname === '/skills');

  await page.goto(ADMIN + `/skills?skill=${slug}`, { waitUntil: 'networkidle' });
  await sleep(500);
  check('a shared link opens the drawer', await page.locator('[data-host="drawer"]').count() === 1);
  check('no horizontal scroll with the drawer open', await noHorizontalScroll(page));
} finally {
  await browser.close();
  done();
}
