// An Admin edits a User's agent access, and never gives more than the Admin
// has (CLEAN-231, User Story 2 of spec 032: FR-013 to FR-019).
//
//   node specs/032-agent-user-access/e2e/ceiling.mjs
//
// The seeded Admin reaches access-alpha and access-bravo only. In the admin
// console, as that Admin: the editor of a User has a row for those two and
// for nothing else, says that the account also has access the Admin cannot
// manage, saves a denial without touching what lies outside the Admin's
// view, and shows the server's refusal when a change would open agents the
// Admin does not have. The Admin's own account and the Owner's show one line
// instead of the editor, and no request is sent that the API would refuse.
//
// Then requests made by hand as the Admin, naming access-charlie, which is
// outside the Admin's view: the ceiling is the server's, not the screen's.
//
// Every edit is made on the second User, and its access is put back through
// the API at the end, whatever happened. The first User is only looked at.
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
  TEMPLATE,
  USER,
  USER2,
  WIDTHS,
  api,
  apiEnv,
  check,
  done,
  launch,
  loginAs,
  requireFromApi,
  section,
  shot,
  sleep,
  until,
  watchedPage,
} from './lib.mjs';

/**
 * Failed requests this scenario expects, and why: the Admin confirms a change
 * that would open the account to agents the Admin does not reach, and the
 * API answers that one PUT 409 ACCESS_EXCEEDS_CEILING. And the seeded Admin
 * does not reach the Ranch admin agent: the console asks which agent that is
 * on every page load and the API answers 404, which the agent store reads as
 * "hidden" (agent.gateway.ts, findAdmin).
 */
const EXPECTED = [
  { status: 409, url: /\/users\/[^/]+\/agent-access$/ },
  { status: 404, url: /\/agents\/admin\/current$/ },
];

const OUTSIDE_TEXT = 'This account also has access you cannot manage.';
const CEILING_TEXT = 'This would open agents you do not have. Ask the Owner.';

const users = (await api('/users', { as: OWNER })).body;
const idOf = (who) => users.find((u) => u.email === who.email)?.id;
const ids = { owner: idOf(OWNER), admin: idOf(ADMIN_USER), user: idOf(USER), user2: idOf(USER2) };
const path = (userId) => `/users/${userId}/agent-access`;

const accessOf = async (userId, as = OWNER) => (await api(path(userId), { as })).body;
const put = (userId, as, body) => api(path(userId), { method: 'PUT', as, body });
const sorted = (list) => [...(list ?? [])].sort().join(',');
/** The second User's access as seed.mjs leaves it: open, no entries. Restored at the end. */
const baseline = { allowed: [], denied: [], outcome: { kind: 'all' } };
/** What this run found on that account: put back exactly, at the end. */
const found = await accessOf(ids.user2);

async function restore(to = baseline) {
  const now = await accessOf(ids.user2);
  if (sorted(now.allowed) === sorted(to.allowed) && sorted(now.denied) === sorted(to.denied) && now.outcome.kind === to.outcome.kind) return true;
  const res = await put(ids.user2, OWNER, { allowed: to.allowed, denied: to.denied, version: now.version, confirmOpen: true });
  return res.status === 200;
}

/** The second User's lists, set by the Owner. */
async function ownerSets(allowed, denied) {
  const now = await accessOf(ids.user2);
  return put(ids.user2, OWNER, { allowed, denied, version: now.version, confirmOpen: true });
}

const count = (page, selector) => page.locator(selector).count();
const textOf = async (page, selector) =>
  ((await page.locator(selector).first().textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
const row = (page, agent) => page.locator(`[data-access-row="${agent.id}"]`);
const valueOf = (page, agent) => row(page, agent).getAttribute('data-access-value');
const outcomeKind = (page) => page.locator('[data-access-outcome]').first().getAttribute('data-access-outcome');

async function openUser(page, userId) {
  await page.goto(`${ADMIN}/users/${userId}`, { waitUntil: 'networkidle' });
  await page.locator('[data-access-card]').waitFor({ state: 'visible', timeout: 15000 });
  await until(async () => (await count(page, '[data-access-row], [data-access-managed], [data-access-error], [data-access-empty]')) > 0, {
    timeout: 15000,
  });
  await sleep(300);
}

const browser = await launch();
try {
  // The agents of the lists. The Ranch admin agent is on nobody's list since
  // CLEAN-240: the Admin has it as their assistant, by its own switch, and
  // the ceiling does not count it.
  const reachedByAdmin = (await api('/agents', { as: ADMIN_USER })).body;
  const view = reachedByAdmin.filter((a) => !a.isAdmin).map((a) => a.id);
  section('The fixture');
  check(sorted(view) === sorted([AGENTS.a.id, AGENTS.b.id]), `the Admin reaches ${AGENTS.a.name} and ${AGENTS.b.name} only, of the agents of the lists (${view.length} agents)`);
  check(
    reachedByAdmin.filter((a) => a.isAdmin).map((a) => a.id).join() === AGENTS.ranch.id,
    'and the Ranch admin agent as their assistant, which no list governs',
  );

  for (const width of WIDTHS) {
    const height = width < 600 ? 844 : 900;
    section(`Admin console, ${width} px, as the restricted Admin`);
    check(await restore(), 'the second User starts open, as seed.mjs leaves it');
    // Something outside the Admin's view, to be carried over untouched.
    check((await ownerSets([], [AGENTS.c.id])).status === 200, `the Owner denies the second User ${AGENTS.c.name}, which the Admin cannot see`);

    const { context, page, problems } = await watchedPage(browser, { width, height, expected: EXPECTED });
    const refused = [];
    page.on('response', (res) => {
      if (res.status() >= 400 && /\/agent-access$/.test(res.url())) refused.push(res.status());
    });
    await loginAs(page, ADMIN_USER, ADMIN);

    // ------------------------------------------- only reached agents as rows
    await openUser(page, ids.user2);
    const rows = await page.locator('[data-access-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-access-row')));
    check(sorted(rows) === sorted([AGENTS.a.id, AGENTS.b.id]), `the editor has a row for the two agents the Admin reaches, and no other (${rows.length} rows)`);
    const cardText = await textOf(page, '[data-access-card]');
    check(![AGENTS.c.name, AGENTS.ranch.name, 'local-agent'].some((n) => cardText.includes(n)), 'no agent outside the Admin’s view is named anywhere in the card');
    check((await count(page, '[data-access-outside]')) === 1 && (await textOf(page, '[data-access-outside]')) === OUTSIDE_TEXT, `the outside-view note reads "${await textOf(page, '[data-access-outside]')}"`);
    check((await outcomeKind(page)) === 'all_except' && (await textOf(page, '[data-access-outcome]')) === 'Reaches every agent you can see', `the outcome counts only what the Admin may see: "${await textOf(page, '[data-access-outcome]')}"`);
    await page.locator('[data-access-card]').scrollIntoViewIfNeeded();
    await shot(page, `ceiling-admin-editor-${width}`);

    // A denial inside the view; what is outside it stays.
    await row(page, AGENTS.b).locator('[data-access-choice="denied"]').click();
    await page.locator('[data-access-save]').click();
    await until(async () => (await count(page, '[data-access-changed]')) === 0 && (await page.locator('[data-access-save]').isDisabled()) && (await page.locator('[data-access-save]').innerText()).trim() === 'Save access', { timeout: 10000 });
    let stored = await accessOf(ids.user2);
    check(sorted(stored.denied) === sorted([AGENTS.b.id, AGENTS.c.id]) && stored.allowed.length === 0, `saved: ${AGENTS.b.name} is denied, and the denial of ${AGENTS.c.name} is carried over`);
    check((await count(page, '[data-access-error]')) === 0 && (await textOf(page, '[data-access-outcome]')) === 'Reaches every agent except 1', `the editor reads "${await textOf(page, '[data-access-outcome]')}"`);

    // ----------------------------------------------------------- the ceiling
    check((await ownerSets([AGENTS.a.id], [])).status === 200, `the Owner limits the second User to ${AGENTS.a.name}`);
    await openUser(page, ids.user2);
    check((await outcomeKind(page)) === 'only' && (await valueOf(page, AGENTS.a)) === 'allowed', `the Admin sees it: "${await textOf(page, '[data-access-outcome]')}"`);
    await row(page, AGENTS.a).locator('[data-access-choice="none"]').click();
    await page.locator('[data-access-save]').click();
    await page.locator('[data-access-confirm]').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('[data-access-confirm-accept]').click();
    await page.locator('[data-access-error]').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('[data-access-confirm]').waitFor({ state: 'detached', timeout: 10000 });
    check((await count(page, '[data-access-error="ACCESS_EXCEEDS_CEILING"]')) === 1, 'taking the last allowed agent away would open agents the Admin does not have: ACCESS_EXCEEDS_CEILING');
    check((await textOf(page, '[data-access-error]')) === CEILING_TEXT, `the server's sentence, as received: "${await textOf(page, '[data-access-error]')}"`);
    check((await valueOf(page, AGENTS.a)) === 'none' && (await row(page, AGENTS.a).getAttribute('data-access-changed')) !== null, 'the refused choice is still selected, still pending');
    stored = await accessOf(ids.user2);
    check(stored.outcome.kind === 'only' && sorted(stored.allowed) === AGENTS.a.id, 'and nothing was saved');
    check(refused.join() === '409', `one refused request, the 409 (${refused.join() || 'none'})`);
    await page.locator('[data-access-card]').scrollIntoViewIfNeeded();
    await shot(page, `ceiling-admin-refused-${width}`);

    // Moving the account inside the Admin's reach is the Admin's to do.
    await page.locator('[data-access-discard]').click();
    check((await count(page, '[data-access-error]')) === 0 && (await valueOf(page, AGENTS.a)) === 'allowed', 'Discard puts the rows back and clears the refusal');
    await row(page, AGENTS.b).locator('[data-access-choice="allowed"]').click();
    await page.locator('[data-access-save]').click();
    await until(async () => (await count(page, '[data-access-changed]')) === 0 && (await page.locator('[data-access-save]').isDisabled()) && (await page.locator('[data-access-save]').innerText()).trim() === 'Save access', { timeout: 10000 });
    stored = await accessOf(ids.user2);
    check(sorted(stored.allowed) === sorted([AGENTS.a.id, AGENTS.b.id]), `allowing ${AGENTS.b.name}, which the Admin has, is saved`);

    // ------------------------------------- the first User, only looked at
    await openUser(page, ids.user);
    check((await valueOf(page, AGENTS.a)) === 'denied' && (await valueOf(page, AGENTS.b)) === 'none', `the first User: ${AGENTS.a.name} shows Denied`);
    check((await textOf(page, '[data-access-outcome]')) === 'Reaches every agent except 1' && (await count(page, '[data-access-outside]')) === 1, 'with the outcome and the outside-view note');

    // ------------------------------- accounts the Admin may not edit: a line
    await openUser(page, ids.admin);
    check((await count(page, '[data-access-managed="self"]')) === 1 && (await count(page, '[data-access-row]')) === 0, `the Admin's own account: "${await textOf(page, '[data-access-managed]')}"`);
    await page.locator('[data-access-card]').scrollIntoViewIfNeeded();
    await shot(page, `ceiling-admin-own-account-${width}`);
    await openUser(page, ids.owner);
    check((await count(page, '[data-access-managed="owner"]')) === 1 && (await count(page, '[data-access-row]')) === 0, `the Owner's account: "${await textOf(page, '[data-access-managed]')}"`);
    check(refused.join() === '409', 'and no request was sent for either that the API would refuse');

    check(problems.length === 0, `no console error, no unexpected failed request${problems.length ? `: ${problems.join(' | ')}` : ''}`);
    await context.close();
  }

  // ------------------------------------------------------- from the script
  section(`By hand, as the Admin: ${AGENTS.c.name} is outside the Admin's view`);
  {
    check((await ownerSets([AGENTS.a.id], [AGENTS.c.id])).status === 200, `the second User: only ${AGENTS.a.name}, and ${AGENTS.c.name} denied by the Owner`);
    const before = await accessOf(ids.user2);
    const seen = await accessOf(ids.user2, ADMIN_USER);
    check(
      sorted(seen.allowed) === AGENTS.a.id && seen.denied.length === 0 && seen.hasEntriesOutsideView === true && !JSON.stringify(seen).includes(AGENTS.c.id),
      'GET as the Admin: the entry outside the view is not returned, only that there is one',
    );
    const unchanged = async () => {
      const now = await accessOf(ids.user2);
      return now.version === before.version && sorted(now.allowed) === sorted(before.allowed) && sorted(now.denied) === sorted(before.denied);
    };

    let res = await put(ids.user2, ADMIN_USER, { allowed: [AGENTS.a.id, AGENTS.c.id], denied: [], version: seen.version });
    check(res.status === 404 && res.raw?.message === 'Agent not found', `PUT allowing ${AGENTS.c.name}: 404 Agent not found (${res.status} ${res.raw?.message})`);
    check(await unchanged(), 'nothing was saved');
    res = await put(ids.user2, ADMIN_USER, { allowed: [AGENTS.a.id], denied: [AGENTS.c.id], version: seen.version });
    check(res.status === 404 && res.raw?.message === 'Agent not found', `PUT denying ${AGENTS.c.name}: 404 Agent not found, the same answer as for an agent that does not exist (${res.status})`);
    res = await put(ids.user2, ADMIN_USER, { allowed: [AGENTS.a.id], denied: ['agent-00000032-0000-4000-8000-0000000000ee'], version: seen.version });
    check(res.status === 404 && res.raw?.message === 'Agent not found', `PUT naming an agent that does not exist: 404 Agent not found (${res.status})`);
    check(await unchanged(), 'nothing was saved');

    // "Open" hands the second User every agent that is not denied for them.
    // What made that more than the Admin has used to be the Ranch admin
    // agent; no list governs it since CLEAN-240 and the ceiling no longer
    // counts it. An ordinary agent outside the Admin's reach is what the
    // ceiling is about: one is made here, as the fixtures are, and removed.
    process.env.DATABASE_URL = apiEnv.DATABASE_URL;
    const { PrismaClient } = requireFromApi('@prisma/client');
    const prisma = new PrismaClient();
    const template = await prisma.template.findUnique({ where: { name: TEMPLATE.name } });
    const delta = await prisma.agent.create({
      data: { id: `agent-${crypto.randomUUID()}`, name: 'access-delta', templateId: template.id, status: 'stopped', config: {}, resources: { cpu: '500m', memory: '512Mi' } },
    });
    try {
      check((await api(`/agents/${delta.id}`, { as: ADMIN_USER })).status === 404, 'an agent the Admin does not reach exists: access-delta (404 for them)');
      res = await put(ids.user2, ADMIN_USER, { allowed: [], denied: [], version: seen.version, confirmOpen: true });
      check(
        res.status === 409 && res.raw?.code === 'ACCESS_EXCEEDS_CEILING' && res.raw?.message === CEILING_TEXT,
        `PUT emptying the lists with confirmOpen, which would open ${AGENTS.b.name} and an agent the Admin does not have: 409 ACCESS_EXCEEDS_CEILING (${res.status} ${res.raw?.code})`,
      );
      check(!JSON.stringify(res.raw).includes(delta.id) && !JSON.stringify(res.raw).includes('access-delta'), 'the refusal does not name that agent');
    } finally {
      await prisma.agent.deleteMany({ where: { name: 'access-delta' } });
      await prisma.$disconnect();
    }
    check(!JSON.stringify(res.raw).includes(AGENTS.c.id) && !JSON.stringify(res.raw).includes(AGENTS.c.name), 'the refusal names no agent outside the view');
    check(await unchanged(), 'nothing was saved');

    res = await put(ids.admin, ADMIN_USER, { allowed: [], denied: [], version: null, confirmOpen: true });
    check(res.status === 403 && res.raw?.code === 'ACCESS_NOT_EDITABLE', `PUT on the Admin's own account: 403 ACCESS_NOT_EDITABLE (${res.status} ${res.raw?.code})`);
    res = await put(ids.owner, ADMIN_USER, { allowed: [], denied: [AGENTS.a.id], version: null });
    check(res.status === 403 && res.raw?.code === 'ACCESS_NOT_EDITABLE', `PUT on the Owner's account: 403 ACCESS_NOT_EDITABLE (${res.status} ${res.raw?.code})`);
    res = await api(path(ids.admin), { as: ADMIN_USER });
    check(res.status === 403 && res.raw?.code === 'ACCESS_NOT_EDITABLE', `GET of the Admin's own access: 403 ACCESS_NOT_EDITABLE (${res.status})`);
    res = await api(path(ids.user2), { as: USER2 });
    check(res.status === 403, `GET as a User, of their own access: 403 (${res.status})`);
    res = await put(ids.user2, USER2, { allowed: [], denied: [], version: seen.version, confirmOpen: true });
    check(res.status === 403, `PUT as a User, on their own access: 403 (${res.status})`);
    const adminAfter = await accessOf(ids.admin);
    check(sorted(adminAfter.allowed) === sorted([AGENTS.a.id, AGENTS.b.id]) && adminAfter.outcome.kind === 'only', 'the Admin is still limited to the two seeded agents');
    check(await unchanged(), 'and the second User’s access is exactly as it was before the hand-made requests');

    // Inside the view the Admin's change goes through, and the hidden entry stays.
    res = await put(ids.user2, ADMIN_USER, { allowed: [AGENTS.a.id], denied: [AGENTS.b.id], version: seen.version });
    const after = await accessOf(ids.user2);
    check(res.status === 200 && sorted(after.denied) === sorted([AGENTS.b.id, AGENTS.c.id]) && sorted(after.allowed) === AGENTS.a.id, `PUT denying ${AGENTS.b.name}: saved, and the Owner's denial of ${AGENTS.c.name} is still there`);
  }
} finally {
  await browser.close();
  const back = await restore(found).catch(() => false);
  check(back, 'the second User’s access is put back exactly as this run found it');
}

done('ceiling');
