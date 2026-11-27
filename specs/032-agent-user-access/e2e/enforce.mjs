// What the consoles do with the access lists (CLEAN-231, User Stories 1 and 3
// of spec 032: T068, T084, T085).
//
//   node specs/032-agent-user-access/e2e/enforce.mjs
//   node specs/032-agent-user-access/e2e/enforce.mjs --only app
//   node specs/032-agent-user-access/e2e/enforce.mjs --only admin
//
// App console, at 390 px and 1440 px, as the second User (USER2), whose
// access this script sets through the API as the Owner and puts back:
//   1. reaching no agent, they see the no-access state and no agent's name
//   2. denied one agent, they are not offered it, and its typed address
//      shows no chat and no name
//   3. access taken away while the chat is open: the page leaves for the
//      agents, nothing of the conversation stays on screen or in the browser
// Admin console, at 390 px and 1440 px, as the seeded limited Admin (reaches
// access-alpha and access-bravo):
//   4. the walk: no screen names, links or counts an agent they do not reach,
//      no request is answered 404, the assistant entry is not offered
//   5. a list that could not be read is not an empty list
// Admin console, at 1440 px:
//   6. the restart marks the browser keeps are one map per account, and the
//      maps kept before that are removed once, also from a browser that had
//      already run the first removal
//
// Only USER2's access is changed, and it is put back in a `finally`: the
// other scripts of this folder run against the Owner, the Admin and the
// first User and depend on what seed.mjs gave them.
//
// Fails on any console error and any failed request not listed as expected.
//
// Needs: API :3333 (after seed.mjs), app :3000, admin :3001, fakeRuntime.mjs.
import {
  ADMIN,
  ADMIN_USER,
  AGENTS,
  API,
  APP,
  OWNER,
  USER2,
  WIDTHS,
  api,
  arg,
  chatOn,
  check,
  done,
  launch,
  loginAs,
  rememberAssistantAccess,
  section,
  setAssistantFor,
  shot,
  sleep,
  until,
  watchedPage,
} from './lib.mjs';

const only = arg('only');

// ------------------------------------------------------------------ fixtures

const idOf = async (who) => (await api('/auth/me', { as: who })).body.id;
const user2Id = await idOf(USER2);
const adminId = await idOf(ADMIN_USER);
const ownerId = await idOf(OWNER);

// This script is about accounts the lists leave with fewer agents, or with
// none: a User who reaches no agent at all, an Admin who is shown nothing of
// the agents outside their list, the Ranch admin agent among them. That
// agent is on nobody's list since CLEAN-240: a person has it by the
// assistant's own switch, which is on by default. So "does not reach it"
// is "it is switched off for them", and that is how this run is set up, for
// the Admin and for the second User; what was there comes back at the end.
// The Admin and the User who HAVE it are checked by routes.mjs and http.mjs.
const putAssistantAccessBack = await rememberAssistantAccess();
for (const id of [adminId, user2Id]) {
  const off = await setAssistantFor(id, { enabled: false });
  if (off.status !== 200) throw new Error(`switching the assistant off answered ${off.status}`);
}

/** Every agent of the installation, as the Owner sees them. */
const everyAgent = (await api('/agents', { as: OWNER })).body;
const reachedByAdmin = new Set((await api('/agents', { as: ADMIN_USER })).body.map((a) => a.id));
/** What the limited Admin must never be shown. */
const hiddenFromAdmin = everyAgent.filter((a) => !reachedByAdmin.has(a.id));

/** The version this script last wrote, to notice somebody else's write. */
let user2Version = null;

/** Replace USER2's access, as the Owner. Opening the account is confirmed. */
async function setUser2Access({ allowed = [], denied = [] } = {}) {
  const current = await api(`/users/${user2Id}/agent-access`, { as: OWNER });
  if (current.status !== 200) throw new Error(`GET agent-access of USER2 answered ${current.status}`);
  const res = await api(`/users/${user2Id}/agent-access`, {
    method: 'PUT',
    as: OWNER,
    body: { allowed, denied, version: current.body.version ?? null, confirmOpen: true },
  });
  if (res.status >= 300) {
    throw new Error(`PUT agent-access of USER2 answered ${res.status}: ${JSON.stringify(res.body).slice(0, 200)}`);
  }
  user2Version = res.body.version ?? null;
  return res.body;
}

/** Every agent there is right now: other scripts create and delete some. */
/** The agents the access lists are about: every one but the assistant. */
const agentsNow = async () => (await api('/agents', { as: OWNER })).body.filter((a) => !a.isAdmin);

/**
 * Other scripts of this folder (ceiling, deletion, owner-editor, http) edit
 * USER2 as well and create agents of their own. A scenario that ran while
 * one of them wrote to USER2, or while an agent appeared that USER2 was
 * never denied, did not test what it says; it says so instead of failing
 * quietly for a reason that is not the console's.
 */
async function undisturbed(what, { denyAll = false } = {}) {
  const now = (await api(`/users/${user2Id}/agent-access`, { as: OWNER })).body;
  const sameVersion = (now.version ?? null) === user2Version;
  const extra = denyAll ? (await agentsNow()).filter((a) => !now.denied.includes(a.id)).map((a) => a.name) : [];
  check(
    sameVersion && extra.length === 0,
    `${what}: nobody else changed USER2's access or added an agent meanwhile${
      sameVersion ? '' : ' (another script wrote to USER2: rerun when it is done)'
    }${extra.length ? ` (new agents: ${extra})` : ''}`,
  );
}

/** What USER2 had before this script touched it; put back at the end. */
const user2Before = (await api(`/users/${user2Id}/agent-access`, { as: OWNER })).body;

// ------------------------------------------------------------------- helpers

const pathOf = (page) => new URL(page.url()).pathname;
const textOf = (page) => page.evaluate(() => document.body.innerText);
const storageOf = (page) =>
  page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k) ?? ''])));

/** Names and ids of `agents` found in what the page shows and links to. */
async function shownOf(page, agents) {
  const text = await textOf(page);
  const html = await page.content();
  return {
    names: agents.filter((a) => text.includes(a.name)).map((a) => a.name),
    ids: agents.filter((a) => html.includes(a.id)).map((a) => a.name),
  };
}

const noProblems = (problems) =>
  check(problems.length === 0, `no console error, no unexpected failed request${problems.length ? `: ${problems.join(' | ')}` : ''}`);

/**
 * Admin: the local stack has no S3 bucket, so the routes that read an
 * agent's workspace answer 400 (see owner-only.mjs).
 */
const NO_BUCKET = { status: 400, url: /\/agents\/[^/]+\/(env|channels|files|secrets)(\?|\/|$)/ };

const browser = await launch();
try {
  // ====================================================================== app
  if (only !== 'admin') {
    try {
      for (const width of WIDTHS) {
        const height = width < 600 ? 844 : 900;
        const alpha = AGENTS.a;

        // -------------------------------------------------- 1. no agent at all
        section(`App console, ${width} px: a User who reaches no agent`);
        await setUser2Access({ denied: (await agentsNow()).map((a) => a.id) });
        {
          const { context, page, problems } = await watchedPage(browser, { width, height });
          await loginAs(page, USER2, APP);
          const empty = page.locator('[data-agents-empty="no_access"]');
          check(Boolean(await until(async () => (await empty.count()) > 0, { timeout: 15000 })), 'the no-access state is shown');
          check(pathOf(page) === '/agents', `the address stays at the agents (${pathOf(page)})`);
          const text = await textOf(page);
          check(
            text.includes('No agents yet') && text.includes('An administrator decides which agents you can use. Ask them for access.'),
            'it says an administrator decides which agents they can use',
          );
          check((await page.locator('a[href="/agents/create"]').count()) === 0, 'and offers nothing to create');
          const shown = await shownOf(page, everyAgent);
          check(shown.names.length === 0 && shown.ids.length === 0, `no agent is named or linked${shown.names.length ? `: ${shown.names}` : ''}`);
          check((await page.locator('textarea').count()) === 0, 'and there is no chat');
          await shot(page, `enforce-app-no-access-${width}`);
          await undisturbed('this scenario', { denyAll: true });
          noProblems(problems);
          await context.close();
        }

        // ------------------------------------------------ 2. one agent denied
        section(`App console, ${width} px: a User denied ${alpha.name}`);
        await setUser2Access({ denied: [alpha.id] });
        {
          const { context, page, problems } = await watchedPage(browser, {
            width,
            height,
            // The typed address of the denied agent: the API answers what it
            // answers for an agent that does not exist.
            expected: [{ status: 404, url: alpha.id }],
          });
          await loginAs(page, USER2, APP);
          await page.waitForURL((u) => /^\/agents\/.+/.test(u.pathname), { timeout: 20000 });
          await page.locator('textarea').first().waitFor({ state: 'visible', timeout: 20000 });
          check(pathOf(page) !== `/agents/${alpha.id}`, `they land on an agent of their own (${pathOf(page)})`);
          // The list: one tap away on a phone, a view of the map on a desk.
          if (width < 1024) await page.getByRole('button', { name: 'Switch agent' }).first().click();
          else await page.getByRole('tab', { name: 'List' }).first().click();
          await sleep(600);
          const listed = await shownOf(page, [alpha, AGENTS.b]);
          check(listed.names.includes(AGENTS.b.name), `the list offers ${AGENTS.b.name}`);
          check(
            !listed.names.includes(alpha.name) && !listed.ids.includes(alpha.name),
            `and neither names nor links ${alpha.name}`,
          );
          await shot(page, `enforce-app-denied-list-${width}`);

          await page.goto(`${APP}/agents/${alpha.id}`, { waitUntil: 'networkidle' });
          await sleep(1200);
          // The page does not stay on an agent the account does not reach: it
          // leaves for the agents (useAgentGone, CLEAN-231), where the workspace
          // opens one they do reach with its composer in place (CLEAN-260 draws
          // the shell and the composer at once). So a composer may be there;
          // what must not be is this address, a chat with this agent, or its name.
          const landedOn = new URL(page.url()).pathname;
          const reachedIds = (await api('/agents', { as: USER2 })).body.map((a) => a.id);
          check(
            !landedOn.includes(alpha.id) && (landedOn === '/agents' || reachedIds.some((id) => landedOn === `/agents/${id}`)),
            `its typed address does not stay: the page left for the agents the account reaches (${landedOn.replace(/agent-[0-9a-f-]+/, '<an agent they reach>')})`,
          );
          check(
            (await page.locator('textarea').count()) === 0 || !(await textOf(page)).includes(alpha.name),
            'and no chat with it is on the screen',
          );
          check((await page.locator('[data-message-id]').count()) === 0, 'no message');
          check(!(await textOf(page)).includes(alpha.name), 'and no name');
          await shot(page, `enforce-app-denied-address-${width}`);
          // Back on the map, so the view this browser remembers is the default.
          if (width >= 1024) await page.getByRole('tab', { name: 'Orbit' }).first().click().catch(() => undefined);
          await undisturbed('this scenario');
          noProblems(problems);
          await context.close();
        }

        // -------------------------------- 3. access taken away, chat open
        section(`App console, ${width} px: access is taken away while the chat is open`);
        await setUser2Access({});
        {
          const { context, page, problems } = await watchedPage(browser, {
            width,
            height,
            // Whatever the page still asked about the agent in the moment
            // the access went is answered "not found".
            expected: [{ status: 404, url: alpha.id }],
          });
          const frames = [];
          page.on('websocket', (ws) => ws.on('framereceived', (f) => frames.push(String(f.payload))));
          await loginAs(page, USER2, APP);
          await page.goto(`${APP}/agents/${alpha.id}`, { waitUntil: 'networkidle' });
          const chat = chatOn(page);
          await chat.ready();
          const said = `enforce open chat ${Date.now().toString(36)}-${width}`;
          check(Boolean(await chat.say(said)), `USER2 talks to ${alpha.name}`);
          await sleep(500);
          const key = `bridle:conversation:${user2Id}:${alpha.id}`;
          check(Boolean((await storageOf(page))[key]?.includes(said)), 'the browser keeps their copy of the conversation');
          await shot(page, `enforce-app-revoke-before-${width}`);

          await setUser2Access({ denied: [alpha.id] });
          const left = await until(async () => pathOf(page) !== `/agents/${alpha.id}`, { timeout: 15000 });
          check(Boolean(left), `the page leaves the agent by itself (now at ${pathOf(page)})`);
          check(
            frames.some((f) => f.includes('bridle_error') && f.includes('AGENT_NOT_FOUND')),
            'because the hub said AGENT_NOT_FOUND on the open socket',
          );
          await page.waitForLoadState('networkidle').catch(() => undefined);
          await sleep(1200);
          check(/^\/agents(\/|$)/.test(pathOf(page)), 'for the agents');
          check(
            (await page.locator('[data-message-id]').filter({ hasText: said }).count()) === 0 && !(await textOf(page)).includes(said),
            'no message of that conversation is left on screen',
          );
          if (width < 1024) await page.getByRole('button', { name: 'Switch agent' }).first().click();
          await sleep(400);
          const after = await shownOf(page, [alpha]);
          check(after.names.length === 0 && after.ids.length === 0, `${alpha.name} is not offered any more`);
          const store = await storageOf(page);
          const kept = Object.keys(store).filter((k) => k.includes(alpha.id) && k.includes(user2Id));
          check(kept.length === 0, `the browser keeps nothing of it for this account${kept.length ? `: ${kept.join(', ')}` : ''}`);
          await shot(page, `enforce-app-revoke-after-${width}`);
          await undisturbed('this scenario');
          noProblems(problems);
          await context.close();
        }
      }
    } finally {
      // As it was: the lists USER2 had before, opening confirmed. An agent
      // another script deleted meanwhile cannot be on a list any more.
      const exists = new Set((await agentsNow()).map((a) => a.id));
      const wanted = {
        allowed: (user2Before.allowed ?? []).filter((id) => exists.has(id)),
        denied: (user2Before.denied ?? []).filter((id) => exists.has(id)),
      };
      await setUser2Access(wanted);
      const back = (await api(`/users/${user2Id}/agent-access`, { as: OWNER })).body;
      check(
        JSON.stringify([back.allowed, back.denied]) === JSON.stringify([wanted.allowed, wanted.denied]),
        `USER2's access is put back as it was before this script (${back.outcome?.kind})`,
      );
    }
  }

  // ==================================================================== admin
  if (only !== 'app') {
    const tabs = ['', 'settings', 'overview', 'knowledge', 'a2a', 'files', 'secrets', 'channels', 'env', 'logs', 'events', 'paddock'];
    const walk = [
      '/agents',
      ...tabs.map((t) => `/agents/${AGENTS.b.id}${t ? `?tab=${t}` : ''}`),
      `/agents/${AGENTS.a.id}`,
      '/events',
      '/templates',
      '/chats',
      '/llms/usage',
      '/mcps',
      '/paddock',
      '/knowledges',
      '/sessions',
      '/settings/agents',
      '/settings/rancher',
      '/settings/notifications',
      '/skills',
      '/api-keys',
    ];
    /**
     * Routes whose ANSWER names an agent the Admin does not reach. A hole of
     * the API, reported and not hidden here: the walk says so on every run,
     * and fails on a route that is not on this list.
     */
    const KNOWN_HOLES = [
      {
        url: '/rancher/status',
        why: 'answers the whole Ranch admin agent record (id, name, config) to an Admin who does not reach it',
      },
    ];

    for (const width of WIDTHS) {
      const height = width < 600 ? 844 : 900;
      section(`Admin console, ${width} px: the limited Admin walks the console`);
      const { context, page, problems } = await watchedPage(browser, {
        width,
        height,
        expected: [
          NO_BUCKET,
          // Asked once, by the layout: the API's way of saying this account
          // does not reach the Ranch admin agent.
          { status: 404, url: '/agents/admin/current' },
        ],
      });
      const notFound = [];
      let loads = 0;
      page.on('load', () => {
        loads += 1;
      });
      const leaks = [];
      const reads = [];
      page.on('response', (res) => {
        const url = res.url();
        if (!url.startsWith(API)) return;
        const path = url.slice(API.length);
        if (res.status() === 404) notFound.push(path);
        const inUrl = hiddenFromAdmin.filter((a) => path.includes(a.id));
        if (inUrl.length) leaks.push(`${res.request().method()} ${path} is about ${inUrl.map((a) => a.name)}`);
        if (/\/stream(\?|$)/.test(path)) return;
        reads.push(
          res
            .text()
            .then((body) => {
              const named = hiddenFromAdmin.filter((a) => body.includes(a.id) || body.includes(`"${a.name}"`));
              if (named.length) leaks.push(`${res.request().method()} ${path} names ${named.map((a) => a.name)}`);
            })
            .catch(() => undefined),
        );
      });

      await loginAs(page, ADMIN_USER, ADMIN);
      await page.waitForURL((u) => /^\/agents\/.+/.test(u.pathname), { timeout: 20000 });
      check(reachedByAdmin.has(pathOf(page).split('/')[2]), `they land on an agent they reach (${pathOf(page)})`);

      const seen = [];
      for (const path of walk) {
        await page.goto(`${ADMIN}${path}`, { waitUntil: 'networkidle' }).catch(() => undefined);
        await sleep(700);
        const shown = await shownOf(page, hiddenFromAdmin);
        if (shown.names.length || shown.ids.length) {
          seen.push(`${path.replace(AGENTS.b.id, 'bravo').replace(AGENTS.a.id, 'alpha')}: ${[...new Set([...shown.names, ...shown.ids])]}`);
        }
      }
      check(seen.length === 0, `${walk.length} screens: none names or links an agent they do not reach${seen.length ? ` — ${seen.join(' | ')}` : ''}`);

      // The rail is the list and the search.
      await page.goto(`${ADMIN}/agents/${AGENTS.b.id}`, { waitUntil: 'networkidle' });
      if (width < 1024) await page.getByRole('button', { name: 'Agents', exact: true }).first().click();
      await sleep(500);
      const rail = await textOf(page);
      check(
        rail.includes(AGENTS.a.name) && rail.includes(AGENTS.b.name),
        `the rail lists ${AGENTS.a.name} and ${AGENTS.b.name}`,
      );
      const search = page.locator('input[type="search"]:visible, input[placeholder*="earch"]:visible').first();
      if ((await search.count()) > 0) {
        await search.fill('access-');
        await sleep(400);
        const found = await shownOf(page, hiddenFromAdmin);
        check(found.names.length === 0, `a search for "access-" finds only theirs${found.names.length ? `, not ${found.names}` : ''}`);
        await shot(page, `enforce-admin-rail-search-${width}`);
        await search.fill('');
      } else {
        console.log('  note: the rail shows no search field at this width with two agents; the search step is skipped');
        await shot(page, `enforce-admin-rail-${width}`);
      }
      if (width < 1024) await page.keyboard.press('Escape').catch(() => undefined);

      // The header counts failing and unreachable agents.
      await page.goto(`${ADMIN}/events`, { waitUntil: 'networkidle' });
      await sleep(500);
      const events = await shownOf(page, hiddenFromAdmin);
      check(events.names.length === 0 && events.ids.length === 0, 'the events of the installation name only their agents');
      await shot(page, `enforce-admin-events-${width}`);

      // The assistant.
      section(`Admin console, ${width} px: the assistant entry`);
      await page.goto(`${ADMIN}/agents/${AGENTS.b.id}`, { waitUntil: 'networkidle' });
      await sleep(600);
      if (width < 1024) {
        await page.locator('[data-sidebar="trigger"]').first().click().catch(() => undefined);
        await sleep(500);
      }
      check((await page.locator('a[href="/users"], a[href="/templates"]').count()) > 0, 'the sidebar is on screen');
      check((await page.locator('a[href="/rancher"]').count()) === 0, 'it has no link to the assistant');
      check(
        (await page.locator('[data-assistant-home]').first().getAttribute('href')) === '/agents',
        'the brand leads to the agents',
      );
      await shot(page, `enforce-admin-sidebar-${width}`);
      if (width < 1024) await page.keyboard.press('Escape').catch(() => undefined);

      await page.goto(`${ADMIN}/rancher`, { waitUntil: 'networkidle' });
      await page.waitForURL((u) => u.pathname.startsWith('/agents'), { timeout: 15000 }).catch(() => undefined);
      await sleep(800);
      check(pathOf(page).startsWith('/agents/'), `its typed address leads back to the agents (${pathOf(page)})`);
      const onRancher = await shownOf(page, hiddenFromAdmin);
      check(onRancher.names.length === 0 && onRancher.ids.length === 0, 'and names nothing');
      await shot(page, `enforce-admin-rancher-address-${width}`);

      // The console learns it from one request, when it is loaded: the answer
      // is kept for as long as the page lives, and nothing asks again while
      // moving about inside it.
      const asked = () => notFound.filter((p) => p.startsWith('/agents/admin/current')).length;
      check(asked() <= loads, `GET /agents/admin/current is asked at most once per load of the console (${asked()} answers of 404 in ${loads} loads)`);
      await page.goto(`${ADMIN}/agents/${AGENTS.b.id}`, { waitUntil: 'networkidle' });
      await sleep(600);
      const askedBefore = asked();
      for (const href of ['/templates', '/chats', '/events', '/agents']) {
        if (width < 1024) {
          await page.locator('[data-sidebar="trigger"]').first().click().catch(() => undefined);
          await sleep(400);
        }
        await page.locator(`a[href="${href}"]`).first().click();
        await page.waitForURL((u) => u.pathname.startsWith(href), { timeout: 15000 });
        await page.waitForLoadState('networkidle').catch(() => undefined);
        await sleep(400);
      }
      check(asked() === askedBefore, `and not again while moving between four screens (${asked() - askedBefore} more)`);
      // A body that never ends (a stream under another name) is not waited for.
      await Promise.race([Promise.all(reads), sleep(8000)]);
      const otherNotFound = notFound.filter((p) => !p.startsWith('/agents/admin/current'));
      check(otherNotFound.length === 0, `no other request was answered 404${otherNotFound.length ? `: ${[...new Set(otherNotFound)].join(', ')}` : ''}`);
      const known = (l) => KNOWN_HOLES.some((h) => l.includes(h.url));
      const fresh = [...new Set(leaks.filter((l) => !known(l)))];
      check(fresh.length === 0, `no answer of the API names an agent they do not reach, the reported holes aside${fresh.length ? `: ${fresh.join(' | ')}` : ''}`);
      for (const hole of KNOWN_HOLES) {
        const hits = leaks.filter((l) => l.includes(hole.url)).length;
        console.log(`  note: reported hole, not hidden by the console: GET ${hole.url} ${hole.why} (${hits} answers in this walk)`);
      }

      // A typed address of an agent they do not reach: the one 404 that is
      // theirs to provoke.
      section(`Admin console, ${width} px: the typed address of an agent they do not reach`);
      for (const agent of [AGENTS.ranch, AGENTS.c]) {
        const before = problems.length;
        await page.goto(`${ADMIN}/agents/${agent.id}`, { waitUntil: 'networkidle' });
        await sleep(1000);
        const asked = problems.splice(before).filter((p) => !p.includes(`404 GET ${API}/agents/${agent.id}`));
        problems.push(...asked);
        check(!(await textOf(page)).includes(agent.name), `${agent.id.slice(-1)}: no name`);
        check((await page.locator('textarea').count()) === 0, 'no chat');
      }
      await shot(page, `enforce-admin-typed-address-${width}`);

      // ------------------------------------- 5. a list that failed to load
      section(`Admin console, ${width} px: the agent list cannot be read`);
      const failList = (times) =>
        page.route(
          (url) => url.href.startsWith(API) && url.pathname === '/agents',
          (route) =>
            route.fulfill({
              status: 500,
              contentType: 'application/json',
              headers: { 'access-control-allow-origin': ADMIN, 'access-control-allow-credentials': 'true' },
              body: JSON.stringify({ statusCode: 500, message: 'Internal server error' }),
            }),
          { times },
        );
      const listFailures = () => problems.filter((p) => p.startsWith(`500 GET ${API}/agents`)).length;
      const dropListFailures = () => {
        for (let i = problems.length - 1; i >= 0; i -= 1) {
          if (problems[i].startsWith(`500 GET ${API}/agents`)) problems.splice(i, 1);
        }
      };
      // With rows already in the store: they stay.
      await page.goto(`${ADMIN}/agents/${AGENTS.b.id}`, { waitUntil: 'networkidle' });
      await sleep(500);
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await failList(1);
      await page.evaluate(() => window.useNuxtApp?.().$router.push('/chats')).catch(() => undefined);
      if (pathOf(page) !== '/chats') {
        // No global to reach the router through: the sidebar link does it.
        if (width < 1024) await page.locator('[data-sidebar="trigger"]').first().click().catch(() => undefined);
        await page.locator('a[href="/chats"]').first().click();
      }
      await page.waitForURL((u) => u.pathname === '/chats', { timeout: 15000 });
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await sleep(600);
      const failedOnce = listFailures();
      await page.goBack({ waitUntil: 'networkidle' }).catch(() => undefined);
      await page.waitForURL((u) => u.pathname.startsWith('/agents/'), { timeout: 15000 }).catch(() => undefined);
      await sleep(600);
      if (width < 1024) await page.getByRole('button', { name: 'Agents', exact: true }).first().click().catch(() => undefined);
      await sleep(400);
      const kept = await textOf(page);
      check(failedOnce >= 1, 'a read of the list is answered 500');
      check(
        kept.includes(AGENTS.a.name) && kept.includes(AGENTS.b.name),
        'the rows the store had are still offered',
      );
      if (width < 1024) await page.keyboard.press('Escape').catch(() => undefined);
      dropListFailures();

      // With nothing in the store: the page says the list did not arrive.
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await failList(8);
      await page.goto(`${ADMIN}/agents`, { waitUntil: 'networkidle' });
      const failed = page.locator('[data-agents-empty="load_failed"]');
      check(Boolean(await until(async () => (await failed.count()) > 0, { timeout: 15000 })), 'a first read that fails says the agents could not be loaded');
      check(!(await textOf(page)).includes('Create your first agent'), 'and does not offer a first agent');
      await shot(page, `enforce-admin-list-failed-${width}`);
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await failed.getByRole('button', { name: 'Try again' }).click();
      await page.waitForURL((u) => /^\/agents\/.+/.test(u.pathname), { timeout: 15000 }).catch(() => undefined);
      check(reachedByAdmin.has(pathOf(page).split('/')[2] ?? ''), `"Try again" reads it and opens an agent (${pathOf(page)})`);
      dropListFailures();

      noProblems(problems);
      await context.close();
    }

    // ------------------------------------------------- 6. the restart marks
    section('Admin console, 1440 px: the restart marks the browser keeps');
    {
      const { context, page, problems } = await watchedPage(browser, { width: 1440, height: 900, expected: [NO_BUCKET, { status: 404, url: '/agents/admin/current' }] });
      const OLD = ['agent:pendingRestart', 'agent:restartInFlight', 'agentFile:pendingRestart'];
      const mine = `agent:pendingRestart:${adminId}`;
      const banner = page.getByText('Restart the agent to apply the changes', { exact: false });
      // A browser that used the console before: the first removal has run
      // (the flag says '1'), the three unscoped maps are still there, and the
      // Admin has a mark of their own under the new key. Seeded once, before
      // any script of the console runs.
      await context.addInitScript(
        ({ old, key, agentId }) => {
          if (sessionStorage.getItem('enforce.seeded')) return;
          sessionStorage.setItem('enforce.seeded', '1');
          localStorage.setItem('ranch.accountKeys.admin', '1');
          localStorage.setItem(old[0], JSON.stringify({ [agentId]: true }));
          localStorage.setItem(old[1], JSON.stringify({}));
          localStorage.setItem(old[2], JSON.stringify({ [agentId]: true }));
          localStorage.setItem(key, JSON.stringify({ [agentId]: true }));
        },
        { old: OLD, key: mine, agentId: AGENTS.b.id },
      );
      const signOut = async (who) => {
        await page.locator('button', { hasText: who.email }).first().click();
        await page.getByRole('menuitem', { name: 'Sign out' }).click();
        await page.waitForURL((u) => u.pathname === '/login', { timeout: 15000 });
      };
      const signIn = async (who) => {
        await page.locator('input[type="email"], input[name="email"]').first().fill(who.email);
        await page.locator('input[type="password"]').first().fill(who.password);
        await Promise.all([
          page.waitForURL((u) => u.pathname.startsWith('/agents'), { timeout: 20000 }),
          page.locator('button[type="submit"]').first().click(),
        ]);
      };
      const openBravo = async () => {
        // Without a reload: the store in memory is what is being checked.
        await page.waitForURL((u) => /^\/agents\/.+/.test(u.pathname), { timeout: 20000 });
        if (pathOf(page) !== `/agents/${AGENTS.b.id}`) {
          await page.getByText(AGENTS.b.name, { exact: true }).first().click();
          await page.waitForURL((u) => u.pathname === `/agents/${AGENTS.b.id}`, { timeout: 15000 });
        }
        await page.locator('textarea').first().waitFor({ state: 'visible', timeout: 20000 });
        await sleep(800);
      };

      await page.goto(`${ADMIN}/login`, { waitUntil: 'networkidle' });
      {
        const store = await storageOf(page);
        const left = OLD.filter((k) => k in store);
        check(left.length === 0, `the three unscoped maps are removed on the first load${left.length ? `, not ${left}` : ''}`);
        check(store['ranch.accountKeys.admin'] === '2', `and the browser is marked as swept to step 2 (${store['ranch.accountKeys.admin']})`);
        check(Boolean(store[mine]), 'the scoped map is left alone');
      }
      await signIn(ADMIN_USER);
      await openBravo();
      check((await banner.count()) > 0, `the Admin is told ${AGENTS.b.name} wants a restart: their own mark`);
      await shot(page, 'enforce-admin-restart-mark-admin-1440');

      await signOut(ADMIN_USER);
      await signIn(OWNER);
      await openBravo();
      check((await banner.count()) === 0, 'the Owner, signing in after them in the same tab, is not');
      {
        const store = await storageOf(page);
        check(!(`agent:pendingRestart:${ownerId}` in store), 'nothing was written under the Owner’s id');
        check(Boolean(store[mine]), 'the Admin’s map is still the Admin’s');
        const bare = Object.keys(store).filter((k) => OLD.includes(k));
        check(bare.length === 0, `no unscoped map came back${bare.length ? `: ${bare}` : ''}`);
      }
      await shot(page, 'enforce-admin-restart-mark-owner-1440');

      await signOut(OWNER);
      await signIn(ADMIN_USER);
      await openBravo();
      check((await banner.count()) > 0, 'the Admin signs in again and has their mark back');
      // Taken off the way a person does, so nothing is left behind.
      // The banner's last button is its close mark (an icon, no name).
      await banner.first().locator('xpath=..').locator('button').last().click();
      await sleep(300);
      check((await banner.count()) === 0, 'they dismiss it');
      {
        const store = await storageOf(page);
        check(!store[mine] || store[mine] === '{}', `and their map is empty (${store[mine] ?? 'no key'})`);
      }
      noProblems(problems);
      await context.close();
    }
  }
} finally {
  await browser.close();
  const failed = await putAssistantAccessBack();
  check(failed.length === 0, `the assistant setting is as this script found it${failed.length ? `: ${failed.join(', ')}` : ''}`);
}

done('enforce');
