// Shared helpers for the launch step list checks (CLEAN-247). Prints no
// secrets.
//
// Everything of specs/030-agent-request-limits/e2e/lib.mjs (the same stack,
// seed and fixtures), plus what a launch needs to be watched step by step on
// a machine with no cluster:
//
//   - the status stream is scripted in the page: `EventSource` for
//     `/agents/status/stream` is replaced before the console loads, and the
//     test feeds it the frames a real launch produces, in order;
//   - the agent's row is real, with its status fields overridden on the way
//     to the browser, and restart / start / stop are answered in the page so
//     no workflow is submitted;
//   - the hub is real: a runtime for the agent under test is connected and
//     disconnected from here, exactly as a pod coming and going does it.
//
//   api     :3333   node dist/main            (started by all.mjs, after seed)
//   app     :3000   npx nuxt dev --port 3000
//   admin   :3001   npx nuxt dev --port 3001
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ADMIN,
  API,
  APP,
  FIXTURES,
  OWNER,
  api,
  apiEnv,
  loginAs,
  requireFromApi,
  until,
} from '../../030-agent-request-limits/e2e/lib.mjs';

export * from '../../030-agent-request-limits/e2e/lib.mjs';

// These shadow the ones re-exported above: this feature's own folders.
export const HERE = dirname(fileURLToPath(import.meta.url));
/** Screenshots go outside the repo, always. `LAUNCH_SHOTS` picks the folder. */
export const SHOTS = process.env.LAUNCH_SHOTS || resolve(tmpdir(), 'ranch-launch-steps-shots');
mkdirSync(SHOTS, { recursive: true });

export async function shot(page, name) {
  const path = resolve(SHOTS, `${name}.png`);
  await page.screenshot({ path });
  return path;
}

/** The fixture no fake runtime connects for: its hub connection is ours. */
export const AGENT = FIXTURES.stopped.id;

/** A failure reason with characters a careless renderer would mangle. */
export const REASON = 'Back-off pulling image "ranch/agent:nope"';

// --------------------------------------------------------------------- pods

const pod = (over) => ({
  phase: 'Pending',
  ready: false,
  restartCount: 0,
  containerWaitingReason: null,
  superseded: false,
  ...over,
});

/** The pod, as the stream reports it at each stage of a launch. */
export const POD = {
  /** The instance being replaced: still Running while it terminates. */
  old: pod({ phase: 'Running', ready: true, superseded: true }),
  pending: pod({}),
  creating: pod({ containerWaitingReason: 'ContainerCreating' }),
  running: pod({ phase: 'Running' }),
  ready: pod({ phase: 'Running', ready: true }),
  pullFailed: pod({ containerWaitingReason: 'ImagePullBackOff' }),
};

// ------------------------------------------------------------ status stream

/** Runs in the page, before the console: a status stream the test feeds. */
function installStatusStream() {
  const Native = window.EventSource;
  const sockets = new Set();
  let last = null;
  let open = true;

  class Scripted {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      sockets.add(this);
      setTimeout(() => {
        if (!open || this.readyState === 2) return;
        this.readyState = 1;
        if (this.onopen) this.onopen({});
        if (last && this.onmessage) this.onmessage({ data: last });
      }, 0);
    }
    close() {
      this.readyState = 2;
      sockets.delete(this);
    }
    addEventListener() {}
    removeEventListener() {}
  }

  window.EventSource = function (url, init) {
    return String(url).includes('/agents/status/stream') ? new Scripted(url) : new Native(url, init);
  };

  window.__status = {
    /** `snapshot` is what a stream that reconnects is given again. */
    send(message, snapshot) {
      last = JSON.stringify(snapshot);
      const data = JSON.stringify(message);
      for (const socket of sockets) if (socket.onmessage) socket.onmessage({ data });
    },
    drop() {
      open = false;
      for (const socket of sockets) if (socket.onerror) socket.onerror({});
    },
    resume() {
      open = true;
      for (const socket of sockets) {
        socket.readyState = 1;
        if (socket.onopen) socket.onopen({});
        if (last && socket.onmessage) socket.onmessage({ data: last });
      }
    },
    opened: () => sockets.size,
  };
}

/**
 * Puts one agent's launch under the test's control on this page. Call before
 * the console is opened.
 *
 * `row` is what the API is made to say of the agent (`status`,
 * `launchContext`, `statusReason`); `set()` changes it and moves `updatedAt`
 * forward, as a write does. `push()` sends a stream frame carrying the row's
 * status with a pod and the hub's word. Restart, start and stop are answered
 * here by the server's own rules, and recorded in `calls`.
 */
export async function stage(page, agentId = AGENT, initial = {}) {
  const origin = new URL(API).origin;
  let clock = Date.now();
  const row = {
    status: 'running',
    launchContext: 'restart',
    statusReason: null,
    ...initial,
    updatedAt: new Date(clock).toISOString(),
  };
  const calls = [];
  let shape = null;
  let lastPod = null;
  let lastHub = false;

  const touch = () => {
    clock += 1000;
    row.updatedAt = new Date(clock).toISOString();
  };
  const patch = (o) => {
    if (o && typeof o === 'object' && o.id === agentId) {
      Object.assign(o, {
        status: row.status,
        launchContext: row.launchContext,
        statusReason: row.statusReason,
        updatedAt: row.updatedAt,
      });
    }
  };
  const patchBody = (json) => {
    const wrapped = json && typeof json === 'object' && 'data' in json && !('id' in json);
    const body = wrapped ? json.data : json;
    if (Array.isArray(body)) body.forEach(patch);
    else patch(body);
    return json;
  };
  const frame = () => ({
    agent: { id: agentId, status: row.status, updatedAt: row.updatedAt },
    pod: lastPod,
    bridleConnected: lastHub,
    tools: null,
  });
  const emit = async () => {
    const f = frame();
    await page
      .evaluate(
        ([message, snapshot]) => window.__status && window.__status.send(message, snapshot),
        [
          { type: 'event', payload: { eventType: 'modified', status: f } },
          { type: 'snapshot', payload: [f] },
        ],
      )
      .catch(() => {});
  };

  await page.addInitScript(installStatusStream);

  // The row and the list: real, with the status fields of ours on top.
  await page.route(
    (url) => url.origin === origin && (url.pathname === '/agents' || url.pathname === `/agents/${agentId}`),
    async (route) => {
      const request = route.request();
      if (request.method() !== 'GET') return route.continue();
      const response = await route.fetch();
      let json;
      try {
        json = await response.json();
      } catch {
        return route.fulfill({ response });
      }
      patchBody(json);
      if (new URL(request.url()).pathname !== '/agents') shape = JSON.parse(JSON.stringify(json));
      return route.fulfill({ response, json });
    },
  );

  // Restart, start, stop: answered here, so nothing is submitted anywhere.
  const action = new RegExp(`^/agents/${agentId}/(restart|start|stop)$`);
  await page.route(
    (url) => url.origin === origin && action.test(url.pathname),
    async (route) => {
      const request = route.request();
      if (request.method() !== 'POST') return route.continue();
      const what = new URL(request.url()).pathname.split('/').pop();
      calls.push(what);
      if (what === 'stop') {
        row.status = 'stopped';
        lastPod = null;
      } else {
        // agentDeploy.service: no instance to replace is a start.
        row.launchContext =
          what === 'start' || row.status === 'stopped' || row.status === 'failed' ? 'start' : 'restart';
        row.status = 'deploying';
        row.statusReason = null;
        // The server stamps the launch before it answers, and the pod that
        // was there is from then on the one being replaced.
        if (lastPod) lastPod = { ...lastPod, superseded: true };
      }
      touch();
      await emit();
      if (!shape) shape = (await api(`/agents/${agentId}`)).raw;
      const json = patchBody(JSON.parse(JSON.stringify(shape)));
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        headers: {
          'access-control-allow-origin': request.headers().origin ?? '*',
          'access-control-allow-credentials': 'true',
        },
        body: JSON.stringify(json),
      });
    },
  );

  return {
    row,
    calls,
    /** Changes what the API says of the agent, as a write would. */
    set(next) {
      Object.assign(row, next);
      touch();
    },
    /** One stream frame: the row's status, this pod, the hub's word. */
    async push({ pod = lastPod, hub = lastHub } = {}) {
      lastPod = pod;
      lastHub = hub;
      await emit();
    },
    /** After a reload the page's stream starts empty: say the last frame again. */
    replay: emit,
    drop: () => page.evaluate(() => window.__status.drop()),
    resume: () => page.evaluate(() => window.__status.resume()),
  };
}

// ---------------------------------------------------------------------- hub

/**
 * The agent's runtime on the hub, under the test's hand: `up()` is a pod that
 * has booted and registered, `down()` is one that got its SIGTERM. Answers
 * what it is sent, like the shared fake agents.
 */
export function runtime(agentId = AGENT) {
  const { io } = requireFromApi('socket.io-client');
  let socket = null;
  return {
    async up() {
      if (socket) return true;
      socket = io(`${API}/ws/agent`, {
        auth: { apiKey: apiEnv.BRIDLE_API_KEY, agentId },
        transports: ['websocket'],
        reconnection: true,
        reconnectionDelay: 500,
      });
      const own = socket;
      own.on('message', (msg) => {
        const { clientId, text } = msg ?? {};
        own.emit('message', {
          type: 'message',
          clientId,
          text: `echo: ${text}`,
          messageId: randomUUID(),
          ts: Date.now(),
        });
      });
      own.on('sync', (msg) => own.emit('sync_done', { requestId: msg?.requestId, pushed: 0 }));
      return Boolean(await until(() => own.connected, { timeout: 10000 }));
    },
    async down() {
      if (!socket) return;
      socket.disconnect();
      socket = null;
    },
  };
}

// ------------------------------------------------------------------ console

export const CONSOLES = {
  admin: {
    name: 'admin',
    base: ADMIN,
    url: (id) => `${ADMIN}/agents/${id}?tab=chat`,
  },
  app: {
    name: 'app',
    base: APP,
    url: (id) => `${APP}/agents/${id}`,
  },
};

/**
 * A signed-in page of one console, with what went wrong on it collected:
 * console errors, page errors, and requests that failed.
 */
export async function consolePage(browser, which, { width = 1440, height = 900, reduced = false, who = OWNER, locale = null } = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    reducedMotion: reduced ? 'reduce' : 'no-preference',
  });
  if (locale) {
    await context.addCookies([{ name: 'i18n_redirected', value: locale, url: which.base }]);
  }
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${String(e).slice(0, 200)}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text().slice(0, 200)}`);
  });
  page.on('requestfailed', (r) => {
    const why = r.failure()?.errorText ?? '';
    // A navigation or a closed stream aborts what was in flight: not a failure.
    if (why.includes('ERR_ABORTED')) return;
    problems.push(`request failed: ${r.method()} ${new URL(r.url()).pathname} ${why}`);
  });
  await loginAs(page, who, which.base);
  return { page, context, problems };
}

/** Opens the agent's chat and waits until it can be written in. */
export async function openChat(page, which, agentId = AGENT) {
  await page.goto(which.url(agentId), { waitUntil: 'domcontentloaded' });
  return Boolean(
    await until(async () => (await page.locator('textarea').count()) > 0, { timeout: 30000, every: 250 }),
  );
}

// --------------------------------------------------------------------- list

/** `accepted:done stopped:current …` as the page shows it; '' when no list. */
export function rows(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-step]')]
      .map((el) => `${el.getAttribute('data-step')}:${el.getAttribute('data-step-state')}`)
      .join(' '),
  );
}

/** Waits for the list to read exactly `expected`; returns what it read last. */
export async function waitRows(page, expected, timeout = 8000) {
  let seen = '';
  const ok = await until(
    async () => {
      seen = await rows(page);
      return seen === expected;
    },
    { timeout, every: 100 },
  );
  return { ok: Boolean(ok), seen };
}

/** The overlay over the chat: its kind, or null when there is none. */
export function overlayKind(page) {
  return page.evaluate(
    () => document.querySelector('[data-chat-overlay]')?.getAttribute('data-chat-overlay') ?? null,
  );
}

/** An attribute of the list's host (`data-launch`, `data-launch-outcome`, …). */
export function launchAttr(page, name) {
  return page.evaluate((attr) => document.querySelector('[data-launch]')?.getAttribute(attr) ?? null, name);
}
