// Browser check for the profile page "Pass" (CLEAN-217, contracts/profile-ui.md).
//
//   node specs/028-app-profile/e2e/profile.mjs            # every state, screenshots
//   node specs/028-app-profile/e2e/profile.mjs --no-poll  # skip the 30 s poll wait
//
// Needs the app on APP_URL (:3000), the API on API_URL (:3333) and the seeded
// Owner login in .env.project. Changes nothing on the server: other roles and
// odd accounts are produced by rewriting the auth responses in the browser.
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  API,
  APP,
  LOGIN,
  PASS,
  apiSession,
  launch,
  noHorizontalScroll,
  sleep,
} from '../../026-app-console-redesign/e2e/lib.mjs';

const SHOTS = resolve(dirname(fileURLToPath(import.meta.url)), 'shots');
mkdirSync(SHOTS, { recursive: true });
const shot = (page, name) => page.screenshot({ path: resolve(SHOTS, `${name}.png`), fullPage: true });

let fails = 0;
const check = (ok, msg) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!ok) fails += 1;
};
const unwrap = (json) => (json && typeof json === 'object' && 'data' in json ? json.data : json);
const text = (page, sel) => page.locator(sel).first().innerText().then((t) => t.trim()).catch(() => null);
const count = (page, sel) => page.locator(sel).count();

/** Rewrites every object in an auth response that looks like the user. */
function patchUser(value, patch) {
  if (Array.isArray(value)) return value.map((v) => patchUser(v, patch));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = patchUser(v, patch);
  if (typeof out.email === 'string' && 'role' in out) Object.assign(out, patch);
  return out;
}

/**
 * A signed-in page in its own context. `user` rewrites the account the app
 * sees; `routes` adds interceptions (pattern → handler) before login.
 */
async function open(browser, { width = 1440, height = 900, reduced = false, user = null, routes = [] } = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    reducedMotion: reduced ? 'reduce' : 'no-preference',
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();
  if (user) {
    await page.route(`${API}/auth/**`, async (route) => {
      const res = await route.fetch();
      let body;
      try {
        body = await res.json();
      } catch {
        return route.fulfill({ response: res });
      }
      return route.fulfill({ response: res, json: patchUser(body, user) });
    });
  }
  for (const [pattern, handler] of routes) await page.route(pattern, handler);
  await page.goto(`${APP}/login`, { waitUntil: 'networkidle' });
  await page.locator('input[type="email"], input[name="email"]').first().fill(LOGIN);
  await page.locator('input[type="password"]').first().fill(PASS);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }),
    page.locator('button[type="submit"]').first().click(),
  ]);
  // Login lands on /agents, whose resolver then replaces the route with an
  // agent's own. Let that finish, or it would pull a later navigation back.
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.locator('[data-profile-pill]').waitFor({ timeout: 15000 });
  await sleep(1200);
  return { context, page };
}
async function toProfile(page, { settle = true } = {}) {
  await page.goto(`${APP}/profile`, { waitUntil: 'networkidle' });
  await page.locator('[data-profile]').waitFor({ timeout: 15000 });
  // The pass drops and swings for up to 3.5 s; measure it at rest.
  await sleep(settle ? 3900 : 0);
}
const capStates = (page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('li[data-cap]')).map((li) => `${li.dataset.cap}:${li.dataset.state}`),
  );

// ── Server truth ─────────────────────────────────────────────────────────
const { token, agents } = await apiSession();
const auth = { authorization: `Bearer ${token}` };
const me = unwrap(await (await fetch(`${API}/auth/me`, { headers: auth })).json());
const capRes = await fetch(`${API}/agents/capacity`, { headers: auth });
const capacity = capRes.ok ? unwrap(await capRes.json()) : null;
const running = agents.filter((a) => a.status === 'running').length;
const registry = (() => {
  const c = String(me.id).replace(/[^a-z0-9]/gi, '').slice(0, 8).toUpperCase();
  return c.length <= 4 ? c : `${c.slice(0, 4)}·${c.slice(4)}`;
})();
console.log(`account role=${me.role} status=${me.status}; agents ${agents.length}, running ${running}; capacity ${capacity ? `${capacity.usedAgentSlots}/${capacity.totalAgentSlots}` : 'null'}`);

const browser = await launch();

// ── Signed out ───────────────────────────────────────────────────────────
console.log('-- signed out');
{
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${APP}/profile`, { waitUntil: 'networkidle' });
  const url = new URL(page.url());
  check(url.pathname === '/login' && url.searchParams.get('redirect') === '/profile', `redirected to ${url.pathname}${url.search}`);
  await context.close();
}

// ── Owner: the real account ──────────────────────────────────────────────
console.log('-- owner');
{
  const { context, page } = await open(browser);
  const capacityCalls = [];
  const agentCalls = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/agents/capacity')) capacityCalls.push(Date.now());
    if (r.method() === 'GET' && r.url().replace(/\?.*$/, '').endsWith('/agents')) agentCalls.push(Date.now());
  });

  const pill = page.locator('[data-profile-pill]');
  check((await pill.count()) === 1, 'header shows the profile pill');
  check((await pill.getAttribute('aria-current')) === null, 'pill is not current outside the profile');
  await pill.click();
  await page.waitForURL((u) => u.pathname === '/profile', { timeout: 10000 });
  await page.locator('[data-profile]').waitFor();
  await sleep(800);
  check((await pill.getAttribute('aria-current')) === 'page', 'pill is aria-current on the profile');
  check((await page.locator('header nav a[aria-current="page"]').count()) === 0, 'no nav tab claims the profile');

  check((await text(page, '[data-profile-name]')) === (me.name || me.email), `name on the pass is "${me.name || me.email}"`);
  check((await count(page, 'h1')) === 1, 'exactly one h1');
  check((await text(page, '[data-profile-registry]')) === registry, `registry number is ${registry}`);
  check(((await text(page, '[data-profile-status]')) ?? '').length > 0, 'account status has a word');
  check((await text(page, '[data-account-email]')) === me.email, 'email matches /auth/me');
  check((await text(page, '[data-account-id]')) === me.id, 'id matches /auth/me');
  check((await count(page, '[data-account-name]')) === (me.name ? 1 : 0), 'name row present only with a name');
  check((await count(page, '[data-profile-sign]')) === 1, 'personal sign on the pass');

  console.log('-- copy');
  await page.locator('[data-copy-id]').click();
  await sleep(250);
  check((await text(page, '[data-copied]')) !== '', 'live region announces Copied');
  check((await page.evaluate(() => navigator.clipboard.readText())) === me.id, 'clipboard holds the id');
  await sleep(2300);
  check((await page.locator('[data-copied]').innerText()).trim() === '', 'Copied clears after two seconds');

  console.log('-- capabilities');
  check((await capStates(page)).join() === 'create:yes,control:yes,slots:yes,share:yes,users:elsewhere', `owner states (${(await capStates(page)).join(' ')})`);

  console.log('-- fleet');
  check((await text(page, '[data-fleet-agents]')) === String(agents.length), `agents counter is ${agents.length}`);
  check((await text(page, '[data-fleet-running]')) === String(running), `running counter is ${running}`);
  if (capacity) {
    check((await text(page, '[data-fleet-free]')) === String(capacity.freeAgentSlots), `free slots counter is ${capacity.freeAgentSlots}`);
    const label = (await page.locator('[data-fleet-scale]').getAttribute('aria-label')) ?? '';
    check([capacity.usedAgentSlots, capacity.freeAgentSlots, capacity.totalAgentSlots].every((n) => label.includes(String(n))), `scale label carries the three numbers ("${label}")`);
    const kind = await page.locator('[data-fleet-scale]').getAttribute('data-fleet-scale');
    check(kind === (capacity.totalAgentSlots <= 40 ? 'marks' : 'bar'), `scale drawn as ${kind} for ${capacity.totalAgentSlots} slots`);
    if (kind === 'marks') {
      check((await count(page, '[data-fleet-scale] > span')) === capacity.totalAgentSlots, 'one mark per slot');
    }
  } else {
    check((await count(page, '[data-fleet-free]')) === 0, 'no slots block without capacity');
  }
  check(capacityCalls.length >= 1, 'an operator requests capacity');

  console.log('-- layout and motion');
  const tall = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-profile] a, [data-profile] button, [data-profile-pill]'))
      .map((el) => ({ h: Math.round(el.getBoundingClientRect().height), t: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24) }))
      .filter((x) => x.h < 44),
  );
  check(tall.length === 0, `every control is at least 44 px tall${tall.length ? ` (short: ${JSON.stringify(tall)})` : ''}`);
  const infinite = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-profile] *')).filter((el) => getComputedStyle(el).animationIterationCount === 'infinite').length,
  );
  check(infinite === 0, 'nothing on the page animates endlessly');
  // Clicking around nudges the pass; measure it once it hangs still.
  await page.waitForFunction(() => document.querySelector("[data-profile-rig]").style.transform === "", null, { timeout: 8000 });
  const columns = await page.evaluate(() => {
    const pass = document.querySelector('[data-profile-pass]').getBoundingClientRect();
    const acc = document.querySelector('[data-account-email]').getBoundingClientRect();
    return { side: acc.left > pass.right, passWidth: Math.round(pass.width) };
  });
  check(columns.side && columns.passWidth === 400, `two columns at 1440, pass ${columns.passWidth} px wide`);
  await noHorizontalScroll(page, 'profile 1440');
  await shot(page, 'profile-1440');
  const box = await page.locator('[data-profile-pass]').boundingBox();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.25);
  await sleep(400);
  const tilted = await page.locator('[data-profile-pass]').evaluate((el) => getComputedStyle(el).transform);
  check(tilted !== 'none' && tilted !== 'matrix(1, 0, 0, 1, 0, 0)', 'the pass tilts after a fine pointer');
  await page.mouse.move(5, 5);

  if (!process.argv.includes('--no-poll')) {
    console.log('-- poll (waits up to 35 s)');
    const before = agentCalls.length;
    for (let i = 0; i < 35 && agentCalls.length === before; i += 1) await sleep(1000);
    check(agentCalls.length > before, 'the agent list is fetched again within 35 s');
  }

  console.log('-- session row');
  await page.locator('[data-to-agents]').click();
  await page.waitForURL((u) => u.pathname.startsWith('/agents'), { timeout: 10000 });
  check(new URL(page.url()).pathname.startsWith('/agents'), '"Go to agents" opens the agents page');
  await toProfile(page);
  await page.locator('[data-logout]').click();
  await page.waitForURL((u) => u.pathname === '/', { timeout: 10000 }).catch(() => undefined);
  check(new URL(page.url()).pathname === '/', '"Log out" ends on the landing');
  await page.goto(`${APP}/profile`, { waitUntil: 'networkidle' });
  check(new URL(page.url()).pathname === '/login', 'and the profile is closed again');
  await context.close();
}

// ── Drop and swing on the lanyard ────────────────────────────────────────
console.log('-- drop and swing');
{
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    recordVideo: { dir: SHOTS, size: { width: 1440, height: 900 } },
  });
  const page = await context.newPage();
  await page.goto(`${APP}/login`, { waitUntil: 'networkidle' });
  await page.locator('input[type="email"], input[name="email"]').first().fill(LOGIN);
  await page.locator('input[type="password"]').first().fill(PASS);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }),
    page.locator('button[type="submit"]').first().click(),
  ]);
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.locator('[data-profile-pill]').waitFor({ timeout: 15000 });
  await sleep(1200);

  // Sample the rig from inside the page for 4.2 s, from the moment it mounts.
  await page.evaluate(() => {
    window.__swing = [];
    const started = performance.now();
    const tick = () => {
      const rig = document.querySelector('[data-profile-rig]');
      if (rig) {
        const m = new DOMMatrixReadOnly(getComputedStyle(rig).transform);
        window.__swing.push({
          t: Math.round(performance.now() - started),
          deg: (Math.atan2(m.b, m.a) * 180) / Math.PI,
          y: m.f,
          inline: rig.style.transform,
          willChange: rig.style.willChange,
          width: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          top: Math.round(document.querySelector('[data-account-email]')?.getBoundingClientRect().top ?? -1),
        });
      }
      if (performance.now() - started < 4600) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.locator('[data-profile-pill]').click();
  await page.locator('[data-profile]').waitFor({ timeout: 15000 });
  await sleep(4400);
  const samples = await page.evaluate(() => window.__swing);
  const t0 = samples[0]?.t ?? 0;
  const rel = samples.map((s) => ({ ...s, t: s.t - t0 }));
  const first = rel[0];
  check(Boolean(first) && first.y < -300, `starts above the header (y ${first ? Math.round(first.y) : 'n/a'} px)`);
  const maxDeg = Math.max(...rel.map((s) => Math.abs(s.deg)));
  check(maxDeg > 5 && maxDeg <= 7.05, `swings, never past 7 degrees (max ${maxDeg.toFixed(2)})`);
  const maxDown = Math.max(...rel.map((s) => s.y));
  check(maxDown >= 8 && maxDown <= 14.5, `the lanyard gives on the catch (${maxDown.toFixed(1)} px past rest)`);
  // Swings: sign changes of the angle after the catch.
  let swings = 0;
  let side = 0;
  for (const smp of rel) {
    if (Math.abs(smp.deg) < 0.3) continue;
    const now = Math.sign(smp.deg);
    if (side && now !== side) swings += 1;
    side = now;
  }
  check(swings >= 3 && swings <= 5, `about four swings before rest (${swings} crossings)`);
  const restAt = rel.find((s, i) => rel.slice(i).every((x) => x.inline === ''))?.t;
  check(restAt !== undefined && restAt < 3480, `at rest on its own, with no transform left, after ${restAt} ms (limit 3500)`);
  check(rel[rel.length - 1].willChange === "" && rel[0].willChange === "transform", "will-change is set while it moves and removed at rest");
  check(rel.every((s) => s.width <= 0), 'no sideways scroll at any moment of the swing');
  const tops = new Set(rel.map((s) => s.top));
  check(tops.size === 1, `the layout never moves (account card top: ${[...tops].join(', ')})`);
  const lanyardTop = await page.evaluate(() => {
    const header = document.querySelector('header').getBoundingClientRect().bottom;
    const lanyard = document.querySelector('.profile-pass__lanyard').getBoundingClientRect().top;
    return Math.round(lanyard - header);
  });
  // Nothing between the pass and the window may cut it sideways: an overflow
  // clip on the page root once sliced its left edge during the swing and on hover.
  const cutters = await page.evaluate(() => {
    const out = [];
    for (let el = document.querySelector("[data-profile-rig]").parentElement; el && el !== document.documentElement; el = el.parentElement) {
      const ox = getComputedStyle(el).overflowX;
      if (ox !== "visible") out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}:${ox}`);
    }
    return out;
  });
  check(cutters.length === 0, `no ancestor clips the pass sideways${cutters.length ? ` (${cutters.join(", ")})` : ""}`);
  check(lanyardTop === 0, `the lanyard starts at the header's lower edge (gap ${lanyardTop} px)`);

  console.log('-- pointer nudge');
  const box = await page.locator('[data-profile-rig]').boundingBox();
  const yMid = box.y + box.height * 0.6;
  await page.mouse.move(box.x - 60, yMid);
  await sleep(60);
  await page.mouse.move(box.x + box.width + 60, yMid, { steps: 3 });
  await sleep(180);
  const pushed = await page.evaluate(() => {
    const m = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('[data-profile-rig]')).transform);
    return (Math.atan2(m.b, m.a) * 180) / Math.PI;
  });
  check(Math.abs(pushed) > 0.2 && Math.abs(pushed) <= 3.05, `a fast pointer pass nudges it, within 3 degrees (${pushed.toFixed(2)})`);
  await sleep(3600);
  check((await page.locator('[data-profile-rig]').evaluate((el) => el.style.transform)) === '', 'and it settles again');

  const video = page.video();
  await context.close();
  if (video) {
    const { renameSync } = await import('node:fs');
    renameSync(await video.path(), resolve(SHOTS, 'profile-drop.webm'));
    console.log('  video specs/028-app-profile/e2e/shots/profile-drop.webm');
  }
}

// ── The same drop on a phone, for the record ─────────────────────────────
{
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    hasTouch: true,
    recordVideo: { dir: SHOTS, size: { width: 390, height: 844 } },
  });
  const page = await context.newPage();
  await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
  await page.locator("input[type=email], input[name=email]").first().fill(LOGIN);
  await page.locator("input[type=password]").first().fill(PASS);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 }),
    page.locator("button[type=submit]").first().click(),
  ]);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await sleep(1500);
  await page.locator("[data-profile-pill]").click();
  await page.locator("[data-profile]").waitFor({ timeout: 15000 });
  await sleep(300);
  const moving = await page.locator("[data-profile-rig]").evaluate((el) => el.style.transform !== "");
  check(moving, "390: the drop plays on a touch device too");
  await sleep(3800);
  check((await page.locator("[data-profile-rig]").evaluate((el) => el.style.transform)) === "", "390: at rest after 3.5 s");
  await noHorizontalScroll(page, "drop 390");
  const video = page.video();
  await context.close();
  if (video) {
    const { renameSync } = await import("node:fs");
    renameSync(await video.path(), resolve(SHOTS, "profile-drop-390.webm"));
  }
}

// ── Widths ───────────────────────────────────────────────────────────────
console.log('-- widths');
for (const width of [1024, 768, 390, 360]) {
  const { context, page } = await open(browser, { width, height: 900 });
  await toProfile(page);
  await noHorizontalScroll(page, `profile ${width}`);
  const stacked = await page.evaluate(() => {
    const pass = document.querySelector('[data-profile-pass]').getBoundingClientRect();
    const acc = document.querySelector('[data-account-email]').getBoundingClientRect();
    return acc.top > pass.bottom;
  });
  check(width >= 1024 ? !stacked : stacked, `${width}: ${width >= 1024 ? 'two columns' : 'one column, pass first'}`);
  check((await count(page, '[data-profile-pill]')) === 1, `${width}: profile pill in the header`);
  if (width !== 360) await shot(page, `profile-${width}`);
  await context.close();
}

// ── Reduced motion ───────────────────────────────────────────────────────
console.log('-- reduced motion');
{
  const { context, page } = await open(browser, { reduced: true });
  await toProfile(page);
  const box = await page.locator('[data-profile-pass]').boundingBox();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.25);
  await sleep(400);
  const t = await page.locator('[data-profile-pass]').evaluate((el) => getComputedStyle(el).transform);
  check(t === 'none', `the pass stays flat (transform: ${t})`);
  {
    const { context: c2, page: p2 } = await open(browser, { reduced: true });
    await toProfile(p2, { settle: false });
    const rigNow = await p2.locator('[data-profile-rig]').evaluate((el) => getComputedStyle(el).transform);
    check(rigNow === 'none', `no drop under reduced motion: the pass is in place at once (${rigNow})`);
    await c2.close();
  }
  await shot(page, 'profile-1440-reduced');
  await context.close();
}

// ── Admin ────────────────────────────────────────────────────────────────
console.log('-- admin (role rewritten in the browser)');
{
  const { context, page } = await open(browser, { user: { role: 'Admin' } });
  await toProfile(page);
  check((await capStates(page)).join() === 'create:yes,control:yes,slots:yes,share:yes,users:locked', `admin states (${(await capStates(page)).join(' ')})`);
  check((await count(page, 'li[data-cap]')) === 5, 'no item is hidden');
  await context.close();
}

// ── User ─────────────────────────────────────────────────────────────────
console.log('-- user (role rewritten in the browser)');
{
  let capacityRequests = 0;
  const { context, page } = await open(browser, {
    user: { role: 'User' },
    routes: [[`${API}/agents/capacity`, (route) => { capacityRequests += 1; return route.continue(); }]],
  });
  await toProfile(page);
  check((await capStates(page)).join() === 'create:locked,control:locked,slots:locked,share:yes,users:locked', `user states (${(await capStates(page)).join(' ')})`);
  check((await count(page, 'li[data-cap]')) === 5, 'no item is hidden');
  check((await count(page, '[data-fleet-agents]')) === 1 && (await count(page, '[data-fleet-running]')) === 1, 'two counters');
  check((await count(page, '[data-fleet-free]')) === 0 && (await count(page, '[data-fleet-scale]')) === 0, 'no free-slots counter and no scale');
  check(capacityRequests === 0, 'no capacity request for a user');
  await shot(page, 'profile-user-1440');
  await context.close();
}

// ── Capacity unknown ─────────────────────────────────────────────────────
console.log('-- capacity failing');
{
  const { context, page } = await open(browser, {
    routes: [[`${API}/agents/capacity`, (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"success":false}' })]],
  });
  await toProfile(page);
  check((await count(page, '[data-fleet-free]')) === 0 && (await count(page, '[data-fleet-scale]')) === 0, 'slots block absent, not zero');
  check((await text(page, '[data-fleet-agents]')) === String(agents.length), 'the other counters still stand');
  await shot(page, 'profile-nocapacity-1440');
  await context.close();
}

// ── No agents ────────────────────────────────────────────────────────────
console.log('-- no agents');
{
  const { context, page } = await open(browser, {
    routes: [[(url) => url.href.replace(/\?.*$/, '') === `${API}/agents`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true,"data":[]}' })]],
  });
  await toProfile(page);
  check((await text(page, '[data-fleet-agents]')) === '0' && (await text(page, '[data-fleet-running]')) === '0', 'both counters read 0');
  await context.close();
}

// ── Odd accounts ─────────────────────────────────────────────────────────
console.log('-- long name');
{
  const long = 'Maximilian Alexander von Hohenzollern-Sigmaringen';
  const { context, page } = await open(browser, { user: { name: long } });
  await toProfile(page);
  const lines = await page.locator('[data-profile-name]').evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)));
  check(lines >= 2, `the name wraps to ${lines} lines`);
  const overlap = await page.evaluate(() => {
    const n = document.querySelector('[data-profile-name]').getBoundingClientRect();
    const r = document.querySelector('[data-profile-role]').getBoundingClientRect();
    return n.bottom > r.top + 1;
  });
  check(!overlap, 'the role line sits below the wrapped name');
  await noHorizontalScroll(page, 'long name');
  await shot(page, 'profile-longname-1440');
  await context.close();
}
console.log('-- no name, unknown role and status');
{
  const { context, page } = await open(browser, { user: { name: '', role: 'Auditor', status: 'suspended' } });
  await toProfile(page);
  check((await text(page, '[data-profile-name]')) === me.email, 'the email stands in for the name');
  check((await count(page, '[data-account-name]')) === 0, 'no empty Name row');
  check(((await text(page, '[data-profile-status]')) ?? '').includes('suspended'), 'an unknown status is shown as received');
  // The auth mapper turns a role it does not know into User, the lowest one,
  // before the store ever holds it; the page therefore reads as a User's.
  check((await capStates(page)).join() === 'create:locked,control:locked,slots:locked,share:yes,users:locked', 'an unknown role is treated as the lowest role');
  await context.close();
}

// ── Capacity known (the local cluster reports none) ──────────────────────
const fakeCapacity = (used, total) => [
  `${API}/agents/capacity`,
  (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { freeAgentSlots: total - used, usedAgentSlots: used, totalAgentSlots: total, slotCpuMilli: 100, slotMemBytes: 536870912, nodes: [], observedAt: new Date().toISOString() } }),
    }),
];
console.log('-- capacity 14 of 20 (marks)');
{
  const { context, page } = await open(browser, { routes: [fakeCapacity(14, 20)] });
  await toProfile(page);
  check((await text(page, '[data-fleet-free]')) === '6', 'free slots counter is 6');
  check((await page.locator('[data-fleet-scale]').getAttribute('data-fleet-scale')) === 'marks', 'drawn as marks');
  check((await count(page, '[data-fleet-scale] > span')) === 20, '20 marks');
  check((await count(page, '[data-fleet-scale] > .profile-fleet__mark--used')) === 14, '14 of them filled');
  const label = (await page.locator('[data-fleet-scale]').getAttribute('aria-label')) ?? '';
  check(['14', '6', '20'].every((n) => label.includes(n)), `scale label carries the three numbers ("${label}")`);
  await noHorizontalScroll(page, 'capacity marks');
  await shot(page, 'profile-capacity-1440');
  await page.setViewportSize({ width: 390, height: 844 });
  await sleep(500);
  await noHorizontalScroll(page, 'capacity marks 390');
  await shot(page, 'profile-capacity-390');
  await context.close();
}
console.log('-- capacity 30 of 64 (bar)');
{
  const { context, page } = await open(browser, { routes: [fakeCapacity(30, 64)] });
  await toProfile(page);
  check((await page.locator('[data-fleet-scale]').getAttribute('data-fleet-scale')) === 'bar', 'drawn as one bar above 40 slots');
  check((await text(page, '[data-fleet-free]')) === '34', 'free slots counter is 34');
  await context.close();
}

await browser.close();
console.log(fails ? `\n${fails} check(s) failed` : '\nall checks passed');
process.exit(fails ? 1 : 0);
