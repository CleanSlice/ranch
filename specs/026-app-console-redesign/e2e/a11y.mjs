// Accessibility pass for the console and the gate (CLEAN-215, SC-005): every
// focusable control has an accessible name, no focusable element sits under
// aria-hidden, the orbit nodes / drum / view tabs / search / sheet buttons and
// the gate form are reachable by Tab. Read-only; needs the app, the API and
// the seeded login.
//
//   node specs/026-app-console-redesign/e2e/a11y.mjs
import { APP, launch, login, newPage, pickAgentId, settle, sleep } from './lib.mjs';

let fails = 0;
const check = (ok, msg) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!ok) fails += 1;
};

// Only what the Tab key can land on. Elements with tabindex="-1" (the drum's
// cards, focused through the listbox's aria-activedescendant) are not in the
// tab order, so an aria-hidden one round the back is correct, not a defect.
const FOCUSABLE =
  'a[href]:not([tabindex="-1"]), button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Accessible-name approximation: aria-label, aria-labelledby, text, title, alt of an inner img. */
async function audit(page, scopeLabel) {
  const result = await page.evaluate((selector) => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    const name = (el) => {
      const byId = el.getAttribute('aria-labelledby');
      if (byId) {
        const t = byId.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim() ?? '').join(' ').trim();
        if (t) return t;
      }
      return (
        el.getAttribute('aria-label')?.trim() ||
        el.textContent?.replace(/\s+/g, ' ').trim() ||
        el.getAttribute('title')?.trim() ||
        el.getAttribute('placeholder')?.trim() ||
        el.querySelector('img[alt]')?.getAttribute('alt')?.trim() ||
        ''
      );
    };
    const els = Array.from(document.querySelectorAll(selector)).filter(visible);
    const unnamed = els.filter((el) => !name(el)).map((el) => el.outerHTML.slice(0, 120));
    const hidden = els.filter((el) => el.closest('[aria-hidden="true"]')).map((el) => el.outerHTML.slice(0, 120));
    return { total: els.length, unnamed, hidden };
  }, FOCUSABLE);
  check(result.unnamed.length === 0, `${scopeLabel}: every visible control has a name (${result.total} controls${result.unnamed.length ? `; unnamed: ${result.unnamed.join(' | ')}` : ''})`);
  check(result.hidden.length === 0, `${scopeLabel}: no focusable control under aria-hidden${result.hidden.length ? ` (${result.hidden.join(' | ')})` : ''}`);
}

async function tabReaches(page, selector, label, maxTabs = 60) {
  for (let i = 0; i < maxTabs; i += 1) {
    await page.keyboard.press('Tab');
    const hit = await page.evaluate((sel) => !!document.activeElement?.closest(sel), selector);
    if (hit) {
      check(true, `Tab reaches ${label} (${i + 1} presses)`);
      return;
    }
  }
  check(false, `Tab reaches ${label} within ${maxTabs} presses`);
}

const browser = await launch();

console.log('-- gate');
const gate = await newPage(browser, { width: 1440, height: 900 });
await gate.goto(APP + '/login', { waitUntil: 'domcontentloaded' });
await settle(gate);
await audit(gate, 'login');
await gate.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
await tabReaches(gate, 'input[type="email"]', 'the email field');
await tabReaches(gate, 'button[type="submit"]', 'the submit button');
await gate.context().close();

console.log('-- landing on a touch device (hover: none)');
const touch = await newPage(browser, { width: 390, height: 844, touch: true });
await touch.goto(APP + '/', { waitUntil: 'domcontentloaded' });
await settle(touch);
await touch.locator('#platform').scrollIntoViewIfNeeded();
await sleep(800);
const pointerFx = await touch.evaluate(() =>
  Array.from(document.querySelectorAll('.land-fx--pointer')).map((el) => getComputedStyle(el).display),
);
check(pointerFx.length > 0 && pointerFx.every((d) => d === 'none'), `pointer effects hidden under hover:none (${pointerFx.length} glow layers, displays: ${[...new Set(pointerFx)].join(',')})`);
check((await touch.locator('#platform article.land-fx-once.is-in').count()) > 0, 'cards carry the one-shot highlight class once revealed');
await touch.context().close();

console.log('-- console (orbit)');
const agentId = await pickAgentId();
const page = await newPage(browser, { width: 1440, height: 900 });
await login(page);
await page.evaluate(() => localStorage.setItem('agent:view', 'orbit'));
await page.goto(`${APP}/agents/${agentId}`, { waitUntil: 'networkidle' });
await sleep(1500);
await audit(page, 'agents / orbit');
await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
await tabReaches(page, '[role="tab"]', 'the view switch');
await tabReaches(page, 'input[type="search"]', 'the search');
await tabReaches(page, '[data-orbit-node]', 'an orbit node');
await tabReaches(page, 'button[aria-expanded]', 'the sheet fold button', 80);
check((await page.locator('[data-orbit-node][aria-current="true"]').count()) === 1, 'the open agent is marked aria-current on its node');

console.log('-- console (drum)');
await page.evaluate(() => localStorage.setItem('agent:view', 'drum'));
await page.reload({ waitUntil: 'networkidle' });
await sleep(1200);
await audit(page, 'agents / drum');
const listbox = page.locator('[role="listbox"]').first();
check(((await listbox.getAttribute('aria-label')) || '').length > 0, 'drum listbox has a name');
check(!!(await listbox.getAttribute('aria-activedescendant')), 'drum names its active card');
check((await page.locator('[role="listbox"] [role="option"][aria-selected="true"]').count()) === 1, 'exactly one option is selected');

await browser.close();
console.log(fails ? `${fails} check(s) FAILED` : 'All a11y checks ok.');
process.exit(fails ? 1 : 0);
