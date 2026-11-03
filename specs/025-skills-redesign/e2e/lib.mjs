// Shared helpers for the CLEAN-205 browser checks. Prints no secrets.
//
// Playwright is deliberately NOT a dependency of this repo. Install it anywhere
// outside the repo and point PLAYWRIGHT_DIR at that folder:
//
//   mkdir ~/pw && cd ~/pw && bun init -y && bun add playwright-core
//   PLAYWRIGHT_DIR=~/pw node specs/025-skills-redesign/e2e/reorder.mjs
//
// It drives an installed Chrome (CHROME_PATH overrides the default location).
// Credentials: RANCH_LOGIN / RANCH_PASS in .env.project at the repo root.
//
//   reorder.mjs   mouse drag + save, keyboard move, Discard, rollback on 500, reload on 409 (1440 px)
//   drawer.mjs    the skill drawer at 1024 px: open, Esc, focus back on the row, Back
//   sheet.mjs     cards, bottom sheet and Reorder mode at 390 px
//   form.mjs      slug from title, validation, taken name, draft, Ctrl+S
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(resolve(process.env.PLAYWRIGHT_DIR || process.cwd(), 'package.json'));
const { chromium } = require('playwright-core');

export const ADMIN = process.env.ADMIN_URL || 'http://localhost:3001';
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

/** New page at the given viewport (the scripts pick 1440, 1024 or 390). */
export async function newPage(browser, { width = 1440, height = 900 } = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 200)));
  return page;
}

// A seeded local login can come from the environment instead of .env.project.
const LOGIN = process.env.RANCH_LOGIN || env.RANCH_LOGIN;
const PASS = process.env.RANCH_PASS || env.RANCH_PASS;

export async function login(page, base = ADMIN) {
  await page.goto(base + '/login', { waitUntil: 'networkidle' });
  await page.locator('input[type="email"], input[name="email"]').first().fill(LOGIN);
  await page.locator('input[type="password"]').first().fill(PASS);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }),
    page.locator('button[type="submit"]').first().click(),
  ]);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** PASS / FAIL lines; `done()` exits non-zero when anything failed. */
export function checker() {
  let failed = 0;
  const check = (name, ok, detail = '') => {
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  };
  const done = () => {
    console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
    process.exit(failed ? 1 : 0);
  };
  return { check, done };
}

/** No horizontal page scroll: the brief's rule at every width. */
export const noHorizontalScroll = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
