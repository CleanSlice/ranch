// The acting party, end to end and without a model (CLEAN-232, User Stories
// 7 to 10). The core proof of Part A.
//
//   node specs/032-agent-user-access/e2e/acting.mjs
//
// For an Owner, an Admin, a User who created an agent and a User who created
// none: sign in to the app console in a real browser, open the chat with the
// Ranch admin agent and send a message. The fake runtime holds the message
// the hub sent it; its `acting.token` is the token the API minted for that
// person. Then this script acts as the runtime would: an MCP client against
// /mcp/mcp with the Ranch admin agent's service token (which carries Owner)
// and the actor in `_meta["ranch/actor"]` of every tools/list and
// tools/call.
//
// What it asserts is that the agent's own token decides nothing: the tools
// shown and the calls carried out are the person's, and anything that is not
// a proven person or the agent acting for itself is a guest.
//
// No token is printed, logged or written to disk.
//
// Needs: API :3333 (after seed.mjs), app :3000, fakeRuntime.mjs.
import {
  ADMIN_USER,
  AGENTS,
  API,
  APP,
  MANAGEMENT_TOOLS,
  OWNER,
  TOOLS,
  USER,
  USER2,
  WIDTHS,
  agentServiceToken,
  api,
  chatOn,
  check,
  done,
  fake,
  launch,
  loginAs,
  mcpAs,
  rememberAssistantAccess,
  section,
  setAssistantFor,
  shot,
  tokenFor,
  until,
  watchedPage,
} from './lib.mjs';

const RANCH = AGENTS.ranch.id;
const ACCOUNTS = [
  { key: 'owner', who: OWNER },
  { key: 'admin', who: ADMIN_USER },
  { key: 'user', who: USER },
  { key: 'user2', who: USER2 },
];

const hasAll = (names, wanted) => wanted.filter((n) => !names.includes(n));
const hasAny = (names, unwanted) => unwanted.filter((n) => names.includes(n));
const unavailable = (r) => r.refused && /not available to this caller/i.test(r.text);
const notFound = (r) => /not found/i.test(r.text);
const exists = async (agentId) => (await api(`/agents/${agentId}`, { as: OWNER })).status === 200;
/**
 * The one refusal that names an agent (CLEAN-263): the assistant, to a
 * person who has it and is not the Owner. They were just shown it by
 * list_agents, so "not found" would hide nothing and read as a fault. It
 * says why, carries `reason: "owner_only"`, and nothing else of the agent.
 */
const OWNERS_TO_MANAGE = `${AGENTS.ranch.name} is the Ranch assistant. Only the Owner can restart, stop or change it.`;
const ownersToManage = (r) => {
  let said = null;
  try {
    said = JSON.parse(r.text);
  } catch {
    said = null;
  }
  return said?.reason === 'owner_only' && said?.error === OWNERS_TO_MANAGE && Object.keys(said).sort().join() === 'error,reason';
};

section('Preconditions');
const health = await fake.health();
check(health?.connected?.includes(RANCH), 'the fake runtime is connected for the Ranch admin agent');
await fake.reset();

// Since CLEAN-231 the seeded Admin is limited to access-alpha and
// access-bravo, which leaves them no assistant to talk to. This script is
// about whom the assistant acts for, so for its own run the Owner also
// allows the Ranch admin agent for the Admin, through the access route, and
// takes it back at the end. The Admin still does not reach access-charlie.
const adminId = (await api('/users', { as: OWNER })).body.find((u) => u.email === ADMIN_USER.email)?.id;
async function setAdminAccess(allowed) {
  const current = (await api(`/users/${adminId}/agent-access`, { as: OWNER })).body;
  return api(`/users/${adminId}/agent-access`, {
    method: 'PUT',
    as: OWNER,
    body: { allowed, denied: [], version: current?.version ?? null },
  });
}
{
  // The assistant is on nobody's access list since CLEAN-240 (the route
  // answers 422 ASSISTANT_NOT_LISTED for it): a person has it through the
  // assistant setting, which is on for an Admin by default. So there is
  // nothing to allow here, only to confirm.
  const mine = (await api('/agents', { as: ADMIN_USER })).body ?? [];
  check(
    mine.some((a) => a.id === RANCH && a.isAdmin),
    'the Admin has the Ranch admin agent, through the assistant setting',
  );
}

// What the assistant offers a person is a setting of its own since
// CLEAN-240, and it only narrows: a User has it at Basic unless the Owner
// says otherwise, which leaves them "see and ask" and none of the tools
// that change an agent. This script is about whom a call is made for, so
// for its own run Users are on Full, where the level leaves out nothing
// their role and their agents give them, and what was there before comes
// back at the end. An Admin is on Full already.
const putAssistantAccessBack = await rememberAssistantAccess();
{
  const res = await api('/assistant-access/roles/User', { method: 'PUT', as: OWNER, body: { enabled: true, level: 'full' } });
  check(res.status === 200 && res.body?.level === 'full', `Users have the assistant at Full for this run (${res.status})`);
  const admins = (await api('/assistant-access', { as: OWNER })).body?.roles?.Admin;
  check(admins?.enabled === true && admins?.level === 'full', `and Admins have it at Full, as an installation nobody configured does (${admins?.level})`);
}

// ------------------------------------------------- the browser: who is asking

/** key → { token, role, surface, context } of the LAST width; the context stays open. */
const acting = {};
const browser = await launch();
try {
  for (const width of WIDTHS) {
    section(`App console, ${width} px: a message to the Ranch admin agent`);
    for (const { key, who } of ACCOUNTS) {
      const { context, page, problems } = await watchedPage(browser, { width, height: width < 600 ? 844 : 900 });
      await loginAs(page, who, APP);
      await page.goto(`${APP}/agents/${RANCH}`, { waitUntil: 'networkidle' });
      const chat = chatOn(page);
      await chat.ready();
      const text = `who am I? ${key} ${width} ${Date.now()}`;
      const answered = await chat.say(text);
      const message = await until(async () => (await fake.received(RANCH)).find((m) => m.text === text), {
        timeout: 10000,
      });
      check(Boolean(message) && Boolean(answered), `[${key}] the message reached the runtime and was answered`);
      const a = message?.acting;
      check(
        typeof a?.token === 'string' && a.token.split('.').length === 3,
        `[${key}] it carries an acting token`,
      );
      check(a?.role === who.role, `[${key}] acting.role is ${who.role} (${a?.role})`);
      check(a?.surface === 'app', `[${key}] acting.surface is app (${a?.surface})`);
      await shot(page, `acting-${key}-${width}`);
      check(problems.length === 0, `[${key}] no console error, no failed request${problems.length ? `: ${problems.join(' | ')}` : ''}`);
      if (acting[key]) await acting[key].context.close();
      acting[key] = { token: a?.token, context };
    }
  }

  // One more turn, on an ordinary agent: the Admin talks to access-bravo.
  // Its acting token is what the self-service peer tools are checked with
  // below, since CLEAN-236 gives those to a person and to nobody else.
  {
    section('App console, 1440 px: the Admin talks to an ordinary agent');
    const { context, page, problems } = await watchedPage(browser, { width: 1440, height: 900 });
    await loginAs(page, ADMIN_USER, APP);
    await page.goto(`${APP}/agents/${AGENTS.b.id}`, { waitUntil: 'networkidle' });
    const chat = chatOn(page);
    await chat.ready();
    const text = `who am I? admin on bravo ${Date.now()}`;
    const answered = await chat.say(text);
    const message = await until(async () => (await fake.received(AGENTS.b.id)).find((m) => m.text === text), {
      timeout: 10000,
    });
    check(Boolean(message) && Boolean(answered), `the message reached ${AGENTS.b.name} and was answered`);
    check(
      typeof message?.acting?.token === 'string' && message.acting.role === 'Admin',
      `it carries an acting token, for an Admin (${message?.acting?.role})`,
    );
    check(message?.acting?.assistant === undefined, 'and nothing about an assistant level: this is not the assistant');
    check(problems.length === 0, `no console error, no failed request${problems.length ? `: ${problems.join(' | ')}` : ''}`);
    acting.adminOnBravo = { token: message?.acting?.token, context };
  }

  // ------------------------------------------------------- the runtime's side

  const ranchToken = agentServiceToken(RANCH);
  const person = (key) => ({ kind: 'person', token: acting[key].token });
  const mcp = await mcpAs(ranchToken);
  const users = (await api('/users', { as: OWNER })).body;
  const user2Id = (Array.isArray(users) ? users : (users?.items ?? [])).find((u) => u.email === USER2.email)?.id;
  check(Boolean(user2Id), 'the second User’s id is known (for the owner-only call)');

  section('A User who created no agent');
  {
    const names = await mcp.list(person('user2'));
    const shown = hasAny(names, MANAGEMENT_TOOLS);
    check(names.length > 0, `tools/list answers (${names.length} tools)`);
    check(shown.length === 0, `no admin, owner or manage-agent tool is listed${shown.length ? `: ${shown.join(', ')}` : ''}`);
    const del = await mcp.call('delete_agent', { id: AGENTS.b.id, confirm: true }, person('user2'));
    check(unavailable(del), `tools/call delete_agent for ${AGENTS.b.name} is refused ("${del.text.slice(0, 80)}")`);
    check(await exists(AGENTS.b.id), `${AGENTS.b.name} still exists`);
    const list = await mcp.call('list_users', {}, person('user2'));
    check(unavailable(list), 'tools/call list_users is refused');
    const set = await mcp.call('upsert_setting', { group: 'e2e', name: 'x', value: '1', valueType: 'string' }, person('user2'));
    check(unavailable(set), 'tools/call upsert_setting is refused');
    const status = await mcp.call('get_agent_status', { id: AGENTS.c.id }, person('user2'));
    check(unavailable(status), 'and so is a manage-agent tool on somebody else’s agent');
  }

  section('A User who created an agent');
  {
    const names = await mcp.list(person('user'));
    const shown = hasAny(names, [...TOOLS.admin, ...TOOLS.owner, ...TOOLS.ownPeers]);
    check(shown.length === 0, `no admin or owner tool is listed, and none for the Ranch admin agent's own peers${shown.length ? `: ${shown.join(', ')}` : ''}`);
    const lacking = hasAll(names, TOOLS.manage);
    check(lacking.length === 0, `the manage-agent tools are listed${lacking.length ? ` (missing: ${lacking.join(', ')})` : ''}`);
    const own = await mcp.call('get_agent_status', { id: AGENTS.c.id }, person('user'));
    check(!own.refused && own.text.includes(AGENTS.c.name), `get_agent_status works for ${AGENTS.c.name}, the agent they created`);
    const other = await mcp.call('get_agent_status', { id: AGENTS.b.id }, person('user'));
    check(notFound(other) && !other.text.includes(AGENTS.b.name), `and answers "not found" for ${AGENTS.b.name}`);
    const ranch = await mcp.call('get_agent_status', { id: RANCH }, person('user'));
    check(
      ownersToManage(ranch),
      `the Ranch admin agent, which they have as their assistant, is refused with the reason and nothing else: only the Owner manages it ("${ranch.text.replace(/\s+/g, ' ').slice(0, 120)}")`,
    );
    const restart = await mcp.call('restart_agent', { id: RANCH }, person('user'));
    const remove = await mcp.call('delete_agent', { id: RANCH, confirm: true }, person('user'));
    check(
      ownersToManage(restart) && ownersToManage(remove) && (await exists(RANCH)) && (await fake.health())?.connected?.includes(RANCH),
      'restart_agent and delete_agent for it answer the same, and it is still there and still connected',
    );
    const del = await mcp.call('delete_agent', { id: AGENTS.b.id, confirm: true }, person('user'));
    check(notFound(del), `delete_agent for ${AGENTS.b.name} answers "not found"`);
    check(await exists(AGENTS.b.id), `${AGENTS.b.name} still exists`);
    // A refusal names the next move, and since CLEAN-231 `list_agents` is
    // one every signed-in person has: it is listed for them, so a "not
    // found" may send them there, and it shows them the agents they reach.
    // The refusal about the assistant sends nobody to list_agents: it is on
    // that list already.
    const naming = [other, del].filter((r) => /list_agents/.test(r.text));
    check(
      names.includes('list_agents') && naming.length === 2 && !/list_agents/.test(ranch.text),
      `list_agents is listed for them, and each "not found" names it ("${del.text.replace(/\s+/g, ' ').slice(0, 110)}")`,
    );
    const mine = await mcp.call('list_agents', {}, person('user'));
    check(
      !mine.refused && mine.text.includes(AGENTS.c.name) && mine.text.includes(AGENTS.b.name) && !mine.text.includes(AGENTS.a.name),
      `list_agents shows them the agents they reach: not ${AGENTS.a.name}, which is denied for this User`,
    );
    check(
      mine.text.includes('operator-only-access-charlie') && !mine.text.includes('operator-only-access-bravo'),
      `with the configuration of ${AGENTS.c.name}, which they created, and without that of ${AGENTS.b.name}`,
    );
    // The peer tools word their refusal themselves; same rule.
    const peers = await mcp.call('list_agent_peers', { agentId: AGENTS.b.id }, person('user'));
    check(
      peers.refused && /not found/i.test(peers.text) && !peers.text.includes(AGENTS.b.name),
      `list_agent_peers for ${AGENTS.b.name} answers "not found" in the same words, without the agent's name ("${peers.text.replace(/\s+/g, ' ').slice(0, 110)}")`,
    );
    const list = await mcp.call('list_users', {}, person('user'));
    check(unavailable(list), 'tools/call list_users is refused');
  }

  section('An Admin');
  {
    const names = await mcp.list(person('admin'));
    const lacking = hasAll(names, [...TOOLS.admin, ...TOOLS.manage]);
    check(lacking.length === 0, `admin and manage-agent tools are listed${lacking.length ? ` (missing: ${lacking.join(', ')})` : ''}`);
    const shown = hasAny(names, [...TOOLS.owner, ...TOOLS.ownPeers]);
    check(
      shown.length === 0,
      `no owner tool is listed (${TOOLS.owner.join(', ')}), and none for the Ranch admin agent's own peers${shown.length ? `: ${shown.join(', ')}` : ''}`,
    );
    const self = await mcp.call('import_my_peer_by_address', { url: 'https://peer.invalid/a2a' }, person('admin'));
    check(unavailable(self), 'the Ranch admin agent takes no colleague on an Admin’s word: import_my_peer_by_address is refused');
    const list = await mcp.call('list_users', {}, person('admin'));
    check(!list.refused && list.text.includes(USER.email), 'list_users works');
    const role = await mcp.call('set_user_role', { userId: user2Id, role: 'Admin' }, person('admin'));
    check(unavailable(role), 'set_user_role is refused');
    const del = await mcp.call('delete_user', { userId: user2Id, confirm: true }, person('admin'));
    check(unavailable(del), 'delete_user is refused');
    const promote = await mcp.call('set_agent_admin', { id: AGENTS.a.id, enabled: true }, person('admin'));
    check(unavailable(promote), 'set_agent_admin is refused');
    const after = (await api('/users', { as: OWNER })).body;
    const still = (Array.isArray(after) ? after : (after?.items ?? [])).find((u) => u.id === user2Id);
    check(still?.role === 'User', 'the second User is still there, still a User');
    const own = await mcp.call('get_agent_status', { id: AGENTS.a.id }, person('admin'));
    check(!own.refused && own.text.includes(AGENTS.a.name), `get_agent_status works for ${AGENTS.a.name}`);
    // The Admin's lists (CLEAN-231): alpha, bravo and, for this run, the
    // Ranch admin agent. access-charlie is not among them.
    const listed = await mcp.call('list_agents', {}, person('admin'));
    check(
      !listed.refused && listed.text.includes(AGENTS.a.name) && listed.text.includes(AGENTS.b.name) && !listed.text.includes(AGENTS.c.name),
      `list_agents shows the Admin their agents and not ${AGENTS.c.name}`,
    );
    check(
      listed.text.includes(AGENTS.ranch.name) && !listed.text.includes('operator-only-access-ranch'),
      'the Ranch admin agent, which they reach but may not manage, comes without its configuration',
    );
    const hidden = await mcp.call('restart_agent', { id: AGENTS.c.id }, person('admin'));
    const unknown = await mcp.call('restart_agent', { id: 'agent-00000032-0000-4000-8000-0000000000ee' }, person('admin'));
    check(
      notFound(hidden) && hidden.text.split(AGENTS.c.id).join('x') === unknown.text.split('agent-00000032-0000-4000-8000-0000000000ee').join('x'),
      `restart_agent for ${AGENTS.c.name} is reported as not found, in the words an unknown agent gets`,
    );
    const ranch = await mcp.call('get_agent_status', { id: RANCH }, person('admin'));
    check(
      ownersToManage(ranch),
      `manage tools refuse an Admin the Ranch admin agent, which they have as their assistant, with the reason and nothing else of it ("${ranch.text.replace(/\s+/g, ' ').slice(0, 120)}")`,
    );
    const env = await mcp.call('get_agent_env', { id: RANCH }, person('admin'));
    check(ownersToManage(env), 'its environment included: the same refusal, and not one variable');
    const restart = await mcp.call('restart_agent', { id: RANCH }, person('admin'));
    const stop = await mcp.call('stop_agent', { id: RANCH }, person('admin'));
    const remove = await mcp.call('delete_agent', { id: RANCH, confirm: true }, person('admin'));
    check(
      [restart, stop, remove].every(ownersToManage) && (await exists(RANCH)) && (await fake.health())?.connected?.includes(RANCH),
      'restart_agent, stop_agent and delete_agent for it answer the same, and it is still there and still connected',
    );
    // With the assistant switched off for this Admin it is out of their
    // reach, and then it is not found like any other agent, in the words an
    // unknown id gets. Asked with the Admin's own console token: the
    // assistant itself does not answer a person it is switched off for.
    {
      const adminAccount = await setAssistantFor(adminId, { enabled: false });
      check(adminAccount.status === 200 && adminAccount.body?.enabled === false, `the Owner switches the assistant off for the Admin (${adminAccount.status})`);
      const own = await mcpAs(await tokenFor(ADMIN_USER));
      const GHOST = 'agent-00000032-0000-4000-8000-0000000000ee';
      const leaks = [];
      for (const [tool, args] of [
        ['get_agent_status', (id) => ({ id })],
        ['get_agent_env', (id) => ({ id })],
        ['restart_agent', (id) => ({ id })],
        ['delete_agent', (id) => ({ id, confirm: true })],
        ['get_agent', (id) => ({ id })],
      ]) {
        const hidden = await own.call(tool, args(RANCH));
        const unknown = await own.call(tool, args(GHOST));
        if (!notFound(hidden) || hidden.text.split(RANCH).join('x') !== unknown.text.split(GHOST).join('x') || hidden.text.includes(AGENTS.ranch.name)) {
          leaks.push(`${tool}: ${hidden.text.replace(/\s+/g, ' ').slice(0, 90)}`);
        }
      }
      const listed = await own.call('list_agents', {});
      check(
        leaks.length === 0 && !listed.refused && listed.text.includes(AGENTS.a.name) && !listed.text.includes(AGENTS.ranch.name) && !listed.text.includes(RANCH),
        `switched off, it is not found for them, in the words an unknown agent gets, and list_agents does not name it${leaks.length ? ` — ${leaks.join(' | ')}` : ''}`,
      );
      const byRoute = await api(`/agents/${RANCH}`, { as: ADMIN_USER });
      const current = await api('/agents/admin/current', { as: ADMIN_USER });
      check(byRoute.status === 404 && current.status === 404, `and GET /agents/<it> and GET /agents/admin/current answer them 404 (${byRoute.status}, ${current.status})`);
      await own.close();
      const back = await setAssistantFor(adminId, null);
      check(back.status === 200 && back.body?.enabled === true && back.body?.source === 'role', `the Admin follows their role again (${back.status})`);
    }
    // A connection has two ends: the peer must be the caller's to manage too.
    const peer = await mcp.call('connect_agent_peer', { agentId: AGENTS.a.id, peerAgentId: RANCH }, person('admin'));
    check(
      peer.refused && notFound(peer),
      `connect_agent_peer ${AGENTS.a.name} → Ranch admin agent is refused as not found ("${peer.text.slice(0, 60)}")`,
    );
    const viaRoute = await api(`/agents/${AGENTS.a.id}/peers`, {
      method: 'POST',
      body: { peerAgentId: RANCH },
      as: ADMIN_USER,
    });
    check(
      viaRoute.status === 404 && viaRoute.body?.message === 'Agent not found',
      `POST /agents/<alpha>/peers naming the Ranch admin agent answers 404 Agent not found (${viaRoute.status})`,
    );
    const peers = await api(`/agents/${AGENTS.a.id}/peers`, { as: OWNER });
    check(Array.isArray(peers.body) && peers.body.length === 0, 'and no connection was made');
    const envRoute = await api(`/agents/${RANCH}/env`, { as: ADMIN_USER });
    check(envRoute.status === 404, `GET /agents/<ranch admin agent>/env answers an Admin 404 (${envRoute.status})`);
  }

  section('The Owner');
  {
    const names = await mcp.list(person('owner'));
    const lacking = hasAll(names, MANAGEMENT_TOOLS);
    check(lacking.length === 0, `every management tool is listed${lacking.length ? ` (missing: ${lacking.join(', ')})` : ''}`);
    // Owner-only and harmless: without `confirm` the tool gets past the
    // owner check and stops at its own question, having changed nothing.
    const del = await mcp.call('delete_user', { userId: user2Id, confirm: false }, person('owner'));
    check(
      !unavailable(del) && /confirm/i.test(del.text),
      `an owner-only call reaches the tool: delete_user asks for confirmation ("${del.text.slice(0, 70)}")`,
    );
    const ranch = await mcp.call('get_agent_status', { id: RANCH }, person('owner'));
    check(!ranch.refused && ranch.text.includes(AGENTS.ranch.name), 'the Ranch admin agent is the Owner’s to manage');
  }

  section('Anything else is a guest');
  const guestLike = async (label, client, actor) => {
    const names = await client.list(actor);
    const shown = hasAny(names, MANAGEMENT_TOOLS);
    const list = await client.call('list_users', {}, actor);
    const del = await client.call('delete_agent', { id: AGENTS.b.id, confirm: true }, actor);
    // The Ranch admin agent's own peers: nobody without a name gives it a colleague.
    const peer = await client.call('connect_my_peer', { peerAgentId: AGENTS.b.id }, actor);
    check(
      shown.length === 0 && list.refused && del.refused && peer.refused && (await exists(AGENTS.b.id)),
      `${label}: no management tool listed (${names.length} tools), list_users, delete_agent and connect_my_peer refused` +
        (shown.length ? ` — LISTED: ${shown.join(', ')}` : '') +
        (!list.refused ? ' — list_users WORKED' : '') +
        (!del.refused ? ' — delete_agent WORKED' : '') +
        (!peer.refused ? ' — connect_my_peer WORKED' : ''),
    );
  };
  await guestLike('no actor at all', mcp, undefined);
  await guestLike('{ kind: "guest" }', mcp, { kind: 'guest' });
  await guestLike('a garbage token', mcp, { kind: 'person', token: 'not.a.token' });
  await guestLike('a person with no token', mcp, { kind: 'person' });
  await guestLike('an actor kind nobody defined', mcp, { kind: 'owner' });

  // The same acting tokens, presented by ANOTHER agent's service token: the
  // audience of the token is the Ranch admin agent, so they prove nothing.
  // The other token carries Owner too, the strongest case.
  const other = await mcpAs(agentServiceToken(AGENTS.b.id, { admin: true }));
  await guestLike('the User’s token replayed by another agent (wrong audience)', other, person('user'));
  await guestLike('the Owner’s token replayed by another agent (wrong audience)', other, person('owner'));
  await other.close();

  // The User signs out; the token minted for that session dies with it.
  const before = await mcp.call('get_agent_status', { id: AGENTS.c.id }, person('user'));
  // A sign-in belongs to the console it was made in since CLEAN-236: each
  // console has a cookie of its own, and a sign-out says which console it
  // is, in `X-Ranch-Console`, as the consoles do. One that names none, or
  // the other console, ends nothing, and must leave the token working.
  const revokedBy = async (headers) => {
    const res = await acting.user.context.request.post(`${API}/auth/logout`, { headers });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok(), revoked: body?.data?.revoked ?? body?.revoked };
  };
  const unnamed = await revokedBy({});
  const otherConsole = await revokedBy({ 'x-ranch-console': 'admin' });
  const still = await mcp.call('get_agent_status', { id: AGENTS.c.id }, person('user'));
  check(
    unnamed.ok && unnamed.revoked === false && otherConsole.ok && otherConsole.revoked === false && !still.refused,
    `a sign-out that names no console, or the admin console, ends nothing of the app's sign-in (revoked ${unnamed.revoked}, ${otherConsole.revoked}) and the token still works`,
  );
  const out = await revokedBy({ 'x-ranch-console': 'app' });
  check(!before.refused && out.ok && out.revoked === true, `the User signs out of the app console (POST /auth/logout with their cookie and X-Ranch-Console: app, revoked ${out.revoked})`);
  await guestLike('the User’s token after they signed out', mcp, person('user'));
  const after = await mcp.call('get_agent_status', { id: AGENTS.c.id }, person('user'));
  check(unavailable(after), 'the manage tool that worked a moment ago is refused now');

  section('The agent acting for itself');
  {
    const trusted = { kind: 'trusted', via: 'internal' };
    const names = await mcp.list(trusted);
    // Every management tool but the ones about connections: a connection
    // exists for a person only when they reach the peer (CLEAN-236), and a
    // turn nobody asked for has no person whose reach could be asked. So
    // the agent on its own schedule changes and inspects nobody's peers,
    // its own included.
    const PEER_TOOLS = ['connect_agent_peer', 'list_agent_peers', ...TOOLS.ownPeers];
    const lacking = hasAll(names, MANAGEMENT_TOOLS.filter((n) => !PEER_TOOLS.includes(n)));
    check(lacking.length === 0, `{ kind: "trusted", via: "internal" }: every management tool that needs no person is listed${lacking.length ? ` (missing: ${lacking.join(', ')})` : ''}`);
    const peerTools = hasAny(names, PEER_TOOLS);
    const peerCalls = [
      await mcp.call('connect_agent_peer', { agentId: AGENTS.a.id, peerAgentId: AGENTS.b.id }, trusted),
      await mcp.call('list_agent_peers', { agentId: AGENTS.a.id }, trusted),
      await mcp.call('connect_my_peer', { peerAgentId: AGENTS.b.id }, trusted),
      await mcp.call('list_my_peers', {}, trusted),
    ];
    check(
      peerTools.length === 0 && peerCalls.every(unavailable),
      `and none about connections, which need a person: not listed, and connect_agent_peer, list_agent_peers, connect_my_peer and list_my_peers are refused${peerTools.length ? ` — LISTED: ${peerTools.join(', ')}` : ''}${peerCalls.every(unavailable) ? '' : ` — ${peerCalls.map((r) => r.text.slice(0, 50)).join(' | ')}`}`,
    );
    check(
      ((await api(`/agents/${AGENTS.a.id}/peers`, { as: OWNER })).body ?? []).length === 0,
      `and ${AGENTS.a.name} got no connection out of it`,
    );
    const readers = hasAll(names, TOOLS.reader);
    check(readers.length === 0, `and list_agents and get_agent, which a scheduled job needs as before${readers.length ? ` (missing: ${readers.join(', ')})` : ''}`);
    const all = await mcp.call('list_agents', {}, trusted);
    check(Object.values(AGENTS).every((a) => all.text.includes(a.name)), 'list_agents names every agent for it: the lists are about people');
    const list = await mcp.call('list_users', {}, trusted);
    check(!list.refused && list.text.includes(OWNER.email), 'list_users works: full power, as today');
    // Trust is the Ranch admin agent's: a plain agent's token gains nothing by saying it.
    const plain = await mcpAs(agentServiceToken(AGENTS.b.id, { admin: false }));
    {
      // A plain agent keeps its own self-service tools (they are its own
      // peers, CLEAN-105) and gains nothing else by the word "trusted".
      const names = await plain.list(trusted);
      const shown = hasAny(names, [...TOOLS.admin, ...TOOLS.owner, ...TOOLS.manage]);
      const list = await plain.call('list_users', {}, trusted);
      const del = await plain.call('delete_agent', { id: AGENTS.a.id, confirm: true }, trusted);
      check(
        shown.length === 0 && list.refused && del.refused && (await exists(AGENTS.a.id)),
        `a plain agent’s token stating { kind: "trusted" }: no admin, owner or manage-agent tool (${names.length} tools), list_users and delete_agent refused` +
          (shown.length ? ` — LISTED: ${shown.join(', ')}` : ''),
      );
    }
    {
      // The other direction: an ordinary agent taking the Ranch admin agent
      // as ITS colleague. The tools for an agent's own peers are a person's
      // since CLEAN-236: the agent's own token, whatever actor it states,
      // is nobody. A token minted for a turn with the Ranch admin agent is
      // for another audience and proves no person here either. So the tool
      // is not there at all: refused before it looks at what was named, in
      // the same words for the Ranch admin agent and for an agent that
      // does not exist, and nothing is offered.
      const GHOST = 'agent-00000032-0000-4000-8000-0000000000ee';
      const actors = [
        ['{ kind: "trusted" }', trusted],
        ['the Owner’s acting token, minted for another agent', person('owner')],
        ['an Admin’s acting token, minted for another agent', person('admin')],
        ['{ kind: "guest" }', { kind: 'guest' }],
      ];
      for (const [label, actor] of actors) {
        const listed = hasAny(await plain.list(actor), TOOLS.ownPeers);
        const connect = await plain.call('connect_my_peer', { peerAgentId: RANCH }, actor);
        const ghost = await plain.call('connect_my_peer', { peerAgentId: GHOST }, actor);
        const offered = await plain.call('list_ranch_agents', {}, actor);
        check(
          listed.length === 0 && unavailable(connect) && connect.text === ghost.text,
          `a plain agent’s connect_my_peer naming the Ranch admin agent, stating ${label}: not listed, and refused before it is looked at, in the words an unknown agent gets ("${connect.text.slice(0, 50)}")${listed.length ? ` — LISTED: ${listed.join(', ')}` : ''}`,
        );
        check(
          unavailable(offered) && !Object.values(AGENTS).some((a) => offered.text.includes(a.id) || offered.text.includes(a.name)),
          'and list_ranch_agents is refused the same way and names no agent at all',
        );
      }
      // A person the agent is talking to: the Admin, by the token minted
      // for their turn with access-bravo. For them the tools are there,
      // and the rule of CLEAN-232 is the one that answers: the Ranch admin
      // agent is the Owner's on either end of a connection, so for an
      // Admin, who has it as their assistant, it is not found, in the words
      // an unknown agent gets, and it is not among the agents offered.
      {
        const admin = { kind: 'person', token: acting.adminOnBravo.token };
        const lacking = hasAll(await plain.list(admin), TOOLS.ownPeers);
        check(lacking.length === 0, `an Admin’s own turn with ${AGENTS.b.name}: the tools for its own peers are listed${lacking.length ? ` (missing: ${lacking.join(', ')})` : ''}`);
        const connect = await plain.call('connect_my_peer', { peerAgentId: RANCH }, admin);
        const ghost = await plain.call('connect_my_peer', { peerAgentId: GHOST }, admin);
        check(
          connect.refused && notFound(connect) && connect.text.split(RANCH).join('x') === ghost.text.split(GHOST).join('x') && !connect.text.includes(AGENTS.ranch.name),
          `connect_my_peer naming the Ranch admin agent: refused as not found, in the words an unknown agent gets ("${connect.text.replace(/\s+/g, ' ').slice(0, 70)}")`,
        );
        const offered = await plain.call('list_ranch_agents', {}, admin);
        check(
          !offered.refused && offered.text.includes(AGENTS.a.id) && !offered.text.includes(AGENTS.c.id) && !offered.text.includes(RANCH) && !offered.text.includes(AGENTS.ranch.name),
          `list_ranch_agents names ${AGENTS.a.name}, which the Admin reaches, and neither ${AGENTS.c.name} nor the Ranch admin agent`,
        );
        // The same token on the Ranch admin agent's connection proves nothing.
        const replayed = await mcp.call('connect_my_peer', { peerAgentId: AGENTS.a.id }, admin);
        check(unavailable(replayed), 'that token replayed on the Ranch admin agent’s connection is nobody’s: connect_my_peer is refused');
      }
      const own = await api(`/agents/${AGENTS.b.id}/peers`, { as: OWNER });
      check(
        Array.isArray(own.body) && !own.body.some((p) => p.peerAgentId === RANCH),
        `after all of it ${AGENTS.b.name} has no connection to the Ranch admin agent (${Array.isArray(own.body) ? own.body.length : '?'} peers)`,
      );
    }
    await plain.close();
    const peers = await api(`/agents/${RANCH}/peers`, { as: OWNER });
    check(Array.isArray(peers.body) && peers.body.length === 0, 'after all of it the Ranch admin agent has no peer');
  }

  section('The acting token opens nothing by itself');
  for (const key of ['owner', 'admin']) {
    const res = await fetch(`${API}/auth/me`, { headers: { authorization: `Bearer ${acting[key].token}` } });
    check(res.status === 401, `[${key}] as a plain Bearer on GET /auth/me: 401 (${res.status})`);
    const agents = await fetch(`${API}/agents`, { headers: { authorization: `Bearer ${acting[key].token}` } });
    check(agents.status === 401, `[${key}] and on GET /agents: 401 (${agents.status})`);
  }

  await mcp.close();
} finally {
  await browser.close();
  const failed = await putAssistantAccessBack();
  check(failed.length === 0, `the assistant setting is as this script found it${failed.length ? `: ${failed.join(', ')}` : ''}`);
  const back = await setAdminAccess([AGENTS.a.id, AGENTS.b.id]);
  check(back.status === 200 && back.body?.allowed?.length === 2, `the Admin is limited to ${AGENTS.a.name} and ${AGENTS.b.name} again (${back.status})`);
}

done('acting');
