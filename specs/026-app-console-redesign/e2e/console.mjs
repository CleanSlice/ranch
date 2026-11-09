// Behaviour checks for the agent console (CLEAN-215, contracts/console-ui.md).
//
//   node specs/026-app-console-redesign/e2e/console.mjs [--agent <name>]
//
// Needs the app on APP_URL (default :3000), the API on API_URL (:3333) and the
// seeded Owner login in .env.project. The stop/start part changes one agent's
// status on the server — point --agent at a throwaway one (default: the first
// running non-admin agent whose name starts with "Garage"), and re-run the seed
// afterwards if you want the original statuses back.
import { APP, API, apiSession, arg, launch, login, newPage, sleep } from './lib.mjs';

const RE = {
  stop: /Остановить|^Stop$/,
  start: /Запустить|^Start$/,
  stopFailed: /Не удалось остановить|Stop failed/,
  running: /Запущен|Running/,
  stopped: /Остановлен|Stopped/,
  deploying: /Развёртывание|Deploying/,
  fold: /Свернуть лист|Fold the sheet/,
  unfold: /Развернуть лист|Unfold the sheet/,
  switchAgent: /Сменить агента|Switch agent/,
  drumTab: /Барабан|Drum/,
};

let fails = 0;
const check = (ok, msg) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!ok) fails += 1;
};
const focusedNodeIndex = (page) =>
  page.evaluate(() => {
    const list = Array.from(document.querySelectorAll('[data-orbit-node]'));
    return list.indexOf(document.activeElement);
  });
const nodeLabel = (page, name) =>
  page.locator(`[data-orbit-node][aria-label^="${name}"]`).first().getAttribute('aria-label');
async function waitLabel(page, name, re) {
  for (let i = 0; i < 20; i += 1) {
    if (re.test((await nodeLabel(page, name)) ?? '')) return true;
    await sleep(300);
  }
  return false;
}

const { agents } = await apiSession();
const wanted = String(arg('agent', 'Garage'));
const target =
  agents.find((a) => a.name.startsWith(wanted) && !a.isAdmin) ??
  agents.find((a) => a.status === 'running' && !a.isAdmin);
if (!target) throw new Error('no non-admin running agent to test with; seed first');
console.log(`agents: ${agents.length}; mutating "${target.name}" (${target.status})`);

const browser = await launch();
const page = await newPage(browser, { width: 1440, height: 900 });
page.on('request', (r) => {
  if (/\/agents\/[^/]+\/(stop|start|restart)$/.test(r.url())) console.log(`     → ${r.method()} ${r.url()}`);
});
page.on('requestfailed', (r) => {
  if (/\/(stop|start|restart)$/.test(r.url())) console.log(`     ✕ ${r.url()} ${r.failure()?.errorText ?? ''}`);
});
await login(page);
// Set once, after login, so later reload checks (sheet fold, drum view) see
// what the console itself wrote and not a value re-injected on every load.
await page.evaluate(() => {
  localStorage.setItem('agent:view', 'orbit');
  localStorage.removeItem('agent:sheetOpen');
});
await page.goto(`${APP}/agents/${target.id}`, { waitUntil: 'networkidle' });
await sleep(1500);

console.log('-- orbit');
const nodeCount = await page.locator('[data-orbit-node]').count();
check(nodeCount === agents.length, `one node per agent (${nodeCount} / ${agents.length})`);
const admin = agents.find((a) => a.isAdmin);
if (admin) {
  check((await page.locator(`[data-orbit-node][aria-label^="${admin.name}"]`).count()) === 1, `admin node "${admin.name}" present`);
}
const legendTotal = await page.evaluate(() =>
  Array.from(document.querySelectorAll('ul li'))
    .map((li) => li.textContent?.trim() ?? '')
    .filter((t) => /\d+$/.test(t) && t.length < 40)
    .reduce((s, t) => s + Number(t.match(/(\d+)$/)[1]), 0),
);
check(legendTotal === agents.length, `legend counts add up to ${agents.length} (got ${legendTotal})`);

await page.locator('[data-orbit-node]').first().focus();
for (let i = 0; i < 3; i += 1) await page.keyboard.press('ArrowRight');
check((await focusedNodeIndex(page)) === 3, 'ArrowRight x3 moves focus to the 4th node');
for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowLeft');
check((await focusedNodeIndex(page)) === nodeCount - 1, 'ArrowLeft x4 wraps to the last node');
const before = page.url();
await page.keyboard.press('Enter');
await page.waitForURL((u) => u.pathname.startsWith('/agents/') && u.toString() !== before, { timeout: 8000 }).catch(() => undefined);
check(page.url() !== before && /\/agents\/[^/]+$/.test(page.url()), `Enter opens the focused agent (${new URL(page.url()).pathname})`);

console.log('-- search');
await sleep(600);
await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
await page.keyboard.press('Control+KeyK');
await sleep(300);
check(await page.evaluate(() => document.activeElement?.getAttribute('type') === 'search'), 'Ctrl+K focuses the search');
await page.keyboard.type(target.name.slice(0, 8));
await sleep(200);
await page.keyboard.press('Enter');
await page.waitForURL((u) => u.pathname.endsWith(`/agents/${target.id}`), { timeout: 8000 }).catch(() => undefined);
check(page.url().endsWith(`/agents/${target.id}`), `Enter opens the first match (${target.name})`);
await page.keyboard.press('Control+KeyK');
await page.keyboard.type('zzz');
await page.keyboard.press('Escape');
await sleep(150);
check((await page.locator('input[type="search"]').first().inputValue()) === '', 'Escape clears the search');

console.log('-- sheet: stop with the request aborted (rollback)');
if (!page.url().endsWith(`/agents/${target.id}`)) {
  await page.goto(`${APP}/agents/${target.id}`, { waitUntil: 'networkidle' });
}
await sleep(800);
const labelBefore = await nodeLabel(page, target.name);
check(RE.running.test(labelBefore ?? ''), `node reads running before (${labelBefore})`);
await page.route(`${API}/agents/*/stop`, (r) => r.abort());
await page.getByRole('button', { name: RE.stop }).first().click();
await sleep(1200);
const labelAfterAbort = await nodeLabel(page, target.name);
check(RE.running.test(labelAfterAbort ?? ''), `node rolled back to running (${labelAfterAbort})`);
check((await page.getByText(RE.stopFailed).count()) > 0, 'sheet shows the stop-failed message');
await page.unroute(`${API}/agents/*/stop`);

console.log('-- sheet: stop, then start');
await page.getByRole('button', { name: RE.stop }).first().click();
check(await waitLabel(page, target.name, RE.stopped), 'node, and so the sheet and the row, read stopped after the server confirms');
check((await page.getByRole('button', { name: RE.start }).count()) > 0, 'sheet now offers Start');
await page.getByRole('button', { name: RE.start }).first().click();
check(await waitLabel(page, target.name, RE.deploying), 'Start flips the node to deploying');

console.log('-- sheet fold persists');
await page.getByRole('button', { name: RE.fold }).first().click();
await sleep(200);
await page.reload({ waitUntil: 'networkidle' });
await sleep(1200);
check((await page.getByRole('button', { name: RE.unfold }).count()) > 0, 'sheet stays folded after a reload');
await page.getByRole('button', { name: RE.unfold }).first().click();

console.log('-- below lg');
await page.setViewportSize({ width: 1000, height: 800 });
await sleep(400);
check((await page.getByRole('button', { name: RE.switchAgent }).count()) > 0, '"Switch agent" button shown');
check(!(await page.locator('[role="tablist"]').first().isVisible().catch(() => false)), 'view switch hidden');
await page.setViewportSize({ width: 1440, height: 900 });
await sleep(400);

console.log('-- drum');
await page.getByRole('tab', { name: RE.drumTab }).click();
await sleep(600);
const listbox = page.locator('[role="listbox"]').first();
check((await listbox.count()) === 1, 'drum is a listbox');
const active0 = await listbox.getAttribute('aria-activedescendant');
const box = await listbox.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.wheel(0, 300);
await sleep(400);
const active1 = await listbox.getAttribute('aria-activedescendant');
check(!!active0 && active1 !== active0, `wheel turns the drum (${active0} → ${active1})`);
await listbox.focus();
await page.keyboard.press('ArrowRight');
await sleep(400);
const active2 = await listbox.getAttribute('aria-activedescendant');
check(active2 !== active1, `ArrowRight turns one card (${active1} → ${active2})`);
const urlBefore = page.url();
await page.keyboard.press('Enter');
await page.waitForURL((u) => u.toString() !== urlBefore, { timeout: 8000 }).catch(() => undefined);
const centredAgentId = (active2 ?? '').replace(/^agent-drum-/, '');
check(page.url() !== urlBefore && page.url().endsWith(`/agents/${centredAgentId}`), `Enter opens the centred card (${centredAgentId})`);
await page.reload({ waitUntil: 'networkidle' });
await sleep(1000);
check((await page.getByRole('tab', { name: RE.drumTab }).getAttribute('aria-selected')) === 'true', 'Drum view survives a reload');

await browser.close();
console.log(fails ? `${fails} check(s) FAILED` : 'All console checks ok.');
process.exit(fails ? 1 : 0);
