// Screenshot set for CLEAN-215.
//
//   node specs/026-app-console-redesign/e2e/shots.mjs --out <dir>
//     [--only landing,login,register,agents,session-ended] [--widths 1440,390]
//     [--reduced] [--touch] [--view orbit|drum|list]
//
// Full-page PNGs named <page>-<width>[-reduced|-touch].png. Every shot asserts
// there is no horizontal scroll; the process exits 1 if any shot failed.
import { resolve } from 'node:path';
import { APP, API, arg, ensureDir, launch, login, newPage, noHorizontalScroll, pickAgentId, settle, sleep } from './lib.mjs';

const out = ensureDir(resolve(String(arg('out', 'specs/026-app-console-redesign/shots/latest'))));
const only = String(arg('only', 'landing,login,register,agents')).split(',').map((s) => s.trim()).filter(Boolean);
const widths = String(arg('widths', '1920,1440,1024,768,390,360')).split(',').map((w) => Number(w.trim()));
const reduced = arg('reduced', false) === true;
const touch = arg('touch', false) === true;
const view = arg('view', null);
const suffix = reduced ? '-reduced' : touch ? '-touch' : '';

const heightFor = (w) => (w >= 1024 ? 900 : 844);

const browser = await launch();
let failed = false;
let agentId = null;

async function shot(page, name, w, fullPage) {
  const file = resolve(out, `${name}-${w}${suffix}.png`);
  await page.screenshot({ path: file, fullPage });
  const ok = await noHorizontalScroll(page, `${name}@${w}`);
  if (!ok) failed = true;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${file}`);
}

for (const w of widths) {
  console.log(`-- ${w}px${suffix}`);
  if (only.includes('landing')) {
    const page = await newPage(browser, { width: w, height: heightFor(w), reduced, touch });
    await page.goto(APP + '/', { waitUntil: 'domcontentloaded' });
    await settle(page, { reduced });
    await shot(page, 'landing', w, true);
    if (reduced) {
      const videos = await page.locator('video').count();
      console.log(`  ${videos === 0 ? 'ok  ' : 'FAIL'} reduced motion: ${videos} <video> element(s)`);
      if (videos) failed = true;
    }
    await page.context().close();
  }
  for (const name of ['login', 'register']) {
    if (!only.includes(name)) continue;
    const page = await newPage(browser, { width: w, height: heightFor(w), reduced, touch });
    await page.goto(APP + '/' + name, { waitUntil: 'domcontentloaded' });
    await settle(page, { reduced });
    await shot(page, name, w, true);
    await page.context().close();
  }
  if (only.includes('agents')) {
    agentId ??= await pickAgentId();
    const page = await newPage(browser, { width: w, height: heightFor(w), reduced, touch });
    if (view) await page.addInitScript((v) => localStorage.setItem('agent:view', v), String(view));
    await login(page);
    await page.goto(`${APP}/agents/${agentId}`, { waitUntil: 'networkidle' });
    await sleep(reduced ? 300 : 1500);
    await shot(page, 'agents', w, false);
    await page.context().close();
  }
  if (only.includes('session-ended')) {
    agentId ??= await pickAgentId();
    const page = await newPage(browser, { width: w, height: heightFor(w), reduced, touch });
    await login(page);
    await page.goto(`${APP}/agents/${agentId}`, { waitUntil: 'networkidle' });
    await sleep(800);
    // Every API answer is now 401 TOKEN_EXPIRED: the next client-side
    // navigation fails, the refresh fails too, and the api plugin ends the
    // session (CLEAN-72). The code matters — a bare 401 is read as "logged out".
    await page.route(`${API}/**`, (r) =>
      r.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ statusCode: 401, code: 'TOKEN_EXPIRED', message: 'Unauthorized' }),
      }),
    );
    // Client-side navigation to /chats (a full reload would log out silently
    // instead): push the URL and let Vue Router pick up the popstate.
    await page.evaluate(() => {
      window.history.pushState({}, '', '/chats');
      window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
    });
    await page.locator('[role="dialog"], [role="alertdialog"]').first().waitFor({ timeout: 15000 });
    await sleep(600);
    await shot(page, 'session-ended', w, false);
    await page.context().close();
  }
}

await browser.close();
if (failed) {
  console.log('Some shots FAILED (see above).');
  process.exit(1);
}
console.log('All shots ok.');
