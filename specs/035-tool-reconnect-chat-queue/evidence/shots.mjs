// CLEAN-245 evidence: the screenshots (README.md lists them).
//
//   node shots.mjs us2|us3|us4|compat|all
//
// Drives a headless Chromium through both consoles and a share link on the
// LOCAL stack, with `runtime.mjs` standing in for the agents. Every check a
// screenshot stands for is also asserted here, so a picture is never the only
// proof. Nothing secret is read or printed: the accounts are the seed's
// throwaway ones.
import { createRequire } from "node:module";
import path from "node:path";
import {
  ADMIN,
  APP,
  HERE,
  api,
  check,
  control,
  prisma,
  sleep,
  summary,
} from "./lib.mjs";
import {
  ACCOUNTS,
  AGENTS,
  PASSWORD,
  login as apiLogin,
  seed,
  setStatus,
} from "./seed.mjs";

// Playwright is not a dependency of this repo: point PLAYWRIGHT_CORE at a
// directory that has `playwright-core` installed, and CHROME at a Chromium.
const { chromium } = createRequire(
  path.join(process.env.PLAYWRIGHT_CORE ?? process.cwd(), "package.json"),
)("playwright-core");

const WIDE = { width: 1440, height: 900 };
const NARROW = { width: 400, height: 800 };
const BASES = { admin: ADMIN, app: APP };
const A = AGENTS.A;

let browser;
const contexts = [];

/** A signed-in page of a console. `role`: 'owner' | 'user'. */
export async function login(consoleName, role, viewport = WIDE) {
  const ctx = await browser.newContext({ viewport });
  contexts.push(ctx);
  const page = await ctx.newPage();
  const account = ACCOUNTS[role];
  await page.goto(`${BASES[consoleName]}/login`);
  const prefix = consoleName === "admin" ? "#" : "#auth-";
  await page.fill(`${prefix}email`, account.email);
  await page.fill(`${prefix}password`, PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL((u) => !u.pathname.includes("login"), {
    timeout: 30_000,
  });
  page.base = BASES[consoleName];
  return page;
}

/** A visitor's page on the share link: no account. */
export async function visitor(shareToken, viewport = WIDE) {
  const ctx = await browser.newContext({ viewport });
  contexts.push(ctx);
  const page = await ctx.newPage();
  await page.goto(`${APP}/share?token=${shareToken}`);
  await composer(page).waitFor({ timeout: 30_000 });
  return page;
}

export async function openChat(page, agentId = A.id) {
  await page.goto(`${page.base}/agents/${agentId}`);
  await composer(page).waitFor({ timeout: 30_000 });
  await sleep(1500); // the socket and the first status frame
}

export async function shot(page, name) {
  await sleep(400);
  await page.screenshot({ path: path.join(HERE, `${name}.png`) });
  console.log(`shot  ${name}.png`);
}

const composer = (page) => page.locator("textarea").last();
const rows = (page) => page.locator("[data-queue-row]");
const rowTexts = async (page) =>
  (await rows(page).locator("span.truncate").allTextContents()).map((t) =>
    t.trim(),
  );

async function write(page, text) {
  await composer(page).fill(text);
  await composer(page).press("Enter");
  await sleep(250);
}

async function mode(m, agent = "A") {
  await control("/mode", { agent, mode: m });
  await sleep(700);
}

async function received(agent = "A") {
  return (await control(`/received?agent=${agent}`)).received.map(
    (m) => m.text,
  );
}

async function waitReceived(n, agent = "A", timeoutMs = 30_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const got = await received(agent);
    if (got.length >= n) return got;
    await sleep(200);
  }
  return received(agent);
}

/** A clean slate between scenes: runtime ready and quick, nothing remembered. */
async function reset() {
  await setStatus(A, "running");
  await control("/delay", { agent: "A", ms: 300 });
  await control("/forget", { agent: "A" });
  await mode("ready");
}

/** Empty this conversation's queue the way a person would: there is no back door. */
async function clearQueue(page) {
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("bridle:queue:")) localStorage.removeItem(key);
    }
  });
}

// ── US2: the status explains the wait ────────────────────────────────

async function us2(ctx) {
  await reset();
  const admin = await login("admin", "owner");

  await mode("connecting");
  await openChat(admin);
  check(
    "admin: connecting is said, with the server that is slow",
    await admin
      .locator("main")
      .getByText(/Documents is not answering yet/)
      .first()
      .innerText(),
    /attempt 2/,
  );
  check(
    "admin: the composer is open meanwhile",
    await composer(admin).isEnabled(),
    true,
  );
  await shot(admin, "us2-admin-connecting");

  await mode("limited");
  await admin
    .locator('[data-tool-state="limited"]')
    .first()
    .waitFor({ timeout: 10_000 });
  check(
    "admin chat: the server that is retrying is named",
    await admin.locator('main [data-tool-state="limited"]').allInnerTexts(),
    (texts) => texts.some((t) => /Documents/.test(t)),
  );
  await write(admin, "Are you there?");
  check("admin: a limited agent takes the message", await waitReceived(1), [
    "Are you there?",
  ]);
  await shot(admin, "us2-admin-limited-chat");

  await admin.locator('[data-workspace-tab="settings"]').click();
  await admin
    .locator("[data-tool-state-detail]")
    .first()
    .waitFor({ timeout: 10_000 });
  check(
    "admin overview: what is missing and what is being done",
    await admin.locator("[data-tool-state-detail]").first().innerText(),
    /Running without Documents — still trying to reconnect/,
  );
  const detail = await api("GET", `/agents/${A.id}/tool-state`, {
    token: ctx.ownerToken,
  });
  check(
    "API: the Owner reads the server, its attempts and its last error",
    detail.data?.servers?.find((s) => s.name === "Documents"),
    (s) =>
      s?.state === "retrying" &&
      s.attempts === 6 &&
      /ECONNREFUSED/.test(s.lastError ?? ""),
  );
  await shot(admin, "us2-admin-limited-list");

  // The detail of a limited agent is read again every 30 s; a reload is the
  // same request sooner.
  await mode("refused");
  await openChat(admin);
  await admin.locator('[data-workspace-tab="settings"]').click();
  await admin
    .locator("[data-tool-state-detail]")
    .first()
    .waitFor({ timeout: 10_000 });
  check(
    "admin overview: a refusal is not called a retry",
    await admin.locator("[data-tool-state-detail]").first().innerText(),
    /refused, check its credentials/,
  );
  await shot(admin, "us2-admin-refused");

  // The User: one word of it, never a server name.
  const user = await login("app", "user");
  const bodies = [];
  user.on("response", async (res) => {
    if (!res.url().startsWith("http://localhost:3345")) return;
    try {
      bodies.push(await res.text());
    } catch {
      /* a redirect or a socket upgrade has no body */
    }
  });
  const frames = [];
  user.on("websocket", (ws) =>
    ws.on("framereceived", (f) => frames.push(String(f.payload))),
  );

  await mode("connecting");
  await setStatus(A, "deploying");
  await openChat(user);
  check(
    "app: the composer is open while the agent starts",
    await composer(user).isEnabled(),
    true,
  );
  await shot(user, "us2-app-user-starting");

  await setStatus(A, "running");
  await mode("limited");
  await openChat(user);
  await user.locator("[data-tool-state]").first().waitFor({ timeout: 10_000 });
  await shot(user, "us2-app-user-limited");
  const seen = (await user.content()) + bodies.join("\n") + frames.join("\n");
  check(
    "app (User): no server name, no error in the page, the responses or the socket",
    ["Documents", "ECONNREFUSED", "10.0.4.17", "lastError"].filter((w) =>
      seen.includes(w),
    ),
    [],
  );
  const refused = await api("GET", `/agents/${A.id}/tool-state`, {
    token: (await apiLogin(ACCOUNTS.user.email)).accessToken,
  });
  check(
    "API: a User is refused the detail",
    refused.status,
    (s) => s === 403 || s === 404,
  );

  const guest = await visitor(ctx.shareToken);
  const guestFrames = [];
  guest.on("websocket", (ws) =>
    ws.on("framereceived", (f) => guestFrames.push(String(f.payload))),
  );
  await guest.reload();
  await composer(guest).waitFor();
  await sleep(1500);
  await shot(guest, "us2-share-limited");
  check(
    "share (visitor): no server name",
    ["Documents", "ECONNREFUSED"].filter((w) =>
      (guestFrames.join("\n") + "" || "").includes(w),
    ),
    [],
  );

  await mode("ready");
  await openChat(admin);
  check(
    "admin: the notice is gone once the tools are back",
    await admin.locator('main [data-tool-state="limited"]').count(),
    0,
  );
  await shot(admin, "us2-admin-cleared");
}

// ── US2, the rest: the Ranch agent can say it, and an incident opens ──

async function us2ops(ctx) {
  await reset();
  // A run starts with no incident of an earlier one (scratch database only).
  for (const table of ["AgentNotification", "AgentEvent", "AgentIncident"]) {
    await prisma().$executeRawUnsafe(`DELETE FROM "${table}"`);
  }
  await mode("limited");
  const admin = await login("admin", "owner");

  // The model is taken out of the fake Rancher: its answer is what Ranch's
  // own `get_agent_status` tool returned for this turn, put into a sentence.
  await control("/status-of", { agent: "R", id: A.id });
  // Its own chat page: `/rancher` is the set-up wizard on a database with no
  // model key, no storage and no template.
  await openChat(admin, AGENTS.R.id);
  await sleep(1500);
  await write(admin, `What is wrong with ${A.name}?`);
  await admin
    .getByText(/its tools are limited/)
    .first()
    .waitFor({ timeout: 20_000 });
  const tool = (await control("/last-tool?agent=R")).result;
  const tools = (tool?.data ?? tool)?.tools;
  check(
    "Ranch agent: get_agent_status names the server, its state and its error",
    tools?.servers?.find((s) => s.name === "Documents"),
    (s) => s?.state === "retrying" && /ECONNREFUSED/.test(s.lastError ?? ""),
  );
  check(
    "Ranch agent: nothing shaped like a credential in the result",
    JSON.stringify(tool),
    (t) => !/bearer|api[-_]?key|password/i.test(t),
  );
  await shot(admin, "us2-rancher-answer");

  // TOOLS_LIMITED_ALERT_MS is 60 s on this stack (README.md).
  console.log("waiting for the limited incident (about 75 s)…");
  let open = null;
  const until = Date.now() + 150_000;
  while (!open && Date.now() < until) {
    await sleep(5000);
    await control("/mode", { agent: "A", mode: "limited" });
    const list = (
      await api("GET", "/agent-incidents", { token: ctx.ownerToken })
    ).data;
    const items = Array.isArray(list) ? list : (list?.items ?? []);
    open =
      items.find(
        (i) => i.agentId === A.id && /tool|limited/i.test(JSON.stringify(i)),
      ) ?? null;
  }
  check("incident: one opens for the agent that stays limited", open, (i) =>
    Boolean(i),
  );
  check(
    "incident: it names the server and no error text",
    JSON.stringify(open ?? {}),
    (t) => /Documents/.test(t) && !/ECONNREFUSED/.test(t),
  );
  await admin.goto(`${ADMIN}/events`);
  await sleep(2500);
  await shot(admin, "us2-admin-incident-open");

  // Recovery is the incident machinery's own: the incident is marked up and
  // watched, and its sweep closes it after the quiet window.
  await mode("ready");
  let up = null;
  for (let i = 0; i < 12 && !up; i++) {
    await sleep(2500);
    const list = (
      await api("GET", "/agent-incidents", { token: ctx.ownerToken })
    ).data;
    up = (list?.items ?? []).find((it) => it.id === open?.id)?.upSince ?? null;
  }
  check(
    "incident: marked up when the tools are back",
    up,
    (at) => Boolean(at) && at > open.lastFailureAt,
  );
  await admin.reload();
  await sleep(2500);
  await shot(admin, "us2-admin-incident-up");
}

// ── US3: a queue of three, a composer that is never locked ───────────

const FULL_LINE = /Three messages are already waiting/;

async function queueThree(page, texts) {
  for (const t of texts) await write(page, t);
  await rows(page)
    .nth(texts.length - 1)
    .waitFor({ timeout: 10_000 });
}

/** Every text is in the conversation exactly once, in this order. */
async function once(page, texts, label) {
  const body = await page.locator("main, body").first().innerText();
  const at = texts.map((t) => body.indexOf(t));
  const counts = texts.map((t) => body.split(t).length - 1);
  // A sent message shows twice in the transcript of the fake runtime: the
  // person's bubble and the `echo:` of it.
  check(
    `${label}: each message once, in order`,
    { order: at.every((v, i) => v >= 0 && (i === 0 || v > at[i - 1])), counts },
    (r) => r.order && r.counts.every((c) => c === 2),
  );
}

async function us3(ctx) {
  await reset();
  const admin = await login("admin", "owner");
  await openChat(admin);
  await clearQueue(admin);

  await mode("connecting");
  await queueThree(admin, [
    "q245 first question",
    "q245 second question",
    "q245 third question",
  ]);
  check(
    "admin: three wait, none is sent",
    [await rows(admin).count(), (await received()).length],
    [3, 0],
  );
  check(
    "admin: the composer stays open",
    await composer(admin).isEnabled(),
    true,
  );
  await sleep(1200);
  await shot(admin, "us3-admin-queued-3");

  await write(admin, "q245 a fourth one");
  check(
    "admin: the fourth is refused in words",
    await admin.locator("[data-queue-full]").innerText(),
    FULL_LINE,
  );
  check(
    "admin: and stays in the composer",
    await composer(admin).inputValue(),
    "q245 a fourth one",
  );
  check("admin: still three", await rows(admin).count(), 3);
  await shot(admin, "us3-admin-full");
  await composer(admin).fill("");

  await control("/delay", { agent: "A", ms: 1200 });
  await mode("ready");
  const got = await waitReceived(3);
  check("admin: sent one per turn, in the order shown", got, [
    "q245 first question",
    "q245 second question",
    "q245 third question",
  ]);
  const stamps = (await control("/received?agent=A")).received.map((m) => m.at);
  check(
    "admin: each waited for the answer before it",
    [stamps[1] - stamps[0] >= 1100, stamps[2] - stamps[1] >= 1100],
    [true, true],
  );
  await admin
    .getByText("echo: q245 third question")
    .first()
    .waitFor({ timeout: 15_000 });
  check(
    "admin: the panel is gone",
    await admin.locator("[data-queue]").count(),
    0,
  );
  await once(
    admin,
    ["q245 first question", "q245 second question", "q245 third question"],
    "admin",
  );
  await shot(admin, "us3-admin-drained");

  // Writing while the agent answers.
  await control("/forget", { agent: "A" });
  await control("/delay", { agent: "A", ms: 6000 });
  await write(admin, "q245 a long question");
  await waitReceived(1);
  await write(admin, "q245 follow-up one");
  await write(admin, "q245 follow-up two");
  check("admin: written during an answer, they wait", await rowTexts(admin), [
    "q245 follow-up one",
    "q245 follow-up two",
  ]);
  await sleep(800);
  const last = await admin
    .getByText("q245 a long question")
    .first()
    .boundingBox();
  const panel = await admin.locator("[data-queue]").boundingBox();
  check(
    "admin: the panel does not cover the last message",
    last.y + last.height <= panel.y,
    true,
  );
  await shot(admin, "us3-admin-during-answer");
  check("admin: and go after it", await waitReceived(3, "A", 40_000), [
    "q245 a long question",
    "q245 follow-up one",
    "q245 follow-up two",
  ]);
  await admin
    .getByText("echo: q245 follow-up two")
    .first()
    .waitFor({ timeout: 20_000 });

  // Two tabs of one person: one sender.
  await control("/forget", { agent: "A" });
  await control("/delay", { agent: "A", ms: 800 });
  await mode("connecting");
  const second = await admin.context().newPage();
  second.base = ADMIN;
  await openChat(second);
  await queueThree(admin, ["q245 tab one", "q245 tab two", "q245 tab three"]);
  await rows(second).nth(2).waitFor({ timeout: 10_000 });
  check(
    "two tabs: the other tab shows the same queue",
    await rowTexts(second),
    ["q245 tab one", "q245 tab two", "q245 tab three"],
  );
  await mode("ready");
  await waitReceived(3);
  await sleep(4000);
  check("two tabs: each message reached the agent once", await received(), [
    "q245 tab one",
    "q245 tab two",
    "q245 tab three",
  ]);
  await second.close();

  // The app console, a signed-in User.
  await reset();
  const user = await login("app", "user");
  await openChat(user);
  await clearQueue(user);
  await mode("connecting");
  await queueThree(user, ["q245 app first", "q245 app second"]);
  check(
    "app: two wait",
    [await rows(user).count(), (await received()).length],
    [2, 0],
  );
  await shot(user, "us3-app-queued");
  await control("/delay", { agent: "A", ms: 1000 });
  await mode("ready");
  check("app: sent in order", await waitReceived(2), [
    "q245 app first",
    "q245 app second",
  ]);
  await user
    .getByText("echo: q245 app second")
    .first()
    .waitFor({ timeout: 15_000 });
  check(
    "app: the panel is gone",
    await user.locator("[data-queue]").count(),
    0,
  );
  await shot(user, "us3-app-drained");

  // A phone-wide window.
  await reset();
  const phone = await login("app", "user", NARROW);
  await openChat(phone);
  await clearQueue(phone);
  await mode("connecting");
  await queueThree(phone, [
    "q245 narrow first",
    "q245 narrow second with a much longer text that has to be cut",
    "q245 narrow third",
  ]);
  await write(phone, "q245 narrow fourth");
  check(
    "app 400w: no sideways scroll",
    await phone.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  await shot(phone, "us3-app-queued-400w");
  await clearQueue(phone);
  await phone.context().close();

  // A visitor on the share link.
  await reset();
  const guest = await visitor(ctx.shareToken);
  await sleep(1500);
  await mode("connecting");
  await queueThree(guest, ["q245 visitor first", "q245 visitor second"]);
  check(
    "share: two wait",
    [await rows(guest).count(), (await received()).length],
    [2, 0],
  );
  await shot(guest, "us3-share-queued");
  await mode("ready");
  check("share: sent in order", await waitReceived(2), [
    "q245 visitor first",
    "q245 visitor second",
  ]);
}

// ── US4: the order is the person's ───────────────────────────────────

async function us4() {
  await reset();
  const admin = await login("admin", "owner");
  await openChat(admin);
  await clearQueue(admin);
  await mode("connecting");
  await queueThree(admin, ["o245 alpha", "o245 beta", "o245 gamma"]);

  // Keyboard only from here to the fold.
  await rows(admin).nth(2).focus();
  await admin.keyboard.press("Alt+ArrowUp");
  await admin.keyboard.press("Alt+ArrowUp");
  check("admin (keys): gamma moved to the top", await rowTexts(admin), [
    "o245 gamma",
    "o245 alpha",
    "o245 beta",
  ]);
  check(
    "admin (keys): the move is said aloud",
    await admin.locator("[data-queue-moved]").innerText(),
    /position 1 of 3/,
  );
  check(
    "admin (keys): focus followed the row",
    await admin.evaluate(() =>
      document.activeElement?.textContent?.includes("o245 gamma"),
    ),
    true,
  );
  await shot(admin, "us4-admin-reordered");

  await admin.keyboard.press("Tab"); // edit
  await admin.keyboard.press("Tab"); // remove
  await admin.keyboard.press("Tab"); // more
  await admin.keyboard.press("Enter");
  await admin
    .getByRole("menuitem", { name: "Move down" })
    .waitFor({ timeout: 5000 });
  await shot(admin, "us4-admin-menu");
  await admin.getByRole("menuitem", { name: "Move down" }).focus();
  await admin.keyboard.press("Enter");
  await sleep(300);
  check("admin (keys): the menu moves it too", await rowTexts(admin), [
    "o245 alpha",
    "o245 gamma",
    "o245 beta",
  ]);

  await admin.locator("[data-queue-fold]").focus();
  await admin.keyboard.press("Enter");
  check(
    "admin (keys): folded, the count stays",
    [
      await rows(admin).count(),
      await admin.locator("[data-queue-count]").innerText(),
    ],
    [0, "3"],
  );
  await shot(admin, "us4-admin-folded");
  await admin.keyboard.press("Enter");

  // Remove one, take one back to edit it.
  await rows(admin)
    .filter({ hasText: "o245 gamma" })
    .getByRole("button", { name: "Remove" })
    .click();
  await rows(admin)
    .filter({ hasText: "o245 beta" })
    .getByRole("button", { name: "Edit" })
    .click();
  check(
    "admin: the one being edited is back in the composer",
    await composer(admin).inputValue(),
    "o245 beta",
  );
  check("admin: and out of the queue", await rowTexts(admin), ["o245 alpha"]);
  await shot(admin, "us4-admin-edit-back");
  await composer(admin).fill("o245 beta, reworded");
  await composer(admin).press("Enter");
  await sleep(300);
  const shown = await rowTexts(admin);
  check("admin: reworded, it waits at the end", shown, [
    "o245 alpha",
    "o245 beta, reworded",
  ]);

  await control("/delay", { agent: "A", ms: 600 });
  await mode("ready");
  const got = await waitReceived(2);
  await sleep(2500);
  check(
    "admin: the order sent is the order shown; the removed one never went",
    await received(),
    shown,
  );
  check("admin: nothing else was sent", got.length, 2);

  // A stopped agent holds what was written.
  await control("/forget", { agent: "A" });
  await mode("connecting");
  await write(admin, "o245 kept while stopped");
  await rows(admin).first().waitFor();
  await setStatus(A, "stopped");
  await openChat(admin).catch(() => {});
  await admin.locator("[data-queue-held]").first().waitFor({ timeout: 15_000 });
  check(
    "admin: a stopped agent holds the queue and says so",
    await admin.locator("[data-queue-held-line]").innerText(),
    /messages are kept/,
  );
  check("admin: nothing was sent to it", (await received()).length, 0);
  await shot(admin, "us4-admin-held-stopped");
  await admin.locator("[data-queue-clear]").click();
  check(
    "admin: Clear queue empties it",
    await admin.locator("[data-queue]").count(),
    0,
  );
  await setStatus(A, "running");

  // The app console: drag with the pointer.
  await reset();
  const user = await login("app", "user");
  await openChat(user);
  await clearQueue(user);
  await mode("connecting");
  await queueThree(user, ["o245 app alpha", "o245 app beta", "o245 app gamma"]);
  const from = await rows(user)
    .nth(2)
    .locator("[data-queue-handle]")
    .boundingBox();
  const to = await rows(user).nth(0).boundingBox();
  await user.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await user.mouse.down();
  await user.mouse.move(to.x + 40, to.y + 2, { steps: 8 });
  await user.mouse.up();
  await sleep(300);
  check("app (drag): gamma dropped at the top", await rowTexts(user), [
    "o245 app gamma",
    "o245 app alpha",
    "o245 app beta",
  ]);
  await shot(user, "us4-app-reordered");

  // Written two days ago: nothing goes by itself.
  const editQueue = (fn) =>
    user.evaluate((body) => {
      const change = new Function("list", body);
      for (const key of Object.keys(localStorage)) {
        if (!key.startsWith("bridle:queue:")) continue;
        const list = JSON.parse(localStorage.getItem(key));
        localStorage.setItem(key, JSON.stringify(change(list) ?? list));
      }
    }, fn);
  await editQueue(
    "for (const e of list) e.queuedAt -= 2 * 24 * 60 * 60 * 1000;",
  );
  await openChat(user);
  await mode("ready");
  await user.locator('[data-queue-held="stale"]').waitFor({ timeout: 15_000 });
  await sleep(3000);
  check(
    "app: two days old, nothing is sent by itself",
    (await received()).length,
    0,
  );
  check(
    "app: Send now and Clear queue are offered",
    [
      await user.locator("[data-queue-resume]").count(),
      await user.locator("[data-queue-clear]").count(),
    ],
    [1, 1],
  );
  await shot(user, "us4-app-held-stale");
  const order = await rowTexts(user);
  await control("/delay", { agent: "A", ms: 500 });
  await user.locator("[data-queue-resume]").click();
  check(
    "app: Send now sends them in the order shown",
    await waitReceived(3),
    order,
  );
  await user
    .getByText("echo: o245 app beta")
    .first()
    .waitFor({ timeout: 15_000 });

  // A message whose file is gone from the server: the hub refuses it
  // (ATTACHMENT_FAILED); it stays, marked, and the one behind it goes.
  await control("/forget", { agent: "A" });
  await mode("connecting");
  await write(user, "o245 with a file");
  await write(user, "o245 after the file");
  await rows(user).nth(1).waitFor();
  await editQueue(
    "list[0].attachments = [{ remoteId: 'att-gone-245', name: 'report.pdf', size: 48213, kind: 'binary', mimeType: 'application/pdf' }];",
  );
  await openChat(user);
  await rows(user).nth(1).waitFor();
  await mode("ready");
  await user
    .locator("[data-queue-blocked]")
    .first()
    .waitFor({ timeout: 15_000 });
  check("app: the one behind the blocked message went", await waitReceived(1), [
    "o245 after the file",
  ]);
  check(
    "app: the blocked one stays, with the reason",
    [
      await rowTexts(user),
      (await user.locator("[data-queue-blocked-reason]").first().innerText())
        .length > 0,
    ],
    [["o245 with a file"], true],
  );
  await shot(user, "us4-app-blocked");
  await clearQueue(user);
}

// ── Runtime 0.39: no tool report at all ──────────────────────────────

async function compat() {
  await reset();
  await mode("none");
  const admin = await login("admin", "owner");
  await openChat(admin);
  await clearQueue(admin);
  await sleep(1500);
  check(
    "old runtime: no tool line",
    await admin.locator("[data-tool-state]").count(),
    0,
  );
  await control("/delay", { agent: "A", ms: 5000 });
  await write(admin, "c245 first");
  await waitReceived(1);
  await write(admin, "c245 second");
  await write(admin, "c245 third");
  check("old runtime: the queue works", await rowTexts(admin), [
    "c245 second",
    "c245 third",
  ]);
  await shot(admin, "compat-old-runtime");
  check("old runtime: sent in order", await waitReceived(3, "A", 40_000), [
    "c245 first",
    "c245 second",
    "c245 third",
  ]);
  const detail = await api("GET", `/agents/${A.id}/tool-state`, {
    token: (await seed()).ownerToken,
  });
  check(
    "old runtime: the detail says nothing is reported",
    [detail.status, detail.data?.phase ?? detail.data?.tools ?? null],
    [200, null],
  );
}

const SCENES = { us2, us2ops, us3, us4, compat };

const which = process.argv[2] ?? "all";
browser = await chromium.launch({
  executablePath: process.env.CHROME || undefined,
});
try {
  const ctx = await seed();
  for (const [name, scene] of Object.entries(SCENES)) {
    if (which !== "all" && which !== name) continue;
    console.log(`\n== ${name}`);
    await scene(ctx);
  }
} finally {
  for (const ctx of contexts) await ctx.close().catch(() => {});
  await browser.close();
  await reset().catch(() => {});
  await prisma().$disconnect();
}
process.exit(summary() ? 1 : 0);
