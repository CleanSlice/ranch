// CLEAN-236, Stories 1 and 3: connecting colleagues from the chat. A User
// connects the agents they reach and no others; somebody with no account
// connects nothing. Each call is made the way the agent's runtime makes it,
// for the person (or nobody) whose turn it is.
import { api, check, done, section, silentAbout } from './lib.mjs';
import { AGENTS, GHOST, connect, fresh, seed } from './seed.mjs';
import { runtimes } from './fakeRuntime.mjs';

const { A, B, C, R } = AGENTS;
const TOOLS = ['list_my_peers', 'list_ranch_agents', 'preview_agent_card_by_address', 'connect_my_peer', 'import_my_peer_by_address', 'connect_my_peer_from_card', 'remove_my_peer'];

export async function run(people) {
  const { owner, admin, u1, u2 } = people;
  await fresh();
  const rt = await runtimes({ A });
  /** One chat turn with A as `token`'s holder; `work` runs inside it. */
  const turn = async (token, work) => {
    let out;
    rt.A.handler = async (msg, me) => {
      out = await work(msg, me);
      return 'ok';
    };
    await api('POST', `/api/agent/${A.id}/message/sync`, { ...(token ? { token } : {}), body: { text: 'connect a colleague' } });
    return out;
  };
  const offered = async (msg, me) => (await me.tools(msg)).map((t) => t.name).filter((n) => TOOLS.includes(n));
  const ownerPeers = async () => (await api('GET', `/agents/${A.id}/peers`, { token: owner.token })).data;

  try {
    section('a User who reaches A, B and C');
    check('is offered the connection tools', await turn(u1.token, offered), TOOLS);
    const listed = await turn(u1.token, (msg, me) => me.tool('list_ranch_agents', {}, msg));
    check('is offered the agents they reach, and not the Ranch admin agent', [silentAbout(listed.text, [B.id, C.id]).length, silentAbout(listed.text, [R.id, R.name])], [2, []]);
    const made = await turn(u1.token, (msg, me) => me.tool('connect_my_peer', { peerAgentId: C.id }, msg));
    check('connects A to C', made.ok, true);
    const row = (await ownerPeers()).find((p) => p.peerAgentId === C.id);
    check('the connection says who made it', [row?.createdBy?.name, row?.openToVisitors], [u1.name, false]);
    const toRanch = await turn(u1.token, (msg, me) => me.tool('connect_my_peer', { peerAgentId: R.id }, msg));
    const toGhost = await turn(u1.token, (msg, me) => me.tool('connect_my_peer', { peerAgentId: GHOST }, msg));
    check('cannot connect the Ranch admin agent', toRanch.ok, false);
    check('  … and is told what they are told for an agent that does not exist', toRanch.text.replaceAll(R.id, 'X'), toGhost.text.replaceAll(GHOST, 'X'));

    section('a User who reaches A only');
    const u2List = await turn(u2.token, (msg, me) => me.tool('list_ranch_agents', {}, msg));
    check('is offered no agent to connect', silentAbout(u2List.text, [B.id, B.name, C.id, C.name, R.id]), []);
    const u2Peers = await turn(u2.token, (msg, me) => me.tool('list_my_peers', {}, msg));
    check('is not shown the connection to C, which they do not reach', silentAbout(u2Peers.text, [C.id, C.name, row.id]), []);
    const u2ToB = await turn(u2.token, (msg, me) => me.tool('connect_my_peer', { peerAgentId: B.id }, msg));
    const u2ToGhost = await turn(u2.token, (msg, me) => me.tool('connect_my_peer', { peerAgentId: GHOST }, msg));
    check('cannot connect B', u2ToB.ok, false);
    check('  … with the answer for an agent that does not exist', u2ToB.text.replaceAll(B.id, 'X'), u2ToGhost.text.replaceAll(GHOST, 'X'));
    const u2Remove = await turn(u2.token, (msg, me) => me.tool('remove_my_peer', { peerId: row.id, confirm: true }, msg));
    const u2RemoveGhost = await turn(u2.token, (msg, me) => me.tool('remove_my_peer', { peerId: '00000000-0000-4000-8000-000000000000', confirm: true }, msg));
    check('cannot remove U1\'s connection, nor learn that it exists', [u2Remove.ok, u2Remove.text === u2RemoveGhost.text], [false, true]);
    check('B is not connected, C still is', (await ownerPeers()).map((p) => p.peerAgentId), [C.id]);

    section('an Admin in the chat, denied B');
    const adminToB = await turn(admin.token, (msg, me) => me.tool('connect_my_peer', { peerAgentId: B.id }, msg));
    check('cannot connect B from the chat either', adminToB.ok, false);

    section('whose connection it is to remove');
    const ab = await connect(owner.token, A, B);
    const notTheirs = await turn(u1.token, (msg, me) => me.tool('remove_my_peer', { peerId: ab, confirm: true }, msg));
    check('U1 sees the Owner\'s connection to B but may not remove it', notTheirs.ok, false);
    const unconfirmed = await turn(u1.token, (msg, me) => me.tool('remove_my_peer', { peerId: row.id, confirm: false }, msg));
    check('removing their own asks to be confirmed', [unconfirmed.ok, (await ownerPeers()).length], [false, 2]);
    const own = await turn(u1.token, (msg, me) => me.tool('remove_my_peer', { peerId: row.id, confirm: true }, msg));
    check('U1 removes the one they made', [own.ok, (await ownerPeers()).map((p) => p.peerAgentId)], [true, [B.id]]);

    section('somebody with no account: an anonymous visitor of the public agent');
    check('is offered none of the connection tools', await turn(null, offered), []);
    const attempts = await turn(null, async (msg, me) => {
      const out = {};
      for (const [name, args] of [
        ['list_my_peers', {}],
        ['list_ranch_agents', {}],
        ['connect_my_peer', { peerAgentId: C.id }],
        ['import_my_peer_by_address', { url: 'https://example.com' }],
        ['connect_my_peer_from_card', { card: '{}' }],
        ['remove_my_peer', { peerId: ab, confirm: true }],
      ]) {
        out[name] = (await me.tool(name, args, msg)).ok;
      }
      return out;
    });
    check('and each is refused when called anyway', Object.values(attempts), [false, false, false, false, false, false]);
    check('  … whatever the agent states about itself: a turn of its own is not a person\'s', await turn(null, async (msg, me) => (await me.tool('connect_my_peer', { peerAgentId: C.id }, msg, { kind: 'trusted', via: 'internal' })).ok), false);
    check('nothing changed', (await ownerPeers()).map((p) => p.peerAgentId), [B.id]);

    section('the routes of the console, without a console session');
    check('no token', (await api('POST', `/agents/${A.id}/peers`, { body: { peerAgentId: C.id } })).status, 401);
    check('a User\'s token', (await api('POST', `/agents/${A.id}/peers`, { token: u1.token, body: { peerAgentId: C.id } })).status, (s) => s === 403 || s === 404);
  } finally {
    await rt.stop();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await run(await seed());
  await done();
}
