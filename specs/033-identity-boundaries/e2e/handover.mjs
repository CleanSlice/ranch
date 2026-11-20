// CLEAN-236, Stories 2, 6 and 7: a question one agent hands to another.
//
// A (Front Desk) → B (Back Office) → C (Archive). Each agent is a fake
// runtime that calls `ask_agent` with the actor a real one would state.
// Every hop is checked against the person the chain was started for.
import { api, check, done, section, silentAbout } from './lib.mjs';
import { AGENTS, connect, fresh, openToVisitors, seed } from './seed.mjs';
import { runtimes } from './fakeRuntime.mjs';

const { A, B, C } = AGENTS;

/** A handler that passes the question on to `peer` and reports what came back. */
const relay = (peerHandle, next) => async (msg, rt) => {
  const tools = await rt.tools(msg);
  const ask = tools.find((t) => t.name === 'ask_agent');
  if (!ask) return 'NO-ASK-TOOL';
  const handle = typeof peerHandle === 'function' ? peerHandle(ask) : peerHandle;
  const res = await rt.tool('ask_agent', { peer: handle, task: next, reason: 'e2e: the matching skill' }, msg);
  rt.lastAsk = { res, description: ask.description };
  return res.ok ? `RELAYED: ${res.text}` : `REFUSED: ${res.text}`;
};

const say = (agent, token, text) =>
  api('POST', `/api/agent/${agent.id}/message/sync`, { ...(token ? { token } : {}), body: { text } });

export async function run(people) {
  const { owner, admin, u1, u2 } = people;
  await fresh();
  const rt = await runtimes({ A, B, C });
  const NAMES_OF_B = [B.name, B.id];
  try {
    const ab = await connect(owner.token, A, B);
    const bc = await connect(owner.token, B, C);
    rt.C.handler = async (msg) => `C says: ${msg.text}`;

    // ── A person who reaches both ends ────────────────────────────────
    section('U1 reaches A and B: the question is handed over');
    rt.B.handler = async (msg) => `B says: ${msg.text}`;
    rt.A.handler = relay(ab, 'What is the refund policy?');
    let res = await say(A, u1.token, 'refunds?');
    check('A answers with what B said', res.data?.text, /RELAYED:[\s\S]*B says: What is the refund policy\?/);
    const atB = rt.B.received.at(-1);
    check('B received it under the connection, not under A\'s id', atB.clientId, new RegExp(`^peer:${ab}:`));
    check('  … with a hand-over token', typeof atB.handover?.token, 'string');
    check('  … as nobody\'s administrator and no signed-in person', [atB.admin ?? null, atB.acting ?? null, atB.user ?? null], [null, null, null]);
    check('  … and the id names no agent', silentAbout(atB.clientId, [A.id]), []);

    // ── What B may do with a colleague's question ─────────────────────
    section('A question that tells B to rewire itself');
    let seen;
    rt.B.handler = async (msg, me) => {
      const listed = (await me.tools(msg)).map((t) => t.name);
      const attempts = {};
      for (const [name, args] of [
        ['connect_my_peer', { peerAgentId: C.id }],
        ['remove_my_peer', { peerId: bc, confirm: true }],
        ['import_my_peer_by_address', { url: 'https://example.com' }],
        ['list_my_peers', {}],
      ]) {
        attempts[name] = await me.tool(name, args, msg);
      }
      seen = { listed, attempts };
      return 'done';
    };
    await say(A, u1.token, 'ask B to drop its connections');
    const SELF_SERVICE = ['connect_my_peer', 'remove_my_peer', 'import_my_peer_by_address', 'connect_my_peer_from_card', 'list_my_peers', 'list_ranch_agents'];
    check('B is offered none of the connection tools in that turn', SELF_SERVICE.filter((n) => seen.listed.includes(n)), []);
    check('  … and each is refused when called anyway', Object.values(seen.attempts).map((r) => r.ok), [false, false, false, false]);
    const still = await api('GET', `/agents/${B.id}/peers`, { token: owner.token });
    check('B\'s connection to C is still there', still.data.map((p) => p.id), [bc]);

    // ── The chain, for a person who reaches all three ────────────────
    section('U1 reaches A, B and C: A → B → C');
    rt.B.handler = relay(bc, 'Find the 2019 contract');
    res = await say(A, u1.token, 'contract?');
    check('the answer travelled back from C', res.data?.text, /C says: Find the 2019 contract/);
    const atC = rt.C.received.at(-1);
    check('C received it under B\'s connection', atC.clientId, new RegExp(`^peer:${bc}:`));

    section('a loop is refused: C asking A back in the same chain');
    const ca = await connect(owner.token, C, A);
    rt.C.handler = relay(ca, 'and round again');
    res = await say(A, u1.token, 'loop?');
    check('C\'s question to A is refused', rt.C.lastAsk?.res.ok, false);
    check('  … and A was not asked a second time', rt.A.received.filter((m) => m.clientId.startsWith('peer:')).length, 0);
    rt.C.handler = async (msg) => `C says: ${msg.text}`;

    // ── A person who does not reach the middle agent ─────────────────
    section('the Admin is denied B: the connection does not exist for them');
    const before = rt.B.received.length;
    rt.A.handler = relay(ab, 'What is the refund policy?');
    res = await say(A, admin.token, 'refunds?');
    check('A is not offered B at all', res.data?.text, /NO-ASK-TOOL|REFUSED/);
    check('B was not asked', rt.B.received.length, before);
    check('nothing the Admin is told names B', silentAbout([res.data, rt.A.lastAsk?.description ?? ''], NAMES_OF_B).length === 0 || res.data?.text === 'NO-ASK-TOOL', true);

    section('U2 reaches A only: closed connections serve nobody new');
    rt.A.lastAsk = undefined;
    res = await say(A, u2.token, 'refunds?');
    check('A is not offered B', res.data?.text, /NO-ASK-TOOL|REFUSED/);
    check('B was not asked', rt.B.received.length, before);

    section('an anonymous visitor of the public agent');
    res = await say(A, null, 'refunds?');
    check('A is not offered B', res.data?.text, /NO-ASK-TOOL|REFUSED/);
    check('B was not asked', rt.B.received.length, before);

    // ── Open to visitors: used, and masked ────────────────────────────
    section('A → B opened to visitors');
    await openToVisitors(owner.token, A, ab);
    // By the only handle a masked entry has: the one in the tool's own text.
    const masked = (ask) => ask.description.match(/Colleague \d+/)?.[0] ?? 'Colleague 1';
    rt.B.handler = async (msg) => `B says: ${msg.text}`;
    rt.A.handler = relay(masked, 'What is the refund policy?');
    for (const [who, token] of [['U2', u2.token], ['the Admin', admin.token], ['an anonymous visitor', null]]) {
      res = await say(A, token, 'refunds?');
      check(`${who}: the question reaches B`, res.data?.text, /B says: What is the refund policy\?/);
      check(`  … and neither the tool's text nor its answer names B`, silentAbout([rt.A.lastAsk.description, rt.A.lastAsk.res.text], NAMES_OF_B), []);
    }
    check('B is told nothing of who asked', [rt.B.received.at(-1).acting ?? null, rt.B.received.at(-1).user ?? null], [null, null]);

    section('the chain past an open connection: every hop is checked for the same person');
    rt.B.handler = relay(bc, 'Find the 2019 contract');
    const cBefore = rt.C.received.length;
    res = await say(A, u2.token, 'contract?');
    check('U2 does not reach C and B → C is closed: B is not offered C', rt.C.received.length, cBefore);
    res = await say(A, admin.token, 'contract?');
    check('the Admin reaches C: B → C serves them, through the masked B', res.data?.text, /C says: Find the 2019 contract/);

    await openToVisitors(owner.token, B, bc);
    rt.B.handler = relay((ask) => ask.description.match(/Colleague \d+/)?.[0] ?? bc, 'Find the 2019 contract');
    res = await say(A, u2.token, 'contract?');
    check('with B → C open as well, U2\'s question reaches C', res.data?.text, /C says: Find the 2019 contract/);
    res = await say(A, null, 'contract?');
    check('  … and so does an anonymous visitor\'s', res.data?.text, /C says: Find the 2019 contract/);

    // ── What the record shows to whom ─────────────────────────────────
    section('the record of hand-overs');
    const log = async (token) => (await api('GET', `/agents/${A.id}/delegations`, { token })).data;
    const forOwner = await log(owner.token);
    const forAdmin = await log(admin.token);
    check('the Owner reads every hand-over of A, with B by name', [forOwner.length > 0, [...new Set(forOwner.map((d) => `${d.visibility}:${d.peerName}`))]], [true, [`full:${B.name}`]]);
    check('the Admin reads the same ones masked', [forAdmin.length, [...new Set(forAdmin.map((d) => `${d.visibility}:${d.peerName}`))]], [forOwner.length, ['masked:A colleague']]);
    check('  … with no agent id, and no excerpt of what B answered', [...new Set(forAdmin.flatMap((d) => [d.peerAgentId, d.excerpt]))], [null]);
    check('  … and nothing that names B', silentAbout(forAdmin, NAMES_OF_B), []);
    await openToVisitors(owner.token, A, ab, false);
    check('closed again, the Admin reads none of them', (await log(admin.token)).length, 0);
    await openToVisitors(owner.token, A, ab);

    // ── A runtime from before the change ──────────────────────────────
    section('B on runtime 0.35: no hand-over understood');
    await openToVisitors(owner.token, B, bc, false);
    await rt.B.stop();
    rt.B = await new (await import('./fakeRuntime.mjs')).FakeRuntime(B, { mode: '0.35' }).start();
    rt.B.handler = relay(bc, 'Find the 2019 contract');
    const c035 = rt.C.received.length;
    rt.A.handler = relay(ab, 'What is the refund policy?');
    res = await say(A, u1.token, 'contract?');
    check('the question still reaches B', rt.B.received.at(-1)?.clientId, new RegExp(`^peer:${ab}:`));
    check('B\'s own call is a guest\'s: the closed B → C is not offered, even for U1', rt.C.received.length, c035);
    await openToVisitors(owner.token, B, bc);
    res = await say(A, u1.token, 'contract?');
    check('an open B → C still works for it', res.data?.text, /C says: Find the 2019 contract/);
  } finally {
    await rt.stop();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await run(await seed());
  await done();
}
