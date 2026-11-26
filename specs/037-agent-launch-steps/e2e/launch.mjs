// The launch step list, step by step, in both consoles (CLEAN-247).
//
//   node specs/037-agent-launch-steps/e2e/launch.mjs            both consoles
//   node specs/037-agent-launch-steps/e2e/launch.mjs --only app
//
// Each scenario opens its own page. The frames of a real launch are fed to
// the page's status stream in order (lib.mjs), the hub connection is a real
// one that this script raises and drops, and the list is read off the DOM by
// the hooks of contracts/launch-ui.md.
import {
  AGENT,
  CONSOLES,
  POD,
  REASON,
  USER,
  arg,
  check,
  consolePage,
  done,
  launch,
  launchAttr,
  openChat,
  overlayKind,
  rows,
  runtime,
  section,
  sleep,
  stage,
  until,
  waitRows,
} from './lib.mjs';

const only = typeof arg('only') === 'string' ? arg('only').split(',') : null;
const wanted = Object.values(CONSOLES).filter((c) => !only || only.includes(c.name));

const RESTART = ['accepted', 'stopped', 'scheduled', 'container', 'online', 'ready'];
const START = ['accepted', 'scheduled', 'container', 'online', 'ready'];

/** `line(RESTART, 'scheduled')` → everything before done, it current, the rest upcoming. */
function line(ids, current, state = 'current') {
  const at = ids.indexOf(current);
  return ids
    .map((id, i) => `${id}:${i < at ? 'done' : i === at ? state : 'upcoming'}`)
    .join(' ');
}

async function expectRows(page, expected, label) {
  const { ok, seen } = await waitRows(page, expected);
  check(ok, ok ? label : `${label}\n         expected ${expected}\n         saw      ${seen || '(no list)'}`);
  return ok;
}

/** Presses the console's own restart; in `app` the launch is one somebody else started. */
async function beginRestart(which, page, st) {
  if (which.name === 'admin') {
    await page.locator('[data-agent-actions]').first().click();
    await page.getByRole('menuitem', { name: /^Restart/ }).first().click();
    return;
  }
  // The app console's chat has no restart of its own in the workspace: the
  // launch arrives the way anybody else's does, as a status on the stream.
  st.set({ status: 'deploying', launchContext: 'restart' });
  await st.push({ pod: POD.old, hub: true });
}

async function quiet(problems, label) {
  check(problems.length === 0, problems.length === 0 ? `${label}: no console errors, no failed requests` : `${label}: ${problems.join(' | ')}`);
}

// ------------------------------------------------------------------ restart

async function restartScenario(browser, which) {
  section(`${which.name}: a restart, every stage`);
  const rt = runtime();
  const { page, context, problems } = await consolePage(browser, which);
  const st = await stage(page);
  try {
    check(await rt.up(), 'the runtime is on the hub');
    check(await openChat(page, which), 'the chat is open');
    await st.push({ pod: POD.ready, hub: true });
    check(Boolean(await until(async () => (await overlayKind(page)) === null, { timeout: 15000 })), 'no overlay over a running agent');

    await beginRestart(which, page, st);
    check(Boolean(await until(async () => (await overlayKind(page)) === 'starting', { timeout: 8000 })), 'the overlay rises');
    check((await launchAttr(page, 'data-launch')) === 'restart', 'it is a restart');
    await expectRows(page, line(RESTART, 'stopped'), 'accepted; waiting for the old instance, whose pod and hub connection prove nothing');

    await rt.down();
    await st.push({ pod: POD.old, hub: false });
    await expectRows(page, line(RESTART, 'scheduled'), 'the old instance left the hub; its terminating pod is not taken for the new one');

    await st.push({ pod: POD.pending });
    await expectRows(page, line(RESTART, 'scheduled'), 'a pending pod with no waiting reason is still being scheduled');

    await st.push({ pod: POD.creating });
    await expectRows(page, line(RESTART, 'container'), 'scheduled; the container is being prepared');

    await st.push({ pod: POD.running });
    await expectRows(page, line(RESTART, 'online'), 'container ready; connecting to Ranch');

    // Reload in the middle: the list comes back where the launch is.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await until(async () => (await page.evaluate(() => Boolean(window.__status && window.__status.opened()))), { timeout: 20000 });
    await st.replay();
    const t = Date.now();
    const back = await expectRows(page, line(RESTART, 'online'), 'after a reload the list is at the same step');
    if (back) check(Date.now() - t < 6000, `and got there in ${Date.now() - t} ms`);

    check(await rt.up(), 'the new runtime registers on the hub');
    await st.push({ pod: POD.running, hub: true });
    await expectRows(page, line(RESTART, 'ready'), 'connected; getting ready while the status is not written yet');

    // The end: every row done, held for a moment, then the chat shows.
    st.set({ status: 'running' });
    let sawAllDone = false;
    const watch = (async () => {
      const end = Date.now() + 6000;
      while (Date.now() < end) {
        const seen = await rows(page);
        if (seen && seen.split(' ').every((r) => r.endsWith(':done'))) sawAllDone = true;
        if (sawAllDone && (await overlayKind(page)) === null) return;
        await sleep(60);
      }
    })();
    await st.push({ pod: POD.ready, hub: true });
    await watch;
    check(sawAllDone, 'every row is shown done before the list leaves');
    check((await overlayKind(page)) === null, 'the overlay clears on its own');
    check((await page.locator('textarea').first().isEnabled()) === true, 'the chat can be written in');
    await quiet(problems, which.name);
  } finally {
    await rt.down();
    await context.close();
  }
}

// ------------------------------------------------------------------ failure

async function failureScenario(browser, which) {
  section(`${which.name}: a launch that fails, and the way forward`);
  const rt = runtime();
  const { page, context, problems } = await consolePage(browser, which);
  const st = await stage(page);
  try {
    await rt.up();
    await openChat(page, which);
    await st.push({ pod: POD.ready, hub: true });
    await until(async () => (await overlayKind(page)) === null, { timeout: 15000 });

    await beginRestart(which, page, st);
    await until(async () => (await overlayKind(page)) === 'starting', { timeout: 8000 });
    await rt.down();
    await st.push({ pod: POD.old, hub: false });
    await st.push({ pod: POD.creating });
    await expectRows(page, line(RESTART, 'container'), 'the launch got as far as the container');

    // The stream drops: the list keeps its state and says so.
    await st.drop();
    check(Boolean(await until(async () => (await launchAttr(page, 'data-launch-stale')) !== null, { timeout: 5000 })), 'a dropped stream is said on the list');
    check((await rows(page)) === line(RESTART, 'container'), 'and the rows keep their state');
    await st.resume();
    check(Boolean(await until(async () => (await launchAttr(page, 'data-launch-stale')) === null, { timeout: 5000 })), 'the notice clears when frames resume');

    st.set({ status: 'failed', statusReason: REASON });
    await st.push({ pod: POD.pullFailed });
    await expectRows(page, line(RESTART, 'container', 'failed'), 'the list stops on the step that failed');
    check((await overlayKind(page)) === 'failed', 'the overlay is the failure');
    // The reason is on the row, which is read again once the launch has
    // failed; until it arrives the pod's own waiting reason stands in.
    let text = '';
    await until(
      async () => {
        text = await page.locator('[data-step="container"]').first().innerText();
        return text.includes(REASON);
      },
      { timeout: 8000 },
    );
    check(text.includes(REASON), `the server's reason is shown as received (${JSON.stringify(text.replace(/\s+/g, ' ').slice(0, 90))})`);
    const retry = page.locator('[data-launch-action="retry"]');
    check((await retry.count()) === 1 && (await retry.first().isVisible()), 'a manager is offered the way forward');

    // Retry: a new launch, from the first row. Nothing is replaced, so no "stopped" row.
    await retry.first().click();
    check(Boolean(await until(() => st.calls.length >= (which.name === 'admin' ? 2 : 1), { timeout: 5000 })), 'retry asks for a restart');
    check(Boolean(await until(async () => (await launchAttr(page, 'data-launch')) === 'start', { timeout: 8000 })), 'the server calls it a start: there is no instance to replace');
    await expectRows(page, line(START, 'scheduled'), 'the list starts over, and the failed pod is not taken for the new one');
    await quiet(problems, which.name);
  } finally {
    await rt.down();
    await context.close();
  }
}

// -------------------------------------------------------------------- start

async function startScenario(browser) {
  const which = CONSOLES.admin;
  section('admin: start of a stopped agent, then a stop mid-launch');
  const { page, context, problems } = await consolePage(browser, which);
  const st = await stage(page, AGENT, { status: 'stopped', launchContext: 'restart' });
  try {
    await openChat(page, which);
    await st.push({ pod: null, hub: false });
    check(Boolean(await until(async () => (await overlayKind(page)) === 'stopped', { timeout: 15000 })), 'a stopped agent shows its own overlay, unchanged');
    check((await rows(page)) === '', 'with no step list');

    await page.locator('[data-agent-toggle-running]').first().click();
    check(Boolean(await until(async () => (await launchAttr(page, 'data-launch')) === 'start', { timeout: 8000 })), 'pressing Start raises the list of a start');
    await expectRows(page, line(START, 'scheduled'), 'five rows, none about a previous instance');
    await st.push({ pod: POD.creating });
    await expectRows(page, line(START, 'container'), 'and they follow the pod');

    // A stop while it launches is not a failure. This console's own Stop is
    // disabled for as long as the agent is deploying, as it was before, so
    // the stop is one that came from elsewhere: another tab, the agent's tool.
    st.set({ status: 'stopped' });
    await st.push({ pod: null, hub: false });
    check(Boolean(await until(async () => (await overlayKind(page)) === 'stopped', { timeout: 8000 })), 'a stop mid-launch gives the stopped overlay');
    check((await page.locator('[data-step-state="failed"]').count()) === 0, 'with no failed row');
    await quiet(problems, which.name);
  } finally {
    await context.close();
  }
}

// ------------------------------------------------------------------- reader

async function readerScenario(browser) {
  const which = CONSOLES.app;
  section('app: somebody who may not manage the agent');
  const rt = runtime();
  let opened;
  try {
    opened = await consolePage(browser, which, { who: USER });
  } catch (err) {
    console.log(`  skip  the plain user could not sign in to the app console (${String(err).slice(0, 80)})`);
    return;
  }
  const { page, context, problems } = opened;
  // What the API gives a reader (agentReaderView): no launch context, no
  // reason of a failure.
  const st = await stage(page, AGENT, { launchContext: null, statusReason: null });
  try {
    await rt.up();
    if (!(await openChat(page, which))) {
      console.log('  skip  the plain user does not reach this fixture agent');
      return;
    }
    await st.push({ pod: POD.ready, hub: true });
    await until(async () => (await overlayKind(page)) === null, { timeout: 15000 });

    st.set({ status: 'deploying' });
    await st.push({ pod: POD.old, hub: true });
    check(Boolean(await until(async () => (await overlayKind(page)) === 'starting', { timeout: 8000 })), 'a launch they did not start is shown to them');
    // They are not told it is a restart, and their list must be right all the same.
    await expectRows(page, line(START, 'scheduled'), 'the old instance, still up, ticks nothing');
    await rt.down();
    await st.push({ pod: POD.creating, hub: false });
    await expectRows(page, line(START, 'container'), 'and the new pod is followed once the old one left');

    st.set({ status: 'failed' });
    await st.push({ pod: POD.pullFailed });
    await expectRows(page, line(START, 'container', 'failed'), 'a failure stops on its step');
    const text = await page.locator('[data-step="container"]').first().innerText();
    check(text.includes('ImagePullBackOff'), 'with the reason the stream gives everybody, as received');
    check((await page.locator('[data-launch-action="retry"]').count()) === 0, 'and no restart offered to them');

    // A stop is not a failure: the list leaves, nothing is marked failed.
    st.set({ status: 'stopped' });
    await st.push({ pod: null, hub: false });
    check(Boolean(await until(async () => (await overlayKind(page)) === null, { timeout: 8000 })), 'a stop takes the list away');
    await quiet(problems, 'app (reader)');
  } finally {
    await rt.down();
    await context.close();
  }
}

// --------------------------------------------------------------------- run

const browser = await launch();
try {
  for (const which of wanted) {
    await restartScenario(browser, which);
    await failureScenario(browser, which);
  }
  if (!only || only.includes('admin')) await startScenario(browser);
  if (!only || only.includes('app')) await readerScenario(browser);
} finally {
  await browser.close();
}
done('launch');
