// The pages of both consoles on the Ranch assistant, for a person who is not
// the Owner (CLEAN-269).
//
//   node specs/032-agent-user-access/e2e/assistant-pages.mjs
//   node specs/032-agent-user-access/e2e/assistant-pages.mjs --keep   (leave the fixtures in the database)
//
// The assistant's conversations with other people, its usage figures, its
// evaluations and its share link are the Owner's (CLEAN-236, CLEAN-268). The
// API says so; this script holds the consoles to saying it too, and to not
// asking for what they know is not the viewer's:
//
// Management console, as an Admin who has the assistant:
//   - Chats with no agent picked: the list is without the assistant's
//     conversations and one line says so;
//   - Chats with the assistant picked: the Admin's OWN conversation with it,
//     nobody else's, the owner-only line, no Sync, never "No chats here";
//   - that conversation opens and reads as theirs;
//   - the Owner's chat with the assistant, by address: "not available", with
//     a way back, and nothing asked about it after the first answer; the same
//     state for an id that names nothing;
//   - Evaluations: the assistant is not offered to evaluate, the list says
//     what it leaves out, an evaluation of it by address is "not available";
//   - usage: the LLM usage page and the panel on the Rancher page say that
//     the assistant's figures are not included, and do not ask for them;
//   - the agents rail draws the assistant's row with no limit mark and
//     nothing left loading.
// As the Owner: none of those lines, every record of the assistant there.
//
// App console:
//   - a User and an Admin on the assistant: no Share, History holds their own
//     conversation and nothing else; the Owner has Share;
//   - a share-link read the API refuses, on any agent: one quiet line, no
//     error state;
//   - Statistics, whole installation, as the Admin, in English and Russian:
//     what is left out for the assistant, and that its incidents are listed.
//
// Both consoles, every role, the Owner included: the assistant is the first
// row of every list as it is, so there is no pin on it. No control on its row
// or in its header, no "pinned" mark, also for a person who pinned it before
// (the script writes such a pin for each account and removes it at the end);
// pinning another agent works as it did.
//
// Runs at 390 px and 1440 px. Fails on any console error and on any failed
// request (a status of 400 and up) that is not listed as expected where it
// is provoked, so a page that asks a route closed for the assistant fails.
//
// Needs: API :3333 (after seed.mjs), app :3000, admin :3001. The fake runtime
// is not needed: the conversations are fixtures, written the way seed.mjs
// writes its own, and removed at the end.
//
// Screenshots go to E2E_OUT/shots-269 (default: the system temp directory),
// never into the repo. Prints no secrets.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ADMIN,
  ADMIN_USER,
  AGENTS,
  APP,
  LLM,
  OUT,
  OWNER,
  USER,
  WIDTHS,
  api,
  apiEnv,
  arg,
  check,
  done,
  launch,
  loginAs,
  requireFromApi,
  section,
  sleep,
  until,
  watchedPage,
} from './lib.mjs';

const KEEP = process.argv.includes('--keep') || arg('keep') === 'true';
const SHOTS = resolve(OUT, 'shots-269');
mkdirSync(SHOTS, { recursive: true });
const shot = (page, name) => page.screenshot({ path: resolve(SHOTS, `${name}.png`) });

const RANCH = AGENTS.ranch;
const ALPHA = AGENTS.a;
const BRAVO = AGENTS.b;

// ---------------------------------------------------------------- wording
// One sentence in both consoles; the app says it through i18n.
const leftOut = (what) => `The ${what} of ${RANCH.name}, the Ranch assistant, are not included: only the Owner can read them.`;
const TEXT = {
  chatsLeftOut: `${leftOut('conversations')} Pick ${RANCH.name} in the agent filter for your own.`,
  chatsOwnOnly: `These are your own conversations with ${RANCH.name}. Other people's conversations with it are read by the Owner only.`,
  notAvailableChat: 'This chat is not available',
  notAvailableEvaluation: 'This evaluation is not available',
  notYours: 'It does not exist, or it is not yours to read.',
  evaluationsLeftOut: leftOut('evaluations'),
  usageLeftOut: leftOut('usage figures'),
  ownerManaged: 'This agent is managed by the Owner.',
  statsEn: `The conversations, spend and limit refusals of ${RANCH.name}, the Ranch assistant, are not included: only the Owner can read them. Its incidents are listed.`,
  statsRu: `Беседы с ассистентом Ranch ${RANCH.name}, его расход и отказы по лимиту запросов в эти цифры не входят: их видит только владелец. Его инциденты в списке есть.`,
  shareRefused: 'The share link of this agent is not yours to manage.',
};

// --------------------------------------------------------------- fixtures
if (!apiEnv.DATABASE_URL) {
  console.error('DATABASE_URL is missing in api/.env');
  process.exit(1);
}
process.env.DATABASE_URL = apiEnv.DATABASE_URL;
const { PrismaClient } = requireFromApi('@prisma/client');
const prisma = new PrismaClient();

const EVAL = {
  ranch: '00000269-0000-4000-8000-00000000000f',
  alpha: '00000269-0000-4000-8000-00000000000a',
};
const NOBODY_CHAT = '00000269-0000-4000-8000-0000000000ff';
const PREVIEW = {
  owner: 'pages-269: what the Owner asked the assistant',
  admin: 'pages-269: what the Admin asked the assistant',
  user: 'pages-269: what the User asked the assistant',
};

/** Conversations with the assistant, a day of its usage, and two evaluations. */
async function seedFixtures() {
  const now = new Date();
  const people = Object.fromEntries(
    await Promise.all(
      [OWNER, ADMIN_USER, USER].map(async (who) => [who.role, await prisma.user.findUnique({ where: { email: who.email } })]),
    ),
  );
  if (!people.Owner || !people.Admin || !people.User) throw new Error('the seeded accounts are missing: run seed.mjs first');
  // The chat identity the hub gives each token: the Owner is `admin`,
  // everybody else their own id (api: bridle/domain/chatIdentity.ts).
  const channelOf = { owner: 'admin', admin: people.Admin.id, user: people.User.id };
  const chats = {};
  for (const key of ['owner', 'admin', 'user']) {
    const row = {
      agentId: RANCH.id,
      channel: 'bridle',
      externalUserId: channelOf[key],
      sessionKey: `bridle:${channelOf[key]}`,
      title: null,
      preview: PREVIEW[key],
      lastRole: 'assistant',
      lastMessageAt: now,
      messageCount: 4,
      userMessageCount: 2,
      archived: false,
    };
    const saved = await prisma.chatSession.upsert({
      where: { agentId_sessionKey: { agentId: row.agentId, sessionKey: row.sessionKey } },
      create: row,
      update: { preview: row.preview, archived: false, lastMessageAt: now, messageCount: 4, userMessageCount: 2 },
    });
    chats[key] = saved.id;
  }
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const usage = { agentId: RANCH.id, llmCredentialId: LLM.id, model: LLM.model, date: day, inputTokens: 7000, outputTokens: 700, callCount: 9 };
  await prisma.usage.upsert({
    where: { agentId_model_date: { agentId: RANCH.id, model: LLM.model, date: day } },
    create: usage,
    update: usage,
  });
  // A pin on the assistant from before it stopped being offered, for each
  // account: the row stays in the table, and nothing may show it.
  for (const person of Object.values(people)) {
    await prisma.agentPin.upsert({
      where: { userId_agentId: { userId: person.id, agentId: RANCH.id } },
      create: { userId: person.id, agentId: RANCH.id },
      update: {},
    });
  }
  for (const [key, agentId] of [['ranch', RANCH.id], ['alpha', ALPHA.id]]) {
    const row = {
      agentId,
      status: 'aborted',
      startedAt: now,
      finishedAt: now,
      scenarioCount: 0,
      judgeConfig: {},
      scenariosSnapshot: [],
    };
    await prisma.paddockEvaluation.upsert({ where: { id: EVAL[key] }, create: { id: EVAL[key], ...row }, update: row });
  }
  fixturePeople.push(...Object.values(people).map((p) => p.id));
  return chats;
}
const fixturePeople = [];

async function removeFixtures() {
  const now = new Date();
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  // The pins this script wrote on the assistant, and any it left on bravo.
  await prisma.agentPin.deleteMany({ where: { agentId: { in: [RANCH.id, BRAVO.id] }, userId: { in: fixturePeople } } });
  await prisma.paddockEvaluation.deleteMany({ where: { id: { in: Object.values(EVAL) } } });
  await prisma.usage.deleteMany({ where: { agentId: RANCH.id, model: LLM.model, date: day } });
  await prisma.chatSession.deleteMany({ where: { agentId: RANCH.id, preview: { in: Object.values(PREVIEW) } } });
}

// ----------------------------------------------------------------- helpers
const count = (page, selector) => page.locator(selector).count();
const textOf = async (page, selector) =>
  ((await page.locator(selector).first().textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
const bodyText = async (page) => ((await page.locator('body').innerText()) ?? '').replace(/\s+/g, ' ');
const visible = async (page, selector) => (await count(page, selector)) > 0 && (await page.locator(selector).first().isVisible());
const heightOf = (width) => (width < 600 ? 844 : 900);

/** No horizontal overflow of the page at this width. */
const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

/** The failed requests a step provoked on purpose are taken out; the rest stay problems. */
function takeExpected(problems, patterns) {
  const taken = [];
  for (let i = problems.length - 1; i >= 0; i -= 1) {
    if (patterns.some((p) => p.test(problems[i]))) taken.unshift(...problems.splice(i, 1));
  }
  return taken;
}
function clean(problems, what) {
  check(problems.length === 0, `${what}: no console error and no failed request${problems.length ? `: ${problems.join(' | ')}` : ''}`);
  problems.length = 0;
}

/**
 * The local stack has no S3 bucket, so the routes that read an agent's
 * workspace answer the Owner 400: the same list owner-only.mjs expects, and
 * an evaluation's report, which is kept there too. They are the Owner's
 * requests only. None of them is a route closed for the assistant.
 */
const NO_BUCKET = [
  { status: 400, url: /\/agents\/[^/]+\/(env|channels|files|secrets)(\?|\/|$)/ },
  { status: 400, url: /\/paddock-evaluations\/[^/]+\/(report|trace)/ },
  { status: 404, url: /\/paddock-evaluations\/[^/]+\/(report|trace)/ },
];

/** `NO_BUCKET` as patterns over the recorded problems, for a page that is not the Owner's. */
const NO_BUCKET_SAID = [/^400 GET .*\/agents\/[^/]+\/(env|channels|files|secrets)(\?|\/|$)/];

/**
 * The Rancher page shows the chat and the usage panel beside it once the
 * installation is set up: a model, storage, the template, the agent. The
 * local stack has no storage, so the page would stop at its checklist. The
 * status is passed on as the API answered it, with those two steps marked
 * done: the panel under test reads nothing of them.
 */
async function withRancherSetUp(page) {
  await page.route('**/rancher/status', async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    const status = json?.data ?? json;
    status.hasS3 = true;
    status.template = status.template ?? { id: 'template-pages-269', name: 'rancher' };
    await route.fulfill({ response, json });
  });
}

/** A request for a record of the assistant that only the Owner reads (CLEAN-268). */
const CLOSED_FOR_ASSISTANT = new RegExp(
  [
    // `…/limits/enabled` is not one of them: one boolean, open to whoever has the agent.
    `/agents/${RANCH.id}/(usage|limits|load|share-link)([?]|$)`,
    `/paddock-(evaluations|scenarios)[^#]*agentId=${RANCH.id}`,
    `/chats(/sync)?[?][^#]*agentId=${RANCH.id}`,
  ].join('|'),
);

const chatRows = (page) => page.locator('a[href^="/chats/"]');
async function chatsReady(page) {
  await until(async () => !(await bodyText(page)).includes('Loading…'), { timeout: 15000 });
  await sleep(300);
}
async function pickAgent(page, name) {
  await page.locator('[aria-label="Filter by agent"]').click();
  await page.locator('[role="option"]').filter({ hasText: name }).first().click();
  await chatsReady(page);
}

async function openAppAgent(page, id) {
  await page.goto(`${APP}/agents/${id}`, { waitUntil: 'networkidle' });
  await page.locator('[data-panel-switch]').first().waitFor({ state: 'visible', timeout: 20000 });
  await sleep(400);
}
async function openHistory(page) {
  await page.locator('[data-panel-view="history"]').first().click();
  await page.locator('[data-history-list]').first().waitFor({ state: 'visible', timeout: 15000 });
  await until(async () => (await count(page, '[data-history-row]')) > 0 || (await count(page, '[data-history-state]')) > 0, { timeout: 15000 });
  await sleep(300);
}

// ------------------------------------------------------------ preconditions
section('Preconditions');
const chats = await seedFixtures();
check(Object.values(chats).every(Boolean), 'fixtures: a conversation with the assistant for the Owner, the Admin and the User; a day of its usage; an evaluation of it');
{
  const mine = (await api('/agents', { as: ADMIN_USER })).body ?? [];
  check(mine.some((a) => a.id === RANCH.id && a.isAdmin), `the Admin has the assistant (${RANCH.name}) among their agents`);
  // What the API gives, so that a console check below is read against it.
  const all = await api(`/chats?agentId=${RANCH.id}`, { as: ADMIN_USER });
  check(all.status === 200 && all.body?.total === 0, `GET /chats?agentId=<assistant> as the Admin: an empty page (${all.status}, total ${all.body?.total})`);
  const own = await api(`/me/chats?agentId=${RANCH.id}`, { as: ADMIN_USER });
  check(
    own.status === 200 && own.body?.total === 1 && own.body.items[0].id === chats.admin,
    `GET /me/chats?agentId=<assistant> as the Admin: their own conversation alone (${own.status}, total ${own.body?.total})`,
  );
  for (const who of [OWNER, ADMIN_USER, USER]) {
    const list = (await api('/agents', { as: who })).body ?? [];
    const row = list.find((a) => a.id === RANCH.id);
    check(row && row.pinned === false, `GET /agents as the ${who.role}: the assistant is not pinned, though a pin of theirs on it is in the table`);
  }
  check((await prisma.agentPin.count({ where: { agentId: RANCH.id, userId: { in: fixturePeople } } })) === 3, 'and those three pins are still there: nothing was deleted');
  const theirs = await api(`/chats/${chats.owner}`, { as: ADMIN_USER });
  check(theirs.status === 404, `GET /chats/<the Owner's chat with the assistant> as the Admin: 404 (${theirs.status})`);
}

const browser = await launch();
try {
  for (const width of WIDTHS) {
    const height = heightOf(width);

    // ================================================== admin, as an Admin
    section(`Management console, ${width} px, as an Admin: Chats`);
    {
      const { context, page, problems } = await watchedPage(browser, { width, height });
      await loginAs(page, ADMIN_USER, ADMIN);

      await page.goto(`${ADMIN}/chats`, { waitUntil: 'networkidle' });
      await chatsReady(page);
      check((await chatRows(page).count()) > 0, 'no agent picked: the conversations of the agents they supervise are listed');
      check(!(await bodyText(page)).includes('pages-269'), 'none of them is a conversation with the assistant');
      check((await textOf(page, '[data-chats-left-out]')) === TEXT.chatsLeftOut, `one line says the assistant's are not included ("${await textOf(page, '[data-chats-left-out]')}")`);
      check((await count(page, 'button:has-text("Sync")')) === 1, 'Sync is offered for the agents they supervise');
      check(await fits(page), 'nothing overflows the page');
      await shot(page, `admin-admin-chats-all-${width}`);

      await pickAgent(page, RANCH.name);
      await page.locator('[data-chats-own-only]').first().waitFor({ state: 'visible', timeout: 10000 });
      const rows = await chatRows(page).allInnerTexts();
      check(rows.length === 1 && rows[0].includes(PREVIEW.admin), `the assistant picked: the Admin's own conversation is listed (${rows.length} row)`);
      check(rows.every((r) => !r.includes(PREVIEW.owner) && !r.includes(PREVIEW.user)), "the Owner's and the User's are not");
      check(rows.length === 1 && /\bYou\b/.test(rows[0]), 'the row says whose it is: "You"');
      check((await textOf(page, '[data-chats-own-only]')) === TEXT.chatsOwnOnly, `the owner-only line ("${await textOf(page, '[data-chats-own-only]')}")`);
      {
        const body = await bodyText(page);
        check(!body.includes('No chats here') && !/run Sync/i.test(body), 'never "No chats here … run Sync"');
      }
      check((await count(page, 'button:has-text("Sync")')) === 0, 'Sync is not offered for the assistant');
      check((await count(page, '[data-chats-left-out]')) === 0, 'the "not included" line is gone: nothing is left out of a list of their own');
      check(await fits(page), 'nothing overflows the page');
      await shot(page, `admin-admin-chats-assistant-${width}`);

      // Their own conversation opens, by the route that gives it.
      await chatRows(page).first().click();
      await page.waitForURL((u) => u.pathname === `/chats/${chats.admin}`, { timeout: 10000 });
      await page.waitForLoadState('networkidle');
      await sleep(400);
      check((await count(page, '[data-not-available]')) === 0, 'their own conversation with the assistant opens');
      check((await bodyText(page)).includes(`bridle:`), 'with its record beside it (messages, last activity, session)');
      check(!(await bodyText(page)).includes('Tool events') && (await count(page, 'button:has-text("Summarize")')) === 0, "no Tool events switch and no Summarize: neither is a person's own reading");
      await shot(page, `admin-admin-chat-own-${width}`);
      clean(problems, 'Chats, the list and their own conversation');

      // An archived search that matches nothing of theirs: still not "run Sync".
      await page.goto(`${ADMIN}/chats`, { waitUntil: 'networkidle' });
      await chatsReady(page);
      await pickAgent(page, RANCH.name);
      await page.locator('input[type="search"]').fill('nothing-of-mine-matches-this');
      await sleep(900);
      await chatsReady(page);
      check(
        (await chatRows(page).count()) === 0 && (await bodyText(page)).includes(`No conversations of your own with ${RANCH.name} here`),
        'a search that matches none of their own: "No conversations of your own with … here", with the owner-only line',
      );
      check(!(await bodyText(page)).includes('No chats here'), 'and still not "No chats here"');
      await shot(page, `admin-admin-chats-assistant-empty-${width}`);
      clean(problems, 'Chats, the empty list of their own');

      // Somebody else's conversation with the assistant, by address.
      section(`Management console, ${width} px, as an Admin: a chat that is not theirs, by address`);
      for (const [what, id] of [["the Owner's chat with the assistant", chats.owner], ['an id that names no chat', NOBODY_CHAT]]) {
        await page.goto(`${ADMIN}/chats/${id}`, { waitUntil: 'networkidle' });
        await page.locator('[data-not-available]').first().waitFor({ state: 'visible', timeout: 10000 });
        const body = await bodyText(page);
        check(body.includes(TEXT.notAvailableChat) && body.includes(TEXT.notYours), `${what}: "${TEXT.notAvailableChat}" — "${TEXT.notYours}"`);
        check(!body.includes('No messages in this session') && !body.includes('Refresh'), 'no empty feed and no header of a chat');
        check(!body.includes(PREVIEW.owner) && !/Owner's|access-owner/i.test(body), 'nothing says whose chat it was');
        const asked = takeExpected(problems, [new RegExp(`404 GET .*/chats/${id}$`), new RegExp(`404 GET .*/me/chats/${id}$`)]);
        check(asked.length === 2, `the two routes that could give it were asked once each, and answered 404 (${asked.length})`);
        clean(problems, 'nothing else was asked about it (messages, feedback)');
        if (id === chats.owner) await shot(page, `admin-admin-chat-not-available-${width}`);
      }
      await page.locator('[data-not-available] a:has-text("Back to chats")').click();
      await page.waitForURL((u) => u.pathname === '/chats', { timeout: 10000 });
      check(true, 'and there is a way back to the list');
      await context.close();
    }

    section(`Management console, ${width} px, as an Admin: Evaluations`);
    {
      const { context, page, problems } = await watchedPage(browser, { width, height });
      await loginAs(page, ADMIN_USER, ADMIN);

      await page.goto(`${ADMIN}/paddock`, { waitUntil: 'networkidle' });
      await page.locator('[data-evaluations-left-out]').first().waitFor({ state: 'visible', timeout: 10000 });
      check((await count(page, `a[href="/paddock/${EVAL.alpha}"]`)) > 0, `the evaluation of ${ALPHA.name} is listed`);
      check((await count(page, `a[href="/paddock/${EVAL.ranch}"]`)) === 0, "the assistant's is not");
      check((await textOf(page, '[data-evaluations-left-out]')) === TEXT.evaluationsLeftOut, `one line says so ("${await textOf(page, '[data-evaluations-left-out]')}")`);
      check(await fits(page), 'nothing overflows the page');
      await shot(page, `admin-admin-evaluations-${width}`);

      // The one place an evaluation is started is the agent's Paddock section.
      await page.goto(`${ADMIN}/agents/${RANCH.id}?tab=paddock`, { waitUntil: 'networkidle' });
      await page.locator('[data-owner-managed]').first().waitFor({ state: 'visible', timeout: 15000 });
      check((await count(page, 'button:has-text("Run evaluation")')) === 0, 'the assistant is not offered to evaluate: no Run evaluation, by address either');
      check((await textOf(page, '[data-owner-managed]')) === TEXT.ownerManaged, `the line that is there instead ("${await textOf(page, '[data-owner-managed]')}")`);
      await page.goto(`${ADMIN}/agents/${ALPHA.id}?tab=paddock`, { waitUntil: 'networkidle' });
      await until(async () => (await count(page, 'button:has-text("Run evaluation")')) > 0, { timeout: 15000 });
      check((await count(page, 'button:has-text("Run evaluation")')) === 1, `${ALPHA.name}, which they manage, is`);
      takeExpected(problems, NO_BUCKET_SAID);
      clean(problems, 'Evaluations and the Paddock section');

      await page.goto(`${ADMIN}/paddock/${EVAL.ranch}`, { waitUntil: 'networkidle' });
      await page.locator('[data-not-available]').first().waitFor({ state: 'visible', timeout: 10000 });
      {
        const body = await bodyText(page);
        check(body.includes(TEXT.notAvailableEvaluation) && body.includes(TEXT.notYours), `an evaluation of the assistant by address: "${TEXT.notAvailableEvaluation}"`);
        const asked = takeExpected(problems, [new RegExp(`404 GET .*/paddock-evaluations/${EVAL.ranch}$`)]);
        check(asked.length === 1, `asked once, answered 404 (${asked.length})`);
        clean(problems, 'nothing else was asked about it (logs, report)');
      }
      await shot(page, `admin-admin-evaluation-not-available-${width}`);
      await context.close();
    }

    section(`Management console, ${width} px, as an Admin: usage and the rail`);
    {
      const { context, page, problems } = await watchedPage(browser, { width, height });
      await loginAs(page, ADMIN_USER, ADMIN);

      await page.goto(`${ADMIN}/llms/usage`, { waitUntil: 'networkidle' });
      await page.locator('[data-usage-left-out]').first().waitFor({ state: 'visible', timeout: 10000 });
      await until(async () => (await count(page, 'tbody tr')) > 0 && !(await bodyText(page)).includes('Loading…'), { timeout: 15000 });
      const table = await textOf(page, 'tbody');
      check(table.includes(ALPHA.name) && !table.includes(RANCH.name), `LLM usage: ${ALPHA.name} has a row, the assistant has none`);
      check((await textOf(page, '[data-usage-left-out]')) === TEXT.usageLeftOut, `one line says its figures are not included ("${await textOf(page, '[data-usage-left-out]')}")`);
      check(await fits(page), 'nothing overflows the page');
      await shot(page, `admin-admin-llm-usage-${width}`);

      await withRancherSetUp(page);
      await page.goto(`${ADMIN}/rancher`, { waitUntil: 'networkidle' });
      await page.locator('[data-usage-left-out]').first().waitFor({ state: 'visible', timeout: 20000 });
      check((await textOf(page, '[data-usage-left-out]')) === TEXT.usageLeftOut, 'the usage panel beside the assistant\'s chat says the same');
      {
        const tab = page.locator('[role="tab"]').filter({ hasText: /^\s*Agent\s*$/ }).first();
        check(await tab.isDisabled(), 'its Agent tab, which would be the assistant\'s own figures, is off');
        check((await tab.getAttribute('title')) === "Only the Owner can read this agent's usage", `and says why ("${await tab.getAttribute('title')}")`);
      }
      check(!/rancher usage/i.test(await bodyText(page)), 'the panel is not titled as the assistant\'s usage');
      check(await fits(page), 'nothing overflows the page');
      await page.locator('[data-usage-left-out]').first().scrollIntoViewIfNeeded();
      await shot(page, `admin-admin-rancher-usage-${width}`);

      await page.goto(`${ADMIN}/agents/${RANCH.id}`, { waitUntil: 'networkidle' });
      await page.locator('[data-owner-managed]').first().waitFor({ state: 'visible', timeout: 15000 });
      await sleep(600);
      if (width >= 1024) {
        const row = page.locator(`[data-agent-id="${RANCH.id}"]`).first();
        check((await row.count()) === 1, 'the rail has the assistant\'s row');
        const marks = await row.evaluate((el) => ({
          text: (el.textContent ?? '').replace(/\s+/g, ' '),
          loading: el.querySelectorAll('[data-slot="skeleton"], .animate-pulse, .animate-spin').length,
          atLimit: el.hasAttribute('data-agent-at-limit'),
          needs: el.hasAttribute('data-agent-needs-limits'),
        }));
        check(!marks.atLimit && !marks.needs && !/at limit|public without limits/.test(marks.text), 'with no limit mark on it');
        check(marks.loading === 0, 'and nothing in it left loading');
      }
      check((await count(page, '[data-header-at-limit], [data-header-needs-limits]')) === 0, 'no limit mark in the header of the assistant');
      await shot(page, `admin-admin-assistant-workspace-${width}`);
      clean(problems, 'usage pages and the assistant\'s workspace: nothing closed for the assistant was asked');
      await context.close();
    }

    // The routes CLEAN-268 closed for the assistant are asked by pages that
    // are not about it too: lists across agents, the agents screen, another
    // agent's own sections. None of them may ask for the assistant's.
    section(`Management console, ${width} px, as an Admin: the rest of the console`);
    {
      const { context, page, problems } = await watchedPage(browser, { width, height });
      const closed = [];
      page.on('request', (req) => {
        const url = req.url();
        if (CLOSED_FOR_ASSISTANT.test(url)) closed.push(`${req.method()} ${new URL(url).pathname}${new URL(url).search}`);
      });
      await loginAs(page, ADMIN_USER, ADMIN);
      const walk = [
        '/', '/agents', '/events', '/templates', '/knowledges', '/llms', '/skills', '/mcps', '/sessions', '/users', '/settings',
        `/agents/${ALPHA.id}?tab=overview`, `/agents/${ALPHA.id}?tab=a2a`, `/agents/${ALPHA.id}?tab=chats`,
      ];
      for (const path of walk) {
        await page.goto(`${ADMIN}${path}`, { waitUntil: 'networkidle' });
        await sleep(500);
      }
      check(closed.length === 0, `${walk.length} pages opened: none asked for the assistant's usage, limits, load, share link, evaluations or scenarios${closed.length ? `: ${closed.join(' | ')}` : ''}`);
      takeExpected(problems, NO_BUCKET_SAID);
      clean(problems, 'and nothing else failed on the way');
      await context.close();
    }

    // ==================================================== admin, as the Owner
    section(`Management console, ${width} px, as the Owner: everything as before`);
    {
      const { context, page, problems } = await watchedPage(browser, { width, height, expected: NO_BUCKET });
      await loginAs(page, OWNER, ADMIN);

      await page.goto(`${ADMIN}/chats`, { waitUntil: 'networkidle' });
      await chatsReady(page);
      {
        const body = await bodyText(page);
        check([PREVIEW.owner, PREVIEW.admin, PREVIEW.user].every((p) => body.includes(p)), "Chats, no agent picked: the assistant's conversations are in the list, all three");
        check((await count(page, '[data-access-note]')) === 0, 'and no line about anything left out');
      }
      await pickAgent(page, RANCH.name);
      {
        const rows = await chatRows(page).allInnerTexts();
        check(rows.length === 3, `the assistant picked: the three conversations with it (${rows.length})`);
        check(rows.some((r) => r.includes('access-admin')) && rows.some((r) => r.includes('access-user')), 'each row names the person it is with');
        check((await count(page, '[data-access-note]')) === 0 && (await count(page, 'button:has-text("Sync")')) === 1, 'no owner-only line, and Sync is there');
      }
      await shot(page, `admin-owner-chats-assistant-${width}`);
      await page.goto(`${ADMIN}/chats/${chats.admin}`, { waitUntil: 'networkidle' });
      await sleep(400);
      check((await count(page, '[data-not-available]')) === 0 && (await bodyText(page)).includes('Tool events'), "the Admin's chat with the assistant opens for the Owner, tool events and all");
      await page.goto(`${ADMIN}/chats/${NOBODY_CHAT}`, { waitUntil: 'networkidle' });
      await page.locator('[data-not-available]').first().waitFor({ state: 'visible', timeout: 10000 });
      check((await bodyText(page)).includes('It does not exist, or it was removed.'), 'an id that names no chat: not available, in the Owner\'s words');
      {
        const asked = takeExpected(problems, [new RegExp(`404 GET .*/chats/${NOBODY_CHAT}$`)]);
        check(asked.length === 1 && !asked[0].includes('/me/chats/'), 'asked on the one route the Owner reads every chat by');
      }

      await page.goto(`${ADMIN}/paddock`, { waitUntil: 'networkidle' });
      await until(async () => (await count(page, `a[href="/paddock/${EVAL.ranch}"]`)) > 0, { timeout: 10000 });
      check((await count(page, `a[href="/paddock/${EVAL.ranch}"]`)) > 0 && (await count(page, '[data-access-note]')) === 0, "Evaluations: the assistant's is listed, no line");
      await page.goto(`${ADMIN}/paddock/${EVAL.ranch}`, { waitUntil: 'networkidle' });
      await sleep(500);
      check((await count(page, '[data-not-available]')) === 0, 'and opens');
      await page.goto(`${ADMIN}/agents/${RANCH.id}?tab=paddock`, { waitUntil: 'networkidle' });
      await until(async () => (await count(page, 'button:has-text("Run evaluation")')) > 0, { timeout: 15000 });
      check((await count(page, 'button:has-text("Run evaluation")')) === 1, 'the Owner is offered to evaluate the assistant');

      await page.goto(`${ADMIN}/llms/usage`, { waitUntil: 'networkidle' });
      await until(async () => (await textOf(page, 'tbody')).includes(RANCH.name), { timeout: 15000 });
      check((await textOf(page, 'tbody')).includes(RANCH.name) && (await count(page, '[data-access-note]')) === 0, "LLM usage: the assistant's row is there, no line");
      await withRancherSetUp(page);
      await page.goto(`${ADMIN}/rancher`, { waitUntil: 'networkidle' });
      await until(async () => /rancher usage/i.test(await bodyText(page)), { timeout: 20000 });
      {
        const tab = page.locator('[role="tab"]').filter({ hasText: /^\s*Agent\s*$/ }).first();
        check(/rancher usage/i.test(await bodyText(page)) && !(await tab.isDisabled()) && (await count(page, '[data-access-note]')) === 0, 'the Rancher page: the panel is the assistant\'s usage, its Agent tab is on, no line');
      }
      await shot(page, `admin-owner-rancher-usage-${width}`);
      clean(problems, 'the Owner\'s pages');
      await context.close();
    }

    // ================================================================== app
    section(`App console, ${width} px: Share and History on the assistant`);
    for (const who of [USER, ADMIN_USER, OWNER]) {
      const { context, page, problems } = await watchedPage(browser, { width, height });
      await loginAs(page, who, APP);
      await openAppAgent(page, RANCH.id);
      const share = await count(page, '[data-sheet-share]');
      if (who.role === 'Owner') {
        check(share === 1, 'the Owner has Share on the assistant');
        await page.locator('[data-sheet-share] button').first().click();
        await until(async () => (await bodyText(page)).includes('This agent is not shared.'), { timeout: 10000 });
        check((await bodyText(page)).includes('This agent is not shared.'), 'and the panel reads its link');
        {
          const box = await page.locator('[role="dialog"]').first().boundingBox();
          check(box && box.x >= 0 && box.x + box.width <= width + 1, `the panel is inside the page (${Math.round(box?.x ?? -1)}..${Math.round((box?.x ?? 0) + (box?.width ?? 0))} of ${width})`);
        }
        await shot(page, `app-owner-assistant-share-${width}`);
        await page.keyboard.press('Escape');
      } else {
        check(share === 0 && (await count(page, 'button:has-text("Share")')) === 0, `the ${who.role} is not offered Share on the assistant`);
      }
      await shot(page, `app-${who.role.toLowerCase()}-assistant-${width}`);

      await openHistory(page);
      const rows = await page.locator('[data-history-row]').allInnerTexts();
      const own = PREVIEW[who.role.toLowerCase()];
      const others = Object.values(PREVIEW).filter((p) => p !== own);
      check(rows.length === 1 && rows[0].includes(own), `History, the ${who.role}: their own conversation with the assistant (${rows.length} row)`);
      check(rows.every((r) => others.every((p) => !r.includes(p))), 'and nobody else\'s');
      check(await fits(page), 'nothing overflows the page');
      await shot(page, `app-${who.role.toLowerCase()}-assistant-history-${width}`);
      clean(problems, `the ${who.role} on the assistant: no request to a route closed for it`);
      await context.close();
    }

    // ------------------------------------------------------------ the pin
    section(`App console, ${width} px: no pin on the assistant, for anybody`);
    for (const who of [OWNER, ADMIN_USER, USER]) {
      const { context, page, problems } = await watchedPage(browser, { width, height });
      await loginAs(page, who, APP);
      await openAppAgent(page, RANCH.id);
      check((await count(page, '[data-pin-toggle]')) === 0, `the ${who.role}: no pin control in the assistant's header`);
      check((await count(page, '[data-agent-pane] [data-pinned], header [data-pinned]')) === 0 && (await count(page, '[data-pinned]')) === 0, 'and no "pinned" mark anywhere on the page, though they pinned it once');

      // The list: the plain rail on a wide screen, the overlay on a phone.
      if (width >= 1024) await page.locator('[role="tab"]').filter({ hasText: /^\s*List\s*$/ }).first().click();
      else await page.locator('[data-rail-open]').first().click();
      const rows = page.locator('.agent-rail__row[data-agent-id]');
      await rows.first().waitFor({ state: 'visible', timeout: 10000 });
      const ids = await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-agent-id')));
      check(ids[0] === RANCH.id, 'the assistant is the first row of the list');
      const mine = page.locator(`.agent-rail__row[data-agent-id="${RANCH.id}"]`).first();
      await mine.hover();
      await sleep(250);
      check((await mine.locator('[data-rail-pin]').count()) === 0 && (await mine.locator('[data-pinned]').count()) === 0, 'its row has no pin button on hover and no pin mark');
      const other = page.locator(`.agent-rail__row[data-agent-id="${BRAVO.id}"]`).first();
      check((await other.locator('[data-rail-pin]').count()) === 1, `the row of ${BRAVO.name} has its pin button`);
      await mine.screenshot({ path: resolve(SHOTS, `app-${who.role.toLowerCase()}-rail-assistant-hover-${width}.png`) });
      await shot(page, `app-${who.role.toLowerCase()}-rail-${width}`);

      // Another agent is pinned and unpinned as before; the assistant stays first.
      await other.hover();
      await other.locator('[data-rail-pin]').click();
      await until(async () => (await other.locator('[data-pinned]').count()) === 1, { timeout: 8000 });
      // The mark is drawn at the click; the request lands a moment later.
      const pinnedOf = async () => ((await api('/agents', { as: who })).body ?? []).filter((a) => a.pinned).map((a) => a.id);
      await until(async () => (await pinnedOf()).length > 0, { timeout: 8000 });
      const pinnedNow = await pinnedOf();
      check(pinnedNow.length === 1 && pinnedNow[0] === BRAVO.id, `pinning ${BRAVO.name} from its row works (pinned for them: ${pinnedNow.length})`);
      const after = await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-agent-id')));
      check(after[0] === RANCH.id && after[1] === BRAVO.id, 'the assistant is still first, the pinned agent right under it');
      await other.hover();
      await other.locator('[data-rail-pin]').click();
      await until(async () => (await other.locator('[data-pinned]').count()) === 0, { timeout: 8000 });
      await until(async () => (await pinnedOf()).length === 0, { timeout: 8000 });
      check((await pinnedOf()).length === 0, 'and unpinning it too');
      clean(problems, `the ${who.role}, the pin`);
      await context.close();
    }

    section(`Management console, ${width} px: no pin on the assistant, for anybody`);
    for (const who of [OWNER, ADMIN_USER]) {
      const { context, page, problems } = await watchedPage(browser, { width, height, expected: NO_BUCKET });
      await loginAs(page, who, ADMIN);
      await page.goto(`${ADMIN}/agents/${RANCH.id}`, { waitUntil: 'networkidle' });
      await page.locator('[data-workspace-tab="chat"]').first().waitFor({ state: 'visible', timeout: 15000 });
      await sleep(500);
      check((await count(page, '[data-pin-toggle]')) === 0, `the ${who.role}: no pin control in the assistant's header`);
      check((await count(page, '[data-pinned]')) === 0, 'and no "pinned" mark, in the header or in the rail');
      if (width >= 1024) {
        const ids = await page.locator('[data-agent-id]').evaluateAll((els) => els.map((el) => el.getAttribute('data-agent-id')));
        check(ids[0] === RANCH.id, 'the assistant is the first row of the rail');
        await page.locator(`[data-agent-id="${RANCH.id}"]`).first().hover();
        await sleep(200);
        await page.locator(`[data-agent-id="${RANCH.id}"]`).first().screenshot({ path: resolve(SHOTS, `admin-${who.role.toLowerCase()}-rail-assistant-hover-${width}.png`) });
      }
      await shot(page, `admin-${who.role.toLowerCase()}-assistant-header-${width}`);

      await page.goto(`${ADMIN}/agents/${BRAVO.id}`, { waitUntil: 'networkidle' });
      const toggle = page.locator('[data-pin-toggle]').first();
      await toggle.waitFor({ state: 'visible', timeout: 15000 });
      await toggle.click();
      await until(async () => (await toggle.getAttribute('aria-pressed')) === 'true' && ((await api('/agents', { as: who })).body ?? []).some((a) => a.id === BRAVO.id && a.pinned), { timeout: 8000 });
      check(((await api('/agents', { as: who })).body ?? []).some((a) => a.id === BRAVO.id && a.pinned), `pinning ${BRAVO.name} from its header works`);
      if (width >= 1024) {
        const ids = await page.locator('[data-agent-id]').evaluateAll((els) => els.map((el) => el.getAttribute('data-agent-id')));
        check(ids[0] === RANCH.id && ids[1] === BRAVO.id, 'the assistant is still first, the pinned agent right under it');
      }
      await toggle.click();
      await until(async () => !((await api('/agents', { as: who })).body ?? []).some((a) => a.pinned), { timeout: 8000 });
      check(!((await api('/agents', { as: who })).body ?? []).some((a) => a.pinned), 'and unpinning it too');
      clean(problems, `the ${who.role}, the pin`);
      await context.close();
    }

    section(`App console, ${width} px: a share-link read the API refuses`);
    {
      // The console does not offer Share where it knows the answer. This is
      // the panel hearing it from the API: the agent was taken out of the
      // person's reach while the page was open. Answered here in the API's
      // own words, for an agent the Admin does have.
      const { context, page, problems } = await watchedPage(browser, { width, height });
      await loginAs(page, ADMIN_USER, APP);
      await page.route(`**/agents/${ALPHA.id}/share-link`, (route) => {
        const cors = {
          'access-control-allow-origin': route.request().headers().origin ?? '*',
          'access-control-allow-credentials': 'true',
          'access-control-allow-headers': 'authorization, content-type',
          'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
        };
        // The browser asks first whether it may send the token at all.
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
        return route.fulfill({
          status: 404,
          contentType: 'application/json',
          headers: cors,
          body: JSON.stringify({ message: 'Agent not found', error: 'Not Found', statusCode: 404 }),
        });
      });
      await openAppAgent(page, ALPHA.id);
      await page.locator('[data-sheet-share] button').first().click();
      await page.locator('[data-share-refused]').first().waitFor({ state: 'visible', timeout: 10000 });
      const dialog = page.locator('[role="dialog"]').first();
      const text = ((await dialog.innerText()) ?? '').replace(/\s+/g, ' ');
      check(text.includes(TEXT.shareRefused), `one quiet line ("${TEXT.shareRefused}")`);
      check(!text.includes('Could not update the share link') && !text.includes('Try again'), 'no error state and no retry');
      check((await dialog.locator('button:has-text("Share")').count()) === 0, 'and no Share to press under it');
      {
        const box = await dialog.boundingBox();
        check(box && box.x >= 0 && box.x + box.width <= width + 1, `the panel is inside the page (${Math.round(box?.x ?? -1)}..${Math.round((box?.x ?? 0) + (box?.width ?? 0))} of ${width})`);
      }
      await shot(page, `app-admin-share-refused-${width}`);
      const asked = takeExpected(problems, [/404 GET .*\/share-link$/]);
      check(asked.length === 1, `the refused read, once (${asked.length})`);
      clean(problems, 'the refused share panel');
      await context.close();
    }

    section(`App console, ${width} px: Statistics, whole installation, as the Admin`);
    for (const [lang, expected] of [['en', TEXT.statsEn], ['ru', TEXT.statsRu]]) {
      const { context, page, problems } = await watchedPage(browser, { width, height });
      await context.addCookies([{ name: 'i18n_redirected', value: lang, url: APP }]);
      await loginAs(page, ADMIN_USER, APP);
      await page.goto(`${APP}/profile?scope=installation`, { waitUntil: 'networkidle' });
      await page.locator('[data-stats-owner-only]').first().waitFor({ state: 'visible', timeout: 20000 });
      const said = await textOf(page, '[data-stats-owner-only]');
      check(said === expected, `${lang}: the notice ("${said}")`);
      check(!/counted in full|учтены полностью/.test(said), `${lang}: it no longer says its spend is counted in full`);
      // The pass card above swings in for a moment and is wider than a phone
      // while it does (it was before this change); the notice is what is
      // measured, and the page once that has come to rest.
      {
        const box = await page.locator('[data-stats-owner-only]').first().boundingBox();
        check(box && box.x >= 0 && box.x + box.width <= width + 1, `${lang}: the notice wraps inside the page (${Math.round(box?.width ?? 0)} px of ${width})`);
        check(await until(() => fits(page), { timeout: 5000 }), 'nothing overflows the page');
      }
      await page.locator('[data-stats-owner-only]').first().scrollIntoViewIfNeeded();
      await shot(page, `app-admin-stats-installation-${lang}-${width}`);
      clean(problems, `Statistics, ${lang}`);
      await context.close();
    }
  }
} finally {
  await browser.close();
  if (!KEEP) await removeFixtures().catch((e) => console.log(`  (fixtures not removed: ${e.message})`));
  await prisma.$disconnect();
}

done('assistant-pages');
