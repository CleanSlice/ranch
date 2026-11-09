// Shared helpers for the CLEAN-215 browser checks. Prints no secrets.
//
// Playwright is deliberately NOT a dependency of this repo. Install it anywhere
// outside the repo and point PLAYWRIGHT_DIR at that folder:
//
//   mkdir ~/pw && cd ~/pw && bun init -y && bun add playwright-core
//   PLAYWRIGHT_DIR=~/pw node specs/026-app-console-redesign/e2e/shots.mjs
//
// It drives an installed Chrome (CHROME_PATH overrides the default location).
// Credentials: RANCH_LOCAL_LOGIN / RANCH_LOCAL_PASS in .env.project at the repo
// root (falls back to RANCH_LOGIN / RANCH_PASS).
//
//   shots.mjs     screenshots at six widths; --reduced, --touch, --only, --widths, --out
//   horizon.mjs   FR-010: hero horizon variants A and B at 1440x900
//   console.mjs   keyboard walk of Orbit and Drum, Cmd+K, stop/start rollback
//   measure.mjs   lighthouse medians + gzip of the landing's JS; --label, --compare
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const FEATURE = resolve(REPO, 'specs/026-app-console-redesign');

const pwDir = process.env.PLAYWRIGHT_DIR || 'C:/Users/maxim/pw';
const require = createRequire(resolve(pwDir, 'package.json'));
const pw = require('playwright-core');
export const { chromium, devices } = pw;

export const APP = process.env.APP_URL || 'http://localhost:3000';
export const API = process.env.API_URL || 'http://localhost:3333';
export const CHROME =
  process.env.CHROME_PATH ||
  (process.platform === 'win32'
    ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
    : process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : '/usr/bin/google-chrome');

export const env = {};
try {
  for (const line of readFileSync(resolve(REPO, '.env.project'), 'utf8').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0 && !line.startsWith('#')) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
} catch {
  // No .env.project: anonymous pages still work.
}
export const LOGIN = env.RANCH_LOCAL_LOGIN || env.RANCH_LOGIN || '';
export const PASS = env.RANCH_LOCAL_PASS || env.RANCH_PASS || '';

/** `--name value` → value, `--flag` → true, missing → def. */
export function arg(name, def = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const next = process.argv[i + 1];
  if (next === undefined || next.startsWith('--')) return true;
  return next;
}

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
  return dir;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch() {
  return chromium.launch({ executablePath: CHROME, headless: true });
}

/**
 * A fresh context + page. `reduced` emulates prefers-reduced-motion: reduce;
 * `touch` makes a phone-like context ((hover: none), touch events, mobile UA).
 */
export async function newPage(browser, { width = 1440, height = 900, reduced = false, touch = false } = {}) {
  const base = touch
    ? { ...devices['Pixel 7'], viewport: { width, height } }
    : { viewport: { width, height }, deviceScaleFactor: 1 };
  const context = await browser.newContext({
    ...base,
    reducedMotion: reduced ? 'reduce' : 'no-preference',
    locale: process.env.SHOT_LOCALE || 'ru-RU',
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 200)));
  return page;
}

/** Sign in through the form (works for the old auth layout and the new gate). */
export async function login(page) {
  if (!LOGIN || !PASS) throw new Error('RANCH_LOCAL_LOGIN / RANCH_LOCAL_PASS missing in .env.project');
  await page.goto(APP + '/login', { waitUntil: 'networkidle' });
  await page.locator('input[type="email"], input[name="email"]').first().fill(LOGIN);
  await page.locator('input[type="password"]').first().fill(PASS);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }),
    page.locator('button[type="submit"]').first().click(),
  ]);
}

function unwrap(json) {
  return json && typeof json === 'object' && 'data' in json ? json.data : json;
}

/** Token + agents straight from the API, for picking ids without a browser. */
export async function apiSession() {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: LOGIN, password: PASS }),
  });
  if (!res.ok) throw new Error(`API login failed: ${res.status}`);
  const session = unwrap(await res.json());
  const token = session.accessToken;
  const list = await fetch(`${API}/agents`, { headers: { authorization: `Bearer ${token}` } });
  if (!list.ok) throw new Error(`GET /agents failed: ${list.status}`);
  const agents = unwrap(await list.json());
  return { token, agents: Array.isArray(agents) ? agents : [] };
}

/** AGENT_ID from the environment, else the first running non-admin agent, else the first agent. */
export async function pickAgentId() {
  if (process.env.AGENT_ID) return process.env.AGENT_ID;
  const { agents } = await apiSession();
  const pick =
    agents.find((a) => a.status === 'running' && !a.isAdmin) ?? agents.find((a) => !a.isAdmin) ?? agents[0];
  if (!pick) throw new Error('No agents for this account; seed first');
  return pick.id;
}

/** Waits for the hero image (landing / gate) so a screenshot is never half-painted. */
export async function settle(page, { reduced = false } = {}) {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  const img = page.locator('img.land-atmo__img').first();
  if (await img.count()) {
    await img.evaluate((el) => (el.complete ? undefined : new Promise((r) => el.addEventListener('load', r, { once: true }))));
  }
  // Entrance animations run up to ~1.6 s; under reduced motion there are none.
  await sleep(reduced ? 300 : 1800);
}

/** FAILs when the page scrolls sideways. Returns true when fine. */
export async function noHorizontalScroll(page, label) {
  const { sw, cw } = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  if (sw > cw) {
    console.log(`  FAIL ${label}: horizontal scroll (${sw} > ${cw})`);
    return false;
  }
  return true;
}
