// Browser check for pinning agents in the admin console (CLEAN-216,
// contracts/console-ui.md, US2).
//
//   node specs/027-pin-agents/e2e/admin-pin.mjs
//
// Needs the admin on ADMIN_URL (default :3001), the API on API_URL (:3333)
// and the seeded Owner login in .env.project. Starts from an agent that is
// already pinned (run `pin.mjs --keep` first), unpins it from the header,
// checks the rail, pins it again and leaves it pinned.
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { API, LOGIN, PASS, apiSession, launch, newPage, sleep } from '../../026-app-console-redesign/e2e/lib.mjs';

const ADMIN = process.env.ADMIN_URL || 'http://localhost:3001';
const SHOTS = resolve(dirname(fileURLToPath(import.meta.url)), 'shots');
mkdirSync(SHOTS, { recursive: true });

let fails = 0;
const check = (ok, msg) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!ok) fails += 1;
};

const railIds = (page) =>
  page.evaluate(() => Array.from(document.querySelectorAll('li[data-agent-id]')).map((li) => li.dataset.agentId));
const headerPinned = (page) => page.evaluate(() => Boolean(document.querySelector('h1 ~ [data-pinned], header [data-pinned]')));
const rowPinned = (page, id) =>
  page.evaluate((agentId) => Boolean(document.querySelector(`li[data-agent-id="${agentId}"] [data-pinned]`)), id);

function expectedOrder(agents, pinnedId, pinnedValue) {
  const withPin = agents.map((a) => ({ ...a, pinned: a.id === pinnedId ? pinnedValue : a.pinned }));
  const admin = withPin.filter((a) => a.isAdmin);
  const pinned = withPin.filter((a) => !a.isAdmin && a.pinned);
  const rest = withPin.filter((a) => !a.isAdmin && !a.pinned);
  return [...admin, ...pinned, ...rest].map((a) => a.id);
}

async function serverAgent(token, id) {
  const res = await fetch(`${API}/agents/${id}`, { headers: { authorization: `Bearer ${token}` } });
  const json = await res.json();
  return json && typeof json === 'object' && 'data' in json ? json.data : json;
}

const { token, agents } = await apiSession();
const target = agents.find((a) => a.pinned && !a.isAdmin);
if (!target) throw new Error('no pinned non-admin agent; run pin.mjs --keep first');
console.log(`agents: ${agents.length}; target "${target.name}" (${target.id}) pinned=${target.pinned}`);

const browser = await launch();
const page = await newPage(browser, { width: 1440, height: 900 });
await page.goto(`${ADMIN}/login`, { waitUntil: 'networkidle' });
await page.locator('input[type="email"]').first().fill(LOGIN);
await page.locator('input[type="password"]').first().fill(PASS);
await Promise.all([
  page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }),
  page.locator('button[type="submit"]').first().click(),
]);
await page.goto(`${ADMIN}/agents/${target.id}`, { waitUntil: 'networkidle' });
await sleep(1500);

console.log('-- pinned state');
check(await headerPinned(page), 'header shows the pin icon');
check(await rowPinned(page, target.id), 'rail row shows the pin icon');
const rail = await railIds(page);
check(rail.join() === expectedOrder(agents, target.id, true).join(), `rail order is Rancher → pinned → rest (pinned row at index ${rail.indexOf(target.id)})`);
const toggle = page.locator('[data-pin-toggle]');
check((await toggle.count()) === 1, 'header offers the pin toggle');
check((await toggle.getAttribute('aria-pressed')) === 'true', 'toggle is pressed while pinned');
await page.screenshot({ path: resolve(SHOTS, 'admin-pin-1440.png') });

console.log('-- unpin from the header');
page.on('request', (r) => {
  if (r.method() === 'PUT' && /\/agents\/[^/]+$/.test(r.url())) console.log(`     → PUT ${new URL(r.url()).pathname} ${r.postData()}`);
});
await toggle.click();
await sleep(300);
check(!(await headerPinned(page)), 'header icon gone at once');
check(!(await rowPinned(page, target.id)), 'rail row icon gone at once');
check((await railIds(page)).join() === expectedOrder(agents, target.id, false).join(), 'rail order back to ordinary at once');
await sleep(1200);
let server = await serverAgent(token, target.id);
check(server.pinned === false, 'server agrees: pinned=false');
check(server.status === target.status, `status unchanged (${server.status})`);
check((await page.getByText('Restart the agent to apply the changes').count()) === 0, 'no "restart to apply" banner for a pin');

console.log('-- pin again');
await toggle.click();
await sleep(1500);
check(await headerPinned(page), 'header shows the pin icon again');
check((await railIds(page)).join() === expectedOrder(agents, target.id, true).join(), 'rail order has the pinned block again');
server = await serverAgent(token, target.id);
check(server.pinned === true, 'server agrees: pinned=true');

console.log('-- reload');
await page.reload({ waitUntil: 'networkidle' });
await sleep(1500);
check(await headerPinned(page), 'still pinned after a reload');

await browser.close();
console.log(fails ? `\n${fails} check(s) failed` : '\nall checks passed');
process.exit(fails ? 1 : 0);
