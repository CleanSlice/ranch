// The Request limit block against the agent's own last hour (CLEAN-228, User
// Story 4).
//
//   node specs/031-agent-overview-redesign/e2e/limit.mjs
//
// With limits off: switch off, chart without a line, a sentence naming the
// hour's peak. Typing a per-minute value below the peak marks the minutes
// over it and the sentence gives minutes and requests — the same two numbers
// this script works out from `GET /agents/:id/load` — while nothing is sent.
// A value far above the traffic keeps the bars readable and says the limit is
// above the scale. A preset fills the field and counts as a change. Hour
// below minute is refused by its field; a public agent cannot switch limits
// off. Peaks, the "not counted" line and the sentence a limited person reads
// are there.
//
// Leaves `limits-off` and `limits-minute` as the seed made them (the traffic
// it sent stays in the last hour, as traffic does).
//
// Needs: API :3333 (after seed.mjs), fakeAgent.mjs, admin :3001.
import {
  AGENTS,
  adminPage,
  agentAny,
  agentPut,
  captureRequests,
  check,
  done,
  fake,
  getLoad,
  hook,
  launch,
  limitsOf,
  mentions,
  openOverview,
  remember,
  saveBar,
  section,
  sendAnonymous,
  setLimits,
  shot,
  textOf,
  until,
} from './lib.mjs';

const agent = AGENTS.off;
const BURST = 6;

/** data-model.md, "Limit preview": what a per-minute limit would have done to a series. */
function preview(series, perMinute) {
  const peak = Math.max(0, ...series.map((m) => m.accepted));
  if (perMinute === null) return { peak, over: 0, refused: 0 };
  const above = series.filter((m) => m.accepted > perMinute);
  return { peak, over: above.length, refused: above.reduce((sum, m) => sum + (m.accepted - perMinute), 0) };
}

const block = (page) => hook(page, 'block', 'limit').first();
const input = (page, window) => block(page).locator(`[data-limit-input="${window}"]`).first();
const limitSwitch = (page) => hook(page, 'limit-switch').first();
const verdict = (page) => hook(page, 'limit-verdict').first();
const line = (page) => block(page).locator('[data-load-chart-limit]');
const lineShown = async (page) => (await line(page).count()) > 0 && (await line(page).first().isVisible());
const errors = (page) =>
  block(page)
    .locator('[data-limits-error]')
    .evaluateAll((els) =>
      els
        .filter((el) => el.getBoundingClientRect().height > 0)
        .map((el) => el.getAttribute('data-limits-error-code'))
        .filter(Boolean),
    );
const readVerdict = async (page) => ({
  over: Number(await verdict(page).getAttribute('data-over')),
  refused: Number(await verdict(page).getAttribute('data-refused')),
});
const bars = (page) =>
  block(page)
    .locator('[data-load-chart] [data-minute]')
    .evaluateAll((els) =>
      els.map((el) => ({ accepted: Number(el.getAttribute('data-accepted')), over: el.hasAttribute('data-over') })),
    );

/**
 * Waits until the sentence carries the two numbers this script computes from
 * the API's series for `perMinute`. Both are read again on every try: the
 * series slides by a minute while the page is open.
 */
function verdictMatches(page, perMinute) {
  return until(
    async () => {
      const expected = preview((await getLoad(agent)).series, perMinute);
      const shown = await readVerdict(page);
      return shown.over === expected.over && shown.refused === expected.refused ? expected : null;
    },
    { timeout: 10000, every: 300 },
  );
}

section('Preconditions');
check(await fake.up(), 'fake agents are up');
await fake.reset();
const start = await remember(agent);
check(start.agent?.isPublic === false && start.limits === null, 'limits-off is private with no limits');

section('Traffic to look at');
const statuses = [];
for (let i = 0; i < BURST; i++) statuses.push((await sendAnonymous(agent, `burst ${i + 1}`)).status);
check(statuses.every((s) => s === 200), `a burst of ${BURST} to limits-off, none refused (${statuses.join(',')})`);
const peak = preview((await getLoad(agent)).series, null).peak;
check(peak >= 3, `the last hour has a peak to cut into (${peak} in one minute)`);
/** Below the peak: some minutes go over. */
const LOW = Math.max(1, Math.floor(peak / 2));
/** Far above anything the agent got. */
const HIGH = Math.max(500, peak * 50);

const browser = await launch();
try {
  const page = await adminPage(browser, { width: 1440, height: 1100 });
  const bar = saveBar(page);
  const puts = captureRequests(page, agentPut(agent), 'PUT');
  const writes = ['PUT', 'POST', 'PATCH', 'DELETE'].map((method) => captureRequests(page, agentAny(agent), method));
  const written = () => writes.reduce((n, list) => n + list.length, 0);

  section('Limits off');
  await openOverview(page, agent);
  await block(page).scrollIntoViewIfNeeded();
  check((await block(page).getAttribute('id')) === 'visibility-embed', 'the block keeps the anchor the chat line links to');
  check((await limitSwitch(page).getAttribute('role')) === 'switch', 'the block has an on/off switch');
  check((await limitSwitch(page).getAttribute('aria-checked')) === 'false', 'and it is off');
  let empty = true;
  for (const window of ['minute', 'hour', 'day']) {
    empty = empty && (await input(page, window).count()) === 1 && (await input(page, window).inputValue()) === '';
  }
  check(empty, 'the three limit fields are there, empty');
  check(
    await until(async () => (await block(page).locator('[data-load-chart] [data-minute]').count()) === 60, { timeout: 8000 }),
    'the chart shows the last sixty minutes',
  );
  check(!(await lineShown(page)), 'with no limit line across it');
  const off = await textOf(verdict(page));
  check(/no limit/i.test(off), `the sentence says there is no limit ("${off}")`);
  check(
    await until(async () => mentions(await textOf(verdict(page)), preview((await getLoad(agent)).series, null).peak), {
      timeout: 8000,
    }),
    `and names the hour's peak (${peak})`,
  );
  const idle = await readVerdict(page);
  check(idle.over === 0 && idle.refused === 0, 'no minute is over a limit that is not there');
  check((await bars(page)).every((b) => !b.over), 'and no bar is marked');
  check(!(await bar.present()), 'nothing is unsaved');
  await shot(page, 'limit-off');

  section('Switching on');
  await limitSwitch(page).click();
  check(
    await until(async () => (await limitSwitch(page).getAttribute('aria-checked')) === 'true', { timeout: 4000 }),
    'the switch turns on',
  );
  check(await input(page, 'minute').isEditable(), 'the fields are active');
  check(written() === 0 && (await limitsOf(agent)) === null, 'and nothing is saved');

  section(`Typing a limit below the peak (${LOW} per minute)`);
  await input(page, 'minute').fill(String(LOW));
  const low = await verdictMatches(page, LOW);
  const shownLow = await readVerdict(page);
  check(
    low,
    `the sentence has the API's numbers: ${shownLow.over} minutes over, ${shownLow.refused} requests refused` +
      (low ? '' : ` (expected ${JSON.stringify(preview((await getLoad(agent)).series, LOW))})`),
  );
  check(low?.over > 0 && low?.refused > 0, 'and they are not zero: this limit would have bitten');
  const said = await textOf(verdict(page));
  check(mentions(said, LOW) && mentions(said, shownLow.over) && mentions(said, shownLow.refused), `in words ("${said}")`);
  const marked = await bars(page);
  check(
    marked.every((b) => b.over === b.accepted > LOW),
    `exactly the minutes above ${LOW} are marked (${marked.filter((b) => b.over).length} of 60)`,
  );
  check(marked.filter((b) => b.over).length === shownLow.over, 'as many as the sentence says');
  check(await lineShown(page), 'the limit is drawn across the chart');
  check((await line(page).first().getAttribute('data-limit-above-scale')) === null, 'inside its scale');
  check(await bar.counts(1), 'the bar counts one unsaved change');
  check(written() === 0, 'no request was sent while typing');
  check((await limitsOf(agent)) === null, 'and the agent still has no limit');
  await shot(page, 'limit-below-peak');

  section(`A limit far above the traffic (${HIGH} per minute)`);
  await input(page, 'minute').fill(String(HIGH));
  const high = await verdictMatches(page, HIGH);
  check(high && high.over === 0 && high.refused === 0, 'no minute would have gone over');
  check((await bars(page)).every((b) => !b.over), 'no bar is marked');
  check(
    await until(async () => (await line(page).first().getAttribute('data-limit-above-scale')) !== null, { timeout: 4000 }),
    'the limit is marked as above what the chart shows',
  );
  check(/above/i.test(await textOf(block(page).locator('[data-load-chart]'))), 'and the chart says so in words');
  // Readable: the busiest minute still takes a good part of the chart's
  // height instead of being flattened under a line five hundred requests up.
  const share = await block(page)
    .locator('[data-load-chart]')
    .first()
    .evaluate((chart) => {
      let busiest = null;
      for (const el of chart.querySelectorAll('[data-minute]')) {
        if (!busiest || Number(el.getAttribute('data-accepted')) > Number(busiest.getAttribute('data-accepted'))) busiest = el;
      }
      if (!busiest) return 0;
      // The bar is the hooked element or something drawn inside it.
      const heights = [busiest, ...busiest.querySelectorAll('*')]
        .map((el) => el.getBoundingClientRect().height)
        .filter((h) => h > 0);
      return heights.length ? Math.min(...heights) / chart.getBoundingClientRect().height : 0;
    });
  check(share >= 0.2, `the busiest minute is still a readable bar (${Math.round(share * 100)}% of the chart's height)`);
  check(written() === 0, 'still nothing sent');
  await shot(page, 'limit-above-scale');

  section('A preset');
  const preset = hook(page, 'limit-preset', '30').first();
  check((await hook(page, 'limit-preset').count()) === 4, 'four shortcuts: 10, 30, 60, 120');
  await preset.click();
  check(
    await until(async () => (await input(page, 'minute').inputValue()) === '30', { timeout: 4000 }),
    'pressing 30 fills the per-minute field',
  );
  check((await preset.getAttribute('aria-pressed')) === 'true', 'the shortcut shows as pressed');
  check((await hook(page, 'limit-preset', '60').first().getAttribute('aria-pressed')) !== 'true', 'the others do not');
  check((await bar.present()) && (await bar.count()) === 1, 'and it counts as a change, like typing would');
  check(await verdictMatches(page, 30), 'the sentence follows it');
  check(written() === 0 && (await limitsOf(agent)) === null, 'nothing is saved by a preset either');

  section('Hour below minute');
  await input(page, 'minute').fill('10');
  await input(page, 'hour').fill('5');
  // Refused where it stands, or at Save — either way by its field, in this block.
  if (!(await until(async () => (await errors(page)).includes('LIMIT_WINDOWS_CONTRADICT'), { timeout: 1500 }))) {
    await bar.save();
  }
  check(
    await until(async () => (await errors(page)).includes('LIMIT_WINDOWS_CONTRADICT'), { timeout: 6000 }),
    'an hour limit below the minute limit is refused, in the Request limit block',
  );
  const byField = await block(page)
    .locator('[data-limits-error-code="LIMIT_WINDOWS_CONTRADICT"]')
    .first()
    .evaluate((el) => {
      const hour = el.closest('[data-block="limit"]').querySelector('[data-limit-input="hour"]');
      const a = el.getBoundingClientRect();
      const b = hour.getBoundingClientRect();
      return Math.abs(a.top - b.bottom) < 160 || Math.abs(a.top - b.top) < 160;
    });
  check(byField, 'next to the fields it concerns');
  check((await bar.present()) && (await limitsOf(agent)) === null, 'the edits stay and nothing was saved');
  await shot(page, 'limit-hour-below-minute');
  await bar.discard();
  check(await bar.leaves(), 'Discard clears it');
  check((await limitSwitch(page).getAttribute('aria-checked')) === 'false', 'and the switch is off again');

  section('What the block explains');
  const load = await getLoad(agent);
  for (const window of ['minute', 'hour', 'day']) {
    const el = hook(page, 'limit-peak', window);
    check(
      (await el.count()) > 0 && mentions(await textOf(el), load.peaks[window]),
      `the busiest ${window} of the last 30 days is beside its field (${load.peaks[window]})`,
    );
  }
  const uncovered = await textOf(hook(page, 'limits-uncovered'));
  check(/operator/i.test(uncovered) && /agent/i.test(uncovered), 'who is not counted: operators, other agents');
  check(/telegram/i.test(uncovered) && /schedul/i.test(uncovered), 'what is not covered: Telegram, scheduled runs');
  check(/share/i.test(await textOf(block(page))), 'that everyone who talks to the agent shares the allowance');
  const sample = await textOf(hook(page, 'limit-preview'));
  check(/reached its message limit/i.test(sample) && /try again in/i.test(sample), `the sentence a limited person reads ("${sample}")`);
  check(!/queue|each user|platform default/i.test(await textOf(block(page))), 'no queue, no per-user mode, no platform default');
  check(
    (await block(page).locator('[data-load-view]').count()) > 0 &&
      (await block(page).locator('[data-load-window]').count()) === 3,
    'live use of each window is in the same block',
  );
  check(
    (await block(page).locator('[data-load-inflight]').count()) > 0 &&
      (await block(page).locator('[data-load-refused]').count()) > 0,
    'with requests in progress and refused in the last hour',
  );

  section('Saving a limit');
  puts.length = 0;
  await limitSwitch(page).click();
  await input(page, 'minute').fill(String(LOW));
  await bar.save();
  check(await bar.leaves(10000), 'one Save');
  check(
    puts.length === 1 && Object.keys(puts[0] ?? {}).join(',') === 'limits',
    `sends the limits and nothing else (${Object.keys(puts[0] ?? {}).join(', ')})`,
  );
  const savedLimits = await limitsOf(agent);
  check(
    savedLimits?.perMinute === LOW,
    `the agent now has ${LOW} per minute (sent ${JSON.stringify(puts[0]?.limits ?? null)}, saved ${JSON.stringify(savedLimits)})`,
  );
  check((await limitSwitch(page).getAttribute('aria-checked')) === 'true' && (await lineShown(page)), 'the switch is on and the line stays');
  // The meters are the load snapshot, read again after the save.
  check(
    await until(
      async () =>
        (await block(page).locator('[data-load-window="minute"]').first().getAttribute('data-limit')) === String(LOW),
      { timeout: 6000 },
    ),
    'and the minute meter has its ceiling',
  );

  section('A public agent cannot switch limits off');
  await openOverview(page, AGENTS.minute);
  await block(page).scrollIntoViewIfNeeded();
  check((await limitSwitch(page).getAttribute('aria-checked')) === 'true', 'limits-minute: the switch is on');
  check((await input(page, 'minute').inputValue()) === '2', 'with its 2 per minute');
  // Off through the switch; where the switch itself refuses for a public
  // agent, through the other way of saying "no limits": every field empty.
  if (await limitSwitch(page).isEnabled()) await limitSwitch(page).click();
  if (!(await bar.appears(1500)) && !(await errors(page)).includes('PUBLIC_AGENT_NEEDS_LIMITS')) {
    await input(page, 'minute').fill('');
  }
  if (await bar.appears(2000)) await bar.save();
  check(
    await until(async () => (await errors(page)).includes('PUBLIC_AGENT_NEEDS_LIMITS'), { timeout: 6000 }),
    'switching it off is refused in this block, with the reason',
  );
  check((await limitsOf(AGENTS.minute))?.perMinute === 2, 'the limit is still there');
  await shot(page, 'limit-public-needs-limits');

  section('An agent that was public before limits existed');
  await openOverview(page, AGENTS.legacy);
  check(
    await until(async () => (await block(page).locator('[data-limits-needed]').count()) > 0, { timeout: 8000 }),
    'its block asks for a limit',
  );
  check((await textOf(block(page).locator('[data-limits-needed]'))).length > 10, 'in plain words');
} finally {
  await browser.close();
  // Back to the seed's state, whatever happened above.
  await start.restore();
  await setLimits(AGENTS.minute, { perMinute: 2 });
}

done('limit');
