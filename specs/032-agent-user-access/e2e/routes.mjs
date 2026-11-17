// A role on every route, checked against the running API (CLEAN-232, T025).
//
//   node specs/032-agent-user-access/e2e/routes.mjs
//
// Reads every route from api/swagger-spec.json and calls each one:
//
//   1. with the seeded User's token: 403 everywhere outside the reviewed User
//      set of contracts/acting-party.md §6, never a 2xx outside it, never a
//      5xx anywhere;
//   2. with the seeded Admin's token, the Owner-only set: 403;
//   3. with a token the API's own secret signed that holds no role: 403 on
//      everything that is not public.
//
// Nothing is created or changed even if a route were open: path parameters
// are placeholders that name nothing, and every body is empty. Which routes
// are public or behind a machine guard is read from audit-after.txt, the
// reviewed output of api/scripts/audit-routes.mjs.
//
// Also here, because it is the same question asked of a response instead of
// a status: what `GET /agents` hands a User (the reader view).
//
// Needs: API :3333, after seed.mjs. No browser.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ADMIN_USER,
  AGENTS,
  API,
  HERE,
  OWNER,
  REPO,
  USER,
  api,
  check,
  done,
  rolelessToken,
  section,
  tokenFor,
} from './lib.mjs';

/** contracts/acting-party.md §6, and userRoutes.spec.ts: 17 routes and the MCP endpoints. */
const USER_SET = new Set([
  'GET /auth/me',
  'GET /agents',
  'GET /agents/status',
  'GET /agents/:id',
  'GET /agents/:agentId/limits/enabled',
  'GET /agents/:agentId/share-link',
  'POST /agents/:agentId/share-link',
  'POST /agents/:agentId/share-link/regenerate',
  'DELETE /agents/:agentId/share-link',
  'GET /me/chats',
  'GET /me/chats/:id',
  'GET /me/chats/:id/messages',
  'POST /me/chats/sync',
  'POST /me/chats/:id/feedback',
  'DELETE /me/chats/:id/feedback/:messageId',
  'GET /me/chats/:id/feedback',
  'GET /me/chats/:id/export',
  'POST /mcp/mcp',
  'GET /mcp/mcp',
  'DELETE /mcp/mcp',
  'GET /mcp/sse',
  'POST /mcp/messages',
]);

/** A path with its parameters unnamed, so `:id` and `:agentId` compare equal. */
const shape = (route) => route.replace(/:[A-Za-z0-9_]+/g, ':p');

// ---------------------------------------------------------------- the routes

const spec = JSON.parse(readFileSync(resolve(REPO, 'api/swagger-spec.json'), 'utf8'));
const routes = [];
for (const [path, methods] of Object.entries(spec.paths)) {
  for (const method of Object.keys(methods)) {
    if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
    const route = `${method.toUpperCase()} ${path.replace(/\{([^}]+)\}/g, ':$1')}`;
    routes.push({
      route,
      method: method.toUpperCase(),
      // A placeholder that names nothing, in every parameter.
      url: `${API}${path.replace(/\{[^}]+\}/g, 'e2e-nothing')}`,
    });
  }
}

// PUBLIC and machine routes, and the Owner-only ones, from the reviewed audit.
const audit = readFileSync(resolve(HERE, '../audit-after.txt'), 'utf8');
const audited = { PUBLIC: new Set(), machine: new Set(), Owner: new Set() };
for (const line of audit.split(/\r?\n/)) {
  const m = /^\s+(PUBLIC|machine|Owner|Admin\+|User\+)\s+((?:GET|POST|PUT|PATCH|DELETE) \S+)/.exec(line);
  if (m && audited[m[1]]) audited[m[1]].add(shape(m[2]));
}
const userSet = new Set([...USER_SET].map(shape));
const isOpen = (r) => audited.PUBLIC.has(shape(r.route)) || audited.machine.has(shape(r.route));
const inUserSet = (r) => userSet.has(shape(r.route));

async function call(r, token) {
  const mutating = r.method !== 'GET';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(r.url, {
      method: r.method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(mutating ? { 'content-type': 'application/json' } : {}),
      },
      body: mutating ? '{}' : undefined,
      signal: controller.signal,
    });
    // Headers are enough; a stream (SSE) would never end.
    res.body?.cancel().catch(() => undefined);
    return res.status;
  } catch (e) {
    return `no answer (${e?.name ?? e})`;
  } finally {
    clearTimeout(timer);
  }
}

/** Calls `list` with `token`, a few at a time; `{ route, status }` each. */
async function sweep(list, token) {
  const out = [];
  let i = 0;
  const worker = async () => {
    while (i < list.length) {
      const r = list[i++];
      out.push({ route: r.route, status: await call(r, token) });
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  return out;
}

const listed = (rows) => rows.map((r) => `${r.route} → ${r.status}`).join('; ');
const tally = (rows) => {
  const counts = {};
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return Object.entries(counts)
    .map(([status, n]) => `${status}×${n}`)
    .join(' ');
};

// --------------------------------------------------------------------- checks

section('The routes under test');
check(routes.length > 200, `${routes.length} routes read from api/swagger-spec.json`);
check(
  audited.PUBLIC.size > 0 && audited.Owner.size > 0,
  `the audit names ${audited.PUBLIC.size} public, ${audited.machine.size} machine and ${audited.Owner.size} Owner-only routes`,
);
const inSpec = new Set(routes.map((r) => shape(r.route)));
const missing = [...USER_SET].filter((route) => !inSpec.has(shape(route)));
// The SSE transport of the MCP module is not always in the OpenAPI document.
check(
  missing.every((route) => route.includes('/mcp/')),
  `every route of the reviewed User set is in the spec${missing.length ? ` (not documented: ${missing.join(', ')})` : ''}`,
);

section('With the User’s token');
const userToken = await tokenFor(USER);
const closed = routes.filter((r) => !isOpen(r) && !inUserSet(r));
const forUser = routes.filter((r) => !isOpen(r) && inUserSet(r));
const open = routes.filter(isOpen);

const closedAnswers = await sweep(closed, userToken);
const not403 = closedAnswers.filter((a) => a.status !== 403);
check(
  not403.length === 0,
  `403 on all ${closed.length} routes outside the User set (${tally(closedAnswers)})${not403.length ? `: ${listed(not403)}` : ''}`,
);
const twoHundreds = closedAnswers.filter((a) => typeof a.status === 'number' && a.status >= 200 && a.status < 300);
check(twoHundreds.length === 0, `no 2xx outside the User set${twoHundreds.length ? `: ${listed(twoHundreds)}` : ''}`);

const userAnswers = await sweep(forUser, userToken);
const refusedUser = userAnswers.filter((a) => a.status === 403 || a.status === 401);
check(
  refusedUser.length === 0,
  `the ${forUser.length} routes of the User set admit a User (${tally(userAnswers)})${refusedUser.length ? `: ${listed(refusedUser)}` : ''}`,
);

const openAnswers = await sweep(open, userToken);
const fiveHundreds = [...closedAnswers, ...userAnswers, ...openAnswers].filter(
  (a) => typeof a.status !== 'number' || a.status >= 500,
);
check(
  fiveHundreds.length === 0,
  `never a 5xx, on any of ${routes.length} routes, public and machine ones included (${tally(openAnswers)} on those ${open.length})` +
    (fiveHundreds.length ? `: ${listed(fiveHundreds)}` : ''),
);

section('With the Admin’s token, the Owner-only routes');
const ownerOnly = routes.filter((r) => audited.Owner.has(shape(r.route)));
const adminAnswers = await sweep(ownerOnly, await tokenFor(ADMIN_USER));
const adminIn = adminAnswers.filter((a) => a.status !== 403);
check(ownerOnly.length >= 7, `${ownerOnly.length} Owner-only routes found in the spec`);
check(
  adminIn.length === 0,
  `403 on each for an Admin (${tally(adminAnswers)})${adminIn.length ? `: ${listed(adminIn)}` : ''}`,
);
// Not swept with the Owner's token: `DELETE /agent-events/destination` has
// no parameter to make harmless, and for the Owner it would really remove
// the destination. That the Owner passes is owner-only.mjs's to show.

section('With a signed token that holds no role');
const nobody = rolelessToken();
const guarded = routes.filter((r) => !isOpen(r));
const nobodyAnswers = await sweep(guarded, nobody);
const nobodyIn = nobodyAnswers.filter((a) => a.status !== 403);
check(
  nobodyIn.length === 0,
  `403 on all ${guarded.length} routes that are not public (${tally(nobodyAnswers)})${nobodyIn.length ? `: ${listed(nobodyIn)}` : ''}`,
);

section('What GET /agents hands each reader');
const OPERATOR_FIELDS = {
  llmCredentialId: null,
  statusReason: null,
  workflowId: null,
  firstDeployedAt: null,
  lastDeployStartedAt: null,
  launchContext: null,
  lastPullAt: null,
  lastSyncAt: null,
  config: {},
  debugEnabled: false,
  knowledgeIds: [],
};
const isReaderView = (agent) =>
  Object.entries(OPERATOR_FIELDS).every(([key, empty]) => JSON.stringify(agent?.[key]) === JSON.stringify(empty));
const isWhole = (agent) => typeof agent?.config?.e2eOperatorNote === 'string' && agent.llmCredentialId !== null;
const seeded = (list) => Object.fromEntries(Object.entries(AGENTS).map(([key, a]) => [key, list.find((x) => x.id === a.id)]));

const asUser = seeded((await api('/agents', { as: USER })).body);
check(
  isReaderView(asUser.ranch) && isReaderView(asUser.a) && isReaderView(asUser.b),
  'a User gets no configuration of an agent they do not manage: config {}, no credential, workflow or deploy history',
);
check(isWhole(asUser.c), 'and the whole of the one they created');
check(
  !JSON.stringify([asUser.ranch, asUser.a, asUser.b]).includes('operator-only'),
  'nothing of the seeded operator note is anywhere in those three',
);
check(
  ['id', 'name', 'status', 'templateId', 'resources', 'isPublic', 'allowedOrigins', 'isAdmin', 'pinned', 'createdAt', 'updatedAt'].every(
    (key) => asUser.b?.[key] !== undefined && asUser.b?.[key] !== null,
  ),
  'what the user console draws is still there: name, status, template, resources, visibility, pin, dates',
);
const oneAsUser = (await api(`/agents/${AGENTS.b.id}`, { as: USER })).body;
check(isReaderView(oneAsUser), 'GET /agents/:id answers a User the same way');
const statusAsUser = (await api('/agents/status', { as: USER })).body.find((s) => s.agent.id === AGENTS.b.id);
check(isReaderView(statusAsUser?.agent), 'and so does GET /agents/status');

section('What the public status stream says');
/**
 * The first events of GET /agents/status/stream, read with no token at all
 * (it is public: an EventSource cannot send one), then the connection is
 * dropped. The opening snapshot is the whole fleet, so it is the frame that
 * would carry a leak.
 */
async function firstFrames(ms = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  let text = '';
  let status = 0;
  try {
    const res = await fetch(`${API}/agents/status/stream`, { signal: controller.signal });
    status = res.status;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    // The snapshot is one `data:` line ended by a blank line.
    while (!/\n\n/.test(text)) {
      const { value, done: ended } = await reader.read();
      if (ended) break;
      text += decoder.decode(value, { stream: true });
    }
  } catch (e) {
    if (e?.name !== 'AbortError') throw e;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  return { status, text };
}
{
  const { status, text } = await firstFrames();
  const line = text.split(/\r?\n/).find((l) => l.startsWith('data:'));
  let frame = null;
  try {
    frame = JSON.parse(line.slice('data:'.length));
  } catch {
    frame = null;
  }
  const message = frame?.type === undefined && frame?.data ? frame.data : frame;
  const items = message?.type === 'snapshot' && Array.isArray(message.payload) ? message.payload : [];
  check(status === 200 && items.length >= Object.keys(AGENTS).length, `an anonymous reader gets the opening snapshot (${status}, ${items.length} agents)`);
  const leaked = ['operator-only', '"config"', 'llmCredentialId', 'workflowId', 'statusReason', 'launchContext', 'createdById', '"name"', '"podName"', '"message"'].filter((s) => text.includes(s));
  check(leaked.length === 0, `nothing of an agent’s row is in it: no seeded operator note, no config, credential or workflow id, no name${leaked.length ? ` — FOUND: ${leaked.join(', ')}` : ''}`);
  const names = Object.values(AGENTS).filter((a) => text.includes(a.name));
  check(names.length === 0, `no agent is named${names.length ? ` — FOUND: ${names.map((a) => a.name).join(', ')}` : ''}`);
  const keysOf = (pick) => [...new Set(items.flatMap((item) => Object.keys(pick(item) ?? {})))].sort().join(',');
  check(
    keysOf((i) => i) === 'agent,bridleConnected,pod' && keysOf((i) => i.agent) === 'id,status,updatedAt',
    `each agent is { agent: { id, status, updatedAt }, pod, bridleConnected } and nothing more (${keysOf((i) => i)} / ${keysOf((i) => i.agent)})`,
  );
  const podKeys = keysOf((i) => i.pod);
  check(
    podKeys === '' || podKeys === 'containerWaitingReason,phase,ready,restartCount',
    `a pod, when there is one, is { phase, ready, restartCount, containerWaitingReason } (${podKeys || 'no pod on this stack'})`,
  );
  check(
    Object.values(AGENTS).every((a) => items.some((i) => i.agent?.id === a.id && typeof i.agent.status === 'string')),
    'the status of each seeded agent is there, which is what the consoles draw from it',
  );
}

section('What POST /me/chats/sync does for a User');
{
  // The User has no conversation yet on this stack, or only their own: the
  // sync looks at the agents they have one with and reports about those.
  const mine = (await api('/me/chats?perPage=100', { as: USER })).body;
  const myAgents = new Set((mine?.items ?? []).map((s) => s.agentId));
  const total = (await api('/agents', { as: USER })).body.length;
  const sync = await api('/me/chats/sync', { method: 'POST', body: {}, as: USER });
  check(
    sync.status >= 200 && sync.status < 300 && sync.body?.scannedAgents === myAgents.size,
    `it scans the ${myAgents.size} agent(s) the User has a conversation with, of ${total} on the ranch (scannedAgents ${sync.body?.scannedAgents}, status ${sync.status})`,
  );
  check(myAgents.size < total, `which is fewer than all of them, so the count says nothing about the ranch (${myAgents.size} < ${total})`);
  const other = Object.values(AGENTS).find((a) => !myAgents.has(a.id));
  const named = await api('/me/chats/sync', { method: 'POST', body: { agentId: other.id }, as: USER });
  check(
    named.status >= 200 && named.status < 300 && named.body?.scannedAgents === 0 && named.body?.scannedFiles === 0,
    `naming an agent the User has no conversation with scans nothing (scannedAgents ${named.body?.scannedAgents}, scannedFiles ${named.body?.scannedFiles})`,
  );
}

const asAdmin = seeded((await api('/agents', { as: ADMIN_USER })).body);
check(
  isWhole(asAdmin.a) && isWhole(asAdmin.b) && isWhole(asAdmin.c) && isReaderView(asAdmin.ranch) && asAdmin.ranch.isAdmin === true,
  'an Admin gets every agent whole except the Ranch admin agent, which stays marked isAdmin',
);
const asOwner = seeded((await api('/agents', { as: OWNER })).body);
check(Object.values(asOwner).every(isWhole), 'the Owner gets all four whole');

done('routes');
