// Shared helpers for the request-limit browser checks (CLEAN-224). Prints no
// secrets.
//
// The scripts here drive the real consoles against a running local stack:
//
//   api     :3333   node dist/main            (after seed.mjs — it rebuilds its
//                                               counters from the seeded rows)
//   app     :3000   npx nuxt dev --port 3000
//   admin   :3001   npx nuxt dev --port 3001
//   agents          node specs/030-agent-request-limits/e2e/fakeAgent.mjs
//
// Playwright comes from outside the repo, the same way the earlier features
// use it (see specs/026-app-console-redesign/e2e/lib.mjs): PLAYWRIGHT_DIR,
// default C:/Users/maxim/pw.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export {
  API,
  APP,
  CHROME,
  REPO,
  arg,
  chromium,
  ensureDir,
  launch,
  newPage,
  sleep,
} from '../../026-app-console-redesign/e2e/lib.mjs';
import { API, APP, REPO, sleep } from '../../026-app-console-redesign/e2e/lib.mjs';

export const ADMIN = process.env.ADMIN_URL || 'http://localhost:3001';
export const FAKE = process.env.FAKE_AGENT_URL || 'http://localhost:3398';
export const HERE = dirname(fileURLToPath(import.meta.url));
export const SHOTS = resolve(HERE, 'shots');
mkdirSync(SHOTS, { recursive: true });

/** Local fixtures, created by seed.mjs. Not credentials for anything real. */
export const OWNER = { email: 'limits-owner@ranch.test', password: 'Limits-e2e-owner-1' };
export const USER = { email: 'limits-user@ranch.test', password: 'Limits-e2e-user-1' };

/** The six seeded agents (quickstart.md §2). Ids are fixed so scripts can link to them. */
export const AGENTS = {
  minute: 'agent-limits-minute',
  hour: 'agent-limits-hour',
  day: 'agent-limits-day',
  off: 'agent-limits-off',
  legacy: 'agent-limits-legacy',
  share: 'agent-limits-share',
};

/** `KEY=value` lines of a dotenv file; values are never printed. */
export function readEnv(file) {
  const out = {};
  try {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const i = line.indexOf('=');
      if (i > 0 && !line.startsWith('#')) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  } catch {
    // Missing file: the caller reports what it needed.
  }
  return out;
}
export const apiEnv = readEnv(resolve(REPO, 'api/.env'));

/** Resolves packages the way the API does (root node_modules is hoisted). */
export const requireFromApi = createRequire(resolve(REPO, 'api/package.json'));

// ---------------------------------------------------------------- reporting

let fails = 0;
let checks = 0;
export function check(ok, msg) {
  checks += 1;
  if (!ok) fails += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`);
  return Boolean(ok);
}
export function section(title) {
  console.log(`\n${title}`);
}
/** Call last: prints the tally and sets the exit code. */
export function done(name) {
  console.log(`\n${name}: ${checks - fails}/${checks} passed${fails ? `, ${fails} FAILED` : ''}`);
  process.exitCode = fails ? 1 : 0;
  return fails;
}

/** Polls `fn` until it returns something truthy; null on timeout. */
export async function until(fn, { timeout = 10000, every = 150 } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    try {
      const value = await fn();
      if (value) return value;
    } catch {
      // Not there yet.
    }
    if (Date.now() > end) return null;
    await sleep(every);
  }
}

// ---------------------------------------------------------------------- API

function unwrap(json) {
  return json && typeof json === 'object' && 'data' in json ? json.data : json;
}

const tokens = new Map();
export async function tokenFor(who = OWNER) {
  if (tokens.has(who.email)) return tokens.get(who.email);
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: who.email, password: who.password }),
  });
  if (!res.ok) throw new Error(`API login failed for ${who.email}: ${res.status} (run seed.mjs first)`);
  const token = unwrap(await res.json()).accessToken;
  tokens.set(who.email, token);
  return token;
}

/** `{ status, body, headers }` — never throws on a 4xx, tests assert on it. */
export async function api(path, { method = 'GET', body, as = OWNER, headers = {} } = {}) {
  const auth = as ? { authorization: `Bearer ${await tokenFor(as)}` } : {};
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...auth, ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Not JSON.
  }
  return { status: res.status, body: unwrap(parsed), raw: parsed, headers: res.headers };
}

export const setLimits = (agentId, limits) => api(`/agents/${agentId}/limits`, { method: 'PUT', body: limits });
export const getLoad = (agentId) => api(`/agents/${agentId}/load`).then((r) => r.body);

/** One request over HTTP as an anonymous visitor: fills allowance without a browser. */
export const sendAnonymous = (agentId, text = 'fill') =>
  api(`/api/agent/${agentId}/message`, { method: 'POST', body: { text }, as: null });

// --------------------------------------------------------------- fake agent

export const fake = {
  async received(agentId) {
    const res = await fetch(`${FAKE}/received?agentId=${encodeURIComponent(agentId)}`);
    return res.json();
  },
  async reset() {
    await fetch(`${FAKE}/reset`, { method: 'POST' });
  },
  /** Delay before each answer, to keep a turn open. */
  async delay(ms) {
    await fetch(`${FAKE}/delay?ms=${ms}`, { method: 'POST' });
  },
  async up() {
    try {
      return (await fetch(`${FAKE}/health`)).ok;
    } catch {
      return false;
    }
  },
};

// ------------------------------------------------------------------ browser

/** Sign in through the console's own form. `base` is APP or ADMIN. */
export async function loginAs(page, who, base = APP) {
  await page.goto(`${base}/login`, { waitUntil: 'networkidle' });
  await page.locator('input[type="email"], input[name="email"]').first().fill(who.email);
  await page.locator('input[type="password"]').first().fill(who.password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }),
    page.locator('button[type="submit"]').first().click(),
  ]);
}

/** The notice, as the contract names it (contracts/chat-notice.md). */
export const NOTICE = '[data-limit-notice]';

/** What the notice shows right now, or null when it is not on screen. */
export async function readNotice(page) {
  const notice = page.locator(NOTICE).first();
  if (!(await notice.count())) return null;
  if (!(await notice.isVisible().catch(() => false))) return null;
  return {
    state: await notice.getAttribute('data-limit-state'),
    window: await notice.getAttribute('data-limit-window'),
    time: (await notice.locator('[data-limit-time]').first().textContent().catch(() => ''))?.trim() ?? '',
    text: ((await notice.textContent()) ?? '').replace(/\s+/g, ' ').trim(),
  };
}

/** `0:42` → 42, `12:05` → 725; NaN for anything that is not a countdown. */
export function countdownSeconds(time) {
  const m = /^(\d+):(\d{2})$/.exec(time ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}

export async function shot(page, name) {
  await page.screenshot({ path: resolve(SHOTS, `${name}.png`) });
}
