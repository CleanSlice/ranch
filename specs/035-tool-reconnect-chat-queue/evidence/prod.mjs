// CLEAN-245 evidence: the production check (T059), test accounts only.
//
//   PROD_API=… PROD_ADMIN=… PROD_APP=… AGENT_FOR_TEST=… \
//   RANCH_OWNER_LG=… RANCH_OWNER_PASS=… RANCH_USER_LG=… RANCH_USER_PASS=… \
//   PLAYWRIGHT_CORE=<dir> CHROME=<chromium> node prod.mjs
//
// Restarts the test agent, writes three messages in each console while it is
// away, and checks they are answered one per turn, in order, once. Unlike the
// other scripts here this one talks to a real agent with a real model. It
// prints no credential. The pictures are cut to the chat: the rest of a
// production page (the account, the other agents, older conversations) is
// nobody's business here.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(
  path.join(process.env.PLAYWRIGHT_CORE ?? process.cwd(), "package.json"),
)("playwright-core");

const need = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value.replace(/\/+$/, "");
};
const API = need("PROD_API");
const BASES = { admin: need("PROD_ADMIN"), app: need("PROD_APP") };
const AGENT = need("AGENT_FOR_TEST");
const ACCOUNTS = {
  owner: [need("RANCH_OWNER_LG"), need("RANCH_OWNER_PASS")],
  user: [need("RANCH_USER_LG"), need("RANCH_USER_PASS")],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
function check(name, ok, shown = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${shown ? ` -> ${shown}` : ""}`);
}

async function api(method, route, token, body) {
  const res = await fetch(API + route, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => undefined);
  return { status: res.status, data: json?.data ?? json };
}

const composer = (page) => page.locator("textarea").last();
const rows = (page) => page.locator("[data-queue-row]");

async function login(browser, consoleName, role) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await ctx.newPage();
  const [email, password] = ACCOUNTS[role];
  await page.goto(`${BASES[consoleName]}/login`);
  const prefix = consoleName === "admin" ? "#" : "#auth-";
  await page.fill(`${prefix}email`, email);
  await page.fill(`${prefix}password`, password);
  await page.click("button[type=submit]");
  await page.waitForURL((u) => !u.pathname.includes("login"), {
    timeout: 30_000,
  });
  await page.goto(`${BASES[consoleName]}/agents/${AGENT}`);
  await composer(page).waitFor({ timeout: 30_000 });
  await sleep(2000);
  return page;
}

/** The chat column of each console at 1440×900. */
const CHAT = { admin: 548, app: 840 };

/** The chat only, from `top` down. */
async function shot(page, consoleName, name, top = 0) {
  const x = CHAT[consoleName];
  await page.screenshot({
    path: path.join(HERE, `${name}.png`),
    clip: { x, y: top, width: 1440 - x, height: 900 - top },
  });
  console.log(`shot  ${name}.png`);
}

/** Where this run's first message starts: what is above it is older. */
async function topOf(page, tag) {
  const box = await page.getByText(texts(tag)[0]).first().boundingBox();
  return Math.max(0, Math.floor((box?.y ?? 0) - 24));
}

const FRUIT = ["apple", "pear", "plum"];
const texts = (tag) =>
  FRUIT.map(
    (word, i) =>
      `${tag} check ${i + 1} of 3: reply with the single word ${word}`,
  );

async function queueThree(page, tag) {
  for (const text of texts(tag)) {
    await composer(page).fill(text);
    await composer(page).press("Enter");
    await sleep(300);
  }
}

/** The three questions, each once, each answered before the next was sent. */
async function answeredInOrder(page, tag, name) {
  const until = Date.now() + 6 * 60_000;
  let body = "";
  let last = -1;
  while (Date.now() < until) {
    body = await page.locator("body").innerText();
    last = body.indexOf(texts(tag)[2]);
    if (
      (await rows(page).count()) === 0 &&
      last >= 0 &&
      body.toLowerCase().indexOf("plum", last + texts(tag)[2].length) >= 0
    )
      break;
    await sleep(2000);
  }
  const at = texts(tag).map((t) => body.indexOf(t));
  const once = texts(tag).every((t) => body.split(t).length === 2);
  const lower = body.toLowerCase();
  // An answer sits between its question and the next one.
  const answers = FRUIT.map((word, i) => {
    const from = at[i] + texts(tag)[i].length;
    const to = i < 2 ? at[i + 1] : lower.length;
    return at[i] >= 0 && lower.slice(from, to).includes(word);
  });
  check(`${name}: nothing left waiting`, (await rows(page).count()) === 0);
  check(`${name}: each message sent once`, once);
  check(
    `${name}: sent in the order written`,
    at[0] >= 0 && at[0] < at[1] && at[1] < at[2],
  );
  check(
    `${name}: each answered before the next went`,
    answers.every(Boolean),
    answers.join(","),
  );
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME || undefined,
});
try {
  const owner = (
    await api("POST", "/auth/login", null, {
      email: ACCOUNTS.owner[0],
      password: ACCOUNTS.owner[1],
    })
  ).data?.accessToken;
  check("owner signs in", Boolean(owner));

  const tag = `CLEAN-245 ${new Date().toISOString().slice(11, 19)}`;
  const admin = await login(browser, "admin", "owner");
  const app = await login(browser, "app", "user");

  const restart = await api("POST", `/agents/${AGENT}/restart`, owner);
  check("restart accepted", restart.status < 300, String(restart.status));
  for (let i = 0; i < 30; i += 1) {
    const status = (await api("GET", `/agents/${AGENT}`, owner)).data?.status;
    if (status && status !== "running") break;
    await sleep(1000);
  }
  await sleep(1500);

  await queueThree(admin, `${tag} admin`);
  await queueThree(app, `${tag} app`);
  check(
    "admin: the composer took three while the agent restarts",
    (await rows(admin).count()) >= 2,
    String(await rows(admin).count()),
  );
  check(
    "app: the composer took three while the agent restarts",
    (await rows(app).count()) >= 2,
    String(await rows(app).count()),
  );
  // Admin's transcript is under the start overlay; in app the older
  // conversation is in view, so the picture starts at the queue.
  await shot(admin, "admin", "prod-admin-queue", 56);
  const panel = await rows(app).first().boundingBox();
  await shot(app, "app", "prod-app-queue", Math.floor((panel?.y ?? 700) - 60));
  const overlay = await admin.locator("[data-chat-overlay]").boundingBox();
  const firstRow = await rows(admin).first().boundingBox();
  check(
    "admin: the start overlay ends above the queue",
    !overlay || (firstRow && overlay.y + overlay.height <= firstRow.y),
    overlay ? "overlay shown" : "no overlay at that moment",
  );

  await answeredInOrder(admin, `${tag} admin`, "admin");
  await answeredInOrder(app, `${tag} app`, "app");
  await sleep(500);
  await shot(
    admin,
    "admin",
    "prod-admin-drained",
    await topOf(admin, `${tag} admin`),
  );
  await shot(app, "app", "prod-app-drained", await topOf(app, `${tag} app`));

  const state = await api("GET", `/agents/${AGENT}/tool-state`, owner);
  check("tool state for the Owner", state.status === 200, String(state.status));
  // Names and states only: a server's last error can carry an address.
  console.log(
    "tool state:",
    JSON.stringify({
      phase: state.data?.phase,
      servers: (state.data?.servers ?? []).map((s) => ({
        name: s.name,
        state: s.state,
        attempts: s.attempts,
      })),
    }),
  );
  const userToken = (
    await api("POST", "/auth/login", null, {
      email: ACCOUNTS.user[0],
      password: ACCOUNTS.user[1],
    })
  ).data?.accessToken;
  const refused = await api("GET", `/agents/${AGENT}/tool-state`, userToken);
  check("a User is refused the servers", refused.status === 403);
} finally {
  await browser.close();
}
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
