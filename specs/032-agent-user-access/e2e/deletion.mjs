// The last allowed agent of an account is deleted (CLEAN-231, User Story 1
// of spec 032: FR-006, FR-020, FR-022).
//
//   node specs/032-agent-user-access/e2e/deletion.mjs
//
// An account limited to one agent does not become an open one when that
// agent is deleted: it reaches no agents and is marked "Needs review", on
// the list and in the editor, until somebody chooses. Both ways out are
// driven here: allowing another agent, and opening the account (which is
// confirmed). While the throwaway agents exist there are more than six, so
// the editor's filter is on screen and is checked too.
//
// The throwaway agents are written directly, as seed.mjs writes its
// fixtures, and removed at the end; the account edited is the second User,
// and its access is put back through the API, whatever happened.
//
// Runs at 390 px and 1440 px. Fails on any console error and any failed
// request (none is expected).
//
// Needs: API :3333 (after seed.mjs), admin :3001.
import {
  ADMIN,
  AGENTS,
  OWNER,
  TEMPLATE,
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

process.env.DATABASE_URL = apiEnv.DATABASE_URL;
const { PrismaClient } = requireFromApi('@prisma/client');
const prisma = new PrismaClient();

const REVIEW_TEXT = 'The last allowed agent was deleted. This account reaches no agents until you choose.';
const CONFIRM_TEXT = 'This account will reach every agent that is not denied.';
const THROWAWAY = 'access-throwaway-';
/** Agents made only so that the editor has more than six rows. */
const PADDING = 'access-padding-';

const users = (await api('/users', { as: OWNER })).body;
const user2 = users.find((u) => u.email === USER2.email).id;

const accessOf = async () => (await api(`/users/${user2}/agent-access`, { as: OWNER })).body;
const putAccess = (body) => api(`/users/${user2}/agent-access`, { method: 'PUT', as: OWNER, body });
const sorted = (list) => [...(list ?? [])].sort().join(',');
/** The second User's access as seed.mjs leaves it: open, no entries. Restored at the end. */
const baseline = { allowed: [], denied: [], outcome: { kind: 'all' } };
/** What this run found on that account: put back exactly, at the end. */
const found = await accessOf();

async function restore(to = baseline) {
  const now = await accessOf();
  if (sorted(now.allowed) === sorted(to.allowed) && sorted(now.denied) === sorted(to.denied) && now.outcome.kind === to.outcome.kind) return true;
  const res = await putAccess({ allowed: to.allowed, denied: to.denied, version: now.version, confirmOpen: true });
  return res.status === 200;
}

const template = await prisma.template.findUnique({ where: { name: TEMPLATE.name } });
const made = [];
async function throwaway(label) {
  const agent = await prisma.agent.create({
    data: {
      id: `agent-${crypto.randomUUID()}`,
      name: `${THROWAWAY}${label}`,
      templateId: template.id,
      status: 'stopped',
      config: {},
      resources: { cpu: '500m', memory: '512Mi' },
    },
  });
  made.push(agent.id);
  return agent;
}

const count = (page, selector) => page.locator(selector).count();
const textOf = async (page, selector) =>
  ((await page.locator(selector).first().textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
const outcomeKind = (page) => page.locator('[data-access-outcome]').first().getAttribute('data-access-outcome');

async function openEditor(page) {
  await page.goto(`${ADMIN}/users/${user2}`, { waitUntil: 'networkidle' });
  await page.locator('[data-access-card]').waitFor({ state: 'visible', timeout: 15000 });
  await until(async () => (await count(page, '[data-access-row]')) > 0, { timeout: 15000 });
  await sleep(300);
}

async function listMark(page) {
  await page.goto(`${ADMIN}/users`, { waitUntil: 'networkidle' });
  await page.locator('[data-user-access]').first().waitFor({ state: 'attached', timeout: 15000 });
  const mark = page.locator('tr', { hasText: USER2.email }).locator('[data-user-access]');
  return { kind: await mark.getAttribute('data-user-access'), text: (await mark.innerText()).replace(/\s+/g, ' ').trim() };
}

const browser = await launch();
try {
  for (const width of WIDTHS) {
    const height = width < 600 ? 844 : 900;
    section(`Admin console, ${width} px, as the Owner`);
    check(await restore(), 'the second User starts open, as seed.mjs leaves it');
    const first = await throwaway(`${width}-one`);
    const second = await throwaway(`${width}-two`);
    // The editor has a row per agent of the lists, and the filter above six
    // of them. The Ranch admin agent is not one (CLEAN-240), so the seeded
    // three and the two above are five: enough more are made to pass six,
    // and removed once the filter was looked at.
    const listed = async () => (await api('/agents', { as: OWNER })).body.filter((a) => !a.isAdmin).length;
    for (let n = 1; (await listed()) <= 6; n += 1) {
      await prisma.agent.create({
        data: { id: `agent-${crypto.randomUUID()}`, name: `${PADDING}${width}-${n}`, templateId: template.id, status: 'stopped', config: {}, resources: { cpu: '500m', memory: '512Mi' } },
      });
    }
    const total = await listed();

    let view = await accessOf();
    let res = await putAccess({ allowed: [first.id], denied: [], version: view.version });
    check(res.status === 200 && res.body?.outcome?.kind === 'only', `the second User is limited to ${first.name}`);

    const { context, page, problems } = await watchedPage(browser, { width, height });
    await loginAs(page, OWNER, ADMIN);
    await openEditor(page);
    check((await outcomeKind(page)) === 'only' && (await textOf(page, '[data-access-outcome]')) === 'Reaches only these 1', `outcome: "${await textOf(page, '[data-access-outcome]')}"`);
    check((await count(page, '[data-access-review]')) === 0, 'no review banner while the allowed agent exists');

    // More than six agents: the filter.
    check(total > 6 && (await count(page, '[data-access-search]')) === 1 && (await count(page, '[data-access-row]')) === total, `with ${total} agents of the lists, a row each, the filter is shown`);
    await page.locator('[data-access-search]').fill(THROWAWAY);
    await until(async () => (await count(page, '[data-access-row]')) === 2, { timeout: 5000 });
    const shown = await page.locator('[data-access-row] [data-access-name]').allTextContents();
    check(shown.length === 2 && shown.every((n) => n.startsWith(THROWAWAY)), `typing "${THROWAWAY}" leaves the matching rows (${shown.join(', ')})`);
    await prisma.agent.deleteMany({ where: { name: { startsWith: PADDING } } });
    await page.locator('[data-access-card]').scrollIntoViewIfNeeded();
    await shot(page, `deletion-filter-${width}`);
    await page.locator('[data-access-search]').fill('no such agent');
    await until(async () => (await count(page, '[data-access-row]')) === 0, { timeout: 5000 });
    check((await count(page, '[data-access-row]')) === 0 && /No agent matches/.test(await textOf(page, '[data-access-rows]')), 'a filter that matches nothing says so');
    await page.locator('[data-access-search]').fill('');
    await until(async () => (await count(page, '[data-access-row]')) === total, { timeout: 5000 });
    check((await count(page, '[data-access-row]')) === total, 'clearing it brings every row back');

    // ------------------------------------------ the allowed agent is deleted
    res = await api(`/agents/${first.id}`, { method: 'DELETE', as: OWNER });
    check(res.status < 300, `${first.name} is deleted (${res.status})`);
    view = await accessOf();
    check(view.outcome.kind === 'none' && view.needsReview === true && view.allowed.length === 0, `the account did not open: ${view.outcome.kind}, needs review`);
    const reached = (await api('/agents', { as: USER2 })).body;
    // The assistant is no agent of the lists (CLEAN-240): it stays, by its
    // own switch, whatever the lists hold.
    check(
      Array.isArray(reached) && reached.filter((a) => !a.isAdmin).length === 0 && reached.length === 1 && reached[0].id === AGENTS.ranch.id,
      `the second User reads no agent of the lists from GET /agents, only the assistant (${reached.length})`,
    );

    let mark = await listMark(page);
    check(mark.kind === 'none' && mark.text === 'Restricted Needs review', `the list marks it "Restricted" and "Needs review" (${mark.kind}: "${mark.text}")`);
    await shot(page, `deletion-list-${width}`);

    await openEditor(page);
    check((await count(page, '[data-access-review]')) === 1 && (await textOf(page, '[data-access-review]')).startsWith(REVIEW_TEXT), `the review banner reads "${REVIEW_TEXT}"`);
    check((await outcomeKind(page)) === 'none' && (await textOf(page, '[data-access-outcome]')) === 'Reaches no agents — needs review', `outcome: "${await textOf(page, '[data-access-outcome]')}"`);
    check((await count(page, `[data-access-row="${first.id}"]`)) === 0, 'the deleted agent has no row');
    check(await page.locator('[data-access-save]').isDisabled(), 'Save is disabled: nothing was chosen yet');
    await page.locator('[data-access-card]').scrollIntoViewIfNeeded();
    await shot(page, `deletion-review-${width}`);

    // Way out 1: allow another agent. Nothing opens, nothing to confirm.
    await page.locator(`[data-access-row="${AGENTS.b.id}"] [data-access-choice="allowed"]`).click();
    check((await outcomeKind(page)) === 'only', 'allowing an agent: the outcome reads "only" before saving');
    await page.locator('[data-access-save]').click();
    await until(async () => (await count(page, '[data-access-review]')) === 0 && (await page.locator('[data-access-save]').isDisabled()) && (await page.locator('[data-access-save]').innerText()).trim() === 'Save access', { timeout: 10000 });
    check((await count(page, '[data-access-confirm]')) === 0 && (await count(page, '[data-access-error]')) === 0, 'saved without a confirmation and without a refusal');
    view = await accessOf();
    check(view.outcome.kind === 'only' && sorted(view.allowed) === AGENTS.b.id && view.needsReview === false, `the account reaches only ${AGENTS.b.name}, and no longer needs review`);
    check((await count(page, '[data-access-review]')) === 0, 'the banner is gone');
    mark = await listMark(page);
    check(mark.kind === 'only' && mark.text === 'Restricted', `the list marks it "Restricted" only ("${mark.text}")`);

    // Way out 2: open the account, which is confirmed.
    res = await putAccess({ allowed: [second.id], denied: [], version: view.version });
    check(res.status === 200, `limited to ${second.name} instead`);
    res = await api(`/agents/${second.id}`, { method: 'DELETE', as: OWNER });
    check(res.status < 300 && (await accessOf()).needsReview === true, `${second.name} is deleted: needs review again`);
    await openEditor(page);
    check((await count(page, '[data-access-review]')) === 1 && (await count(page, '[data-access-open]')) === 1, 'the banner offers to let the account reach every agent');
    await page.locator('[data-access-open]').click();
    await page.locator('[data-access-confirm]').waitFor({ state: 'visible', timeout: 10000 });
    check((await textOf(page, '[data-access-confirm]')).includes(CONFIRM_TEXT), `which is confirmed first: "${CONFIRM_TEXT}"`);
    check((await accessOf()).outcome.kind === 'none', 'nothing is saved before the confirmation');
    await sleep(400);
    await shot(page, `deletion-confirm-${width}`);
    await page.locator('[data-access-confirm-accept]').click();
    await until(async () => (await count(page, '[data-access-review]')) === 0, { timeout: 10000 });
    view = await accessOf();
    check(view.outcome.kind === 'all' && view.needsReview === false, `confirmed: the account reaches every agent (${view.outcome.kind})`);
    check((await outcomeKind(page)) === 'all' && (await count(page, '[data-access-error]')) === 0, 'and the editor says so');
    mark = await listMark(page);
    check(mark.kind === 'all' && mark.text === '', 'the list shows no mark');

    check(problems.length === 0, `no console error, no failed request${problems.length ? `: ${problems.join(' | ')}` : ''}`);
    await context.close();
  }
} finally {
  await browser.close();
  const back = await restore(found).catch(() => false);
  check(back, 'the second User’s access is put back exactly as this run found it');
  const left = await prisma.agent.deleteMany({ where: { id: { in: made } } }).catch(() => null);
  await prisma.agent.deleteMany({ where: { name: { startsWith: PADDING } } }).catch(() => undefined);
  check(left !== null && (await prisma.agent.count({ where: { name: { startsWith: THROWAWAY } } })) === 0, 'no throwaway agent is left behind');
  await prisma.$disconnect();
}

done('deletion');
