// The live load view (CLEAN-224, User Story 3).
//
//   node specs/030-agent-request-limits/e2e/load.mjs
//
// An Owner watches an agent's page while requests arrive from somewhere else:
// the meters, the chart and the refused count move within seconds, with no
// reload. Leaves the minute window of `limits-minute` full.
//
// Needs: API :3333 (after seed.mjs), fakeAgent.mjs, admin :3001.
import {
  ADMIN,
  AGENTS,
  OWNER,
  check,
  done,
  fake,
  launch,
  loginAs,
  minuteRoom,
  section,
  sendAnonymous,
  shot,
  until,
} from './lib.mjs';

const meter = (page, window) => page.locator(`[data-load-window="${window}"]`).first();
const used = async (page, window) => Number(await meter(page, window).getAttribute('data-used'));
const numberIn = async (locator) => Number((((await locator.first().textContent()) ?? '').match(/\d+/) ?? ['NaN'])[0]);

async function openLoad(page, agentId) {
  await page.goto(`${ADMIN}/agents/${agentId}?tab=overview`, { waitUntil: 'networkidle' });
  await page.locator('[data-load-view]').first().waitFor({ state: 'visible', timeout: 20000 });
}

section('Preconditions');
check(await fake.up(), 'fake agents are up');
await fake.reset();
check(await minuteRoom(AGENTS.minute), 'the minute window of limits-minute is empty');

const browser = await launch();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 200)));
  await loginAs(page, OWNER, ADMIN);

  section('An agent with limits');
  await openLoad(page, AGENTS.minute);
  check((await used(page, 'minute')) === 0, 'the minute meter starts at 0');
  check((await meter(page, 'minute').getAttribute('data-limit')) === '2', 'against its limit of 2');
  check((await meter(page, 'hour').getAttribute('data-limit')) === '', 'a window with no limit has no ceiling');
  const refusedBefore = await numberIn(page.locator('[data-load-refused]'));

  section('A burst from somewhere else');
  const sent = Date.now();
  const statuses = [];
  for (let i = 0; i < 5; i++) statuses.push((await sendAnonymous(AGENTS.minute)).status);
  check(statuses.filter((s) => s === 200).length === 2 && statuses.filter((s) => s === 429).length === 3, `2 accepted, 3 refused (${statuses.join(',')})`);
  const moved = await until(async () => (await used(page, 'minute')) === 2, { timeout: 8000, every: 200 });
  const took = Date.now() - sent;
  check(moved, 'the minute meter moves to 2 without a reload');
  check(took < 5000 + 1500, `within about five seconds (${(took / 1000).toFixed(1)} s including the burst itself)`);
  check(
    await until(async () => (await numberIn(page.locator('[data-load-refused]'))) >= refusedBefore + 3, { timeout: 8000 }),
    'the refused count rises by three',
  );
  const lastBar = page.locator('[data-load-chart] [data-minute]').last();
  check(
    await until(async () => Number(await lastBar.getAttribute('data-accepted')) >= 2, { timeout: 8000 }),
    'the last bar of the chart shows the accepted requests',
  );
  check(Number(await lastBar.getAttribute('data-refused')) >= 3, 'and the refused ones');
  check((await page.locator('[data-load-chart] [data-minute]').count()) === 60, 'the chart has sixty minutes');
  check(/room again|full/i.test((await meter(page, 'minute').textContent()) ?? ''), 'the full window says when it has room again');
  await shot(page, 'load-after-burst');

  section('The agent list');
  check(
    await until(
      async () => (await page.locator(`li[data-agent-id="${AGENTS.minute}"][data-agent-at-limit]`).count()) > 0,
      { timeout: 20000 },
    ),
    'an agent at its limit is marked in the list',
  );
  check(
    (await page.locator(`li[data-agent-id="${AGENTS.legacy}"][data-agent-needs-limits]`).count()) > 0,
    'and so is a public agent without limits',
  );

  section('An agent with limits off');
  await openLoad(page, AGENTS.off);
  for (const window of ['minute', 'hour', 'day']) {
    if ((await meter(page, window).getAttribute('data-limit')) !== '') {
      check(false, `${window} shows a ceiling for an agent without limits`);
    }
  }
  check(true, 'no window shows a ceiling');
  const before = await used(page, 'minute');
  await fake.delay(4000);
  const off = [];
  for (let i = 0; i < 6; i++) off.push((await sendAnonymous(AGENTS.off)).status);
  check(off.every((s) => s === 200), 'nothing is refused');
  check(
    await until(async () => (await used(page, 'minute')) >= before + 6, { timeout: 8000 }),
    'and the load is still shown',
  );
  check(
    await until(async () => (await numberIn(page.locator('[data-load-inflight]'))) >= 1, { timeout: 6000 }),
    'requests in progress are counted while the agent is still answering',
  );
  await shot(page, 'load-limits-off');
  await fake.delay(0);
} finally {
  await fake.delay(0).catch(() => undefined);
  await browser.close();
}

done('load');
