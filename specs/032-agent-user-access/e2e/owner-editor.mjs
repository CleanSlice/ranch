// The Owner edits one account's agent access in the admin console
// (CLEAN-231, User Story 1 of spec 032: FR-012, FR-020 to FR-022).
//
//   node specs/032-agent-user-access/e2e/owner-editor.mjs
//
// On /users: the marks "Restricted" and "Needs review" as the seed leaves
// them. On /users/<second User>: one row per agent with one three-way choice,
// the outcome sentence recomputed before saving, Save disabled until
// something changed, the confirmation before a limited account becomes an
// open one (asked before any request is sent), a stale version (the editor
// reads the access again, keeps the person's choice selected and says it
// changed), and the one line shown for an account that has no access to
// edit. Then, from the script, the refusals the screen cannot provoke.
//
// Every edit is made on the second User, and its access is put back through
// the API at the end, whatever happened.
//
// Runs at 390 px and 1440 px. Fails on any console error and any failed
// request that is not listed in EXPECTED below.
//
// Needs: API :3333 (after seed.mjs), admin :3001.
import {
  ADMIN,
  ADMIN_USER,
  AGENTS,
  OWNER,
  USER,
  USER2,
  WIDTHS,
  api,
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

/**
 * Failed requests this scenario expects, and why: the stale-version step
 * saves with a version somebody else has replaced, and the API answers that
 * one PUT 409 ACCESS_CHANGED.
 */
const EXPECTED = [{ status: 409, url: /\/users\/[^/]+\/agent-access$/ }];

const SENTENCES = {
  all: 'Reaches every agent',
  one_denied: 'Reaches every agent except 1',
  only_one: 'Reaches only these 1',
};
const CONFIRM_TEXT = 'This account will reach every agent that is not denied.';
const CHANGED_TEXT = 'Someone else changed this access in the meantime. Reload it and try again.';

const users = (await api('/users', { as: OWNER })).body;
const idOf = (who) => users.find((u) => u.email === who.email)?.id;
const ids = { owner: idOf(OWNER), admin: idOf(ADMIN_USER), user: idOf(USER), user2: idOf(USER2) };
const agents = (await api('/agents', { as: OWNER })).body;

const accessOf = async (userId) => (await api(`/users/${userId}/agent-access`, { as: OWNER })).body;
const putAccess = (userId, body) => api(`/users/${userId}/agent-access`, { method: 'PUT', as: OWNER, body });
const sorted = (list) => [...(list ?? [])].sort().join(',');

/** The second User's access as seed.mjs leaves it: open, no entries. Restored at the end. */
const baseline = { allowed: [], denied: [], outcome: { kind: 'all' } };
/** What this run found on that account: put back exactly, at the end. */
const found = await accessOf(ids.user2);

async function restore(to = baseline) {
  const now = await accessOf(ids.user2);
  if (sorted(now.allowed) === sorted(to.allowed) && sorted(now.denied) === sorted(to.denied) && now.outcome.kind === to.outcome.kind) return true;
  const res = await putAccess(ids.user2, {
    allowed: to.allowed,
    denied: to.denied,
    version: now.version,
    confirmOpen: true,
  });
  return res.status === 200;
}

const count = (page, selector) => page.locator(selector).count();
const textOf = async (page, selector) =>
  ((await page.locator(selector).first().textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
const row = (page, agent) => page.locator(`[data-access-row="${agent.id}"]`);
const valueOf = (page, agent) => row(page, agent).getAttribute('data-access-value');
const choose = (page, agent, choice) => row(page, agent).locator(`[data-access-choice="${choice}"]`).click();
const outcomeKind = (page) => page.locator('[data-access-outcome]').first().getAttribute('data-access-outcome');
const saveDisabled = (page) => page.locator('[data-access-save]').isDisabled();

async function openUser(page, userId) {
  await page.goto(`${ADMIN}/users/${userId}`, { waitUntil: 'networkidle' });
  await page.locator('[data-access-card]').waitFor({ state: 'visible', timeout: 15000 });
  await until(async () => (await count(page, '[data-access-row], [data-access-managed], [data-access-error], [data-access-empty]')) > 0, {
    timeout: 15000,
  });
  await sleep(300);
}

/** Clicks Save and waits until the editor has nothing pending and is idle. */
async function saveAndSettle(page) {
  await page.locator('[data-access-save]').click();
  await until(
    async () =>
      (await count(page, '[data-access-confirm]')) > 0 ||
      (await count(page, '[data-access-error]')) > 0 ||
      ((await count(page, '[data-access-changed]')) === 0 && (await textOf(page, '[data-access-save]')) === 'Save access'),
    { timeout: 10000 },
  );
  await sleep(200);
}

const browser = await launch();
try {
  for (const width of WIDTHS) {
    const height = width < 600 ? 844 : 900;
    section(`Admin console, ${width} px, as the Owner`);
    check(await restore(), 'the second User starts open, as seed.mjs leaves it');
    const startVersion = (await accessOf(ids.user2)).version;
    const { context, page, problems } = await watchedPage(browser, { width, height, expected: EXPECTED });
    const puts = [];
    page.on('request', (req) => {
      if (req.method() === 'PUT' && /\/agent-access$/.test(req.url())) puts.push(req.postDataJSON());
    });
    await loginAs(page, OWNER, ADMIN);

    // ------------------------------------------------------ the user list
    await page.goto(`${ADMIN}/users`, { waitUntil: 'networkidle' });
    await page.locator('[data-user-access]').first().waitFor({ state: 'attached', timeout: 15000 });
    const listRow = (who) => page.locator('tr', { hasText: who.email });
    const markOf = (who) => listRow(who).locator('[data-user-access]').getAttribute('data-user-access');
    const badgesOf = async (who) => (await listRow(who).locator('[data-user-access]').innerText()).replace(/\s+/g, ' ').trim();
    check((await markOf(USER)) === 'all_except' && (await badgesOf(USER)) === 'Restricted', `the first User, denied one agent: "Restricted" ("${await badgesOf(USER)}")`);
    check((await markOf(ADMIN_USER)) === 'only' && (await badgesOf(ADMIN_USER)) === 'Restricted', `the Admin, limited to two agents: "Restricted" ("${await badgesOf(ADMIN_USER)}")`);
    check((await markOf(USER2)) === 'all' && (await badgesOf(USER2)) === '', `the second User reaches every agent: no mark ("${await badgesOf(USER2)}")`);
    check((await markOf(OWNER)) === 'all' && (await badgesOf(OWNER)) === '', 'the Owner: no mark');
    await shot(page, `owner-editor-list-${width}`);

    // --------------------------------------------------------- the editor
    await openUser(page, ids.user2);
    check((await count(page, '[data-access-row]')) === agents.length, `one row per agent (${await count(page, '[data-access-row]')} of ${agents.length})`);
    const choices = await row(page, AGENTS.a).locator('[data-access-choice]').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-access-choice')}:${e.textContent.trim()}`).join(' '));
    check(choices === 'none:Default allowed:Allowed denied:Denied', `a row has one three-way choice (${choices})`);
    check(/running/i.test(await textOf(page, `[data-access-row="${AGENTS.a.id}"] [data-access-status]`)), `the row shows the agent's status ("${await textOf(page, `[data-access-row="${AGENTS.a.id}"] [data-access-status]`)}")`);
    check((await outcomeKind(page)) === 'all' && (await textOf(page, '[data-access-outcome]')) === SENTENCES.all, `outcome: "${await textOf(page, '[data-access-outcome]')}"`);
    check(await saveDisabled(page), 'Save is disabled until something changed');
    check((await count(page, '[data-access-review]')) === 0 && (await count(page, '[data-access-outside]')) === 0, 'no review banner, and no outside-view note for the Owner');
    check(((await count(page, '[data-access-search]')) > 0) === agents.length > 6, `the filter is shown above six agents only (${agents.length} agents)`);
    await page.locator('[data-access-card]').scrollIntoViewIfNeeded();
    await shot(page, `owner-editor-open-${width}`);

    // Deny one agent: the sentence moves before saving.
    await choose(page, AGENTS.a, 'denied');
    check((await valueOf(page, AGENTS.a)) === 'denied', 'choosing Denied marks the row');
    check((await outcomeKind(page)) === 'all_except' && (await textOf(page, '[data-access-outcome]')) === SENTENCES.one_denied, `before saving, the outcome reads "${await textOf(page, '[data-access-outcome]')}"`);
    check((await count(page, '[data-access-pending]')) === 1 && !(await saveDisabled(page)), 'it is marked as not saved yet, and Save is enabled');
    check(puts.length === 0, 'nothing was sent yet');
    await page.locator('[data-access-card]').scrollIntoViewIfNeeded();
    await shot(page, `owner-editor-pending-${width}`);
    await saveAndSettle(page);
    let stored = await accessOf(ids.user2);
    check(sorted(stored.denied) === AGENTS.a.id && stored.allowed.length === 0 && stored.outcome.kind === 'all_except', `saved: ${AGENTS.a.name} is denied (${stored.outcome.kind})`);
    check(puts.length === 1 && puts[0].version === startVersion && puts[0].confirmOpen === undefined, 'one PUT, the whole view, with the version it was read with');
    check((await saveDisabled(page)) && (await count(page, '[data-access-pending]')) === 0, 'Save is disabled again');

    // Allow one agent: the account is limited to it. No confirmation: nothing opens.
    await choose(page, AGENTS.b, 'allowed');
    check((await outcomeKind(page)) === 'only' && (await textOf(page, '[data-access-outcome]')) === SENTENCES.only_one, `allowing one agent: "${await textOf(page, '[data-access-outcome]')}"`);
    await saveAndSettle(page);
    check((await count(page, '[data-access-confirm]')) === 0, 'limiting an account asks for no confirmation');
    stored = await accessOf(ids.user2);
    check(sorted(stored.allowed) === AGENTS.b.id && sorted(stored.denied) === AGENTS.a.id && stored.outcome.kind === 'only', `saved: only ${AGENTS.b.name}, ${AGENTS.a.name} still denied`);
    const reached = (await api('/agents', { as: USER2 })).body.map((a) => a.name).join(',');
    check(reached === AGENTS.b.name, `the second User now reads only ${AGENTS.b.name} from GET /agents (${reached})`);
    await page.locator('[data-access-card]').scrollIntoViewIfNeeded();
    await shot(page, `owner-editor-limited-${width}`);

    // The list moves with it.
    await page.goto(`${ADMIN}/users`, { waitUntil: 'networkidle' });
    await page.locator('[data-user-access]').first().waitFor({ state: 'attached', timeout: 15000 });
    check((await markOf(USER2)) === 'only' && (await badgesOf(USER2)) === 'Restricted', `the list now marks the second User "Restricted" ("${await badgesOf(USER2)}")`);

    // Opening the account again is confirmed before anything is sent.
    await openUser(page, ids.user2);
    const before = puts.length;
    await choose(page, AGENTS.b, 'none');
    check((await outcomeKind(page)) === 'all_except', 'taking the last allowed agent away would open the account');
    await page.locator('[data-access-save]').click();
    await page.locator('[data-access-confirm]').waitFor({ state: 'visible', timeout: 10000 });
    check((await textOf(page, '[data-access-confirm]')).includes(CONFIRM_TEXT), `the confirmation reads "${CONFIRM_TEXT}"`);
    check(puts.length === before, 'and it is asked before any request is sent');
    await sleep(400);
    await shot(page, `owner-editor-confirm-${width}`);
    await page.locator('[data-access-confirm-cancel]').click();
    await page.locator('[data-access-confirm]').waitFor({ state: 'detached', timeout: 10000 });
    stored = await accessOf(ids.user2);
    check(stored.outcome.kind === 'only' && puts.length === before, 'Cancel saves nothing');
    check((await valueOf(page, AGENTS.b)) === 'none' && !(await saveDisabled(page)), 'and the choice is still selected');
    await page.locator('[data-access-save]').click();
    await page.locator('[data-access-confirm]').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('[data-access-confirm-accept]').click();
    await until(async () => (await count(page, '[data-access-changed]')) === 0 && (await saveDisabled(page)) && (await page.locator('[data-access-save]').innerText()).trim() === 'Save access', { timeout: 10000 });
    stored = await accessOf(ids.user2);
    check(stored.outcome.kind === 'all_except' && stored.allowed.length === 0 && puts.at(-1)?.confirmOpen === true, `confirmed: the account is open again (${stored.outcome.kind}), sent with confirmOpen`);
    check((await textOf(page, '[data-access-outcome]')) === SENTENCES.one_denied, `the editor reads "${await textOf(page, '[data-access-outcome]')}"`);

    // Somebody else saves first: the editor's version is stale.
    const behind = await putAccess(ids.user2, { allowed: [], denied: [AGENTS.a.id, AGENTS.c.id], version: stored.version });
    check(behind.status === 200, `behind the editor's back, ${AGENTS.c.name} is denied through the API`);
    await choose(page, AGENTS.b, 'denied');
    await saveAndSettle(page);
    check((await count(page, '[data-access-error="ACCESS_CHANGED"]')) === 1, 'the save is refused: ACCESS_CHANGED');
    check((await textOf(page, '[data-access-error]')) === CHANGED_TEXT, `the server's sentence, as received: "${await textOf(page, '[data-access-error]')}"`);
    await page.locator('[data-access-reloaded]').waitFor({ state: 'visible', timeout: 10000 });
    check((await valueOf(page, AGENTS.c)) === 'denied', `the lists were read again: ${AGENTS.c.name} now shows Denied`);
    check((await valueOf(page, AGENTS.b)) === 'denied' && (await row(page, AGENTS.b).getAttribute('data-access-changed')) !== null, `the person's own choice on ${AGENTS.b.name} is still selected, and still pending`);
    check((await textOf(page, '[data-access-reloaded]')).startsWith('Someone else changed this access.'), 'and the editor says the access changed');
    stored = await accessOf(ids.user2);
    check(sorted(stored.denied) === sorted([AGENTS.a.id, AGENTS.c.id]), 'nothing was saved over the other change');
    await page.locator('[data-access-card]').scrollIntoViewIfNeeded();
    await shot(page, `owner-editor-changed-${width}`);
    await saveAndSettle(page);
    stored = await accessOf(ids.user2);
    check(sorted(stored.denied) === sorted([AGENTS.a.id, AGENTS.b.id, AGENTS.c.id]) && (await count(page, '[data-access-error]')) === 0, 'saving again applies the choice on top of the other change');

    // Accounts with no access to edit: one line, and no request to refuse.
    await openUser(page, ids.owner);
    check((await count(page, '[data-access-managed="owner"]')) === 1 && (await count(page, '[data-access-row]')) === 0, `the Owner's own account shows one line: "${await textOf(page, '[data-access-managed]')}"`);
    await page.locator('[data-access-card]').scrollIntoViewIfNeeded();
    await shot(page, `owner-editor-owner-account-${width}`);
    await openUser(page, ids.admin);
    check((await count(page, '[data-access-row]')) === agents.length && (await outcomeKind(page)) === 'only', 'the Owner edits an Admin: the editor is there, with the Admin’s two allowed agents');
    check((await valueOf(page, AGENTS.a)) === 'allowed' && (await valueOf(page, AGENTS.b)) === 'allowed' && (await valueOf(page, AGENTS.c)) === 'none', 'its rows show what is stored');

    check(problems.length === 0, `no console error, no unexpected failed request${problems.length ? `: ${problems.join(' | ')}` : ''}`);
    await context.close();
  }

  // ------------------------------------------------------- from the script
  section('From the script: the refusals the screen does not provoke');
  {
    check(await restore(), 'the second User is back at the seeded access');
    let view = await accessOf(ids.user2);
    let res = await putAccess(ids.user2, { allowed: [AGENTS.a.id], denied: [AGENTS.a.id], version: view.version });
    check(res.status === 400 && res.raw?.code === 'ACCESS_LISTS_OVERLAP', `an agent on both lists: 400 ACCESS_LISTS_OVERLAP (${res.status} ${res.raw?.code})`);
    res = await putAccess(ids.owner, { allowed: [], denied: [AGENTS.a.id], version: null });
    check(res.status === 403 && res.raw?.code === 'ACCESS_NOT_EDITABLE', `the Owner's account: 403 ACCESS_NOT_EDITABLE (${res.status} ${res.raw?.code})`);
    res = await putAccess(ids.user2, { allowed: [AGENTS.a.id], denied: [], version: view.version });
    check(res.status === 200, 'limited to one agent');
    view = res.body;
    res = await putAccess(ids.user2, { allowed: [], denied: [], version: view.version });
    check(
      res.status === 409 && res.raw?.code === 'ACCESS_OPEN_NEEDS_CONFIRM' && res.raw?.outcome?.kind === 'all',
      `opening it without confirmOpen: 409 ACCESS_OPEN_NEEDS_CONFIRM with the outcome (${res.status} ${res.raw?.code} ${res.raw?.outcome?.kind})`,
    );
    check((await accessOf(ids.user2)).outcome.kind === 'only', 'and nothing was saved');
  }
} finally {
  await browser.close();
  const back = await restore(found).catch(() => false);
  check(back, 'the second User’s access is put back exactly as this run found it');
}

done('owner-editor');
