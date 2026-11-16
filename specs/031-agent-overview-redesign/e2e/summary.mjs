// The summary strip at the top of Overview (CLEAN-228, User Story 2).
//
//   node specs/031-agent-overview-redesign/e2e/summary.mjs
//
// Four cells whose figures are the API's for the same agent; pod load that
// says "not available" for an agent with no pod instead of 0%; a requests
// cell that moves within seconds of a burst; a stopped agent that still shows
// its spend and requests; one failing source that takes down one cell only;
// and two by two on a phone. Leaves the minute window of `limits-minute`
// full; changes no setting.
//
// Needs: API :3333 (after seed.mjs), fakeAgent.mjs, admin :3001.
import {
  AGENTS,
  FIXTURES,
  adminPage,
  agentOf,
  check,
  done,
  fake,
  getLoad,
  hook,
  inViewport,
  launch,
  mentions,
  minuteRoom,
  noSidewaysScroll,
  openOverview,
  parseMoney,
  section,
  sendAnonymous,
  shot,
  states,
  textOf,
  until,
  usageOf,
} from './lib.mjs';

const CELLS = ['status', 'spend', 'pod', 'requests'];
const cell = (page, name) => hook(page, 'summary-cell', name).first();
const stateOf = (page, name) => cell(page, name).getAttribute('data-state');
const usedIn = async (page) => Number(await cell(page, 'requests').getAttribute('data-used'));
const peakOf = (load) => Math.max(0, ...load.series.map((m) => m.accepted));

/** The spend cell against `GET /agents/:id/usage`, for whichever agent is open. */
async function spendMatches(page, agentId, label) {
  const usage = await usageOf(agentId);
  const text = await textOf(cell(page, 'spend'));
  const shown = parseMoney(text);
  check(
    Math.abs(shown - usage.totals.costUsd) < 0.006,
    `${label}: the spend is the API's 30-day cost ($${shown} vs ${usage.totals.costUsd.toFixed(4)})`,
  );
  check(states(text, usage.totals.callCount), `with its ${usage.totals.callCount} calls`);
  check(mentions(text, usage.totals.inputTokens), `and its ${usage.totals.inputTokens} input tokens ("${text}")`);
}

section('Preconditions');
check(await fake.up(), 'fake agents are up');
await fake.reset();
check((await agentOf(AGENTS.off))?.status === 'running', 'limits-off is running');
check((await agentOf(FIXTURES.stopped.id))?.status === 'stopped', 'limits-stopped is stopped (run seed.mjs first)');
check((await usageOf(AGENTS.off))?.totals?.callCount > 0, 'limits-off has seeded usage');
check(await minuteRoom(AGENTS.minute), 'the minute window of limits-minute is empty');

const browser = await launch();
try {
  const page = await adminPage(browser, { width: 1440, height: 900 });

  section('Four cells');
  await openOverview(page, AGENTS.off);
  const order = await page
    .locator('[data-summary] [data-summary-cell]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-summary-cell')));
  check(order.join(',') === CELLS.join(','), `status, spend, pod load, requests — in that order (${order.join(', ')})`);
  const first = await hook(page, 'overview')
    .first()
    .evaluate((el) => el.querySelector('[data-summary], [data-block]')?.hasAttribute('data-summary') ?? false);
  check(first, 'the strip is the first thing on Overview');
  let onScreen = true;
  for (const name of CELLS) onScreen = onScreen && (await inViewport(cell(page, name)));
  check(onScreen, 'all four are on screen at 1440×900 without scrolling');

  section('Status');
  check(
    await until(async () => (await stateOf(page, 'status')) === 'ok', { timeout: 8000 }),
    'the status cell is available',
  );
  check(/running/i.test(await textOf(cell(page, 'status'))), 'and says Running in words');

  section('Spend, 30 days');
  check(await until(async () => (await stateOf(page, 'spend')) === 'ok', { timeout: 8000 }), 'the spend cell is available');
  await spendMatches(page, AGENTS.off, 'limits-off');

  section('Pod load for an agent with no pod');
  check(
    await until(async () => (await stateOf(page, 'pod')) === 'unavailable', { timeout: 12000 }),
    'the pod cell is marked unavailable',
  );
  const pod = await textOf(cell(page, 'pod'));
  check(/not available/i.test(pod), `it says "not available" ("${pod}")`);
  check(!/\b0(\.0+)?\s*%/.test(pod) && !/\b0\s*\/\s*0\b/.test(pod), 'and shows no 0% that would read as an idle pod');
  check(
    (await stateOf(page, 'status')) === 'ok' && (await stateOf(page, 'spend')) === 'ok',
    'the cells beside it are unaffected',
  );

  section('Requests, with no per-minute limit');
  check(await until(async () => (await stateOf(page, 'requests')) === 'ok', { timeout: 8000 }), 'the requests cell is available');
  check((await cell(page, 'requests').getAttribute('data-limit')) === '', 'it carries no limit');
  check(/no limit/i.test(await textOf(cell(page, 'requests'))), 'and says there is no limit per minute');
  const before = await usedIn(page);
  for (let i = 0; i < 3; i++) await sendAnonymous(AGENTS.off, `summary ${i + 1}`);
  check(
    await until(async () => (await usedIn(page)) >= before + 3, { timeout: 8000, every: 200 }),
    'three requests from elsewhere show up without a reload',
  );
  const load = await getLoad(AGENTS.off);
  check((await usedIn(page)) === load.windows[0].used, `the figure is the API's (${await usedIn(page)} vs ${load.windows[0].used})`);
  if (load.refused.lastHour === 0) {
    check(
      await until(async () => /peak/i.test(await textOf(cell(page, 'requests'))) && mentions(await textOf(cell(page, 'requests')), peakOf(load)), {
        timeout: 8000,
      }),
      `beneath it: the peak per minute this hour (${peakOf(load)})`,
    );
  } else {
    check(/refused/i.test(await textOf(cell(page, 'requests'))), 'beneath it: how many were refused this hour');
  }
  await shot(page, 'summary-limits-off');

  section('Requests, against a per-minute limit');
  await openOverview(page, AGENTS.minute);
  check(await until(async () => (await stateOf(page, 'requests')) === 'ok', { timeout: 8000 }), 'the requests cell is available');
  check((await cell(page, 'requests').getAttribute('data-limit')) === '2', 'it carries the limit of 2');
  check(/of\s+2\s+allowed/i.test(await textOf(cell(page, 'requests'))), 'and says "of 2 allowed"');
  check((await usedIn(page)) === 0, 'it starts at 0');
  const sent = Date.now();
  const statuses = [];
  for (let i = 0; i < 5; i++) statuses.push((await sendAnonymous(AGENTS.minute)).status);
  check(
    statuses.filter((s) => s === 200).length === 2 && statuses.filter((s) => s === 429).length === 3,
    `a burst of five: 2 accepted, 3 refused (${statuses.join(',')})`,
  );
  const moved = await until(async () => (await usedIn(page)) === 2, { timeout: 8000, every: 200 });
  const took = Date.now() - sent;
  check(moved, 'the cell moves to 2 without a reload');
  check(took < 5000 + 1500, `within about five seconds (${(took / 1000).toFixed(1)} s including the burst itself)`);
  const refusedNow = (await getLoad(AGENTS.minute)).refused.lastHour;
  check(
    await until(
      async () => {
        const text = await textOf(cell(page, 'requests'));
        return /refused/i.test(text) && mentions(text, refusedNow);
      },
      { timeout: 8000 },
    ),
    `once something was refused this hour, the line beneath says how many (${refusedNow})`,
  );
  await shot(page, 'summary-limits-minute');

  section('A stopped agent');
  await openOverview(page, FIXTURES.stopped.id);
  check(
    await until(async () => /stopped/i.test(await textOf(cell(page, 'status'))), { timeout: 8000 }),
    'Status says Stopped in words',
  );
  check(
    await until(async () => (await stateOf(page, 'pod')) === 'unavailable', { timeout: 12000 }),
    'pod load is not available',
  );
  check(!/\b0(\.0+)?\s*%/.test(await textOf(cell(page, 'pod'))), 'rather than 0%');
  check(await until(async () => (await stateOf(page, 'spend')) === 'ok', { timeout: 8000 }), 'spend still shows');
  await spendMatches(page, FIXTURES.stopped.id, 'limits-stopped');
  check(await until(async () => (await stateOf(page, 'requests')) === 'ok', { timeout: 8000 }), 'and so do requests');
  check((await usedIn(page)) === 0, 'at 0 in the last minute');
  await shot(page, 'summary-stopped');

  section('A source that fails');
  const usageRoute = new RegExp(`/agents/${AGENTS.off}/usage(\\?.*)?$`);
  await page.route(usageRoute, (route) =>
    route.request().method() === 'GET' ? route.fulfill({ status: 500, body: '{}' }) : route.continue(),
  );
  await openOverview(page, AGENTS.off);
  check(
    await until(async () => (await stateOf(page, 'spend')) === 'unavailable', { timeout: 12000 }),
    'with usage unreachable, the spend cell says it is unavailable',
  );
  check(!/\$\s*0(\.0+)?\b/.test(await textOf(cell(page, 'spend'))), 'and does not show $0');
  check(
    (await stateOf(page, 'status')) === 'ok' && (await stateOf(page, 'requests')) === 'ok',
    'status and requests are unaffected',
  );
  await page.unroute(usageRoute);
  await page.context().close();

  section('A phone-width screen');
  const phone = await adminPage(browser, { width: 390, height: 844 });
  await openOverview(phone, AGENTS.off);
  const boxes = [];
  for (const name of CELLS) boxes.push(await cell(phone, name).boundingBox());
  const lefts = new Set(boxes.map((b) => Math.round(b?.x ?? -1)));
  const tops = new Set(boxes.map((b) => Math.round(b?.y ?? -1)));
  check(boxes.every(Boolean) && lefts.size === 2 && tops.size === 2, `the strip is two by two (${lefts.size} columns, ${tops.size} rows)`);
  check(
    boxes.every(Boolean) && Math.round(boxes[0].y) === Math.round(boxes[1].y) && Math.round(boxes[2].y) === Math.round(boxes[3].y),
    'status beside spend, pod load beside requests',
  );
  check(await noSidewaysScroll(phone), 'and the page does not scroll sideways');
  await shot(phone, 'summary-390');
  await phone.context().close();
} finally {
  await browser.close();
}

done('summary');
