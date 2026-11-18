// Shared helpers for the acting-party checks (CLEAN-232, Part A of spec 032).
// Prints no secrets and writes none to disk.
//
// The scripts here drive the real consoles and the real API of a running
// local stack (quickstart.md §2):
//
//   api     :3333   node dist/main
//   app     :3000   npx nuxt dev --port 3000
//   admin   :3001   npx nuxt dev --port 3001
//   agents          node specs/032-agent-user-access/e2e/fakeRuntime.mjs
//
// Playwright comes from outside the repo, as in the earlier features (see
// specs/026-app-console-redesign/e2e/lib.mjs): PLAYWRIGHT_DIR, default
// C:/Users/maxim/pw. Screenshots and logs go to E2E_OUT (default: a folder in
// the system temp directory), never into the repo.
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

export {
  ADMIN,
  API,
  APP,
  CHROME,
  REPO,
  api,
  apiEnv,
  arg,
  chatOn,
  check,
  chromium,
  done,
  launch,
  loginAs,
  readEnv,
  requireFromApi,
  section,
  sleep,
  tokenFor,
  until,
} from '../../030-agent-request-limits/e2e/lib.mjs';
import { API, APP, apiEnv, requireFromApi } from '../../030-agent-request-limits/e2e/lib.mjs';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const OUT = resolve(process.env.E2E_OUT || resolve(tmpdir(), 'ranch-032-e2e'));
export const SHOTS = resolve(OUT, 'shots-032');
mkdirSync(SHOTS, { recursive: true });

export const FAKE = process.env.FAKE_RUNTIME_URL || 'http://localhost:3397';
export const MCP_URL = `${API}/mcp/mcp`;

/** Both widths every browser script runs at. */
export const WIDTHS = [390, 1440];

/** Local fixtures, created by seed.mjs. Not credentials for anything real. */
export const OWNER = { email: 'access-owner@ranch.test', password: 'Access-e2e-owner-1', role: 'Owner' };
export const ADMIN_USER = { email: 'access-admin@ranch.test', password: 'Access-e2e-admin-1', role: 'Admin' };
export const USER = { email: 'access-user@ranch.test', password: 'Access-e2e-user-1', role: 'User' };
export const USER2 = { email: 'access-user2@ranch.test', password: 'Access-e2e-user2-1', role: 'User' };
export const PEOPLE = { Owner: OWNER, Admin: ADMIN_USER, User: USER };

/**
 * The seeded agents. Ids have the `agent-<uuid>` shape the API validates in
 * request bodies (ConnectPeerDto), and are fixed so scripts can link to them.
 *
 *   ranch  the Ranch admin agent (`isAdmin`), nobody recorded as creator
 *   a      created by the Admin
 *   b      nobody recorded: "Unknown"
 *   c      created by the User (written directly, ahead of the feature that
 *          lets a User create an agent)
 */
export const AGENTS = {
  ranch: { id: 'agent-00000032-0000-4000-8000-00000000000f', name: 'access-ranch' },
  a: { id: 'agent-00000032-0000-4000-8000-00000000000a', name: 'access-alpha' },
  b: { id: 'agent-00000032-0000-4000-8000-00000000000b', name: 'access-bravo' },
  c: { id: 'agent-00000032-0000-4000-8000-00000000000c', name: 'access-charlie' },
};
export const TEMPLATE = { name: 'access-e2e', description: 'Fixture template for the acting-party checks', image: 'access-e2e:local' };
export const LLM = { id: 'llm-access-e2e', provider: 'claude', model: 'claude-haiku-4-5', label: 'access-e2e (dummy key)' };

// ---------------------------------------------------------------- tokens

/**
 * An agent runtime's service token, as `AuthService.issueAgentServiceToken`
 * mints it. Signed here with the local JWT_SECRET of api/.env; never printed.
 */
export function agentServiceToken(agentId, { admin = true } = {}) {
  if (!apiEnv.JWT_SECRET) throw new Error('JWT_SECRET is missing in api/.env');
  const jwt = requireFromApi('jsonwebtoken');
  return jwt.sign(
    { sub: `agent:${agentId}`, email: `agent-${agentId}@ranch.local`, roles: admin ? ['Owner'] : ['Agent'] },
    apiEnv.JWT_SECRET,
    { expiresIn: '1h' },
  );
}

/** A token the API's own secret signed that holds no role at all. */
export function rolelessToken(sub = 'user-nobody') {
  const jwt = requireFromApi('jsonwebtoken');
  return jwt.sign({ sub, email: 'nobody@ranch.test', roles: [] }, apiEnv.JWT_SECRET, { expiresIn: '10m' });
}

// ------------------------------------------------------------ fake runtime

export const fake = {
  /** Whole inbound messages for an agent, oldest first. */
  async received(agentId) {
    const res = await fetch(`${FAKE}/received?agentId=${encodeURIComponent(agentId)}`);
    return res.json();
  },
  async reset() {
    await fetch(`${FAKE}/reset`, { method: 'POST' });
  },
  async health() {
    try {
      return await (await fetch(`${FAKE}/health`)).json();
    } catch {
      return null;
    }
  },
  /** Drop or restore one agent's socket, so a real runtime can take its place. */
  async disconnect(agentId) {
    return (await fetch(`${FAKE}/disconnect?agentId=${encodeURIComponent(agentId)}`, { method: 'POST' })).json();
  },
  async connect(agentId) {
    return (await fetch(`${FAKE}/connect?agentId=${encodeURIComponent(agentId)}`, { method: 'POST' })).json();
  },
};

// ------------------------------------------------------------------ browser

/**
 * A fresh context and page that record what a browser script must fail on:
 * console errors, uncaught page errors, and failed requests (a network
 * failure or a status of 400 and up). `expected` lists what the scenario
 * provokes on purpose: `{ status, url }` with `url` a substring or RegExp.
 * A request the page itself aborted (navigation away, a closed socket or
 * stream) is not a failure.
 */
export async function watchedPage(browser, { width = 1440, height = 900, expected = [] } = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    locale: 'en-GB',
  });
  await context.addCookies([{ name: 'i18n_redirected', value: 'en', url: APP }]);
  const page = await context.newPage();
  const problems = [];
  const allowed = (status, url) =>
    expected.some(
      (e) =>
        (e.status === undefined || e.status === status) &&
        (typeof e.url === 'string' ? url.includes(e.url) : e.url.test(url)),
    );
  const short = (url) => url.replace(/([?&](?:token|access_token)=)[^&]+/g, '$1…').slice(0, 160);
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // Chrome logs every failed request as a console error too; those are
    // judged once, by status, in the response handler below.
    if (/^Failed to load resource/.test(text)) return;
    problems.push(`console error: ${text.slice(0, 240)}`);
  });
  page.on('pageerror', (e) => problems.push(`page error: ${String(e).slice(0, 240)}`));
  page.on('response', (res) => {
    const status = res.status();
    if (status < 400) return;
    const url = res.url();
    if (allowed(status, url)) return;
    problems.push(`${status} ${res.request().method()} ${short(url)}`);
  });
  page.on('requestfailed', (req) => {
    const reason = req.failure()?.errorText ?? '';
    if (/ERR_ABORTED/.test(reason)) return;
    if (allowed(0, req.url())) return;
    problems.push(`request failed (${reason}): ${req.method()} ${short(req.url())}`);
  });
  return { context, page, problems };
}

export async function shot(page, name) {
  const file = resolve(SHOTS, `${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

// ---------------------------------------------------------------------- MCP

const ACTOR = 'ranch/actor';

/**
 * An MCP client the way the runtime is one: the agent's service token as the
 * bearer, and the actor of the turn in `_meta` of every list and call.
 * `actor` is the default for the session; `list` and `call` take another.
 */
export async function mcpAs(bearer, actor) {
  const { Client } = requireFromApi('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = requireFromApi('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const client = new Client({ name: 'access-e2e', version: '1.0.0' }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: { headers: { authorization: `Bearer ${bearer}` } },
  });
  await client.connect(transport);
  const meta = (a) => (a === undefined ? {} : { _meta: { [ACTOR]: a } });
  return {
    /** Tool names the caller is shown. */
    async list(a = actor) {
      const names = [];
      let cursor;
      do {
        const page = await client.listTools({ ...(cursor ? { cursor } : {}), ...meta(a) });
        names.push(...page.tools.map((t) => t.name));
        cursor = page.nextCursor;
      } while (cursor);
      return names;
    },
    /** `{ refused, text }`: refused when the call errored, by result or by protocol. */
    async call(name, args = {}, a = actor) {
      try {
        const result = await client.callTool({ name, arguments: args, ...meta(a) });
        const text = (result.content ?? []).map((c) => c.text ?? '').join('\n');
        return { refused: result.isError === true, text };
      } catch (e) {
        return { refused: true, text: String(e?.message ?? e) };
      }
    },
    close: () => client.close().catch(() => undefined),
  };
}

/** Tools checked by name. Each is the real name in the API's code. */
export const TOOLS = {
  /** `admin` audience: Owner or Admin. */
  admin: ['list_users', 'create_agent', 'list_settings', 'upsert_setting', 'delete_setting'],
  /**
   * `reader` audience (CLEAN-231): any signed-in person, or an operator.
   * They show a caller the agents they reach and are not management.
   */
  reader: ['list_agents', 'get_agent'],
  /** `owner` audience. */
  owner: ['set_user_role', 'delete_user', 'set_agent_admin'],
  /** `manage-agent` audience: whoever may manage the agent named. */
  manage: ['delete_agent', 'stop_agent', 'start_agent', 'restart_agent', 'get_agent_status', 'get_agent_env', 'connect_agent_peer'],
  /**
   * `agent` audience, the calling agent's own peers. On the Ranch admin
   * agent they are the Owner's: listed for the Owner and for the agent
   * acting for itself, for nobody else.
   */
  ownPeers: ['list_my_peers', 'list_ranch_agents', 'connect_my_peer', 'import_my_peer_by_address', 'connect_my_peer_from_card', 'remove_my_peer'],
};
export const MANAGEMENT_TOOLS = [...TOOLS.admin, ...TOOLS.owner, ...TOOLS.manage, ...TOOLS.ownPeers];
