// Session gate checks (CLEAN-215, contracts/gate-ui.md): the route reacts to
// the form, wrong and right credentials, registration on and off, the phone
// layout. Needs the app, the API and the seeded login; toggles the
// auth.registration_enabled setting through the local Postgres container and
// creates one throwaway account (deleted at the end).
//
//   node specs/026-app-console-redesign/e2e/gate.mjs
import { execFileSync } from 'node:child_process';
import { APP, LOGIN, PASS, launch, newPage, settle, sleep } from './lib.mjs';

let fails = 0;
const check = (ok, msg) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!ok) fails += 1;
};
const psql = (sql) =>
  execFileSync('docker', ['exec', 'ranch-postgres', 'psql', '-U', 'postgres', '-d', 'ranch-local', '-tAc', sql], {
    encoding: 'utf8',
  }).trim();
const stage = (page) => page.locator('ol.gate-route').first().getAttribute('class');
const has = async (page, cls) => ((await stage(page)) ?? '').split(/\s+/).includes(cls);

const browser = await launch();
const page = await newPage(browser, { width: 1440, height: 900 });

console.log('-- /login: idle → filling → connecting → failed → success');
await page.goto(APP + '/login', { waitUntil: 'domcontentloaded' });
await settle(page);
check(await has(page, 'is-idle'), 'route starts idle');
await page.locator('input[type="email"]').first().focus();
await sleep(150);
check(await has(page, 'is-filling'), 'focusing a field → filling');
await page.locator('input[type="email"]').first().fill(LOGIN);
await page.locator('input[type="password"]').first().fill('definitely-wrong-password');
const submit = page.locator('button[type="submit"]').first();
await submit.click();
await sleep(1500);
check(await has(page, 'is-failed'), 'wrong password → failed (hub red)');
check((await page.locator('[role="alert"], .text-destructive, [class*="error"]').filter({ hasText: /./ }).count()) > 0, 'form shows the refusal');
await page.locator('input[type="password"]').first().fill(PASS);
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }), submit.click()]);
check(/\/agents/.test(page.url()), `right password → console (${new URL(page.url()).pathname})`);
await page.context().clearCookies();

console.log('-- /register with registration enabled');
psql(`UPDATE "Setting" SET value='true' WHERE "group"='auth' AND name='registration_enabled'`);
const throwaway = `gate-check-${Date.now()}@ranch.local`;
const p2 = await newPage(browser, { width: 1440, height: 900 });
await p2.goto(APP + '/register', { waitUntil: 'domcontentloaded' });
await settle(p2);
check((await p2.locator('a[href="/login"]').count()) > 0 && (await p2.locator('a[href="/register"]').count()) > 0, 'switch links to the real /login and /register');
await p2.locator('input[name="name"], #auth-name').first().fill('Gate Check');
await p2.locator('input[type="email"]').first().fill(throwaway);
await p2.locator('input[type="password"]').first().fill('GateCheck-12345!');
await Promise.all([
  p2.waitForURL((u) => !u.pathname.startsWith('/register'), { timeout: 20000 }),
  p2.locator('button[type="submit"]').first().click(),
]);
check(/\/agents/.test(p2.url()), `registration creates the account and opens the console (${new URL(p2.url()).pathname})`);
await p2.context().close();

console.log('-- /register with registration disabled');
psql(`UPDATE "Setting" SET value='false' WHERE "group"='auth' AND name='registration_enabled'`);
const p3 = await newPage(browser, { width: 1440, height: 900 });
await p3.goto(APP + '/register', { waitUntil: 'domcontentloaded' });
await settle(p3);
check((await p3.locator('ol.gate-route').count()) === 1, 'closed registration still renders inside the gate');
check((await p3.locator('input[type="password"]').count()) === 0, 'no form when registration is closed');
check((await p3.locator('a[href="/login"]').count()) > 0, 'Log in is offered');
await p3.context().close();
psql(`UPDATE "Setting" SET value='true' WHERE "group"='auth' AND name='registration_enabled'`);

console.log('-- 390 px');
const p4 = await newPage(browser, { width: 390, height: 844 });
await p4.goto(APP + '/login', { waitUntil: 'domcontentloaded' });
await settle(p4);
check(await p4.locator('ol.gate-route.gate-route--row').count() === 1, 'route is the compact row');
const backText = p4.locator('.gate__back-text').first();
check(!(await backText.isVisible().catch(() => false)), 'back link text hidden on the phone');
const back = p4.locator('a.gate__back').first();
const name = (await back.getAttribute('aria-label')) || (await back.innerText()).trim();
check(!!name, `back link keeps an accessible name ("${name}")`);
check(
  await p4.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth),
  'no horizontal scroll',
);
await p4.context().close();

const removed = psql(`DELETE FROM "User" WHERE email='${throwaway}' RETURNING email`);
console.log(`  cleanup: throwaway account ${removed ? 'removed' : 'not found'}`);

await browser.close();
console.log(fails ? `${fails} check(s) FAILED` : 'All gate checks ok.');
process.exit(fails ? 1 : 0);
