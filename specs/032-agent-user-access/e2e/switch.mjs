// Nothing carries over between accounts in one browser (CLEAN-231, User
// Story 5 of spec 032: FR-028 to FR-031, SC-009).
//
//   node specs/032-agent-user-access/e2e/switch.mjs
//   node specs/032-agent-user-access/e2e/switch.mjs --only admin
//
// The defect: the Owner chats with an agent in the app console and signs out;
// a User signs in in the same browser and sees the Owner's conversation for
// about a second (and, when the page was reloaded in between, for as long as
// the copy counted as recent).
//
// Every page here carries a recorder, injected before any script of the
// console runs: on each animation frame it writes down the address, the text
// of every rendered message and which of the Owner's sentences are anywhere
// in the document. A check on "no frame" reads that record, so something that
// was on screen for one frame fails it.
//
// App console, at 390 px and 1440 px:
//   1. sign-out empties the page at once; a User signing in in the same tab
//      is never shown the Owner's messages or the Owner's last agent
//   2. the same with a full reload between sign-out and sign-in (the path
//      that was observed)
//   3. the same account reloading gets its conversation back at once
//   4. the session-ended dialog: another account signing in there is shown
//      nothing of the page behind it; the same account keeps the page
//   5. what the browser keeps is per account
// Admin console, at 1440 px: an undelivered message of the Owner (the outbox)
// is not shown to an Admin who signs in after them.
//
// The agent is access-bravo: the Owner, the Admin and the User all reach it,
// so nothing here is refused for access and every absence is the console's
// own doing.
//
// Fails on any console error and any failed request not listed in EXPECTED_*.
//
// Needs: API :3333 (after seed.mjs), app :3000, admin :3001, fakeRuntime.mjs.
import {
  ADMIN,
  ADMIN_USER,
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
  shot,
  sleep,
  until,
  watchedPage,
} from './lib.mjs';

const AGENT = AGENTS.b;

/**
 * Failed requests the scenarios provoke on purpose.
 *
 * App: the session is ended by taking the session cookie away and answering
 * the Owner's next capacity poll 401 from the script; the console then asks
 * `/auth/refresh`, which the API answers 401 for a browser with no cookie.
 * Signing out when the cookie is already gone answers 401 too.
 */
const EXPECTED_APP = [
  { status: 401, url: '/agents/capacity' },
  { status: 401, url: '/auth/refresh' },
  { status: 401, url: '/auth/logout' },
];
/**
 * Admin: the local stack has no S3 bucket, so the routes that read an agent's
 * workspace answer 400 (see owner-only.mjs).
 */
const EXPECTED_ADMIN = [{ status: 400, url: /\/agents\/[^/]+\/(env|channels|files|secrets)(\?|\/|$)/ }];

// ------------------------------------------------------------- the recorder

/**
 * Runs in the page before anything else. `needles` are the sentences that
 * must not be shown to another account; they can be replaced later through
 * `__switch.needles`.
 */
function recorder(needles) {
  const state = { frames: [], needles, loginAt: null };
  window.__switch = state;
  // The moment the API accepted a sign-in, stamped before the console reads
  // the answer: a listener added here runs ahead of the console's own.
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    if (String(method).toUpperCase() === 'POST' && /\/auth\/login$/.test(String(url))) {
      this.addEventListener('load', () => {
        if (this.status >= 200 && this.status < 300) state.loginAt = performance.now();
      });
    }
    return open.call(this, method, url, ...rest);
  };
  const tick = () => {
    if (document.body) {
      const text = document.body.textContent ?? '';
      state.frames.push({
        t: performance.now(),
        path: location.pathname,
        messages: [...document.querySelectorAll('[data-message-id]')].map((el) =>
          (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
        ),
        composer: !!document.querySelector('textarea'),
        dialog: !!document.querySelector('[role="dialog"], [role="alertdialog"]'),
        seen: state.needles.filter((n) => text.includes(n)),
      });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const startRecording = (page) =>
  page.evaluate(() => {
    window.__switch.frames.length = 0;
    window.__switch.loginAt = null;
  });
const framesOf = (page) => page.evaluate(() => ({ frames: window.__switch.frames, loginAt: window.__switch.loginAt }));

/** One line about the frames that showed something they must not. */
function leakNote(bad, total) {
  if (!bad.length) return `${total} frames`;
  const first = bad[0];
  const span = Math.round(bad[bad.length - 1].t - first.t);
  return `${bad.length} of ${total} frames, over ${span} ms, first at ${first.path}: ${JSON.stringify(first.seen.length ? first.seen : first.messages).slice(0, 160)}`;
}

/** Frames in which a sentence of the previous account was in the document. */
const leaks = (frames) => frames.filter((f) => f.seen.length > 0);

// ------------------------------------------------------------------ helpers

const agentUrl = (base, id) => `${base}/agents/${id}`;

/** Waits until the chat is on screen and nothing has moved for a moment. */
async function chatIdle(page) {
  await page.locator('textarea').first().waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await sleep(1500);
}

async function fillLogin(page, who) {
  await page.locator('input[type="email"], input[name="email"]').first().fill(who.email);
  await page.locator('input[type="password"]').first().fill(who.password);
}

/**
 * The API of the shared local stack is restarted now and then by whoever is
 * working on it. A step that needs it waits for it rather than failing on a
 * refused connection that says nothing about the consoles.
 */
async function apiUp() {
  const up = await until(async () => (await fetch(`${API}/health`)).ok, { timeout: 90000, every: 1000 });
  if (!up) throw new Error(`the API at ${API} did not answer /health for 90 s`);
}

/** Sign in through the form that is on screen, recording from the click. */
async function signInRecorded(page, who) {
  await apiUp();
  await fillLogin(page, who);
  await startRecording(page);
  await Promise.all([
    page.waitForURL((u) => u.pathname.startsWith('/agents'), { timeout: 20000 }),
    page.locator('button[type="submit"]').first().click(),
  ]);
}

/** App console: the header's "Sign out", wherever the person is. */
async function appSignOut(page) {
  await page.getByRole('button', { name: 'Sign out' }).first().click();
  await page.waitForURL((u) => u.pathname === '/', { timeout: 15000 });
}

/** App console: from the landing page to the sign-in form, without a reload. */
async function appToLogin(page) {
  const link = page.locator('a[href="/login"]:visible').first();
  if ((await link.count()) === 0) {
    await page.getByRole('button', { name: /open menu/i }).first().click();
  }
  await page.locator('a[href="/login"]:visible').first().click();
  await page.waitForURL((u) => u.pathname === '/login', { timeout: 15000 });
  await page.locator('input[type="password"]').first().waitFor({ state: 'visible', timeout: 15000 });
}

const storageOf = (page) =>
  page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k) ?? ''])));

/** Console keys of the old, unscoped shape: one segment after the prefix. */
const unscopedKeys = (store) =>
  Object.keys(store).filter(
    (k) =>
      k === 'agent:lastOpened' ||
      (/^bridle:(conversation|seq|debug):[^:]+$/.test(k) && !/^bridle:(conversation|seq):share:/.test(k)) ||
      /^bridle:outbox:[^:]+:[^:]+$/.test(k),
  );

const idOf = async (who) => (await api('/auth/me', { as: who })).body.id;

/** Where an account with no remembered agent lands: first running, else first. */
async function landingFor(who) {
  const agents = (await api('/agents', { as: who })).body;
  return (agents.find((a) => a.status === 'running') ?? agents[0])?.id ?? null;
}

// ---------------------------------------------------------------------- run

const ownerId = await idOf(OWNER);
const userId = await idOf(USER);
const adminId = await idOf(ADMIN_USER);
const userLanding = await landingFor(USER);
if (userLanding === AGENT.id) {
  console.log(`  note: ${AGENT.name} is also where the User lands by default; the "last agent" check is then vacuous`);
}

/** `--only app` or `--only admin` runs one console's half. */
const only = arg('only');

const browser = await launch();
try {
  for (const width of only === 'admin' ? [] : WIDTHS) {
    const height = width < 600 ? 844 : 900;
    const tag = `${Date.now().toString(36)}-${width}`;
    const said = [`switch owner one ${tag}`, `switch owner two ${tag}`];

    // ============================================================ app
    section(`App console, ${width} px: sign-out, then another account in the same tab`);
    const { context, page, problems } = await watchedPage(browser, { width, height, expected: EXPECTED_APP });
    await context.addInitScript(recorder, said);

    await page.goto(`${APP}/login`, { waitUntil: 'networkidle' });
    await signInRecorded(page, OWNER);
    await page.goto(agentUrl(APP, AGENT.id), { waitUntil: 'networkidle' });
    const chat = chatOn(page);
    await chat.ready();
    check(Boolean(await chat.say(said[0])) && Boolean(await chat.say(said[1])), `the Owner exchanges two messages with ${AGENT.name}`);
    await sleep(500);
    await shot(page, `switch-app-owner-chat-${width}`);

    await startRecording(page);
    await appSignOut(page);
    await sleep(600);
    {
      const { frames } = await framesOf(page);
      const afterClick = frames.filter((f) => f.path === '/');
      check(
        (await page.locator('[data-message-id]').count()) === 0 && leaks(afterClick).length === 0,
        `after "Sign out" no message is in the page and none of the Owner's sentences (${leakNote(leaks(afterClick), afterClick.length)})`,
      );
      const store = await storageOf(page);
      const old = unscopedKeys(store);
      check(old.length === 0, `the browser keeps no unscoped console key${old.length ? `: ${old.join(', ')}` : ''}`);
      const asUser = Object.entries(store).filter(([k, v]) => k.includes(userId) && said.some((s) => v.includes(s)));
      const elsewhere = Object.entries(store).filter(
        ([k, v]) => said.some((s) => v.includes(s)) && !k.startsWith(`bridle:conversation:${ownerId}:`),
      );
      check(
        asUser.length === 0 && elsewhere.length === 0,
        `the Owner's messages are kept under the Owner's id only${elsewhere.length ? `: also in ${elsewhere.map(([k]) => k).join(', ')}` : ''}`,
      );
    }

    await appToLogin(page);
    await signInRecorded(page, USER);
    await chatIdle(page);
    {
      const { frames } = await framesOf(page);
      const bad = leaks(frames);
      check(bad.length === 0, `a User signs in in the same tab: no frame shows a message of the Owner (${leakNote(bad, frames.length)})`);
      const onOwners = frames.filter((f) => f.path === `/agents/${AGENT.id}`);
      check(
        userLanding === AGENT.id || onOwners.length === 0,
        `the Owner's last agent is not opened for the User (${onOwners.length} frames at it); the User lands on ${new URL(page.url()).pathname}`,
      );
      check(new URL(page.url()).pathname === `/agents/${userLanding}`, 'and that is the first running agent of the User’s own list');
      await shot(page, `switch-app-user-after-signin-${width}`);
    }
    // The agent the Owner talked to, opened by the User: the stored copy of
    // the Owner's conversation is in this browser and is not the User's.
    await startRecording(page);
    await page.goto(agentUrl(APP, AGENT.id), { waitUntil: 'networkidle' });
    await chatIdle(page);
    {
      const { frames } = await framesOf(page);
      const bad = leaks(frames);
      check(bad.length === 0, `the User opens ${AGENT.name} after a reload: no frame shows a message of the Owner (${leakNote(bad, frames.length)})`);
      await shot(page, `switch-app-user-on-owners-agent-${width}`);
    }

    // Back to the agent the User lands on by themselves, so that the agent
    // this account remembers is its own choice and not the Owner's agent.
    await page.goto(agentUrl(APP, userLanding), { waitUntil: 'networkidle' });
    await chatIdle(page);

    // ------------------------------------------------- the observed path
    section(`App console, ${width} px: a reload between sign-out and sign-in`);
    await appSignOut(page);
    await appToLogin(page);
    await signInRecorded(page, OWNER);
    await page.goto(agentUrl(APP, AGENT.id), { waitUntil: 'networkidle' });
    await chatIdle(page);
    check(
      (await page.locator('[data-message-id]').filter({ hasText: said[0] }).count()) > 0,
      'the Owner signs in again and has their conversation',
    );
    await appSignOut(page);
    await page.reload({ waitUntil: 'networkidle' });
    await appToLogin(page);
    await signInRecorded(page, USER);
    await chatIdle(page);
    {
      const { frames } = await framesOf(page);
      const bad = leaks(frames);
      check(bad.length === 0, `sign-out, reload, a User signs in: no frame shows a message of the Owner (${leakNote(bad, frames.length)})`);
      const onOwners = frames.filter((f) => f.path === `/agents/${AGENT.id}`);
      check(userLanding === AGENT.id || onOwners.length === 0, `the Owner's last agent is not opened for the User (${onOwners.length} frames at it)`);
    }
    await page.goto(agentUrl(APP, AGENT.id), { waitUntil: 'networkidle' });
    await chatIdle(page);
    {
      const { frames } = await framesOf(page);
      const bad = leaks(frames);
      check(bad.length === 0, `the User opens ${AGENT.name}: no frame shows a message of the Owner (${leakNote(bad, frames.length)})`);
      await shot(page, `switch-app-user-after-reload-${width}`);
    }

    // Back to the agent the User lands on by themselves, so that the agent
    // this account remembers is its own choice and not the Owner's agent.
    await page.goto(agentUrl(APP, userLanding), { waitUntil: 'networkidle' });
    await chatIdle(page);

    // ------------------------------------------- the same account, reload
    section(`App console, ${width} px: the same account reloads`);
    await appSignOut(page);
    await appToLogin(page);
    await signInRecorded(page, OWNER);
    await page.goto(agentUrl(APP, AGENT.id), { waitUntil: 'networkidle' });
    await chatIdle(page);
    await page.reload({ waitUntil: 'networkidle' });
    await chatIdle(page);
    {
      const { frames } = await framesOf(page);
      const first = frames.find((f) => f.composer);
      check(
        Boolean(first) && said.every((s) => first.messages.some((m) => m.includes(s))),
        `the first frame that shows the chat has the Owner's own messages (${first ? first.messages.length : 'no'} messages in it)`,
      );
      await shot(page, `switch-app-owner-reload-${width}`);
    }

    // ---------------------------------------------- session-ended dialog
    section(`App console, ${width} px: the session ends by itself`);
    const dialog = page.locator('[role="dialog"][aria-labelledby="auth-session-ended-title"]');
    /** Takes the session away the way an expiry does, and waits for the dialog. */
    async function endSession() {
      const cookies = await context.cookies();
      await context.clearCookies();
      await context.addCookies(cookies.filter((c) => c.name === 'i18n_redirected'));
      await page.route(
        (url) => url.href.startsWith(API) && url.pathname === '/agents/capacity',
        (route) =>
          route.fulfill({
            status: 401,
            contentType: 'application/json',
            headers: { 'access-control-allow-origin': APP, 'access-control-allow-credentials': 'true' },
            body: JSON.stringify({ statusCode: 401, code: 'TOKEN_EXPIRED', message: 'Token expired' }),
          }),
        { times: 1 },
      );
      // An Owner's page reads cluster capacity again every 30 s; that
      // request is the one answered 401. (Not the agent list: a 401 there
      // empties the list behind the dialog, which is a defect of its own and
      // not this script's subject.)
      return until(async () => (await dialog.count()) > 0, { timeout: 45000, every: 300 });
    }

    check(Boolean(await endSession()), 'the session-ended dialog appears over the Owner’s chat');
    check(
      (await page.locator('[data-message-id]').filter({ hasText: said[0] }).count()) > 0,
      'the page behind it is kept, for the same person to continue',
    );
    await shot(page, `switch-app-session-ended-${width}`);
    await dialog.locator('input[type="email"], input[name="email"]').first().fill(USER.email);
    await dialog.locator('input[type="password"]').first().fill(USER.password);
    await startRecording(page);
    await dialog.locator('button[type="submit"]').first().click();
    await until(async () => (await dialog.count()) === 0, { timeout: 20000 });
    await page.waitForURL((u) => u.pathname.startsWith('/agents'), { timeout: 20000 }).catch(() => undefined);
    await chatIdle(page);
    {
      const { frames, loginAt } = await framesOf(page);
      // Until the API accepts the sign-in, the page behind the dialog is
      // still the Owner's, as designed. From that moment on it is not.
      const after = frames.filter((f) => loginAt !== null && f.t >= loginAt);
      const bad = leaks(after);
      check(
        loginAt !== null && bad.length === 0,
        `a User signs in in the dialog: from the moment the sign-in is accepted no frame shows a message of the Owner (${leakNote(bad, after.length)})`,
      );
      const path = new URL(page.url()).pathname;
      check(path === `/agents/${userLanding}`, `the console goes to the User's own landing (${path})`);
      await shot(page, `switch-app-dialog-other-account-${width}`);
    }

    // The same account in the dialog: the page stays as it is.
    await appSignOut(page);
    await appToLogin(page);
    await signInRecorded(page, OWNER);
    await page.goto(agentUrl(APP, AGENT.id), { waitUntil: 'networkidle' });
    await chatIdle(page);
    const before = await page.locator('[data-message-id]').count();
    await page.locator('textarea').first().fill(`draft kept ${tag}`);
    check(Boolean(await endSession()), 'the session ends again, for the Owner');
    await dialog.locator('input[type="password"]').first().fill(OWNER.password);
    await startRecording(page);
    await dialog.locator('button[type="submit"]').first().click();
    await until(async () => (await dialog.count()) === 0, { timeout: 20000 });
    await sleep(1500);
    {
      const { frames } = await framesOf(page);
      const moved = frames.filter((f) => f.path !== `/agents/${AGENT.id}`);
      const emptied = frames.filter((f) => f.messages.length < before);
      check(
        moved.length === 0 && emptied.length === 0,
        `the same account signs in in the dialog: the page is kept (${moved.length} frames elsewhere, ${emptied.length} frames with fewer messages, of ${frames.length})`,
      );
      check((await page.locator('textarea').first().inputValue()) === `draft kept ${tag}`, 'and so is what was typed');
      await page.locator('textarea').first().fill('');
      check(Boolean(await chatOn(page).say(`after the dialog ${tag}`)), 'and the chat answers');
      await shot(page, `switch-app-dialog-same-account-${width}`);
    }

    check(problems.length === 0, `no console error, no unexpected failed request${problems.length ? `: ${problems.join(' | ')}` : ''}`);
    await context.close();
  }

  // ============================================================== admin
  if (only !== 'app') {
    section('Admin console, 1440 px: an undelivered message of the Owner');
    const tag = Date.now().toString(36);
    const said = [`switch outbox ${tag}`];
    const { context, page, problems } = await watchedPage(browser, { width: 1440, height: 900, expected: EXPECTED_ADMIN });
    await context.addInitScript(recorder, said);
    // The console's socket to the hub, passed through untouched except for
    // the one frame that carries the Owner's sentence, which is dropped.
    await page.routeWebSocket(
      (url) => url.href.startsWith(API.replace(/^http/, 'ws')),
      (ws) => {
        const server = ws.connectToServer();
        ws.onMessage((frame) => {
          if (typeof frame === 'string' && frame.includes(said[0])) return;
          server.send(frame);
        });
      },
    );
    const chatUrl = `${ADMIN}/agents/${AGENT.id}?tab=chat`;
    const openChat = async () => {
      await page.goto(chatUrl, { waitUntil: 'networkidle' });
      await chatIdle(page);
    };
    const adminSignOut = async (who) => {
      await page.locator('button', { hasText: who.email }).first().click();
      await page.getByRole('menuitem', { name: 'Sign out' }).click();
      await page.waitForURL((u) => u.pathname === '/login', { timeout: 15000 });
    };

    try {
      await page.goto(`${ADMIN}/login`, { waitUntil: 'networkidle' });
      await signInRecorded(page, OWNER);
      await openChat();
      // The frame that carries the message is lost on its way to the hub
      // (see the socket route above): no ack comes back, the message stays
      // "sending" and is in the outbox. It is in no transcript, so only this
      // browser has it.
      const field = page.locator('textarea').first();
      await field.fill(said[0]);
      await field.press('Enter');
      const mine = page.locator('[data-message-id][data-role="user"]').filter({ hasText: said[0] });
      check(Boolean(await until(async () => (await mine.count()) > 0, { timeout: 10000 })), 'the Owner sends a message the agent does not receive');
      await sleep(2500);
      const outboxKey = `bridle:outbox:${ownerId}:${AGENT.id}:admin`;
      const kept = await storageOf(page);
      check(
        Object.entries(kept).some(([k, v]) => k.startsWith('bridle:outbox:') && v.includes(said[0])),
        `it is in the outbox (${Object.keys(kept).filter((k) => k.startsWith('bridle:outbox:')).join(', ') || 'no outbox key'})`,
      );
      check(Boolean(kept[outboxKey]?.includes(said[0])), 'under the Owner’s id');
      await shot(page, 'switch-admin-owner-outbox-1440');

      await startRecording(page);
      await adminSignOut(OWNER);
      await sleep(500);
      {
        const { frames } = await framesOf(page);
        const afterClick = frames.filter((f) => f.path === '/login');
        check(leaks(afterClick).length === 0, `after "Sign out" the message is not in the page (${leakNote(leaks(afterClick), afterClick.length)})`);
        const old = unscopedKeys(await storageOf(page));
        check(old.length === 0, `the browser keeps no unscoped console key${old.length ? `: ${old.join(', ')}` : ''}`);
      }

      await signInRecorded(page, ADMIN_USER);
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await sleep(800);
      {
        const { frames } = await framesOf(page);
        const bad = leaks(frames);
        check(bad.length === 0, `an Admin signs in in the same tab: no frame shows it (${leakNote(bad, frames.length)})`);
      }
      // Without a reload first, then with one: the Admin opens the same chat.
      // The workspace rail names every agent the Admin reaches.
      const row = page.getByText(AGENT.name, { exact: true }).first();
      const listed = await until(async () => (await row.count()) > 0, { timeout: 8000 });
      if (listed) {
        await startRecording(page);
        await row.click();
        await page.waitForURL((u) => u.pathname.includes(AGENT.id), { timeout: 15000 });
        await chatIdle(page);
        const { frames } = await framesOf(page);
        const bad = leaks(frames);
        check(bad.length === 0, `the Admin opens ${AGENT.name} from the list: no frame shows it (${leakNote(bad, frames.length)})`);
      } else {
        console.log(`  note: no link to ${AGENT.name} on ${new URL(page.url()).pathname}; the open-without-reload step is skipped`);
      }
      await openChat();
      {
        const { frames } = await framesOf(page);
        const bad = leaks(frames);
        check(bad.length === 0, `the Admin opens its chat after a reload: no frame shows it (${leakNote(bad, frames.length)})`);
        const store = await storageOf(page);
        const asAdmin = Object.entries(store).filter(([k, v]) => k.includes(adminId) && v.includes(said[0]));
        check(asAdmin.length === 0, 'nothing of it is kept under the Admin’s id');
        await shot(page, 'switch-admin-admin-chat-1440');
      }

      // And the Owner still has it: nothing was lost by keeping it apart.
      await adminSignOut(ADMIN_USER);
      await signInRecorded(page, OWNER);
      await openChat();
      check(
        (await page.locator('[data-message-id][data-role="user"]').filter({ hasText: said[0] }).count()) > 0,
        'the Owner signs in again and the undelivered message is back, to resend or discard',
      );
      const discard = page.getByRole('button', { name: /^discard$/i }).first();
      if ((await discard.count()) > 0) await discard.click().catch(() => undefined);
      await shot(page, 'switch-admin-owner-again-1440');
    } finally {
      await fake.connect(AGENT.id);
    }
    check(problems.length === 0, `no console error, no unexpected failed request${problems.length ? `: ${problems.join(' | ')}` : ''}`);
    await context.close();
  }
} finally {
  await browser.close();
  await fake.connect(AGENT.id).catch(() => undefined);
}

done('switch');
