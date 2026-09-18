// Shared helpers for the CLEAN-102 browser checks. Prints no secrets.
//
// Playwright is deliberately NOT a dependency of this repo. Install it anywhere
// outside the repo and point PLAYWRIGHT_DIR at that folder:
//
//   mkdir ~/pw && cd ~/pw && bun init -y && bun add playwright-core
//   PLAYWRIGHT_DIR=~/pw node specs/015-chat-message-reliability/e2e/chat.mjs app
//
// It drives an installed Chrome (CHROME_PATH overrides the default location).
// Credentials: RANCH_LOGIN / RANCH_PASS in .env.project at the repo root.
//
//   chat.mjs admin|app   order under a +2 min browser clock, delivery, time, reload, scroll, two tabs
//   leave.mjs [ms]       leave the agent page mid-answer and come back
//   status.mjs           agents list row vs header status (admin)
//   handoff.mjs          landing-page chat → agent page (needs a featured public agent)
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(resolve(process.env.PLAYWRIGHT_DIR || process.cwd(), 'package.json'));
const { chromium } = require('playwright-core');

export const ADMIN = process.env.ADMIN_URL || 'http://localhost:3001';
export const APP = process.env.APP_URL || 'http://localhost:3000';
export const AGENT = process.env.AGENT_ID || 'agent-bb620efe-abb5-4123-8ace-6d9b963387c7';
const CHROME =
  process.env.CHROME_PATH ||
  (process.platform === 'win32'
    ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
    : process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : '/usr/bin/google-chrome');

const env = {};
for (const line of readFileSync(resolve(REPO, '.env.project'), 'utf8').split(/\r?\n/)) {
  const i = line.indexOf('=');
  if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

export async function launch() {
  return chromium.launch({ executablePath: CHROME, headless: true });
}

/** New page; `skewMs` shifts the page's clock forward (Date.now and new Date()). */
export async function newPage(browser, { skewMs = 0 } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  if (skewMs) {
    await context.addInitScript((skew) => {
      const RealDate = Date;
      const now = () => RealDate.now() + skew;
      class SkewedDate extends RealDate {
        constructor(...args) {
          if (args.length === 0) super(now());
          else super(...args);
        }
        static now() { return now(); }
      }
      // eslint-disable-next-line no-global-assign
      Date = SkewedDate;
    }, skewMs);
  }
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 200)));
  return page;
}

export async function login(page, base) {
  await page.goto(base + '/login', { waitUntil: 'networkidle' });
  await page.locator('input[type="email"], input[name="email"]').first().fill(env.RANCH_LOGIN);
  await page.locator('input[type="password"]').first().fill(env.RANCH_PASS);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }),
    page.locator('button[type="submit"]').first().click(),
  ]);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
