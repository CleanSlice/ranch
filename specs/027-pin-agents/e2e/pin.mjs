// Browser check for pinning agents in the app console (CLEAN-216,
// contracts/console-ui.md).
//
//   node specs/027-pin-agents/e2e/pin.mjs                 # Owner: pin, check every view, unpin
//   node specs/027-pin-agents/e2e/pin.mjs --check-only    # only assert the current pinned state and order
//   node specs/027-pin-agents/e2e/pin.mjs --keep          # Owner pass, leave the agent pinned
//   node specs/027-pin-agents/e2e/pin.mjs --as user       # a User sees the icon and no control
//
// Needs the app on APP_URL (:3000), the API on API_URL (:3333) and the seeded
// Owner login in .env.project. `--as user` reads RANCH_LOCAL_USER_LOGIN /
// RANCH_LOCAL_USER_PASS and prints `skip` when they are not set. The Owner run
// pins the last unpinned non-admin agent and unpins it at the end, so the
// server is left as it was found (unless --keep).
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  API,
  APP,
  apiSession,
  arg,
  env,
  launch,
  login,
  newPage,
  sleep,
} from '../../026-app-console-redesign/e2e/lib.mjs';

const SHOTS = resolve(dirname(fileURLToPath(import.meta.url)), 'shots');
mkdirSync(SHOTS, { recursive: true });

const RE = {
  pin: /^Закрепить$|^Pin$/,
  unpin: /^Открепить$|^Unpin$/,
  orbitTab: /Орбита|Orbit/,
  listTab: /Список|List/,
};

let fails = 0;
const check = (ok, msg) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!ok) fails += 1;
};

const checkOnly = process.argv.includes('--check-only');
const keep = process.argv.includes('--keep');
const asUser = arg('as', '') === 'user';

/** Ids of the rail rows, top to bottom. */
const railIds = (page) =>
  page.evaluate(() => Array.from(document.querySelectorAll('li[data-agent-id]')).map((li) => li.dataset.agentId));
/** Ids of the orbit nodes in layout order (ring 0 first, twelve o'clock first). */
const orbitIds = (page) =>
  page.evaluate(() => Array.from(document.querySelectorAll('[data-orbit-node]')).map((el) => el.dataset.agentId));
const hasPinIcon = (page, scopeSelector) =>
  page.evaluate((sel) => Boolean(document.querySelector(`${sel} [data-pinned]`)), scopeSelector);
const pinnedRailRows = (page) =>
  page.evaluate(() => document.querySelectorAll('li[data-agent-id] [data-pinned]').length);

async function setView(page, re) {
  await page.getByRole('tab', { name: re }).click();
  await sleep(700);
}

async function serverAgent(token, id) {
  const res = await fetch(`${API}/agents/${id}`, { headers: { authorization: `Bearer ${token}` } });
  const json = await res.json();
  return json && typeof json === 'object' && 'data' in json ? json.data : json;
}

/** The rail rule: admin first, then pinned, then the rest in API order. */
function expectedOrder(agents, pinnedId) {
  const withPin = agents.map((a) => ({ ...a, pinned: a.id === pinnedId ? true : a.pinned }));
  const admin = withPin.filter((a) => a.isAdmin);
  const pinned = withPin.filter((a) => !a.isAdmin && a.pinned);
  const rest = withPin.filter((a) => !a.isAdmin && !a.pinned);
  return [...admin, ...pinned, ...rest].map((a) => a.id);
}

// ── Setup ────────────────────────────────────────────────────────────────
const { token, agents } = await apiSession();
const unpinnedNonAdmin = agents.filter((a) => !a.isAdmin && !a.pinned);
const alreadyPinned = agents.filter((a) => !a.isAdmin && a.pinned);
const target = checkOnly || asUser ? (alreadyPinned[0] ?? null) : (unpinnedNonAdmin.at(-1) ?? null);
if (!target) {
  throw new Error(
    checkOnly || asUser ? 'no pinned agent to check; run the Owner pass first' : 'no unpinned non-admin agent; seed first',
  );
}
console.log(`agents: ${agents.length}; target "${target.name}" (${target.id}) pinned=${target.pinned}`);

const browser = await launch();
const page = await newPage(browser, { width: 1440, height: 900 });

if (asUser) {
  const login2 = env.RANCH_LOCAL_USER_LOGIN;
  const pass2 = env.RANCH_LOCAL_USER_PASS;
  if (!login2 || !pass2) {
    console.log('  skip  RANCH_LOCAL_USER_LOGIN / RANCH_LOCAL_USER_PASS not set; User pass skipped');
    await browser.close();
    process.exit(0);
  }
  await page.goto(APP + '/login', { waitUntil: 'networkidle' });
  await page.locator('input[type="email"], input[name="email"]').first().fill(login2);
  await page.locator('input[type="password"]').first().fill(pass2);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }),
    page.locator('button[type="submit"]').first().click(),
  ]);
} else {
  await login(page);
}
await page.evaluate(() => {
  localStorage.setItem('agent:view', 'orbit');
});
await page.goto(`${APP}/agents/${target.id}`, { waitUntil: 'networkidle' });
await sleep(1500);

// ── User pass: icon yes, control no ───────────────────────────────────────
if (asUser) {
  console.log('-- user');
  check(await hasPinIcon(page, '.agent-sheet'), 'sheet shows the pin icon');
  check((await page.getByRole('button', { name: RE.pin }).count()) === 0, 'no Pin button');
  check((await page.getByRole('button', { name: RE.unpin }).count()) === 0, 'no Unpin button');
  await browser.close();
  console.log(fails ? `\n${fails} check(s) failed` : '\nall checks passed');
  process.exit(fails ? 1 : 0);
}

// ── Owner pass ────────────────────────────────────────────────────────────
if (!checkOnly) {
  console.log('-- pin');
  check((await page.getByRole('button', { name: RE.pin }).count()) === 1, 'sheet offers Pin');
  check(!(await hasPinIcon(page, '.agent-sheet')), 'no pin icon before');
  page.on('request', (r) => {
    if (r.method() === 'PUT' && /\/agents\/[^/]+$/.test(r.url())) {
      console.log(`     → PUT ${new URL(r.url()).pathname} ${r.postData()}`);
    }
  });
  await page.getByRole('button', { name: RE.pin }).first().click();
  await sleep(300);
  check((await page.getByRole('button', { name: RE.unpin }).count()) === 1, 'sheet offers Unpin right after the click');
  check(await hasPinIcon(page, '.agent-sheet'), 'sheet shows the pin icon at once');
  await sleep(1200);
  const server = await serverAgent(token, target.id);
  check(server.pinned === true, 'server agrees: pinned=true');
  check(server.status === target.status, `status unchanged (${server.status})`);
}

const want = expectedOrder(agents, target.id);

console.log('-- orbit');
// A pin leads its own ring (after the admin agent); it does not change rings.
const ringLead = await page.evaluate((id) => {
  const nodes = Array.from(document.querySelectorAll('[data-orbit-node]'));
  const hub = document.querySelector('.agent-orbit__hub').getBoundingClientRect();
  const cx = hub.left + hub.width / 2, cy = hub.top + hub.height / 2;
  const info = nodes.map((el, i) => { const r = el.getBoundingClientRect(); return { id: el.dataset.agentId, i, d: Math.round(Math.hypot(r.left + r.width / 2 - cx, (r.top + r.height / 2 - cy) * 1.2) / 12) }; });
  const me = info.find((n) => n.id === id);
  return { found: Boolean(me), index: me ? me.i : -1 };
}, target.id);
check(ringLead.found, 'the pinned agent is on the map');
const nodeSel = `[data-orbit-node][data-agent-id="${target.id}"]`;
check((await page.locator(`${nodeSel} svg`).count()) > 0, 'orbit node carries the pin badge');
check(/Закреплено|Pinned/.test((await page.locator(nodeSel).getAttribute('aria-label')) ?? ''), 'orbit node aria-label says Pinned');
await page.screenshot({ path: resolve(SHOTS, 'pin-orbit-1440.png') });

// On a desktop the rail is the List view (the Orbit opens it as a drawer
// from "Switch agent"), so the rail rows are read here.
console.log('-- rail (list view)');
await setView(page, RE.listTab);
const rail = await railIds(page);
check(rail.join() === want.join(), `rail order is admin → pinned → rest (pinned row at index ${rail.indexOf(target.id)})`);
check(await hasPinIcon(page, `li[data-agent-id="${target.id}"]`), 'rail row carries the pin icon');
const serverPinnedCount = alreadyPinned.length + (checkOnly ? 0 : 1);
check((await pinnedRailRows(page)) === serverPinnedCount, `${serverPinnedCount} rail row(s) carry a pin icon, matching the server`);
await page.screenshot({ path: resolve(SHOTS, 'pin-sheet-1440.png') });

if (!checkOnly) {
  console.log('-- pin from the row, without opening the agent');
  const other = rail.find((id) => id !== target.id && !agents.find((a) => a.id === id)?.isAdmin && !agents.find((a) => a.id === id)?.pinned);
  const row = page.locator(`li[data-agent-id="${other}"]`);
  const rowPin = row.locator('[data-rail-pin]');
  check((await rowPin.count()) === 1, 'the row has a pin button');
  check((await rowPin.evaluate((el) => getComputedStyle(el).opacity)) === '0', 'hidden until the row is hovered');
  await row.hover();
  await sleep(300);
  check((await rowPin.evaluate((el) => getComputedStyle(el).opacity)) === '1', 'shown on hover');
  const urlBefore = page.url();
  await rowPin.click();
  await sleep(1200);
  check(page.url() === urlBefore, 'pinning from the row does not open the agent');
  check(await hasPinIcon(page, `li[data-agent-id="${other}"]`), 'the row carries the pin icon');
  check((await serverAgent(token, other)).pinned === true, 'server agrees: pinned=true');
  const order = await railIds(page);
  check(order.indexOf(other) <= order.indexOf(target.id) + 1 && order.indexOf(other) >= 1, 'the row moved into the pinned block');
  await page.screenshot({ path: resolve(SHOTS, 'pin-row-hover-1440.png') });
  await page.locator(`li[data-agent-id="${other}"]`).hover();
  await page.locator(`li[data-agent-id="${other}"] [data-rail-pin]`).click();
  await sleep(1200);
  check((await serverAgent(token, other)).pinned === false, 'and unpinning from the row puts it back');
}

console.log('-- reload');
await page.reload({ waitUntil: 'networkidle' });
await sleep(1500);
check(await hasPinIcon(page, '.agent-sheet'), 'still pinned after a reload');
check((await page.getByRole('button', { name: RE.unpin }).count()) === 1, 'sheet still offers Unpin');

console.log('-- phone');
// Same context as the desktop page, so the session comes along.
const phone = await page.context().newPage();
await phone.setViewportSize({ width: 390, height: 844 });
await phone.goto(`${APP}/agents/${target.id}`, { waitUntil: 'networkidle' });
await sleep(1200);
await phone.screenshot({ path: resolve(SHOTS, 'pin-rail-390.png') });
await phone.close();

if (!checkOnly && !keep) {
  console.log('-- unpin');
  await setView(page, RE.listTab);
  await page.getByRole('button', { name: RE.unpin }).first().click();
  await sleep(1500);
  check((await page.getByRole('button', { name: RE.pin }).count()) === 1, 'sheet offers Pin again');
  check(!(await hasPinIcon(page, '.agent-sheet')), 'pin icon gone from the sheet');
  check(!(await hasPinIcon(page, `li[data-agent-id="${target.id}"]`)), 'pin icon gone from the rail row');
  check((await railIds(page)).join() === expectedOrder(agents, null).join(), 'rail order is back to how it was');
  const server = await serverAgent(token, target.id);
  check(server.pinned === false, 'server agrees: pinned=false');
}

await browser.close();
console.log(fails ? `\n${fails} check(s) failed` : '\nall checks passed');
process.exit(fails ? 1 : 0);
