// Shared helpers for the agent Overview browser checks (CLEAN-228). Prints no
// secrets.
//
// Everything of specs/030-agent-request-limits/e2e/lib.mjs — the same stack,
// seed and fake agents — plus what this page needs: its own screenshot
// folder, the hooks of contracts/overview-ui.md by name, the save bar, the
// console's confirm dialog and the bodies of the requests a save sends.
//
//   api     :3333   node dist/main            (after seed.mjs)
//   admin   :3001   npx nuxt dev --port 3001
//   agents          node specs/030-agent-request-limits/e2e/fakeAgent.mjs
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADMIN, OWNER, api, loginAs, until } from '../../030-agent-request-limits/e2e/lib.mjs';

export * from '../../030-agent-request-limits/e2e/lib.mjs';

// These three shadow the ones re-exported above: this feature's own folder.
export const HERE = dirname(fileURLToPath(import.meta.url));
export const SHOTS = resolve(HERE, 'shots');
mkdirSync(SHOTS, { recursive: true });

export async function shot(page, name) {
  await page.screenshot({ path: resolve(SHOTS, `${name}.png`) });
}

/** The section rows, in the order of the contract. */
export const SECTION_ORDER = [
  'overview',
  'knowledge',
  'a2a',
  'channels',
  'secrets',
  'env',
  'files',
  'chats',
  'logs',
  'events',
  'paddock',
];

// ------------------------------------------------------------------- pages

/** A signed-in Owner on the admin console, at a given size. */
export async function adminPage(browser, { width = 1440, height = 900, reduced = false, permissions = [] } = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    reducedMotion: reduced ? 'reduce' : 'no-preference',
    permissions,
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 200)));
  await loginAs(page, OWNER, ADMIN);
  return page;
}

/** An agent's Settings on a section; resolves once the section list is there. */
export async function openSettings(page, agentId, tab = 'overview') {
  await page.goto(`${ADMIN}/agents/${agentId}?tab=${tab}`, { waitUntil: 'networkidle' });
  await page.locator('[data-section-nav]').first().waitFor({ state: 'visible', timeout: 20000 });
}

/** Overview, once its blocks are on the page. */
export async function openOverview(page, agentId) {
  await openSettings(page, agentId, 'overview');
  await page.locator('[data-overview]').first().waitFor({ state: 'visible', timeout: 20000 });
}

// ------------------------------------------------------------------- hooks

/** `hook(page, 'block', 'limit')` → `[data-block="limit"]`; without a value, `[data-block]`. */
export function hook(scope, name, value) {
  const attr = name.startsWith('data-') ? name : `data-${name}`;
  return scope.locator(value === undefined ? `[${attr}]` : `[${attr}="${value}"]`);
}

/** Visible text of the first match, spaces collapsed; '' when there is none. */
export async function textOf(locator) {
  if ((await locator.count()) === 0) return '';
  return ((await locator.first().textContent()) ?? '').replace(/\s+/g, ' ').trim();
}

/** True when the first match has a box and that box crosses the viewport. */
export async function inViewport(locator) {
  if ((await locator.count()) === 0) return false;
  return locator.first().evaluate((el) => {
    const box = el.getBoundingClientRect();
    return (
      box.width > 0 &&
      box.height > 0 &&
      box.bottom > 0 &&
      box.top < window.innerHeight &&
      box.right > 0 &&
      box.left < window.innerWidth
    );
  });
}

/** True when the page cannot be scrolled sideways. */
export async function noSidewaysScroll(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth <= root.clientWidth && document.body.scrollWidth <= root.clientWidth;
  });
}

/**
 * Opens a folded block (`data-advanced`, `data-embed`) by what a person
 * presses: the control inside it that says whether it is expanded.
 */
export async function unfold(page, name) {
  const block = hook(page, name).first();
  await block.scrollIntoViewIfNeeded();
  if ((await block.getAttribute('data-state')) === 'open') return true;
  const self = await block.getAttribute('aria-expanded');
  const trigger = self !== null ? block : block.locator('[aria-expanded], summary').first();
  await trigger.click();
  return Boolean(await until(async () => (await block.getAttribute('data-state')) === 'open', { timeout: 4000 }));
}

// ---------------------------------------------------------------- requests

/**
 * An array that fills with the parsed JSON bodies of the page's requests
 * whose URL matches `urlPart` (a string it contains, or a RegExp) and whose
 * method is `method`. Empty it with `bodies.length = 0`.
 */
export function captureRequests(page, urlPart, method = 'PUT') {
  const bodies = [];
  page.on('request', (request) => {
    if (request.method() !== method) return;
    const url = request.url();
    const hit = urlPart instanceof RegExp ? urlPart.test(url) : url.includes(urlPart);
    if (!hit) return;
    let body = null;
    try {
      body = request.postDataJSON();
    } catch {
      body = request.postData();
    }
    bodies.push(body);
  });
  return bodies;
}

/** `PUT /agents/<id>` itself, not the routes under it. */
export const agentPut = (agentId) => new RegExp(`/agents/${agentId}(\\?.*)?$`);

/** Everything under `/agents/<id>`: any write about this agent. */
export const agentAny = (agentId) => new RegExp(`/agents/${agentId}(/|\\?|$)`);

// ---------------------------------------------------------------- save bar

/** The bar that exists only while something is changed. */
export function saveBar(page) {
  const bar = page.locator('[data-save-bar]');
  return {
    bar,
    present: async () => (await bar.count()) > 0,
    appears: (timeout = 4000) => until(async () => (await bar.count()) > 0, { timeout }),
    leaves: (timeout = 6000) => until(async () => (await bar.count()) === 0, { timeout }),
    /** The number of unsaved changes it states; 0 when the bar is not there. */
    async count() {
      const el = page.locator('[data-save-count]');
      if ((await el.count()) === 0) return 0;
      const m = /\d+/.exec((await el.first().textContent()) ?? '');
      return m ? Number(m[0]) : NaN;
    },
    counts: (n, timeout = 4000) =>
      until(
        async () => {
          const el = page.locator('[data-save-count]');
          if ((await el.count()) === 0) return n === 0;
          const m = /\d+/.exec((await el.first().textContent()) ?? '');
          return m !== null && Number(m[0]) === n;
        },
        { timeout },
      ),
    text: () => textOf(bar),
    save: () => page.locator('[data-visibility-save]').first().click(),
    saveAndRestart: () => page.locator('[data-save-restart]').first().click(),
    discard: () => page.locator('[data-save-discard]').first().click(),
  };
}

// ---------------------------------------------------------- confirm dialog

/** The console's own confirm dialog, as it asks before changes are lost. */
export function confirmDialog(page) {
  const dialog = page.locator('[data-confirm-dialog]');
  const shown = async () => (await dialog.count()) > 0 && (await dialog.first().isVisible());
  return {
    dialog,
    visible: shown,
    appears: (timeout = 4000) => until(shown, { timeout }),
    text: () => textOf(dialog),
    async accept() {
      await page.locator('[data-confirm-accept]').first().click();
      return until(async () => !(await shown()), { timeout: 4000 });
    },
    async cancel() {
      await page.locator('[data-confirm-cancel]').first().click();
      return until(async () => !(await shown()), { timeout: 4000 });
    },
  };
}

// --------------------------------------------------------------------- API

export const agentOf = async (id) => (await api(`/agents/${id}`)).body;
export const limitsOf = async (id) => (await api(`/agents/${id}/limits`)).body?.limits ?? null;
export const usageOf = async (id) => (await api(`/agents/${id}/usage`)).body;

/**
 * What a script needs to put an agent back: call before touching it, and
 * `restore()` in `finally`. Limits go first when the agent ends private, so
 * it is never public without one on the way.
 */
export async function remember(agentId) {
  const agent = await agentOf(agentId);
  const limits = await limitsOf(agentId);
  return {
    agent,
    limits,
    async restore() {
      if (!agent) return;
      const body = {
        name: agent.name,
        config: agent.config ?? {},
        knowledgeIds: agent.knowledgeIds ?? [],
        resources: agent.resources,
        debugEnabled: agent.debugEnabled ?? false,
        allowedOrigins: agent.allowedOrigins ?? [],
      };
      // The platform cannot clear a credential (research R5), only set one.
      if (agent.llmCredentialId) body.llmCredentialId = agent.llmCredentialId;
      // "Public with no limits" exists only for agents older than limits; a
      // save that mentions visibility would be refused, so it is left alone.
      if (!(agent.isPublic && !limits)) {
        const set = {};
        for (const key of ['perMinute', 'perHour', 'perDay']) {
          if (limits && limits[key] !== null && limits[key] !== undefined) set[key] = limits[key];
        }
        body.isPublic = agent.isPublic;
        body.limits = Object.keys(set).length > 0 ? set : null;
      }
      const res = await api(`/agents/${agentId}`, { method: 'PUT', body });
      if (res.status >= 400) console.log(`  [restore] ${agentId}: ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
    },
  };
}

// ----------------------------------------------------------------- figures

/** `1,234` → 1234, `132.6M` → 132600000, `3.2k` → 3200; NaN when it is not a number. */
export function parseCompact(text) {
  const m = /(-?[\d.,]+)\s*([kKmMbB])?/.exec(text ?? '');
  if (!m) return NaN;
  const base = Number(m[1].replace(/,/g, ''));
  const unit = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] ?? '').toLowerCase()] ?? 1;
  return base * unit;
}

/** The first `$1,234.50` in a text, as a number; NaN when there is none. */
export function parseMoney(text) {
  const m = /\$\s*([\d,]+(?:\.\d+)?)/.exec(text ?? '');
  return m ? Number(m[1].replace(/,/g, '')) : NaN;
}

/** Every number written in a text, compact forms expanded (`2,191 calls · 132.6M` → [2191, 132600000]). */
export function numbersIn(text) {
  const out = [];
  const re = /(\d[\d,]*(?:\.\d+)?)\s*([kKMB])?(?![a-zA-Z])/g;
  for (let m = re.exec(text ?? ''); m; m = re.exec(text ?? '')) {
    const unit = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] ?? '').toLowerCase()] ?? 1;
    out.push(Number(m[1].replace(/,/g, '')) * unit);
  }
  return out;
}

/**
 * A figure shown in short form (`2.4M` for 2,449,000) is right when it is
 * within three percent, or half a unit for small ones.
 */
export const about = (shown, real) => Math.abs(shown - real) <= Math.max(0.5, Math.abs(real) * 0.03);

/** True when one of the numbers written in `text` is `real`, allowing for a short form. */
export const mentions = (text, real) => numbersIn(text).some((n) => about(n, real));

/** True when `real` is written in `text` digit for digit (`2,191` for 2191). */
export const states = (text, real) => numbersIn(text).includes(real);
