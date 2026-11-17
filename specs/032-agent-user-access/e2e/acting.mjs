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
  section,
  shot,
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

section('Preconditions');
const health = await fake.health();
check(health?.connected?.includes(RANCH), 'the fake runtime is connected for the Ranch admin agent');
await fake.reset();

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
    check(notFound(ranch), 'and for the Ranch admin agent');
    const del = await mcp.call('delete_agent', { id: AGENTS.b.id, confirm: true }, person('user'));
    check(notFound(del), `delete_agent for ${AGENTS.b.name} answers "not found"`);
    check(await exists(AGENTS.b.id), `${AGENTS.b.name} still exists`);
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
    const ranch = await mcp.call('get_agent_status', { id: RANCH }, person('admin'));
    check(notFound(ranch) && !ranch.text.includes(AGENTS.ranch.name), 'manage tools answer "not found" for the Ranch admin agent');
    const env = await mcp.call('get_agent_env', { id: RANCH }, person('admin'));
    check(notFound(env), 'its environment included');
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
  const out = await acting.user.context.request.post(`${API}/auth/logout`);
  const revoked = (await out.json().catch(() => ({})))?.data?.revoked ?? (await out.json().catch(() => ({})))?.revoked;
  check(!before.refused && out.ok() && revoked === true, 'the User signs out (POST /auth/logout with their cookie, session revoked)');
  await guestLike('the User’s token after they signed out', mcp, person('user'));
  const after = await mcp.call('get_agent_status', { id: AGENTS.c.id }, person('user'));
  check(unavailable(after), 'the manage tool that worked a moment ago is refused now');

  section('The agent acting for itself');
  {
    const trusted = { kind: 'trusted', via: 'internal' };
    const names = await mcp.list(trusted);
    const lacking = hasAll(names, MANAGEMENT_TOOLS);
    check(lacking.length === 0, `{ kind: "trusted", via: "internal" }: every management tool listed${lacking.length ? ` (missing: ${lacking.join(', ')})` : ''}`);
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
      // as ITS colleague. Its own token, whatever actor it states, is a
      // guest to that rule: the agent is not found and is not offered.
      const actors = [
        ['{ kind: "trusted" }', trusted],
        ['the Owner’s acting token', person('owner')],
        ['an Admin’s acting token', person('admin')],
        ['{ kind: "guest" }', { kind: 'guest' }],
      ];
      for (const [label, actor] of actors) {
        const connect = await plain.call('connect_my_peer', { peerAgentId: RANCH }, actor);
        const ghost = await plain.call('connect_my_peer', { peerAgentId: 'agent-00000032-0000-4000-8000-0000000000ee' }, actor);
        const offered = await plain.call('list_ranch_agents', {}, actor);
        check(
          connect.refused && notFound(connect) && connect.text === ghost.text,
          `a plain agent’s connect_my_peer naming the Ranch admin agent, stating ${label}: refused as not found, in the words an unknown agent gets ("${connect.text.slice(0, 50)}")`,
        );
        check(
          !offered.refused && offered.text.includes(AGENTS.a.id) && !offered.text.includes(RANCH) && !offered.text.includes(AGENTS.ranch.name),
          'and list_ranch_agents names the other agents, not that one',
        );
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
}

done('acting');
