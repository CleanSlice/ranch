// Agent access, checked against the running API (CLEAN-231, T053, SC-002).
//
//   node specs/032-agent-user-access/e2e/http.mjs
//
// No browser. With the restricted accounts of seed.mjs:
//
//   the Admin        limited to access-alpha and access-bravo
//                    (hidden: access-charlie and the Ranch admin agent)
//   the first User   denied access-alpha
//   the second User  open; this script edits its access and puts it back
//
//   1. every route of contracts/enforcement.md that names an agent answers a
//      hidden agent exactly as it answers an id that names nothing, and
//      never mentions the hidden agent;
//   2. every list leaves the hidden agents out (and the Owner still gets
//      them, so the check has something to find);
//   3. records addressed by their own id (a chat) and the chat surface;
//   4. the access routes: each refusal code, the ceiling, entries outside
//      the view preserved, the confirmation, the version, an agent never on
//      both lists, also under two simultaneous PUTs;
//   5. deleting the only allowed agent leaves no access and a review mark;
//   6. pins are per account;
//   7. a socket open on an agent is closed when access is taken away;
//   8. the same through the tools;
//   9. POST /chats/sync with no agent named walks and counts only the
//      agents the caller reaches;
//  10. the browser extension's token, which lives up to a year, is asked
//      again on every use: it stops working when the agent is taken away;
//  11. a deleted account's token, still a valid token, reaches nothing, and
//      its open socket is closed.
//
// Needs: API :3333 after seed.mjs, and the fake runtime for section 7.
import {
  ADMIN_USER,
  AGENTS,
  API,
  LLM,
  MCP_URL,
  OWNER,
  TEMPLATE,
  USER,
  USER2,
  agentServiceToken,
  api,
  apiEnv,
  check,
  done,
  mcpAs,
  requireFromApi,
  section,
  setAssistantFor,
  sleep,
  tokenFor,
  until,
} from './lib.mjs';

void MCP_URL;
const GHOST = 'agent-00000032-0000-4000-8000-0000000000ee';
const NAMES = Object.values(AGENTS).map((a) => a.name);

process.env.DATABASE_URL = apiEnv.DATABASE_URL;
const { PrismaClient } = requireFromApi('@prisma/client');
const prisma = new PrismaClient();

/** A response as text, for "does it mention X". */
const textOf = (res) => (typeof res.raw === 'string' ? res.raw : JSON.stringify(res.raw ?? ''));
const mentions = (res, agent) => textOf(res).includes(agent.id) || textOf(res).includes(agent.name);
/** A body with every agent id replaced, so two answers can be compared. */
const shape = (res, id) => textOf(res).split(id).join('<agent>');
const code = (res) => res.raw?.code ?? res.raw?.message?.code ?? res.body?.code;
const message = (res) => {
  const m = res.raw?.message ?? res.body?.message;
  return typeof m === 'string' ? m : (m?.message ?? '');
};

try {
  // ------------------------------------------------------------ who is who
  section('Preconditions');
  const users = (await api('/users', { as: OWNER })).body;
  const idOf = (who) => users.find((u) => u.email === who.email)?.id;
  const ids = { owner: idOf(OWNER), admin: idOf(ADMIN_USER), user: idOf(USER), user2: idOf(USER2) };
  check(Object.values(ids).every(Boolean), 'the four seeded accounts exist');
  const markOf = (who) => users.find((u) => u.email === who.email)?.agentAccess;
  check(markOf(OWNER)?.kind === 'all', `GET /users marks the Owner "all" (${markOf(OWNER)?.kind})`);
  check(markOf(ADMIN_USER)?.kind === 'only', `the Admin "only" (${markOf(ADMIN_USER)?.kind})`);
  check(markOf(USER)?.kind === 'all_except', `the first User "all_except" (${markOf(USER)?.kind})`);
  check(markOf(USER2)?.kind === 'all' && markOf(USER2)?.needsReview === false, `the second User "all" (${markOf(USER2)?.kind})`);
  const me = await api('/auth/me', { as: USER });
  check(me.status === 200 && me.body?.agentAccess === undefined, 'GET /auth/me does not tell a User about their lists');

  // -------------------------------------------- 1. routes that name an agent
  // `{id}` is the agent. Each is called for the hidden agent and for an id
  // that names nothing; the two answers must be the same answer.
  const NAMED = [
    ['GET', '/agents/{id}'],
    ['GET', '/agents/{id}/metrics'],
    ['GET', '/agents/{id}/env'],
    ['GET', '/agents/{id}/mcps'],
    ['GET', '/agents/{id}/mcp-status'],
    ['GET', '/agents/{id}/tools'],
    ['GET', '/agents/{id}/channels'],
    ['PUT', '/agents/{id}/channels', { channels: [] }],
    ['PUT', '/agents/{id}', { name: 'renamed-by-http-mjs' }],
    ['DELETE', '/agents/{id}'],
    ['POST', '/agents/{id}/restart'],
    ['POST', '/agents/{id}/stop'],
    ['POST', '/agents/{id}/start'],
    ['POST', '/agents/{id}/promote-admin'],
    ['DELETE', '/agents/{id}/promote-admin'],
    ['PUT', '/agents/{id}/pin'],
    ['DELETE', '/agents/{id}/pin'],
    ['GET', '/agents/{id}/limits'],
    ['PUT', '/agents/{id}/limits', { perMinute: 5 }],
    ['GET', '/agents/{id}/limits/enabled'],
    ['GET', '/agents/{id}/load'],
    ['GET', '/agents/{id}/files'],
    ['GET', '/agents/{id}/files/limits'],
    ['GET', '/agents/{id}/files/content?path=SOUL.md'],
    ['PUT', '/agents/{id}/files/content', { path: 'SOUL.md', content: 'x' }],
    ['DELETE', '/agents/{id}/files/content?path=SOUL.md'],
    ['POST', '/agents/{id}/files/sync'],
    ['GET', '/agents/{id}/files/export'],
    ['POST', '/agents/{id}/files/open-link', { path: 'SOUL.md' }],
    ['GET', '/agents/{id}/files/proposals'],
    ['GET', '/agents/{id}/secrets'],
    ['PUT', '/agents/{id}/secrets', { key: 'K', value: 'v' }],
    ['GET', '/agents/{id}/share-link'],
    ['POST', '/agents/{id}/share-link'],
    ['POST', '/agents/{id}/share-link/regenerate'],
    ['DELETE', '/agents/{id}/share-link'],
    ['GET', '/agents/{id}/logs'],
    ['GET', '/agents/{id}/usage'],
    ['GET', '/agents/{id}/card'],
    ['GET', '/agents/{id}/peers'],
    ['GET', '/agents/{id}/peers/candidates'],
    ['GET', '/agents/{id}/peers/state'],
    ['GET', '/agents/{id}/delegations'],
    ['GET', '/agent-events?agentId={id}'],
    ['GET', '/agent-incidents?agentId={id}'],
    ['GET', '/chats?agentId={id}'],
    ['POST', '/chats/sync', { agentId: '{id}' }],
    ['POST', '/me/chats/sync', { agentId: '{id}' }],
    ['GET', '/paddock-evaluations?agentId={id}'],
    ['POST', '/paddock-evaluations', { agentId: '{id}' }],
    ['GET', '/paddock-scenarios?agentId={id}'],
    ['POST', '/paddock-scenarios', { agentId: '{id}', name: 'x', description: 'x' }],
    ['POST', '/paddock-scenarios/generate', { agentId: '{id}', description: 'x' }],
    ['POST', '/browser/extension/token', { agentId: '{id}', userId: 'u' }],
    // The chat surface, with the person's console token.
    ['GET', '/api/agent/{id}/health'],
    ['GET', '/api/agent/{id}/transcript'],
    ['GET', '/api/agent/{id}/transcript?channel=anon-http-mjs'],
    ['DELETE', '/api/agent/{id}/transcript'],
    ['POST', '/api/agent/{id}/transcript/archive'],
    ['POST', '/api/agent/{id}/message', { text: 'hello from http.mjs' }],
    ['POST', '/api/agent/{id}/message/sync', { text: 'hello from http.mjs' }],
    ['GET', '/api/agent/{id}/attachment/att-http-mjs'],
    ['GET', '/api/agent/{id}/message/m-1/source/1/content'],
  ];
  const call = (who, [method, path, body], id) =>
    api(path.split('{id}').join(id), {
      method,
      as: who,
      ...(body !== undefined ? { body: JSON.parse(JSON.stringify(body).split('{id}').join(id)) } : {}),
    });

  // The Ranch admin agent is on nobody's list since CLEAN-240: it is the
  // assistant, and a person has it by the assistant's own switch, which is
  // on for an Admin unless the Owner says otherwise (specs/034,
  // contracts/api.md, "Changed routes"). So "an Admin who does not reach
  // it" is an Admin it is switched off for. That is what sections 1 and 2
  // are run with; the Admin who has it follows in section 2b.
  {
    const off = await setAssistantFor(ids.admin, { enabled: false });
    check(off.status === 200 && off.body?.enabled === false, `the Owner switches the assistant off for the Admin (${off.status})`);
  }
  for (const [label, who, hidden] of [
    ['the limited Admin, access-charlie', ADMIN_USER, AGENTS.c],
    ['the limited Admin, the Ranch admin agent, switched off for them', ADMIN_USER, AGENTS.ranch],
    ['the User, access-alpha (denied)', USER, AGENTS.a],
  ]) {
    section(`1. Routes that name an agent: ${label}`);
    const bad = [];
    let refused = 0;
    let byRole = 0;
    for (const route of NAMED) {
      const [h, g] = [await call(who, route, hidden.id), await call(who, route, GHOST)];
      const name = `${route[0]} ${route[1]}`;
      if (h.status === 404) refused += 1;
      else if (h.status === 403) byRole += 1;
      else bad.push(`${name}: ${h.status}`);
      if (h.status !== g.status || shape(h, hidden.id) !== shape(g, GHOST)) {
        bad.push(`${name}: hidden ${h.status} ${shape(h, hidden.id).slice(0, 120)} / unknown ${g.status} ${shape(g, GHOST).slice(0, 120)}`);
      }
      if (textOf(h).includes(hidden.name)) bad.push(`${name}: names the agent`);
    }
    check(bad.length === 0, `${NAMED.length} routes: ${refused} answer 404, ${byRole} are refused by role (403), none answers; each exactly as for an id that names nothing${bad.length ? `\n       ${bad.join('\n       ')}` : ''}`);
  }

  section('1. The same routes still answer for an agent the account reaches');
  for (const [who, agent, label] of [
    [ADMIN_USER, AGENTS.a, 'the Admin, access-alpha'],
    [USER, AGENTS.b, 'the User, access-bravo'],
  ]) {
    const got = await api(`/agents/${agent.id}`, { as: who });
    check(got.status === 200 && got.body?.id === agent.id, `GET /agents/:id: ${label} (${got.status})`);
    const enabled = await api(`/agents/${agent.id}/limits/enabled`, { as: who });
    check(enabled.status === 200, `GET …/limits/enabled: ${label} (${enabled.status})`);
    const link = await api(`/agents/${agent.id}/share-link`, { as: who });
    check(link.status === 200, `GET …/share-link: ${label} (${link.status})`);
    const health = await api(`/api/agent/${agent.id}/health`, { as: who });
    check(health.status === 200, `GET /api/agent/:id/health: ${label} (${health.status})`);
  }
  const ownerSees = await api(`/agents/${AGENTS.c.id}`, { as: OWNER });
  check(ownerSees.status === 200, `the Owner reads access-charlie, whatever lists exist (${ownerSees.status})`);
  const anonymous = await api(`/api/agent/${AGENTS.c.id}/health`, { as: null });
  check(anonymous.status === 200, `no token at all: the chat surface is not about the lists (${anonymous.status})`);
  const adminCurrent = await api('/agents/admin/current', { as: ADMIN_USER });
  check(adminCurrent.status === 404 && !mentions(adminCurrent, AGENTS.ranch), `GET /agents/admin/current: 404 for the Admin who does not reach it (${adminCurrent.status})`);
  check((await api('/agents/admin/current', { as: OWNER })).body?.id === AGENTS.ranch.id, 'and the Ranch admin agent for the Owner');
  // The same agent by another door: the setup status names it by its flag.
  const rancherAdmin = await api('/rancher/status', { as: ADMIN_USER });
  check(
    rancherAdmin.status === 200 && rancherAdmin.body?.admin === null && rancherAdmin.body?.hasAdmin === true,
    `GET /rancher/status tells the Admin the setup state and no agent (${rancherAdmin.status}, admin ${JSON.stringify(rancherAdmin.body?.admin)?.slice(0, 40)})`,
  );
  check(!mentions(rancherAdmin, AGENTS.ranch) && !textOf(rancherAdmin).includes('operator-only'), 'nothing in it identifies the Ranch admin agent: no id, no name, no configuration');
  const rancherOwner = await api('/rancher/status', { as: OWNER });
  check(rancherOwner.body?.admin?.id === AGENTS.ranch.id && typeof rancherOwner.body?.admin?.config?.e2eOperatorNote === 'string', 'the Owner gets it whole from the same route');

  // ------------------------------------------------------------- 2. lists
  section('2. Lists leave the hidden agents out');
  const llmId = LLM.id;
  const skills = (await api('/skills', { as: OWNER })).body;
  const skillId = Array.isArray(skills) ? skills[0]?.id : (skills?.items?.[0]?.id ?? null);
  const LISTS = [
    '/agents',
    '/agents/status',
    '/agent-limits',
    '/agent-links',
    '/agent-events',
    '/agent-incidents',
    '/chats',
    '/chats?includeInternal=true&perPage=100',
    '/me/chats',
    '/usage/overview',
    `/llms/${llmId}/usage`,
    '/paddock-evaluations',
    '/paddock-scenarios',
    '/api/agent/list',
    ...(skillId ? [`/skills/${skillId}/agents`] : []),
  ];
  for (const [label, who, hiddenAgents] of [
    ['the limited Admin', ADMIN_USER, [AGENTS.c, AGENTS.ranch]],
    ['the User', USER, [AGENTS.a]],
  ]) {
    const leaks = [];
    let answered = 0;
    for (const path of LISTS) {
      const res = await api(path, { as: who });
      if (res.status === 200) answered += 1;
      else if (res.status !== 403) leaks.push(`${path}: ${res.status}`);
      for (const agent of hiddenAgents) if (mentions(res, agent)) leaks.push(`${path} mentions ${agent.name}`);
    }
    check(leaks.length === 0, `${label}: ${LISTS.length} lists, ${answered} answered, none mentions ${hiddenAgents.map((a) => a.name).join(' or ')}${leaks.length ? `\n       ${leaks.join('\n       ')}` : ''}`);
  }
  // The check has teeth: the Owner's answers do carry them.
  for (const path of ['/agents', '/agents/status', '/agent-limits', '/chats', '/usage/overview', `/llms/${llmId}/usage`, '/api/agent/list']) {
    const res = await api(path, { as: OWNER });
    check(res.status === 200 && mentions(res, AGENTS.c), `the Owner's ${path} does include access-charlie`);
  }
  const adminAgents = (await api('/agents', { as: ADMIN_USER })).body;
  check(
    Array.isArray(adminAgents) && adminAgents.map((a) => a.name).filter((n) => NAMES.includes(n)).sort().join() === 'access-alpha,access-bravo',
    `GET /agents for the Admin is exactly access-alpha and access-bravo of the fixtures (${adminAgents?.map?.((a) => a.name).join(', ')})`,
  );
  // ------------------------------------- 2b. the Admin who has the assistant
  section('2b. The Ranch admin agent for an Admin who has it as their assistant');
  {
    const on = await setAssistantFor(ids.admin, null);
    check(on.status === 200 && on.body?.enabled === true && on.body?.source === 'role', `the Admin follows their role again: the assistant is on (${on.status})`);
    // What a person who reaches an agent and does not manage it may call:
    // the reader's view of it, their own pin, their own chat with it, and
    // what an Admin reads of any agent they reach. Everything else of the
    // 63 is the Owner's (CLEAN-232) and answers as for an id that names
    // nothing. The list is pinned: a route that starts answering for the
    // assistant is a decision, not a side effect.
    const REACH = [
      'GET /agents/{id}',
      'GET /agents/{id}/tools',
      'PUT /agents/{id}/pin',
      'DELETE /agents/{id}/pin',
      'GET /agents/{id}/limits/enabled',
      'GET /agent-events?agentId={id}',
      'GET /agent-incidents?agentId={id}',
      'GET /chats?agentId={id}',
      'POST /chats/sync',
      'POST /me/chats/sync',
      'POST /browser/extension/token',
      'GET /api/agent/{id}/health',
      'GET /api/agent/{id}/transcript',
      'GET /api/agent/{id}/transcript?channel=anon-http-mjs',
      'DELETE /api/agent/{id}/transcript',
      'POST /api/agent/{id}/transcript/archive',
      'POST /api/agent/{id}/message',
      'POST /api/agent/{id}/message/sync',
      'GET /api/agent/{id}/attachment/att-http-mjs',
      'GET /api/agent/{id}/message/m-1/source/1/content',
    ];
    const reached = [];
    const leaks = [];
    for (const route of NAMED) {
      const [h, g] = [await call(ADMIN_USER, route, AGENTS.ranch.id), await call(ADMIN_USER, route, GHOST)];
      const name = `${route[0]} ${route[1]}`;
      if (h.status !== g.status || shape(h, AGENTS.ranch.id) !== shape(g, GHOST)) reached.push(name);
      if (textOf(h).includes('operator-only')) leaks.push(`${name}: carries the operator's configuration`);
    }
    const unexpected = reached.filter((name) => !REACH.includes(name));
    const lost = REACH.filter((name) => !reached.includes(name));
    check(
      unexpected.length === 0 && lost.length === 0 && leaks.length === 0,
      `${NAMED.length} routes: ${reached.length} are a reader's and answer, the other ${NAMED.length - reached.length} answer exactly as for an id that names nothing, and none carries its configuration` +
        (unexpected.length ? `\n       ANSWERS, and is not on the reviewed list: ${unexpected.join('; ')}` : '') +
        (lost.length ? `\n       no longer answers: ${lost.join('; ')}` : '') +
        (leaks.length ? `\n       ${leaks.join('\n       ')}` : ''),
    );
    const OPERATOR_FIELDS = { config: {}, llmCredentialId: null, workflowId: null, statusReason: null, launchContext: null };
    const isReaderView = (agent) =>
      agent?.id === AGENTS.ranch.id && agent?.isAdmin === true && Object.entries(OPERATOR_FIELDS).every(([key, empty]) => JSON.stringify(agent?.[key]) === JSON.stringify(empty));
    const current = await api('/agents/admin/current', { as: ADMIN_USER });
    check(current.status === 200 && isReaderView(current.body), `GET /agents/admin/current: the reader's view of it, marked isAdmin, no configuration, credential or workflow (${current.status})`);
    const rancher = await api('/rancher/status', { as: ADMIN_USER });
    check(
      rancher.status === 200 && rancher.body?.hasAdmin === true && isReaderView(rancher.body?.admin) && !textOf(rancher).includes('operator-only'),
      `GET /rancher/status hands the Admin the same reader's view, by the other door (${rancher.status})`,
    );
    const env = await api(`/agents/${AGENTS.ranch.id}/env`, { as: ADMIN_USER });
    const restart = await api(`/agents/${AGENTS.ranch.id}/restart`, { method: 'POST', as: ADMIN_USER });
    check(env.status === 404 && restart.status === 404, `its environment and a restart stay the Owner's: 404 (${env.status}, ${restart.status})`);
    const leaksInLists = [];
    for (const path of LISTS) {
      const res = await api(path, { as: ADMIN_USER });
      if (res.status !== 200 && res.status !== 403) leaksInLists.push(`${path}: ${res.status}`);
      if (mentions(res, AGENTS.c)) leaksInLists.push(`${path} mentions ${AGENTS.c.name}`);
      if (textOf(res).includes('operator-only-access-ranch')) leaksInLists.push(`${path} carries the configuration of ${AGENTS.ranch.name}`);
    }
    check(leaksInLists.length === 0, `the ${LISTS.length} lists: none mentions ${AGENTS.c.name}, and none carries the configuration of the Ranch admin agent${leaksInLists.length ? `\n       ${leaksInLists.join('\n       ')}` : ''}`);
    const withIt = (await api('/agents', { as: ADMIN_USER })).body;
    check(
      Array.isArray(withIt) && withIt.map((a) => a.name).filter((n) => NAMES.includes(n)).sort().join() === 'access-alpha,access-bravo,access-ranch',
      `GET /agents for the Admin is access-alpha, access-bravo and the assistant, of the fixtures (${withIt?.map?.((a) => a.name).join(', ')})`,
    );
    // No list governs it: the access route refuses its id by name.
    const view = (await api(`/users/${ids.admin}/agent-access`, { as: OWNER })).body;
    const listed = await api(`/users/${ids.admin}/agent-access`, {
      method: 'PUT',
      as: OWNER,
      body: { allowed: [AGENTS.a.id, AGENTS.b.id, AGENTS.ranch.id], denied: [], version: view?.version ?? null },
    });
    check(
      listed.status === 422 && code(listed) === 'ASSISTANT_NOT_LISTED' && !JSON.stringify(view).includes(AGENTS.ranch.id),
      `and it is on no access list: the Admin's does not name it, and a write that does is refused, 422 ASSISTANT_NOT_LISTED (${listed.status} ${code(listed)})`,
    );
  }

  const overviewOwner = (await api('/usage/overview', { as: OWNER })).body;
  const overviewAdmin = (await api('/usage/overview', { as: ADMIN_USER })).body;
  check(
    overviewAdmin?.totals?.callCount < overviewOwner?.totals?.callCount,
    `the Admin's usage totals are recomputed without the hidden agents (${overviewAdmin?.totals?.callCount} calls against the Owner's ${overviewOwner?.totals?.callCount})`,
  );

  // ----------------------------------------- 3. records with their own id
  section('3. A chat of a hidden agent is a chat that does not exist');
  const chatsOf = async (agent) => (await api(`/chats?agentId=${agent.id}&perPage=100`, { as: OWNER })).body?.items ?? [];
  const chatC = (await chatsOf(AGENTS.c)).find((c) => c.externalUserId === 'admin');
  const chatUserA = (await chatsOf(AGENTS.a)).find((c) => c.externalUserId === ids.user);
  check(Boolean(chatC) && Boolean(chatUserA), 'the fixture conversations are there');
  const NO_CHAT = 'chat-00000000-0000-4000-8000-000000000000';
  const sameAsUnknown = async (who, path, chat) => {
    const [h, g] = [await api(path.replace('{id}', chat.id), { as: who }), await api(path.replace('{id}', NO_CHAT), { as: who })];
    return { ok: h.status === 404 && g.status === 404 && shape(h, chat.id) === shape(g, NO_CHAT), status: h.status };
  };
  for (const path of ['/chats/{id}', '/chats/{id}/messages', '/chats/{id}/feedback', '/chats/{id}/export']) {
    const r = await sameAsUnknown(ADMIN_USER, path, chatC);
    check(r.ok, `GET ${path}: the Admin gets the 404 of an unknown chat (${r.status})`);
  }
  const summarize = await api(`/chats/${chatC.id}/summarize`, { method: 'POST', as: ADMIN_USER });
  check(summarize.status === 404, `POST /chats/:id/summarize: 404 (${summarize.status})`);
  for (const path of ['/me/chats/{id}', '/me/chats/{id}/messages', '/me/chats/{id}/feedback', '/me/chats/{id}/export']) {
    const r = await sameAsUnknown(USER, path, chatUserA);
    check(r.ok, `GET ${path}: the User's own chat with access-alpha is hidden with it (${r.status})`);
  }
  const chatB = (await chatsOf(AGENTS.b)).find((c) => c.externalUserId === 'admin');
  check((await api(`/chats/${chatB.id}`, { as: ADMIN_USER })).status === 200, 'the Admin still reads a chat of access-bravo');
  const history = await prisma.chatSession.findUnique({ where: { id: chatUserA.id } });
  check(Boolean(history), 'the hidden conversation is not deleted: it returns with the access');

  // ------------------------------------------------- 4. the access routes
  section('4. The access routes');
  const access = (userId, who) => api(`/users/${userId}/agent-access`, { as: who });
  const put = (userId, who, body) => api(`/users/${userId}/agent-access`, { method: 'PUT', as: who, body });
  const stored = (userId) => prisma.userAgentAccessEntry.findMany({ where: { userId }, orderBy: { agentId: 'asc' } });

  let view = (await access(ids.user2, OWNER)).body;
  check(view?.outcome?.kind === 'all' && view.version === null && view.allowed.length === 0, 'an account nobody edited: open, no version');
  check((await access(ids.user2, USER)).status === 403, 'a User reads no lists (403)');
  check((await access(ids.user, USER)).status === 403, 'not even their own (403)');

  let res = await put(ids.user2, OWNER, { allowed: [AGENTS.a.id], denied: [AGENTS.a.id], version: null });
  check(res.status === 400 && code(res) === 'ACCESS_LISTS_OVERLAP', `an agent in both arrays: 400 ACCESS_LISTS_OVERLAP (${res.status} ${code(res)})`);
  res = await put(ids.user2, OWNER, { allowed: [AGENTS.a.id], denied: [] });
  check(res.status === 400, `no version in the body: 400 (${res.status})`);

  res = await put(ids.user2, OWNER, { allowed: [AGENTS.a.id], denied: [AGENTS.c.id], version: null });
  check(res.status === 200 && res.body?.outcome?.kind === 'only' && res.body?.outcome?.count === 1, `the Owner allows alpha and denies charlie: "only 1" (${res.status})`);
  const v1 = res.body?.version;
  res = await put(ids.user2, OWNER, { allowed: [AGENTS.a.id, AGENTS.b.id], denied: [AGENTS.c.id], version: null });
  check(res.status === 409 && code(res) === 'ACCESS_CHANGED', `a version that is no longer current: 409 ACCESS_CHANGED (${res.status} ${code(res)})`);
  check((await stored(ids.user2)).length === 2, 'and nothing of the refused request was saved');

  section('4. The ceiling: the limited Admin edits the second User');
  // "Open" would hand the second User every agent that is not denied for
  // them. The agent that made that more than the Admin has used to be the
  // Ranch admin agent; no list governs it since CLEAN-240, so the ceiling
  // no longer counts it. An ordinary agent outside the Admin's reach, and
  // not denied for the second User, is what the ceiling is about: one is
  // made here, the way the fixtures are, and removed after the refusals.
  const ceilingTemplate = await prisma.template.findUnique({ where: { name: TEMPLATE.name } });
  const delta = await prisma.agent.create({
    data: { id: `agent-${crypto.randomUUID()}`, name: 'access-delta', templateId: ceilingTemplate.id, status: 'stopped', config: {}, resources: { cpu: '500m', memory: '512Mi' } },
  });
  check((await api(`/agents/${delta.id}`, { as: ADMIN_USER })).status === 404, 'an agent the Admin does not reach exists: access-delta (404 for them)');
  view = (await access(ids.user2, ADMIN_USER)).body;
  check(
    view?.allowed?.join() === AGENTS.a.id && view?.denied?.length === 0 && view?.hasEntriesOutsideView === true,
    `the Admin sees the entry about alpha, not the one about charlie, and is told there is more (allowed ${view?.allowed?.length}, denied ${view?.denied?.length}, outside ${view?.hasEntriesOutsideView})`,
  );
  check(!JSON.stringify(view).includes(AGENTS.c.id), 'the id of access-charlie is nowhere in that answer');
  res = await put(ids.user2, ADMIN_USER, { allowed: [], denied: [], version: view.version, confirmOpen: true });
  check(res.status === 409 && code(res) === 'ACCESS_EXCEEDS_CEILING', `emptying the allowed list: 409 ACCESS_EXCEEDS_CEILING (${res.status} ${code(res)})`);
  check(message(res) === 'This would open agents you do not have. Ask the Owner.', `with a sentence to act on: "${message(res)}"`);
  const outside = await put(ids.user2, ADMIN_USER, { allowed: [AGENTS.a.id, AGENTS.c.id], denied: [], version: view.version });
  const unknown = await put(ids.user2, ADMIN_USER, { allowed: [AGENTS.a.id, GHOST], denied: [], version: view.version });
  check(outside.status === 404 && shape(outside, AGENTS.c.id) === shape(unknown, GHOST), `a hand-made request naming charlie: refused as an unknown agent (${outside.status}, "${message(outside)}")`);
  const named = await put(ids.user2, ADMIN_USER, { allowed: [AGENTS.a.id, delta.id], denied: [], version: view.version });
  check(named.status === 404 && shape(named, delta.id) === shape(unknown, GHOST), `and one naming access-delta: the same unknown agent (${named.status})`);
  check((await access(ids.user2, OWNER)).body?.version === v1, 'none of the four refusals saved anything');
  // Without that agent the same request opens nothing the Admin lacks, and
  // the ceiling has nothing to say: it is about outcomes, not about the
  // word "open". Asked without the confirmation, so nothing is saved.
  await prisma.agent.delete({ where: { id: delta.id } });
  const within = await put(ids.user2, ADMIN_USER, { allowed: [], denied: [], version: view.version });
  check(
    within.status === 409 && code(within) === 'ACCESS_OPEN_NEEDS_CONFIRM',
    `once access-delta is gone the same request is within the Admin's reach: it stops at the confirmation, not at the ceiling (${within.status} ${code(within)})`,
  );
  check((await access(ids.user2, OWNER)).body?.version === v1, 'and that saved nothing either');
  res = await put(ids.user2, ADMIN_USER, { allowed: [AGENTS.a.id, AGENTS.b.id], denied: [], version: view.version });
  check(res.status === 200 && res.body?.allowed?.length === 2, `adding bravo, which the Admin has: saved (${res.status})`);
  const afterAdmin = await stored(ids.user2);
  check(
    afterAdmin.map((e) => `${e.agentId === AGENTS.c.id ? 'charlie' : 'x'}:${e.list}`).includes('charlie:denied') && afterAdmin.length === 3,
    `the entry about charlie survived the Admin's save unchanged (${afterAdmin.length} entries)`,
  );
  for (const [target, label] of [[ids.admin, 'their own'], [ids.owner, "the Owner's"]]) {
    res = await put(target, ADMIN_USER, { allowed: [], denied: [], version: null });
    check(res.status === 403 && code(res) === 'ACCESS_NOT_EDITABLE', `the Admin changing ${label} access: 403 ACCESS_NOT_EDITABLE (${res.status} ${code(res)})`);
  }
  res = await put(ids.owner, OWNER, { allowed: [], denied: [], version: null });
  check(res.status === 403 && code(res) === 'ACCESS_NOT_EDITABLE', `the Owner changing the Owner's: 403 ACCESS_NOT_EDITABLE (${res.status})`);
  check((await access(ids.admin, ADMIN_USER)).status === 403, 'the Admin does not read their own lists either (403)');

  section('4. Opening a limited account needs a confirmation');
  view = (await access(ids.user2, OWNER)).body;
  res = await put(ids.user2, OWNER, { allowed: [], denied: [AGENTS.c.id], version: view.version });
  check(
    res.status === 409 && code(res) === 'ACCESS_OPEN_NEEDS_CONFIRM' && (res.raw?.outcome ?? res.body?.outcome)?.kind === 'all_except',
    `409 ACCESS_OPEN_NEEDS_CONFIRM, carrying the outcome (${res.status} ${code(res)})`,
  );
  check((await access(ids.user2, OWNER)).body?.version === view.version, 'nothing saved');
  res = await put(ids.user2, OWNER, { allowed: [], denied: [AGENTS.c.id], version: view.version, confirmOpen: true });
  check(res.status === 200 && res.body?.outcome?.kind === 'all_except', `with confirmOpen: saved, "every agent except 1" (${res.status})`);

  section('4. An agent is never on both lists');
  view = res.body;
  res = await put(ids.user2, OWNER, { allowed: [AGENTS.c.id], denied: [], version: view.version });
  check(res.status === 200 && res.body?.allowed?.join() === AGENTS.c.id && res.body?.denied?.length === 0, 'charlie moved from denied to allowed: on allowed only');
  res = await put(ids.user2, OWNER, { allowed: [AGENTS.a.id], denied: [AGENTS.c.id], version: res.body.version });
  check(res.status === 200 && res.body?.denied?.join() === AGENTS.c.id && !res.body?.allowed?.includes(AGENTS.c.id), 'and back: on denied only');
  const rowsOfC = () => prisma.userAgentAccessEntry.count({ where: { userId: ids.user2, agentId: AGENTS.c.id } });
  check((await rowsOfC()) === 1, 'one row for that account and agent in the table');
  const race = await Promise.all([
    put(ids.user2, OWNER, { allowed: [AGENTS.a.id, AGENTS.b.id], denied: [AGENTS.c.id], version: res.body.version }),
    put(ids.user2, OWNER, { allowed: [AGENTS.a.id, AGENTS.c.id], denied: [AGENTS.b.id], version: res.body.version }),
  ]);
  check(race.map((r) => r.status).sort().join() === '200,409', `two simultaneous PUTs on one version: one saved, one ACCESS_CHANGED (${race.map((r) => r.status).join(', ')})`);
  const afterRace = await stored(ids.user2);
  check(new Set(afterRace.map((e) => e.agentId)).size === afterRace.length, `no agent is on both lists afterwards (${afterRace.map((e) => `${AGENTS.a.id === e.agentId ? 'alpha' : AGENTS.b.id === e.agentId ? 'bravo' : 'charlie'}:${e.list}`).join(', ')})`);
  const winner = race.find((r) => r.status === 200).body;
  check((await access(ids.user2, OWNER)).body?.version === winner.version, 'and the state is exactly the one that was saved, not a merge');

  // ---------------------------------------- 5. the only allowed agent goes
  section('5. Deleting the only allowed agent');
  const template = await prisma.template.findUnique({ where: { name: TEMPLATE.name } });
  const throwaway = await prisma.agent.create({
    data: { id: `agent-${crypto.randomUUID()}`, name: 'access-throwaway', templateId: template.id, status: 'stopped', config: {}, resources: { cpu: '500m', memory: '512Mi' } },
  });
  view = (await access(ids.user2, OWNER)).body;
  res = await put(ids.user2, OWNER, { allowed: [throwaway.id], denied: [], version: view.version });
  check(res.status === 200 && res.body?.outcome?.kind === 'only' && res.body?.outcome?.count === 1, 'the second User is limited to a throwaway agent');
  // The assistant is not an agent a list allows or takes away (CLEAN-240):
  // a User has it by its own switch, on by default. So the second User's
  // GET /agents is the one agent of their list and the assistant.
  const ordinary = (list) => (Array.isArray(list) ? list.filter((a) => !a.isAdmin) : null);
  const assistantOf = (list) => (Array.isArray(list) ? list.filter((a) => a.isAdmin).map((a) => a.id).join() : null);
  const before = (await api('/agents', { as: USER2 })).body;
  check(
    ordinary(before)?.length === 1 && ordinary(before)[0].id === throwaway.id && assistantOf(before) === AGENTS.ranch.id && before.length === 2,
    `and sees exactly that agent, and the assistant (${before.length})`,
  );
  const del = await api(`/agents/${throwaway.id}`, { method: 'DELETE', as: OWNER });
  check(del.status >= 200 && del.status < 300, `the Owner deletes it (${del.status})`);
  const after = (await api('/agents', { as: USER2 })).body;
  check(
    ordinary(after)?.length === 0 && assistantOf(after) === AGENTS.ranch.id && after.length === 1,
    `the second User reaches no agent of the lists, not all of them: only the assistant is left (${after?.length})`,
  );
  {
    const off = await setAssistantFor(ids.user2, { enabled: false });
    const nothing = (await api('/agents', { as: USER2 })).body;
    check(off.status === 200 && Array.isArray(nothing) && nothing.length === 0, `and with the assistant switched off for them, nothing at all (${nothing?.length})`);
    const back = await setAssistantFor(ids.user2, null);
    check(back.status === 200 && back.body?.source === 'role', `the second User follows their role again (${back.status})`);
  }
  check((await api(`/agents/${AGENTS.b.id}`, { as: USER2 })).status === 404, 'access-bravo by direct link: 404');
  const mark = (await api(`/users/${ids.user2}`, { as: OWNER })).body?.agentAccess;
  check(mark?.kind === 'none' && mark?.needsReview === true, `GET /users/:id marks the account for review (${mark?.kind}, needsReview ${mark?.needsReview})`);
  view = (await access(ids.user2, OWNER)).body;
  check(view?.needsReview === true && view?.allowed?.length === 0, 'and so does its access');
  check((await stored(ids.user2)).length === 0, 'no entry outlives the agent');

  // --------------------------------------------------------------- 6. pins
  section('6. Pins are per account');
  // The second User is put back to open first.
  res = await put(ids.user2, OWNER, { allowed: [], denied: [], version: view.version, confirmOpen: true });
  check(res.status === 200 && res.body?.outcome?.kind === 'all', 'the second User is open again');
  const pinnedFor = async (who) => ((await api('/agents', { as: who })).body ?? []).filter((a) => a.pinned).map((a) => a.name).sort().join();
  res = await api(`/agents/${AGENTS.b.id}/pin`, { method: 'PUT', as: USER2 });
  check(res.status === 204, `a User pins access-bravo: 204 (${res.status})`);
  check((await api(`/agents/${AGENTS.b.id}/pin`, { method: 'PUT', as: USER2 })).status === 204, 'again: still 204');
  check((await pinnedFor(USER2)) === 'access-bravo', "it is pinned in that User's GET /agents");
  check((await pinnedFor(OWNER)) === '' && (await pinnedFor(USER)) === '', "and in nobody else's");
  check((await api(`/agents/${AGENTS.b.id}`, { as: USER2 })).body?.pinned === true, 'GET /agents/:id says the same');
  const statusPins = ((await api('/agents/status', { as: USER2 })).body ?? []).filter((s) => s.agent?.pinned).map((s) => s.agent.name).join();
  check(statusPins === 'access-bravo', 'and so does GET /agents/status');
  await api(`/agents/${AGENTS.b.id}/pin`, { method: 'PUT', as: OWNER });
  res = await api(`/agents/${AGENTS.b.id}/pin`, { method: 'DELETE', as: USER2 });
  check(res.status === 204 && (await pinnedFor(USER2)) === '', `the User unpins: 204, gone for them (${res.status})`);
  check((await pinnedFor(OWNER)) === 'access-bravo', "the Owner's own pin of the same agent is untouched");
  check((await api(`/agents/${AGENTS.b.id}/pin`, { method: 'DELETE', as: USER2 })).status === 204, 'unpinning what is not pinned: 204');
  await api(`/agents/${AGENTS.b.id}/pin`, { method: 'DELETE', as: OWNER });
  const pinHidden = await api(`/agents/${AGENTS.a.id}/pin`, { method: 'PUT', as: USER });
  const pinGhost = await api(`/agents/${GHOST}/pin`, { method: 'PUT', as: USER });
  check(pinHidden.status === 404 && shape(pinHidden, AGENTS.a.id) === shape(pinGhost, GHOST), `pinning an agent the account does not reach: the 404 of an unknown agent (${pinHidden.status})`);
  const runtimePin = await fetch(`${API}/agents/${AGENTS.b.id}/pin`, { method: 'PUT', headers: { authorization: `Bearer ${agentServiceToken(AGENTS.b.id, { admin: false })}` } });
  const ranchPin = await fetch(`${API}/agents/${AGENTS.b.id}/pin`, { method: 'PUT', headers: { authorization: `Bearer ${agentServiceToken(AGENTS.ranch.id)}` } });
  check(runtimePin.status === 403 && ranchPin.status === 403, `an agent runtime's token, the Ranch admin agent's included: 403 (${runtimePin.status}, ${ranchPin.status})`);
  const oldWay = await api(`/agents/${AGENTS.b.id}`, { method: 'PUT', as: OWNER, body: { pinned: true } });
  check(oldWay.status === 400, `PUT /agents/:id with the old "pinned" field is refused (${oldWay.status})`);
  check((await prisma.agentPin.count({ where: { userId: { in: Object.values(ids) } } })) === 0, 'no pin of the fixture accounts is left behind');

  // ------------------------------------------------------------ 7. socket
  section('7. An open socket is closed when access is taken away');
  const { io } = requireFromApi('socket.io-client');
  const open = (who, agent) =>
    tokenFor(who).then(
      (token) =>
        new Promise((resolveSocket) => {
          const socket = io(`${API}/ws/client`, { auth: { token, agentId: agent.id }, transports: ['websocket'], reconnection: false, forceNew: true });
          const seen = { welcome: false, error: null, closed: false, socket };
          socket.on('welcome', () => {
            seen.welcome = true;
            resolveSocket(seen);
          });
          socket.on('bridle_error', (e) => {
            seen.error = e?.code ?? 'unknown';
            resolveSocket(seen);
          });
          socket.on('disconnect', () => {
            seen.closed = true;
          });
          socket.on('connect_error', (e) => {
            seen.error = `connect_error: ${e.message}`;
            resolveSocket(seen);
          });
          setTimeout(() => resolveSocket(seen), 8000);
        }),
    );
  const refusedSocket = await open(ADMIN_USER, AGENTS.c);
  check(refusedSocket.error === 'AGENT_NOT_FOUND' && !refusedSocket.welcome, `the Admin's handshake on access-charlie is refused: ${refusedSocket.error}`);
  refusedSocket.socket.close();
  const ghostSocket = await open(ADMIN_USER, { id: GHOST });
  check(ghostSocket.error === 'AGENT_NOT_FOUND', `exactly as on an id that names nothing: ${ghostSocket.error}`);
  ghostSocket.socket.close();

  const live = await open(USER2, AGENTS.b);
  const other = await open(USER2, AGENTS.c);
  const ownerSocket = await open(OWNER, AGENTS.b);
  check(live.welcome && other.welcome && ownerSocket.welcome, 'the second User has sockets open on bravo and charlie, the Owner one on bravo');
  view = (await access(ids.user2, OWNER)).body;
  const taken = Date.now();
  res = await put(ids.user2, OWNER, { allowed: [], denied: [AGENTS.b.id], version: view.version });
  check(res.status === 200, 'the Owner denies access-bravo for the second User');
  const closed = await until(() => live.closed, { timeout: 5000, every: 50 });
  check(Boolean(closed) && live.error === 'AGENT_NOT_FOUND', `the socket on bravo is told AGENT_NOT_FOUND and closed, ${Date.now() - taken} ms after the change (SC-006: within 5 s)`);
  await sleep(300);
  check(!other.closed, 'the socket on charlie, still reached, stays open');
  check(!ownerSocket.closed, "the Owner's socket on bravo stays open");
  const again = await open(USER2, AGENTS.b);
  check(again.error === 'AGENT_NOT_FOUND', 'and a new handshake on bravo is refused');
  for (const s of [live, other, ownerSocket, again]) s.socket.close();

  section('7. A message on a socket whose access went is refused');
  // The same, for a socket the close could not reach: the lists are asked
  // again on every message. Proven over HTTP, which shares the check.
  const msg = await api(`/api/agent/${AGENTS.b.id}/message`, { method: 'POST', as: USER2, body: { text: 'after the denial' } });
  check(msg.status === 404, `POST /api/agent/<bravo>/message as the second User: 404 (${msg.status})`);

  // -------------------------------------------------- 9. sync with no agent
  section('9. POST /chats/sync with no agent named');
  {
    const asAdmin = await api('/chats/sync', { method: 'POST', as: ADMIN_USER, body: {} });
    const total = (await api('/agents', { as: OWNER })).body.length;
    check(
      asAdmin.status >= 200 && asAdmin.status < 300 && asAdmin.body?.scannedAgents === 2,
      `the limited Admin's sync walks their 2 agents, not the ${total} of the ranch (scannedAgents ${asAdmin.body?.scannedAgents}, status ${asAdmin.status})`,
    );
    const asOwner = await api('/chats/sync', { method: 'POST', as: OWNER, body: {} });
    check(asOwner.body?.scannedAgents === total, `the Owner's walks all ${total} (scannedAgents ${asOwner.body?.scannedAgents})`);
  }

  // ------------------------------------------- 10. the extension's token
  section("10. The browser extension's token is asked again on every use");
  {
    const minted = await api('/browser/extension/token', { method: 'POST', as: ADMIN_USER, body: { agentId: AGENTS.b.id, userId: 'admin', ttlDays: 1 } });
    const extToken = minted.body?.token;
    check(minted.status >= 200 && minted.status < 300 && typeof extToken === 'string', `the Admin mints a token for access-bravo (${minted.status})`);
    const importState = () =>
      fetch(`${API}/browser/extension/import-state`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${extToken}` },
        body: JSON.stringify({ profile: 'access-e2e', cookies: [] }),
      });
    const while_ = await importState();
    // This stack has no bucket, so the write itself may fail; what matters
    // is that the request got as far as the write.
    check(while_.status !== 404 && while_.status !== 401, `while the Admin reaches bravo the import is let through to the storage (${while_.status})`);
    const adminAccess = (await access(ids.admin, OWNER)).body;
    res = await put(ids.admin, OWNER, { allowed: [AGENTS.a.id], denied: [], version: adminAccess.version });
    check(res.status === 200, 'the Owner takes access-bravo away from the Admin');
    const after_ = await importState();
    const body_ = await after_.text();
    check(after_.status === 404 && !body_.includes(AGENTS.b.name), `the same token now answers 404, as for an agent that does not exist (${after_.status})`);
    res = await put(ids.admin, OWNER, { allowed: [AGENTS.a.id, AGENTS.b.id], denied: [], version: res.body.version });
    check(res.status === 200 && res.body?.allowed?.length === 2, 'the Admin is limited to alpha and bravo again');
    const back_ = await importState();
    check(back_.status !== 404, `and the token works again with the access (${back_.status})`);
  }

  // ---------------------------------------------- 11. a deleted account
  section('11. A deleted account, whose token is still a valid token');
  {
    const GONE = { email: 'access-gone@ranch.test', password: 'Access-e2e-gone-1' };
    await prisma.user.deleteMany({ where: { email: GONE.email } });
    const created = await api('/users', { method: 'POST', as: OWNER, body: { name: 'access gone', email: GONE.email, password: GONE.password } });
    const goneId = created.body?.id;
    check(Boolean(goneId), `a throwaway User is created (${created.status})`);
    res = await put(goneId, OWNER, { allowed: [], denied: [AGENTS.c.id], version: null });
    check(res.status === 200, 'restricted: access-charlie is denied for them');
    const seen = (await api('/agents', { as: GONE })).body;
    check(Array.isArray(seen) && seen.some((a) => a.id === AGENTS.b.id) && !seen.some((a) => a.id === AGENTS.c.id), 'signed in, they see bravo and not charlie');
    const goneSocket = await open(GONE, AGENTS.b);
    check(goneSocket.welcome, 'and have a socket open on bravo');

    const removed = await api(`/users/${goneId}`, { method: 'DELETE', as: OWNER });
    check(removed.status >= 200 && removed.status < 300, `the Owner deletes the account (${removed.status})`);
    const dropped = await until(() => goneSocket.closed, { timeout: 5000, every: 50 });
    check(Boolean(dropped) && goneSocket.error === 'AGENT_NOT_FOUND', 'their socket is closed at once');
    goneSocket.socket.close();

    // The access token is not revoked by the deletion: the bearer guard
    // verifies the signature and does not read the user row. What the token
    // still opens is what matters.
    const list = await api('/agents', { as: GONE });
    check(list.status === 200 && Array.isArray(list.body) && list.body.length === 0, `GET /agents with the deleted account's token: an empty list, not every agent (${list.status}, ${list.body?.length})`);
    for (const agent of [AGENTS.b, AGENTS.c]) {
      const one = await api(`/agents/${agent.id}`, { as: GONE });
      check(one.status === 404, `GET /agents/<${agent.name}>: 404 (${one.status})`);
    }
    const say = await api(`/api/agent/${AGENTS.b.id}/message`, { method: 'POST', as: GONE, body: { text: 'from a deleted account' } });
    check(say.status === 404, `a chat message to bravo: 404 (${say.status})`);
    const pin = await api(`/agents/${AGENTS.b.id}/pin`, { method: 'PUT', as: GONE });
    check(pin.status === 404, `pinning bravo: 404 (${pin.status})`);
    const reopened = await open(GONE, AGENTS.b);
    check(reopened.error === 'AGENT_NOT_FOUND' && !reopened.welcome, `a new socket on bravo is refused (${reopened.error})`);
    reopened.socket.close();
    const gmcp = await mcpAs(await tokenFor(GONE));
    try {
      const out = await gmcp.call('list_agents');
      check(!Object.values(AGENTS).some((a) => out.text.includes(a.name)), 'list_agents through the tools names no agent');
    } finally {
      await gmcp.close();
    }
    check((await prisma.userAgentAccess.count({ where: { userId: goneId } })) === 0 && (await prisma.userAgentAccessEntry.count({ where: { userId: goneId } })) === 0, 'no access row or entry of the account is left');
  }

  // ------------------------------------------------------------- 8. tools
  section('8. The same through the tools');
  const adminMcp = await mcpAs(await tokenFor(ADMIN_USER));
  const userMcp = await mcpAs(await tokenFor(USER));
  try {
    const adminTools = await adminMcp.list();
    check(['get_user_agent_access', 'set_user_agent_access', 'list_agents', 'pin_agent'].every((t) => adminTools.includes(t)), 'an Admin is listed the access tools, list_agents and pin_agent');
    const userTools = await userMcp.list();
    check(userTools.includes('list_agents') && userTools.includes('get_agent') && userTools.includes('pin_agent'), 'a User is listed list_agents, get_agent and pin_agent');
    check(!userTools.includes('get_user_agent_access') && !userTools.includes('set_user_agent_access'), 'and neither access tool');

    let out = await adminMcp.call('list_agents');
    check(
      out.text.includes(AGENTS.a.name) && out.text.includes(AGENTS.b.name) && !out.text.includes(AGENTS.c.name) && !out.text.includes(AGENTS.c.id),
      'list_agents for the Admin: alpha and bravo, not charlie',
    );
    check(
      out.text.includes(AGENTS.ranch.name) && !out.text.includes('operator-only-access-ranch'),
      'and the Ranch admin agent, which they have as their assistant (CLEAN-240), without its configuration',
    );
    {
      await setAssistantFor(ids.admin, { enabled: false });
      const without = await adminMcp.call('list_agents');
      const one = await adminMcp.call('get_agent', { id: AGENTS.ranch.id });
      const ghost = await adminMcp.call('get_agent', { id: GHOST });
      check(
        without.text.includes(AGENTS.a.name) && !without.text.includes(AGENTS.ranch.name) && !without.text.includes(AGENTS.ranch.id),
        'switched off for the Admin, list_agents does not name it',
      );
      check(
        /not found/i.test(one.text) && one.text.split(AGENTS.ranch.id).join('x') === ghost.text.split(GHOST).join('x'),
        `and get_agent answers as for an id that names nothing ("${one.text.replace(/\s+/g, ' ').slice(0, 80)}")`,
      );
      await setAssistantFor(ids.admin, null);
    }
    out = await userMcp.call('list_agents');
    check(!out.text.includes(AGENTS.a.name) && out.text.includes(AGENTS.b.name) && out.text.includes(AGENTS.c.name), 'list_agents for the User: everything but alpha');
    check(!out.text.includes('operator-only-access-bravo') && out.text.includes('operator-only-access-charlie'), "the User reads bravo without its configuration, and charlie, which they created, with it");
    const HIDDEN_CALLS = [
      ['get_agent', { id: AGENTS.c.id }],
      ['restart_agent', { id: AGENTS.c.id }],
      ['delete_agent', { id: AGENTS.c.id, confirm: true }],
      ['get_agent_status', { id: AGENTS.c.id }],
      ['get_share_link', { agentId: AGENTS.c.id }],
      ['agent_usage', { agentId: AGENTS.c.id }],
      ['list_agent_events', { agentId: AGENTS.c.id }],
      ['list_chats', { agentId: AGENTS.c.id }],
      ['get_chat', { id: chatC.id }],
      ['list_agent_paddock_scenarios', { agentId: AGENTS.c.id }],
      ['pin_agent', { id: AGENTS.c.id, pinned: true }],
    ];
    const told = [];
    for (const [tool, args] of HIDDEN_CALLS) {
      const hidden = await adminMcp.call(tool, args);
      const ghostArgs = JSON.parse(JSON.stringify(args).split(AGENTS.c.id).join(GHOST).split(chatC.id).join(NO_CHAT));
      const ghost = await adminMcp.call(tool, ghostArgs);
      const same = hidden.text.split(AGENTS.c.id).join('<x>').split(chatC.id).join('<x>') === ghost.text.split(GHOST).join('<x>').split(NO_CHAT).join('<x>');
      if (!same || !/not found/i.test(hidden.text) || hidden.text.includes(AGENTS.c.name)) told.push(`${tool}: ${hidden.text.slice(0, 140)}`);
    }
    check(told.length === 0, `${HIDDEN_CALLS.length} tools asked about access-charlie as the Admin: each answers "not found", exactly as for an id that names nothing${told.length ? `\n       ${told.join('\n       ')}` : ''}`);
    check(Boolean(await prisma.agent.findUnique({ where: { id: AGENTS.c.id } })), 'and access-charlie is still there');
    for (const tool of ['list_agent_limits', 'get_usage_overview', 'list_chats', 'list_agent_events', 'list_paddock_scenarios']) {
      out = await adminMcp.call(tool, {});
      check(!out.text.includes(AGENTS.c.name) && !out.text.includes(AGENTS.c.id), `${tool} as the Admin does not mention access-charlie`);
    }

    out = await adminMcp.call('get_user_agent_access', { userId: ids.user2 });
    check(!out.refused && out.text.includes(AGENTS.b.name), 'get_user_agent_access as the Admin shows the second User: bravo denied');
    out = await adminMcp.call('set_user_agent_access', { userId: ids.user2, clear: [AGENTS.b.id] });
    check(!out.refused && /"changed": false/.test(out.text) && out.text.includes('Reaches every agent'), 'set_user_agent_access without confirm changes nothing and states the outcome');
    check((await stored(ids.user2)).length === 1, 'nothing was saved by it');
    out = await adminMcp.call('set_user_agent_access', { userId: ids.user2, allow: [AGENTS.c.id], confirm: true });
    check(out.refused && /Agent not found/.test(out.text) && !out.text.includes(AGENTS.c.name), `naming charlie through the tool: refused as unknown ("${out.text.slice(0, 60)}")`);
    out = await adminMcp.call('set_user_agent_access', { userId: ids.owner, deny: [AGENTS.a.id], confirm: true });
    check(out.refused, "the Owner's access through the tool: refused");
    out = await adminMcp.call('set_user_agent_access', { userId: ids.user2, clear: [AGENTS.b.id], confirm: true });
    check(!out.refused && /"changed": true/.test(out.text), 'with confirm: the denial of bravo is removed');
    check((await stored(ids.user2)).length === 0, 'and the second User is open again, as the seed left it');

    out = await userMcp.call('pin_agent', { id: AGENTS.b.id, pinned: true });
    check(!out.refused && (await pinnedFor(USER)) === 'access-bravo' && (await pinnedFor(OWNER)) === '', "pin_agent for a User pins for that User and nobody else");
    await userMcp.call('pin_agent', { id: AGENTS.b.id, pinned: false });
    check((await pinnedFor(USER)) === '', 'and unpins');
  } finally {
    await adminMcp.close();
    await userMcp.close();
  }
} catch (err) {
  check(false, `the script stopped: ${err?.stack ?? err}`);
} finally {
  // Back to what seed.mjs leaves, whatever happened above.
  const user2 = await prisma.user.findUnique({ where: { email: USER2.email } }).catch(() => null);
  if (user2) {
    await prisma.userAgentAccessEntry.deleteMany({ where: { userId: user2.id } }).catch(() => undefined);
    await prisma.userAgentAccess.deleteMany({ where: { userId: user2.id } }).catch(() => undefined);
  }
  await prisma.agent.deleteMany({ where: { name: { in: ['access-throwaway', 'access-delta'] } } }).catch(() => undefined);
  // The assistant follows the role again for the accounts this script
  // switched it off for, wherever it stopped.
  const switched = await prisma.user.findMany({ where: { email: { in: [ADMIN_USER.email, USER2.email] } }, select: { id: true } }).catch(() => []);
  await prisma.assistantAccountAccess.deleteMany({ where: { userId: { in: switched.map((u) => u.id) } } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { email: 'access-gone@ranch.test' } }).catch(() => undefined);
  await prisma.$disconnect();
}

done('http');
