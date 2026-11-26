// Choosing another agent never shows an empty pane (CLEAN-260).
//
//   node specs/032-agent-user-access/e2e/switch-agent.mjs
//   node specs/032-agent-user-access/e2e/switch-agent.mjs --only app      (app | admin)
//   node specs/032-agent-user-access/e2e/switch-agent.mjs --widths 1440
//
// The defect, seen on production: in the app console the pane under the
// agent's header was completely empty (no feed, no composer, no loader) for
// as long as `GET /agents/:id` took, on every switch.
//
// The script makes the slow network itself: `GET /agents/:id` and the
// transcript route are held for DELAY ms through request interception. Every
// page carries a recorder, injected before any script of the console runs: on
// each animation frame it writes down the address, whether a composer is on
// screen, and what the feed shows (messages, a loader, the empty-conversation
// starter, something else, or nothing). A check on "no frame" reads that
// record, so a pane that was empty for one frame fails it.
//
// The local stack keeps no transcripts (no bucket), so the transcript answer
// is written here, after the delay: for an agent talked to in this browser it
// is the same conversation as the server would hold it (the same words and
// times under other ids, which is what the runtime's file gives), for
// access-charlie a conversation this browser has never seen, and for
// access-ranch the server's own answer, which is empty.
//
// App console, at 390 px and 1440 px, as the Owner:
//   1. switch to an agent whose conversation is in memory
//   2. reload at an agent: a cold load by address with a kept conversation
//   3. switch to an agent whose conversation is kept in the browser and whose
//      transcript arrives later: on screen in the first frame, no jump when
//      the transcript merges
//   4. switch to an agent never opened: a loader and the composer, then the
//      conversation; and to one whose conversation is empty: then the starter
//   5. back and forth quickly: an answer for the previous agent never paints
//      over the current one
//   6. a cold load by address with nothing kept, the agent list held as well
//   7. the agent request fails: the chat stays and the sheet says so
//   8. as a User, the address of an agent they do not reach: the page leaves
//      for their own agents (CLEAN-231) and shows nothing of it on the way
// Admin console, at 1440 px: the Chat tab of an agent opened for the first
// time, the transcript held.
//
// Fails on any console error and any failed request not listed in EXPECTED_*.
// Screenshots go to SHOTS_DIR (default: a folder in the system temp
// directory), never into the repo. Prints no secrets.
//
// Needs: API :3333 (after seed.mjs), app :3000, admin :3001, fakeRuntime.mjs.
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  ADMIN,
  AGENTS,
  API,
  APP,
  OWNER,
  USER,
  WIDTHS,
  api,
  arg,
  chatOn,
  check,
  done,
  fake,
  launch,
  section,
  sleep,
  until,
  watchedPage,
} from './lib.mjs';

const SHOTS = resolve(process.env.SHOTS_DIR || resolve(tmpdir(), 'ranch-260-shots'));
mkdirSync(SHOTS, { recursive: true });
const shot = (page, name) => page.screenshot({ path: resolve(SHOTS, `${name}.png`) });

const DELAY = Number(process.env.SWITCH_DELAY_MS || 1500);
const only = arg('only');
const widths = arg('widths') ? String(arg('widths')).split(',').map(Number) : WIDTHS;
const HEIGHTS = { 390: 844, 1440: 900 };

/** The admin console reads an agent's workspace from a bucket the local stack does not have. */
const EXPECTED_ADMIN = [
  { status: 400, url: /\/agents\/[^/]+\/(env|channels|files|secrets)(\?|\/|$)/ },
];

// ------------------------------------------------------------- the recorder

/**
 * Runs in the page before anything else. One entry per animation frame.
 *
 * `feed` is what the pane under the agent's header shows:
 *   messages   at least one message bubble
 *   loader     a loading placeholder (and no message)
 *   starter    the empty-conversation starter
 *   other      some other text (the "unavailable" panel, the history list)
 *   blank      nothing at all
 *   none       there is no pane in the document
 */
function recorder() {
  const state = { frames: [] };
  window.__frames = state;
  const visible = (el) => {
    if (!el) return false;
    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none';
  };
  const LOADER = '[data-chat-state="loading"], [aria-busy="true"], .animate-spin, .animate-pulse, [data-slot="skeleton"]';
  /** The pane: marked since CLEAN-260; before it, the block after the sheet. */
  const paneOf = () => {
    const marked = document.querySelector('[data-agent-pane]');
    if (marked) return marked;
    const sheet = document.querySelector('section.agent-sheet');
    if (sheet) return sheet.nextElementSibling;
    // The admin console: the chat is a card.
    return document.querySelector('textarea')?.closest('[data-slot="card"]') ?? null;
  };
  const tick = () => {
    if (document.body) {
      const pane = paneOf();
      const scope = pane ?? document.body;
      const bubbles = [...scope.querySelectorAll('[data-message-id]')].filter(visible);
      const loader = [...scope.querySelectorAll(LOADER)].some(visible);
      const text = pane ? (pane.innerText ?? '').replace(/\s+/g, ' ').trim() : '';
      const starter = !!scope.querySelector('[data-chat-state="empty"]');
      let feed = 'none';
      if (pane) {
        if (bubbles.length) feed = 'messages';
        else if (loader) feed = 'loader';
        else if (starter) feed = 'starter';
        else if (text) feed = 'other';
        else feed = 'blank';
      }
      const scroller = bubbles[0]?.closest('.overflow-y-auto, [data-radix-scroll-area-viewport], [data-reka-scroll-area-viewport]');
      const last = bubbles[bubbles.length - 1];
      state.frames.push({
        t: performance.now(),
        path: location.pathname,
        composer: [...document.querySelectorAll('textarea')].some(visible),
        feed,
        count: bubbles.length,
        words: bubbles.map((el) => (el.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)),
        heading: (document.querySelector('section.agent-sheet h1')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
        lastBottom: last ? Math.round(last.getBoundingClientRect().bottom) : null,
        fromBottom: scroller ? Math.round(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight) : null,
        text: text.slice(0, 60),
      });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const startRecording = (page) => page.evaluate(() => (window.__frames.frames.length = 0));
const framesOf = (page) => page.evaluate(() => window.__frames.frames);

/** `messages ×12, blank ×93, messages ×40`: the feed as it went, in order. */
function story(frames) {
  const runs = [];
  for (const f of frames) {
    const what = `${f.composer ? '' : 'no composer + '}${f.feed}`;
    const run = runs[runs.length - 1];
    if (run && run.what === what) {
      run.n += 1;
      run.to = f.t;
    } else runs.push({ what, n: 1, from: f.t, to: f.t });
  }
  return runs.map((r) => `${r.what} ×${r.n} (${Math.round(r.to - r.from)} ms)`).join(' → ');
}

const tally = { frames: 0, noComposer: 0, empty: 0 };
/**
 * The two checks every scenario makes on the frames at the agent's address.
 * `starterOk`: the conversation really is empty, so the starter may follow
 * the loader (never precede it).
 */
function judge(frames, label, { starterOk = false } = {}) {
  const noComposer = frames.filter((f) => !f.composer);
  const allowed = starterOk ? ['messages', 'loader', 'starter'] : ['messages', 'loader'];
  const empty = frames.filter((f) => !allowed.includes(f.feed));
  tally.frames += frames.length;
  tally.noComposer += noComposer.length;
  tally.empty += empty.length;
  console.log(`  frames: ${story(frames)}`);
  check(frames.length > 0 && noComposer.length === 0, `${label}: the composer is on screen in every frame (${noComposer.length} of ${frames.length} without it)`);
  check(
    frames.length > 0 && empty.length === 0,
    `${label}: the feed shows messages or a loader in every frame (${empty.length} of ${frames.length} show neither${empty.length ? `: ${[...new Set(empty.map((f) => f.feed))].join(', ')}` : ''})`,
  );
  if (starterOk) {
    const firstStarter = frames.findIndex((f) => f.feed === 'starter');
    const lastLoader = frames.map((f) => f.feed).lastIndexOf('loader');
    check(firstStarter === -1 || firstStarter > lastLoader, `${label}: the starter comes after the loader, not before it`);
  }
  return { noComposer, empty };
}

// ------------------------------------------------------------------ helpers

const agentPath = (id) => `/agents/${id}`;
const isApi = (url) => url.href.startsWith(API);
const noProblems = (problems) =>
  check(problems.length === 0, `no console error, no unexpected failed request${problems.length ? `: ${problems.join(' | ')}` : ''}`);

async function signIn(page, base, who) {
  await page.goto(`${base}/login`, { waitUntil: 'networkidle' });
  await page.locator('input[type="email"], input[name="email"]').first().fill(who.email);
  await page.locator('input[type="password"]').first().fill(who.password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }),
    page.locator('button[type="submit"]').first().click(),
  ]);
}

async function idle(page, ms = 800) {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await sleep(ms);
}

/** App console: choose an agent in the list, the way a person does. */
async function choose(page, width, id) {
  if (width < 1024) await page.locator('[data-rail-open]').first().click();
  const row = page.locator(`li[data-agent-id="${id}"]:visible button`).first();
  await row.waitFor({ state: 'visible', timeout: 10000 });
  await row.click();
}

/** The conversation the browser keeps for an agent, as the server would hold it. */
async function serverCopy(page, agentId) {
  return page.evaluate((id) => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('bridle:conversation:') && k.endsWith(`:${id}`));
    if (!key) return [];
    let list = [];
    try {
      const parsed = JSON.parse(localStorage.getItem(key) ?? '[]');
      list = Array.isArray(parsed) ? parsed : (parsed.messages ?? []);
    } catch {
      return [];
    }
    return list
      .filter((m) => m.text)
      .map((m, i) => ({ id: `srv-${id.slice(-1)}-${i}`, role: m.role === 'user' ? 'user' : 'assistant', text: m.text, ts: m.ts }));
  }, agentId);
}

// ---------------------------------------------------------------------- run

const A = AGENTS.a;
const B = AGENTS.b;
const C = AGENTS.c;
const R = AGENTS.ranch;

if (!(await fake.health())) throw new Error('fakeRuntime.mjs is not running (node specs/032-agent-user-access/e2e/fakeRuntime.mjs)');

const browser = await launch();
try {
  for (const width of only === 'admin' ? [] : widths) {
    const height = HEIGHTS[width] ?? 900;
    const tag = `${Date.now().toString(36)}-${width}`;
    const said = {
      [A.id]: [`alpha one ${tag}`, `alpha two ${tag}`, `alpha three ${tag}`],
      [B.id]: [`bravo one ${tag}`, `bravo two ${tag}`, `bravo three ${tag}`],
    };
    /** Sentences that belong to one agent and must never be shown under another. */
    const foreign = (frames, id, others) =>
      frames.filter((f) => f.path === agentPath(id) && others.some((o) => f.words.some((w) => said[o]?.some((s) => w.includes(s)) || w.includes(`server ${o.slice(-1)} `))));

    section(`App console, ${width} px: two conversations to switch between`);
    const { context, page, problems } = await watchedPage(browser, {
      width,
      height,
      // Scenario 7 answers the agent request 503 on purpose.
      expected: [{ status: 503, url: new RegExp(`/agents/${A.id}$`) }],
    });
    await context.addInitScript(recorder);
    // The list beside the chat, so that choosing an agent is one click at
    // 1440 px. The map goes through the same handler.
    await context.addInitScript(() => {
      try {
        localStorage.setItem('agent:view', 'list');
      } catch {
        // No storage: the map it is.
      }
    });
    await signIn(page, APP, OWNER);
    for (const agent of [A, B]) {
      await page.goto(APP + agentPath(agent.id), { waitUntil: 'networkidle' });
      const chat = chatOn(page);
      await chat.ready();
      // A conversation the server holds nothing of, so every run starts clean.
      let ok = true;
      for (const line of said[agent.id]) ok = Boolean(await chat.say(line)) && ok;
      check(ok, `the Owner exchanges three messages with ${agent.name}`);
    }
    await idle(page);
    const copies = { [A.id]: await serverCopy(page, A.id), [B.id]: await serverCopy(page, B.id) };
    check(copies[A.id].length >= 6 && copies[B.id].length >= 6, `the browser keeps both conversations (${copies[A.id].length} and ${copies[B.id].length} messages)`);
    const now = Date.now();
    copies[C.id] = Array.from({ length: 8 }, (_, i) => ({
      id: `srv-c-${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      text: `server c line ${i + 1} ${tag}`,
      ts: now - (8 - i) * 60_000,
    }));

    // ------------------------------------------------- the slow network
    /** What the script holds back, and for how long; changed by the scenarios. */
    const net = { delay: DELAY, list: false, failAgent: null, log: [] };
    await page.route(
      (url) => isApi(url) && /^\/agents\/agent-[^/]+$/.test(url.pathname),
      async (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        const id = new URL(route.request().url()).pathname.split('/').pop();
        await sleep(net.delay);
        net.log.push(`agent ${id.slice(-1)}`);
        if (net.failAgent === id) {
          return route.fulfill({
            status: 503,
            contentType: 'application/json',
            headers: { 'access-control-allow-origin': APP, 'access-control-allow-credentials': 'true' },
            body: JSON.stringify({ statusCode: 503, message: 'Service Unavailable' }),
          });
        }
        return route.continue().catch(() => undefined);
      },
    );
    await page.route(
      (url) => isApi(url) && url.pathname === '/agents',
      async (route) => {
        if (net.list && route.request().method() === 'GET') await sleep(net.delay);
        return route.continue().catch(() => undefined);
      },
    );
    await page.route(
      (url) => isApi(url) && /^\/api\/agent\/[^/]+\/transcript$/.test(url.pathname),
      async (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        const id = new URL(route.request().url()).pathname.split('/')[3];
        await sleep(net.delay);
        net.log.push(`transcript ${id.slice(-1)}`);
        const messages = copies[id];
        if (!messages) return route.continue().catch(() => undefined);
        try {
          const response = await route.fetch();
          const json = await response.json();
          const data = { ...(json.data ?? json), messages, nextCursor: null, hasMore: false };
          return await route.fulfill({ response, json: 'data' in json ? { ...json, data } : data });
        } catch {
          // The page moved on while the answer was held.
          return undefined;
        }
      },
    );

    // ---------------------------------------------------------------- 1
    section(`App console, ${width} px: 1. switch to an agent whose conversation is in memory`);
    await page.goto(APP + agentPath(A.id), { waitUntil: 'networkidle' });
    await idle(page, DELAY + 800);
    await page.goto(APP + agentPath(B.id), { waitUntil: 'networkidle' });
    await idle(page, DELAY + 800);
    // Both are loaded in this page session now. Back to alpha by the list.
    await startRecording(page);
    await choose(page, width, A.id);
    await page.waitForURL((u) => u.pathname === agentPath(A.id), { timeout: 10000 });
    await sleep(250);
    await shot(page, `1-switch-in-memory-during-request-${width}`);
    await idle(page, DELAY + 600);
    {
      const frames = (await framesOf(page)).filter((f) => f.path === agentPath(A.id));
      judge(frames, 'in memory');
      const first = frames[0];
      check(
        Boolean(first) && said[A.id].every((s) => first.words.some((w) => w.includes(s))),
        `the first frame at ${A.name} has its conversation (${first?.count ?? 0} messages)`,
      );
      check(foreign(frames, A.id, [B.id, C.id]).length === 0, `no frame at ${A.name} shows a message of another agent`);
    }

    // ---------------------------------------------------------------- 2
    section(`App console, ${width} px: 2. a cold load by address, the conversation kept in the browser`);
    await page.goto(APP + agentPath(B.id), { waitUntil: 'commit' });
    await sleep(700);
    await shot(page, `2-cold-load-kept-during-request-${width}`);
    await idle(page, DELAY + 800);
    {
      const all = await framesOf(page);
      // From the first frame in which the console has drawn its own shell.
      const start = all.findIndex((f) => f.feed !== 'none' || f.composer);
      const frames = (start === -1 ? [] : all.slice(start)).filter((f) => f.path === agentPath(B.id));
      console.log(`  ${start === -1 ? all.length : start} frames before the console drew anything of the page`);
      judge(frames, 'cold load, kept');
      const first = frames[0];
      check(
        Boolean(first) && said[B.id].every((s) => first.words.some((w) => w.includes(s))),
        `the first frame the page is drawn in has the kept conversation (${first?.count ?? 0} messages)`,
      );
    }

    // ---------------------------------------------------------------- 3
    section(`App console, ${width} px: 3. switch to a kept conversation, the transcript arrives later`);
    net.log.length = 0;
    await startRecording(page);
    await choose(page, width, A.id);
    await page.waitForURL((u) => u.pathname === agentPath(A.id), { timeout: 10000 });
    await sleep(120);
    await shot(page, `3-switch-kept-first-frames-${width}`);
    await until(() => net.log.includes(`transcript ${A.id.slice(-1)}`), { timeout: DELAY * 3 + 6000 });
    await idle(page, 900);
    {
      const frames = (await framesOf(page)).filter((f) => f.path === agentPath(A.id));
      judge(frames, 'kept');
      const first = frames[0];
      check(
        Boolean(first) && said[A.id].every((s) => first.words.some((w) => w.includes(s))),
        `the first frame at ${A.name} has the kept conversation (${first?.count ?? 0} messages)`,
      );
      check(net.log.includes(`transcript ${A.id.slice(-1)}`), 'the transcript was asked for and answered behind it');
      const counts = [...new Set(frames.map((f) => f.count))];
      const bottoms = [...new Set(frames.map((f) => f.lastBottom))];
      const gaps = [...new Set(frames.map((f) => f.fromBottom))];
      check(counts.length === 1, `the number of messages on screen never changes (${counts.join(', ')})`);
      check(
        bottoms.length === 1 && gaps.length === 1,
        `nothing moves when the transcript merges: the last message stays at ${bottoms.join(' / ')} px, ${gaps.join(' / ')} px from the end of the feed`,
      );
      const ids = await page.evaluate(() => [...document.querySelectorAll('[data-message-id]')].map((el) => el.getAttribute('data-message-id')));
      check(ids.some((id) => id?.startsWith('srv-')), 'what is on screen afterwards is the server\'s transcript');
    }

    // ---------------------------------------------------------------- 4
    section(`App console, ${width} px: 4. switch to an agent never opened in this browser`);
    net.log.length = 0;
    await startRecording(page);
    await choose(page, width, C.id);
    await page.waitForURL((u) => u.pathname === agentPath(C.id), { timeout: 10000 });
    await sleep(500);
    await shot(page, `4-never-opened-loader-${width}`);
    await until(() => net.log.includes(`transcript ${C.id.slice(-1)}`), { timeout: DELAY * 3 + 6000 });
    await idle(page, 900);
    {
      const frames = (await framesOf(page)).filter((f) => f.path === agentPath(C.id));
      judge(frames, 'never opened');
      check(frames[0]?.feed === 'loader', `the first frame at ${C.name} shows a loader (${frames[0]?.feed})`);
      const lastFeed = frames[frames.length - 1];
      check(lastFeed?.feed === 'messages' && lastFeed.count === 8, `then the conversation the server holds (${lastFeed?.count} messages)`);
      check(foreign(frames, C.id, [A.id, B.id]).length === 0, `no frame at ${C.name} shows a message of another agent`);
      await shot(page, `4-never-opened-loaded-${width}`);
    }

    net.log.length = 0;
    await startRecording(page);
    await choose(page, width, R.id);
    await page.waitForURL((u) => u.pathname === agentPath(R.id), { timeout: 10000 });
    await until(() => net.log.includes(`transcript ${R.id.slice(-1)}`), { timeout: DELAY * 3 + 6000 });
    await idle(page, 900);
    {
      const frames = (await framesOf(page)).filter((f) => f.path === agentPath(R.id));
      judge(frames, 'never opened, empty', { starterOk: true });
      check(frames[0]?.feed === 'loader', `the first frame at ${R.name} shows a loader (${frames[0]?.feed})`);
      check(frames[frames.length - 1]?.feed === 'starter', `an empty conversation ends on the starter (${frames[frames.length - 1]?.feed})`);
    }

    // ---------------------------------------------------------------- 5
    section(`App console, ${width} px: 5. back and forth quickly`);
    // A fresh page session, so that every agent's requests are made again.
    await page.goto(APP + agentPath(A.id), { waitUntil: 'networkidle' });
    await idle(page, DELAY + 800);
    net.log.length = 0;
    await startRecording(page);
    await choose(page, width, B.id);
    await sleep(200);
    await choose(page, width, C.id);
    await sleep(200);
    await choose(page, width, A.id);
    await sleep(200);
    await choose(page, width, B.id);
    await page.waitForURL((u) => u.pathname === agentPath(B.id), { timeout: 10000 });
    await idle(page, DELAY * 2 + 1500);
    {
      const all = await framesOf(page);
      const frames = all.filter((f) => /^\/agents\/agent-/.test(f.path));
      judge(frames, 'back and forth');
      const names = { [A.id]: A.name, [B.id]: B.name, [C.id]: C.name };
      const wrongWords = [
        ...foreign(all, A.id, [B.id, C.id]),
        ...foreign(all, B.id, [A.id, C.id]),
        ...foreign(all, C.id, [A.id, B.id]),
      ];
      check(wrongWords.length === 0, `no frame shows one agent's messages at another agent's address (${wrongWords.length} of ${all.length})`);
      const wrongHeading = all.filter((f) => names[f.path.split('/').pop()] && f.heading && !f.heading.includes(names[f.path.split('/').pop()]));
      check(wrongHeading.length === 0, `the header names the agent of the address in every frame (${wrongHeading.length} of ${all.length})`);
      const end = all[all.length - 1];
      check(
        end?.path === agentPath(B.id) && said[B.id].every((s) => end.words.some((w) => w.includes(s))) && end.heading.includes(B.name),
        `it ends on ${B.name} with its own conversation, after every held answer has arrived (${net.log.join(', ')})`,
      );
    }

    // ---------------------------------------------------------------- 6
    section(`App console, ${width} px: 6. a cold load by address with nothing kept, the list held too`);
    await page.evaluate((id) => {
      for (const k of Object.keys(localStorage)) if (k.startsWith('bridle:') && k.endsWith(`:${id}`)) localStorage.removeItem(k);
    }, C.id);
    net.list = true;
    net.log.length = 0;
    await page.goto(APP + agentPath(C.id), { waitUntil: 'commit' });
    await sleep(900);
    await shot(page, `6-cold-load-nothing-kept-loader-${width}`);
    await until(() => net.log.includes(`transcript ${C.id.slice(-1)}`), { timeout: DELAY * 4 + 8000 });
    await idle(page, 900);
    net.list = false;
    {
      const all = await framesOf(page);
      const start = all.findIndex((f) => f.feed !== 'none' || f.composer);
      const frames = (start === -1 ? [] : all.slice(start)).filter((f) => f.path === agentPath(C.id));
      console.log(`  ${start === -1 ? all.length : start} frames before the console drew anything of the page`);
      judge(frames, 'cold load, nothing kept');
      check(frames[0]?.feed === 'loader', `the first frame the page is drawn in shows a loader (${frames[0]?.feed})`);
      check(frames[frames.length - 1]?.feed === 'messages', `then the conversation (${frames[frames.length - 1]?.count} messages)`);
    }

    // ---------------------------------------------------------------- 7
    section(`App console, ${width} px: 7. the agent request fails`);
    net.failAgent = A.id;
    net.delay = 400;
    await startRecording(page);
    await choose(page, width, A.id);
    await page.waitForURL((u) => u.pathname === agentPath(A.id), { timeout: 10000 });
    const failure = page.locator('[data-agent-refresh-failed]');
    const told = await until(async () => (await failure.count()) > 0 && (await failure.first().isVisible()), { timeout: 8000 });
    await idle(page, 600);
    {
      const frames = (await framesOf(page)).filter((f) => f.path === agentPath(A.id));
      judge(frames, 'request failed');
      check(Boolean(told), `the sheet says the agent could not be refreshed: "${told ? (await failure.first().innerText()).replace(/\s+/g, ' ').trim() : ''}"`);
      const unavailable = frames.filter((f) => f.feed === 'other');
      check(unavailable.length === 0, `no frame shows "unavailable" for an agent the console holds (${unavailable.length})`);
      await shot(page, `7-agent-request-failed-${width}`);
      const chat = chatOn(page);
      check(Boolean(await chat.say(`after the failure ${tag}`)), 'and the chat still answers');
    }
    net.failAgent = null;
    if (told) {
      await failure.first().locator('button').first().click();
      check(Boolean(await until(async () => (await failure.count()) === 0, { timeout: 8000 })), '"Try again" asks again, and the line goes once the agent answers');
    }
    net.delay = DELAY;

    noProblems(problems);
    await context.close();

    // ---------------------------------------------------------------- 8
    section(`App console, ${width} px: 8. the address of an agent this account does not reach`);
    const mine = (await api('/agents', { as: USER })).body.map((a) => a.id);
    const hidden = Object.values(AGENTS).find((a) => !mine.includes(a.id));
    if (!hidden || !mine.length) {
      console.log('  note: the seeded User reaches every agent or none; nothing to check');
    } else {
      const user = await watchedPage(browser, {
        width,
        height,
        // The API's "no" for an agent that is not this account's: its record,
        // and the History counter the workspace asks for with every address.
        expected: [
          { status: 404, url: new RegExp(`/agents/${hidden.id}(/|$)`) },
          { status: 404, url: new RegExp(`/me/chats\\?.*agentId=${hidden.id}`) },
        ],
      });
      await user.context.addInitScript(recorder);
      await signIn(user.page, APP, USER);
      await idle(user.page);
      await user.page.goto(APP + agentPath(hidden.id), { waitUntil: 'commit' });
      const left = await until(() => /^\/agents\/agent-/.test(new URL(user.page.url()).pathname) && !user.page.url().includes(hidden.id), { timeout: 15000 });
      await idle(user.page, 800);
      const frames = await framesOf(user.page);
      const at = frames.filter((f) => f.path === agentPath(hidden.id));
      console.log(`  frames at its address: ${story(at)}`);
      check(Boolean(left), `the page leaves for an agent of the User's own (${new URL(user.page.url()).pathname.split('/').pop() === hidden.id ? 'it stayed' : 'it left'})`);
      check(at.every((f) => f.count === 0 && !f.heading.includes(hidden.name)), `nothing of ${hidden.name} is shown on the way: no message, no name`);
      const end = frames[frames.length - 1];
      check(Boolean(end?.composer) && mine.includes(end.path.split('/').pop()), 'and it ends on a chat the User may use');
      noProblems(user.problems);
      await user.context.close();
    }
  }

  // ================================================================ admin
  if (only !== 'app') {
    section('Admin console, 1440 px: the Chat tab of an agent, the transcript held');
    const { context, page, problems } = await watchedPage(browser, { width: 1440, height: 900, expected: EXPECTED_ADMIN });
    await context.addInitScript(recorder);
    await signIn(page, ADMIN, OWNER);
    const tag = `${Date.now().toString(36)}-admin`;
    const now = Date.now();
    const held = Array.from({ length: 6 }, (_, i) => ({
      id: `srv-admin-${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      text: `server admin line ${i + 1} ${tag}`,
      ts: now - (6 - i) * 60_000,
    }));
    const log = [];
    await page.route(
      (url) => isApi(url) && /^\/agents\/agent-[^/]+$/.test(url.pathname),
      async (route) => {
        if (route.request().method() === 'GET') await sleep(DELAY);
        return route.continue().catch(() => undefined);
      },
    );
    await page.route(
      (url) => isApi(url) && /^\/api\/agent\/[^/]+\/transcript$/.test(url.pathname),
      async (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        const id = new URL(route.request().url()).pathname.split('/')[3];
        await sleep(DELAY);
        log.push(id);
        if (id !== C.id) return route.continue().catch(() => undefined);
        try {
          const response = await route.fetch();
          const json = await response.json();
          const data = { ...(json.data ?? json), messages: held, nextCursor: null, hasMore: false };
          return await route.fulfill({ response, json: 'data' in json ? { ...json, data } : data });
        } catch {
          return undefined;
        }
      },
    );
    const chatUrl = (id) => `${ADMIN}/agents/${id}?tab=chat`;
    const adminPane = (frames, id) => frames.filter((f) => f.path === `/agents/${id}`);

    await page.goto(chatUrl(B.id), { waitUntil: 'networkidle' });
    await idle(page, DELAY + 800);

    // Another agent, chosen in the rail, its conversation never loaded here.
    log.length = 0;
    await startRecording(page);
    await page.locator(`li[data-agent-id="${C.id}"] button`).first().click();
    await page.waitForURL((u) => u.pathname === `/agents/${C.id}`, { timeout: 10000 });
    await sleep(500);
    await shot(page, 'admin-never-opened-loader-1440');
    await until(() => log.includes(C.id), { timeout: DELAY * 3 + 6000 });
    await idle(page, 900);
    {
      const frames = adminPane(await framesOf(page), C.id);
      console.log(`  frames: ${story(frames)}`);
      const blank = frames.filter((f) => !f.composer);
      const wrong = frames.filter((f) => f.text.includes('Start a conversation') && f.feed !== 'starter');
      tally.frames += frames.length;
      tally.noComposer += blank.length;
      check(frames.length > 0 && blank.length === 0, `the composer is on screen in every frame (${blank.length} of ${frames.length} without it)`);
      const before = frames.filter((f) => f.feed !== 'messages');
      const notLoader = before.filter((f) => f.feed !== 'loader');
      tally.empty += notLoader.length;
      check(
        notLoader.length === 0 && wrong.length === 0,
        `until the transcript arrives the feed shows a loader, not "Start a conversation" (${notLoader.length} of ${before.length} frames show ${[...new Set(notLoader.map((f) => f.feed))].join(', ') || 'nothing else'})`,
      );
      const end = frames[frames.length - 1];
      check(end?.feed === 'messages' && end.count === 6, `then the conversation the server holds (${end?.count} messages)`);
      await shot(page, 'admin-never-opened-loaded-1440');
    }

    // Back to the one already loaded in this page session: at once.
    await startRecording(page);
    await page.locator(`li[data-agent-id="${B.id}"] button`).first().click();
    await page.waitForURL((u) => u.pathname === `/agents/${B.id}`, { timeout: 10000 });
    await idle(page, DELAY + 900);
    {
      const frames = adminPane(await framesOf(page), B.id);
      console.log(`  frames: ${story(frames)}`);
      const blank = frames.filter((f) => !f.composer);
      tally.frames += frames.length;
      tally.noComposer += blank.length;
      check(frames.length > 0 && blank.length === 0, `back to ${B.name}: the composer is on screen in every frame (${blank.length} of ${frames.length} without it)`);
      const wrong = frames.filter((f) => f.feed === 'blank' || f.feed === 'none');
      tally.empty += wrong.length;
      check(wrong.length === 0, `and the pane is never empty (${wrong.length} of ${frames.length})`);
    }
    noProblems(problems);
    await context.close();
  }
} finally {
  await browser.close();
}

console.log(`\nframes at an agent's address: ${tally.frames}; without a composer: ${tally.noComposer}; feed empty of both messages and a loader: ${tally.empty}`);
done('switch-agent');
