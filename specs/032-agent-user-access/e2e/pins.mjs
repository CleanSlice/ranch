// Everyone pins their own agents (CLEAN-231, User Story 6 of spec 032:
// FR-032 to FR-036, SC-010).
//
//   node specs/032-agent-user-access/e2e/pins.mjs
//   node specs/032-agent-user-access/e2e/pins.mjs --only app
//   node specs/032-agent-user-access/e2e/pins.mjs --only admin
//
// App console, at 390 px and 1440 px, as a User, with the Owner signed in in
// a second browser context:
//   1. the pin control is on the agent's sheet for a User; one click pins,
//      through PUT /agents/:id/pin, and the agent moves to the pinned place
//      in the User's list; it is still there after a reload
//   2. the Owner's list, in the other context and in GET /agents, is as it was
//   3. one more click unpins (DELETE /agents/:id/pin) and the list is back
//   4. a refused pin (the script answers the request 500, once) shows the
//      pin for as long as the request is open, then rolls it back and says so
//   5. at 1440 px the same from the list row, where there is a pointer
// Admin console, same widths, as the Owner, with the limited Admin in the
// second context: 1 to 4, on the agent header.
//
// In both: no request to PUT /agents/:id carries `pinned`.
//
// The agent pinned is chosen from the seeded ones both accounts reach, the
// one lowest in the list, so that pinning it visibly moves it.
//
// Fails on any console error and any failed request not listed in EXPECTED_*.
// Leaves no pin behind: whatever it pinned is unpinned through the API at
// the end, pass or fail.
//
// Needs: API :3333 (after seed.mjs), app :3000, admin :3001, fakeRuntime.mjs.
import {
  ADMIN,
  ADMIN_USER,
  AGENTS,
  APP,
  OWNER,
  USER,
  WIDTHS,
  api,
  arg,
  check,
  done,
  launch,
  loginAs,
  section,
  shot,
  sleep,
  until,
  watchedPage,
} from './lib.mjs';

/** What the script answers the one refused pin with. */
const REFUSAL = 'Pin refused by the e2e script';
/** How long the refused request is kept open, so the optimistic state can be seen. */
const REFUSAL_DELAY_MS = 1500;

const pinPath = (id) => `/agents/${id}/pin`;
const pathOf = (url) => new URL(url).pathname;

/** Failed requests the scenarios provoke on purpose: the one refused pin. */
const REFUSED_PIN = { status: 500, url: /\/agents\/[^/]+\/pin$/ };
const EXPECTED_APP = [REFUSED_PIN];
/**
 * Admin: the local stack has no S3 bucket, so the routes that read an agent's
 * workspace answer 400 (see owner-only.mjs).
 */
const EXPECTED_ADMIN = [REFUSED_PIN, { status: 400, url: /\/agents\/[^/]+\/(env|channels|files|secrets)(\?|\/|$)/ }];

// ------------------------------------------------------------------ helpers

/** Every request a context sends to the API, with its body. */
function recordRequests(context, into) {
  context.on('request', (req) => {
    into.push({ method: req.method(), path: pathOf(req.url()), body: req.postData() ?? '' });
  });
}

/** Requests that send `pinned` through the general update. */
const oldWay = (requests) => requests.filter((r) => r.method === 'PUT' && /^\/agents\/[^/]+$/.test(r.path) && /pinned/.test(r.body));
const pinCalls = (requests, method, id) => requests.filter((r) => r.method === method && r.path === pinPath(id)).length;

/** GET /agents as an account: `[{ id, name, isAdmin, pinned }]`. */
async function agentsOf(who) {
  const res = await api('/agents', { as: who });
  return (res.body ?? []).map((a) => ({ id: a.id, name: a.name, isAdmin: a.isAdmin === true, pinned: a.pinned === true }));
}
const pinnedIdsOf = async (who) => (await agentsOf(who)).filter((a) => a.pinned).map((a) => a.id);

/**
 * Where the consoles put the rows: the Ranch admin agent, then the pinned
 * ones, then the rest, each block in the order it came in (`railOrder`).
 */
function expectedOrder(before, facts) {
  const by = new Map(facts.map((a) => [a.id, a]));
  const admin = [];
  const pinned = [];
  const rest = [];
  for (const id of before) {
    const a = by.get(id);
    if (a?.isAdmin) admin.push(id);
    else if (a?.pinned) pinned.push(id);
    else rest.push(id);
  }
  return [...admin, ...pinned, ...rest];
}

/** The list rows that are on screen: `[{ id, pinned }]`, top to bottom. */
const visibleRows = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('li[data-agent-id]')]
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => ({ id: el.getAttribute('data-agent-id'), pinned: !!el.querySelector('[data-pinned]') })),
  );

/**
 * One console's way to its agent list. Docked on a wide screen (in the app
 * console after choosing the list view), behind a button on a narrow one.
 */
const CONSOLES = {
  app: {
    base: APP,
    opener: (page) => page.getByRole('button', { name: 'Switch agent' }),
    closer: (page) => page.getByRole('button', { name: 'Close agent list' }),
    /** The app console opens on the orbit map; the list is its other view. */
    dock: async (page) => {
      const tab = page.getByRole('tab', { name: 'List' });
      if ((await tab.count()) > 0 && (await tab.first().isVisible())) await tab.first().click();
    },
    /** The pin badge by the agent's name, above the chat. */
    headerRoot: '.agent-sheet',
  },
  admin: {
    base: ADMIN,
    opener: (page) => page.getByRole('button', { name: 'Agents', exact: true }),
    closer: (page) => page.getByRole('button', { name: 'Close', exact: true }),
    dock: async () => undefined,
    headerRoot: 'body',
  },
};

/** The rows of the list, opening it first when it is not on screen. */
async function listRows(page, kind, shotName) {
  const view = CONSOLES[kind];
  let rows = await visibleRows(page);
  if (rows.length === 0) {
    await view.dock(page);
    rows = (await until(async () => ((await visibleRows(page)).length ? visibleRows(page) : null), { timeout: 3000 })) ?? [];
  }
  if (rows.length > 0) {
    if (shotName) await shot(page, shotName);
    return rows;
  }
  await view.opener(page).first().click();
  rows = (await until(async () => ((await visibleRows(page)).length ? visibleRows(page) : null), { timeout: 8000 })) ?? [];
  if (shotName) await shot(page, shotName);
  await view.closer(page).first().click();
  await until(async () => (await visibleRows(page)).length === 0, { timeout: 5000 });
  return rows;
}
const idsOf = (rows) => rows.map((r) => r.id);
const names = (ids, facts) => ids.map((id) => facts.find((a) => a.id === id)?.name ?? id).join(', ');

/** Whether the pin badge is shown by the open agent's name (not in a list row). */
const headerPinned = (page, kind) =>
  page.evaluate(
    (root) =>
      [...(document.querySelector(root)?.querySelectorAll('[data-pinned]') ?? [])].some(
        (el) => !el.closest('li[data-agent-id]') && el.getClientRects().length > 0,
      ),
    CONSOLES[kind].headerRoot,
  );

const toggle = (page) => page.locator('[data-pin-toggle]').first();
const pressed = async (page) => (await toggle(page).getAttribute('aria-pressed')) === 'true';

async function openAgent(page, kind, id) {
  await page.goto(`${CONSOLES[kind].base}/agents/${id}`, { waitUntil: 'networkidle' });
  await toggle(page).waitFor({ state: 'visible', timeout: 20000 });
  await sleep(400);
}

/** Clicks and waits for the API's answer to that one pin request. */
async function clickAndWait(page, click, method, id) {
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === method && pathOf(r.url()) === pinPath(id), { timeout: 15000 }),
    click(),
  ]);
  return res.status();
}

/** Pins the script made, to be undone whatever happens: `email id`. */
const made = new Map();
const remember = (who, id) => made.set(`${who.email} ${id}`, { who, id });

/**
 * The whole story in one console, at one width.
 *
 *   kind        'app' | 'admin'
 *   actor       who pins
 *   other       the account in the second context
 *   candidates  seeded agents both reach; the lowest in the actor's list is pinned
 *   refusedSays what the console shows for the refused pin
 */
async function run(browser, { kind, width, actor, other, candidates, expected, refusedSays }) {
  const height = width < 600 ? 844 : 900;
  const requests = [];

  const first = await watchedPage(browser, { width, height, expected });
  const second = await watchedPage(browser, { width, height, expected });
  recordRequests(first.context, requests);
  recordRequests(second.context, requests);
  const { page } = first;

  try {
    section(`${kind === 'app' ? 'App' : 'Admin'} console, ${width} px: ${actor.role === 'User' ? 'a User' : `the ${actor.role}`} pins an agent`);
    await loginAs(page, actor, CONSOLES[kind].base);
    await loginAs(second.page, other, CONSOLES[kind].base);

    // The agent: the candidate lowest in the actor's own list.
    await openAgent(page, kind, candidates[0].id);
    const firstLook = idsOf(await listRows(page, kind));
    const agent = [...candidates].sort((a, b) => firstLook.indexOf(b.id) - firstLook.indexOf(a.id))[0];
    await openAgent(page, kind, agent.id);
    await openAgent(second.page, kind, agent.id);

    const factsBefore = await agentsOf(actor);
    const before = idsOf(await listRows(page, kind));
    const otherBefore = idsOf(await listRows(second.page, kind));
    const otherApiBefore = (await agentsOf(other)).map((a) => `${a.id}:${a.pinned}`).join();
    check(before.length === factsBefore.length && before.length > 1, `the list shows the ${factsBefore.length} agents the account reaches (${names(before, factsBefore)})`);
    check(!(await pinnedIdsOf(actor)).includes(agent.id), `${agent.name} is not pinned for them to begin with`);
    check((await toggle(page).isVisible()) && (await toggle(page).isEnabled()), 'the pin control is on screen and enabled');
    check(!(await pressed(page)) && !(await headerPinned(page, kind)), 'it reads "not pinned", and there is no pin badge by the name');
    await shot(page, `pins-${kind}-before-${width}`);

    // ---------------------------------------------------------------- pin
    remember(actor, agent.id);
    const status = await clickAndWait(page, () => toggle(page).click(), 'PUT', agent.id);
    check(status === 204, `one click: PUT /agents/:id/pin answers 204 (${status})`);
    check(pinCalls(requests, 'PUT', agent.id) === 1, `one request did it (${pinCalls(requests, 'PUT', agent.id)})`);
    await until(() => pressed(page), { timeout: 5000 });
    check((await pressed(page)) && (await headerPinned(page, kind)), 'the control reads "pinned" and the badge is by the name');

    const factsPinned = await agentsOf(actor);
    check(factsPinned.find((a) => a.id === agent.id)?.pinned === true, 'GET /agents as that account says it is pinned');
    const want = expectedOrder(before, factsPinned);
    const rowsPinned = await listRows(page, kind, `pins-${kind}-list-pinned-${width}`);
    const after = idsOf(rowsPinned);
    check(after.join() === want.join(), `the list is now: ${names(after, factsPinned)}`);
    check(after.join() !== before.join(), `which is not the order it had (${names(before, factsPinned)})`);
    const admins = factsPinned.filter((a) => a.isAdmin).length;
    const pinnedAhead = factsPinned.filter((a) => a.pinned && !a.isAdmin && before.indexOf(a.id) < before.indexOf(agent.id)).length;
    check(after.indexOf(agent.id) === admins + pinnedAhead, `${agent.name} is in the pinned place: row ${after.indexOf(agent.id) + 1}, right after the Ranch admin agent`);
    check(rowsPinned.find((r) => r.id === agent.id)?.pinned === true, 'its row carries the pin badge');
    await shot(page, `pins-${kind}-pinned-${width}`);

    // A reload reads it back from the API: the pin was saved, not only drawn.
    await openAgent(page, kind, agent.id);
    check((await pressed(page)) && idsOf(await listRows(page, kind)).join() === want.join(), 'after a reload it is still pinned and still there');

    // ------------------------------------------------------ the other one
    section(`  the ${other.role}, in another browser context`);
    const otherApiAfter = (await agentsOf(other)).map((a) => `${a.id}:${a.pinned}`).join();
    check(otherApiAfter === otherApiBefore, `GET /agents as the ${other.role}: same agents, same order, same pins as before`);
    check(!(await pinnedIdsOf(other)).includes(agent.id), `${agent.name} is not pinned for them`);
    await openAgent(second.page, kind, agent.id);
    const otherRows = await listRows(second.page, kind, `pins-${kind}-other-unchanged-${width}`);
    check(idsOf(otherRows).join() === otherBefore.join(), `their list, reloaded, is in the order it was (${names(idsOf(otherRows), await agentsOf(other))})`);
    check(
      otherRows.find((r) => r.id === agent.id)?.pinned === false && !(await pressed(second.page)) && !(await headerPinned(second.page, kind)),
      'no pin badge on that row or by the name, and their control reads "not pinned"',
    );

    // -------------------------------------------------------------- unpin
    section('  unpin');
    const off = await clickAndWait(page, () => toggle(page).click(), 'DELETE', agent.id);
    check(off === 204, `one click: DELETE /agents/:id/pin answers 204 (${off})`);
    await until(async () => !(await pressed(page)), { timeout: 5000 });
    check(!(await pressed(page)) && !(await headerPinned(page, kind)), 'the control reads "not pinned", the badge is gone');
    check(idsOf(await listRows(page, kind)).join() === before.join(), 'the list is back in the order it had');
    check(!(await pinnedIdsOf(actor)).includes(agent.id), 'GET /agents as that account says it is not pinned');

    // ----------------------------------------------------------- refused
    section('  a refused pin');
    const origin = new URL(page.url()).origin;
    let refusedOnce = 0;
    const refuse = async (route) => {
      if (route.request().method() !== 'PUT' || refusedOnce > 0) return route.continue();
      refusedOnce += 1;
      await sleep(REFUSAL_DELAY_MS);
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' },
        body: JSON.stringify({ statusCode: 500, message: REFUSAL }),
      });
    };
    const matcher = (url) => url.pathname === pinPath(agent.id);
    await page.route(matcher, refuse);
    const answered = page.waitForResponse((r) => r.request().method() === 'PUT' && pathOf(r.url()) === pinPath(agent.id), { timeout: 15000 });
    await toggle(page).click();
    const shownMeanwhile = await until(() => headerPinned(page, kind), { timeout: REFUSAL_DELAY_MS - 300, every: 50 });
    check(Boolean(shownMeanwhile), 'while the request is open the agent is shown pinned (the optimistic change)');
    const refusedStatus = (await answered).status();
    await page.unroute(matcher, refuse);
    check(refusedStatus === 500 && refusedOnce === 1, `the request was answered 500 by the script (${refusedStatus})`);
    await until(async () => !(await headerPinned(page, kind)), { timeout: 5000 });
    check(!(await headerPinned(page, kind)) && !(await pressed(page)), 'rolled back: no badge, the control reads "not pinned"');
    const said = await until(async () => ((await page.getByText(refusedSays, { exact: true }).count()) > 0 ? true : null), { timeout: 5000 });
    check(Boolean(said), `and the console says so: "${refusedSays}"`);
    await shot(page, `pins-${kind}-refused-${width}`);
    check(idsOf(await listRows(page, kind)).join() === before.join(), 'the list is in the order it had');
    check(!(await pinnedIdsOf(actor)).includes(agent.id), 'GET /agents as that account: not pinned, nothing was saved');
    check(await toggle(page).isEnabled(), 'the control is usable again');

    // --------------------------------------------------- from the list row
    if (kind === 'app' && width >= 1024) {
      section('  from the list row (a pointer is needed to see the control)');
      const row = page.locator(`li[data-agent-id="${agent.id}"]`).first();
      const rowPin = row.locator('[data-rail-pin]');
      await row.hover();
      check((await rowPin.count()) === 1 && (await rowPin.isVisible()), 'the row offers the pin control to a User');
      const on = await clickAndWait(page, () => rowPin.click(), 'PUT', agent.id);
      await until(() => pressed(page), { timeout: 5000 });
      check(on === 204 && idsOf(await listRows(page, kind)).join() === want.join(), `pinned from the row: 204, the same order as before (${on})`);
      await shot(page, `pins-${kind}-row-pinned-${width}`);
      await row.hover();
      const offAgain = await clickAndWait(page, () => rowPin.click(), 'DELETE', agent.id);
      await until(async () => !(await pressed(page)), { timeout: 5000 });
      check(offAgain === 204 && idsOf(await listRows(page, kind)).join() === before.join(), `and unpinned from it: 204, the list is back (${offAgain})`);
    }

    // ------------------------------------------------------------ the rest
    const old = oldWay(requests);
    check(old.length === 0, `no request to PUT /agents/:id carried "pinned"${old.length ? `: ${old.map((r) => r.path).join(', ')}` : ''}`);
    const problems = [...first.problems, ...second.problems];
    check(problems.length === 0, `no console error, no unexpected failed request${problems.length ? `: ${problems.join(' | ')}` : ''}`);
  } finally {
    await first.context.close().catch(() => undefined);
    await second.context.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------- run

/** `--only app` or `--only admin` runs one console's half. */
const only = arg('only');

const browser = await launch();
try {
  for (const width of only === 'admin' ? [] : WIDTHS) {
    // The first User reaches access-bravo and access-charlie; so does the Owner.
    await run(browser, {
      kind: 'app',
      width,
      actor: USER,
      other: OWNER,
      candidates: [AGENTS.c, AGENTS.b],
      expected: EXPECTED_APP,
      refusedSays: `Pin failed: ${REFUSAL}`,
    });
  }
  for (const width of only === 'app' ? [] : WIDTHS) {
    // The limited Admin reaches access-alpha and access-bravo; the Owner all.
    await run(browser, {
      kind: 'admin',
      width,
      actor: OWNER,
      other: ADMIN_USER,
      candidates: [AGENTS.a, AGENTS.b],
      expected: EXPECTED_ADMIN,
      refusedSays: `Pin failed: ${REFUSAL}`,
    });
  }
} catch (err) {
  check(false, `the script stopped: ${String(err?.stack ?? err).slice(0, 600)}`);
} finally {
  await browser.close().catch(() => undefined);
  // Leave no pin behind, whatever happened above.
  section('Afterwards');
  for (const { who, id } of made.values()) {
    const res = await api(pinPath(id), { method: 'DELETE', as: who });
    check(res.status === 204, `unpinned through the API: ${who.email} ${id} (${res.status})`);
  }
  for (const who of [USER, OWNER, ADMIN_USER]) {
    const left = (await pinnedIdsOf(who)).filter((id) => [...made.values()].some((m) => m.id === id && m.who === who));
    check(left.length === 0, `${who.email}: no pin of this script is left${left.length ? `: ${left.join(', ')}` : ''}`);
  }
}

done('pins');
