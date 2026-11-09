// Drum checks added in review round 7 (CLEAN-215): the reel loops, the
// arrows keep working after an agent is opened, the drum is seen from above,
// and the chat column has more room in the Orbit and Drum views.
//
//   node specs/026-app-console-redesign/e2e/drum.mjs
import { APP, FEATURE, apiSession, ensureDir, launch, login, newPage, sleep } from './lib.mjs';
import { resolve } from 'node:path';

const SHOTS = resolve(FEATURE, 'shots');
ensureDir(SHOTS);

let fails = 0;
const check = (ok, msg) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!ok) fails += 1;
};

const { agents } = await apiSession();
if (agents.length < 7) throw new Error('the loop needs at least seven agents; seed first');

const browser = await launch();
const page = await newPage(browser, { width: 1440, height: 900 });
await login(page);
await page.waitForLoadState('networkidle').catch(() => undefined);
await sleep(1500);
await page.evaluate(() => localStorage.setItem('agent:view', 'drum'));
await page.reload({ waitUntil: 'networkidle' });
await sleep(1500);

const drum = page.locator('[role="listbox"]');
const counter = () => page.locator('.agent-drum__counter').innerText().then((t) => Number(t.trim()));
const centredId = () => drum.getAttribute('aria-activedescendant');

console.log('-- loop');
await drum.focus();
await page.keyboard.press('Home');
await sleep(900);
check((await counter()) === 1, 'Home brings the first card to the front');
const firstId = await centredId();
await page.keyboard.press('ArrowLeft');
await sleep(900);
check((await counter()) === agents.length, `one step back from the first is the last (${await counter()} / ${agents.length})`);
const lastId = await centredId();
check(lastId !== firstId, 'a different card is in front');
await page.keyboard.press('ArrowRight');
await sleep(900);
check((await counter()) === 1 && (await centredId()) === firstId, 'one step forward from the last is the first again');
for (let i = 0; i < agents.length; i += 1) await page.keyboard.press('ArrowRight');
await sleep(1600);
check((await counter()) === 1, `a full lap of ${agents.length} steps ends where it started`);
const visibleNow = await page.evaluate(() => document.querySelectorAll('[role="option"][aria-hidden="false"]').length);
check(visibleNow >= 5 && visibleNow <= 7, `cards on both sides of the front one at the seam (${visibleNow} visible)`);
const sides = await page.evaluate(() => {
  const root = document.querySelector('[role="listbox"]').getBoundingClientRect();
  const mid = root.left + root.width / 2;
  const xs = Array.from(document.querySelectorAll('[role="option"][aria-hidden="false"]')).map((el) => {
    const r = el.getBoundingClientRect();
    return r.left + r.width / 2 - mid;
  });
  return { left: xs.filter((x) => x < -40).length, right: xs.filter((x) => x > 40).length };
});
check(sides.left >= 2 && sides.right >= 2, `the first card has neighbours on its left too (${sides.left} left, ${sides.right} right)`);
await page.screenshot({ path: resolve(SHOTS, 'fix-drum-loop-1440.png') });

console.log('-- seen from above');
const lift = await page.evaluate(() => {
  const front = document.querySelector('[role="option"][aria-selected="true"]').getBoundingClientRect();
  const others = Array.from(document.querySelectorAll('[role="option"][aria-hidden="false"]'))
    .filter((el) => el.getAttribute('aria-selected') !== 'true')
    .map((el) => el.getBoundingClientRect());
  const centre = (r) => r.top + r.height / 2;
  return others.map((r) => Math.round(centre(front) - centre(r)));
});
check(lift.length > 0 && lift.every((d) => d > 0), `cards going round the back sit higher than the front one (${lift.join(', ')} px)`);

console.log('-- arrows after opening an agent');
await page.keyboard.press('ArrowRight');
await page.keyboard.press('ArrowRight');
await sleep(900);
const before = page.url();
await page.keyboard.press('Enter');
await page.waitForURL((u) => u.toString() !== before, { timeout: 8000 }).catch(() => undefined);
await sleep(1500);
check(page.url() !== before, `Enter opened the agent in front (${new URL(page.url()).pathname})`);
check(await page.evaluate(() => document.activeElement?.getAttribute('role') === 'listbox'), 'the drum still has the focus');
const at = await counter();
await page.keyboard.press('ArrowRight');
await sleep(900);
check((await counter()) === (at % agents.length) + 1, `ArrowRight still turns it (${at} → ${await counter()})`);
await page.keyboard.press('ArrowLeft');
await page.keyboard.press('ArrowLeft');
await sleep(900);
check((await counter()) === ((at - 2 + agents.length) % agents.length) + 1, 'ArrowLeft too');

console.log('-- opening by click keeps the arrows as well');
await page.locator('[role="option"][aria-selected="true"]').click();
await sleep(1800);
check(await page.evaluate(() => document.activeElement?.getAttribute('role') === 'listbox'), 'focus is back on the drum after a click');
const at2 = await counter();
await page.keyboard.press('ArrowRight');
await sleep(900);
check((await counter()) === (at2 % agents.length) + 1, 'and the arrows turn it');

console.log('-- room for the chat');
const widths = {};
for (const width of [1440, 1280, 1920]) {
  await page.setViewportSize({ width, height: 900 });
  await sleep(500);
  widths[width] = await page.evaluate(() => {
    const el = document.querySelector('.agent-sheet')?.closest('[class*="lg:w-"]');
    return el ? Math.round(el.getBoundingClientRect().width) : -1;
  });
}
check(widths[1440] >= 600 && widths[1280] >= 600 && widths[1920] >= 720, `chat column: ${widths[1280]} px at 1280, ${widths[1440]} at 1440, ${widths[1920]} at 1920`);
await page.setViewportSize({ width: 1440, height: 900 });
await sleep(400);
await page.screenshot({ path: resolve(SHOTS, 'fix-drum-above-1440.png') });
await page.getByRole('tab', { name: /Орбита|Orbit/ }).click();
await sleep(900);
await page.screenshot({ path: resolve(SHOTS, 'fix-orbit-wide-chat-1440.png') });

await browser.close();
console.log(fails ? `\n${fails} check(s) failed` : '\nall checks passed');
process.exit(fails ? 1 : 0);
