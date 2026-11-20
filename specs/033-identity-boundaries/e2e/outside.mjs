// CLEAN-236, Story 4: an agent outside this Ranch. An address that is one of
// this Ranch's own agents is refused however it is spelt or reached, and a
// colleague a User adds is theirs alone.
//
// The outside agent is a stub on 127.0.0.1. A local API reads it because
// `api/.env.dev` sets A2A_ALLOW_PRIVATE_PEERS=true; everywhere else Ranch
// refuses a private address before any request, which `a2a.client.spec.ts`
// pins and this file cannot.
import http from 'node:http';
import { api, check, done, section, silentAbout, API } from './lib.mjs';
import { AGENTS, fresh, seed } from './seed.mjs';
import { runtimes } from './fakeRuntime.mjs';

const { A, B } = AGENTS;

export async function run(people) {
  const { owner, admin, u1, u2 } = people;
  await fresh();
  const rt = await runtimes({ A });
  const stub = await outsideAgents();
  const turn = async (token, work) => {
    let out;
    rt.A.handler = async (msg, me) => {
      out = await work(msg, me);
      return 'ok';
    };
    await api('POST', `/api/agent/${A.id}/message/sync`, { ...(token ? { token } : {}), body: { text: 'add an outside colleague' } });
    return out;
  };
  const byAddress = (token, url) => turn(token, (msg, me) => me.tool('import_my_peer_by_address', { url }, msg));
  const ownerPeers = async () => (await api('GET', `/agents/${A.id}/peers`, { token: owner.token })).data;
  const ours = (res) => [res.ok, /this installation/i.test(res.text)];

  try {
    section('an address that is one of this Ranch\'s own agents');
    const own = new URL(`${API}/a2a/agents/${B.id}`);
    const spellings = [
      `${own}/.well-known/agent-card.json`,
      `${own}`,
      `${own.origin}//a2a/agents/${B.id}`,
      `${own.origin}/a2a/%61gents/${B.id}/.well-known/agent-card.json`,
      `${own.protocol}//LOCALHOST:${own.port}/a2a/agents/${B.id}`,
    ];
    for (const url of spellings) {
      check(`refused from the chat: ${url.replace(B.id, '<B>')}`, ours(await byAddress(u1.token, url)), [false, true]);
    }
    const console_ = await api('POST', `/agents/${A.id}/peers`, { token: owner.token, body: { url: spellings[0] } });
    check('refused in the console too, for the Owner', [console_.status, console_.json?.code], [400, 'PEER_SELF_URL']);
    check('U2, who does not reach B, is told the same and learns nothing of B', await byAddress(u2.token, spellings[0]).then((r) => [r.ok, silentAbout(r.text, [B.name])]), [false, []]);

    section('an address that only leads back here');
    check('a card address that redirects to one of our agents is not followed', (await byAddress(u1.token, `${stub.base}/redirect`)).ok, false);
    check('a card elsewhere that sends its questions to this installation is refused', ours(await byAddress(u1.token, `${stub.base}/disguised`)), [false, true]);
    const pasted = await turn(u1.token, (msg, me) => me.tool('connect_my_peer_from_card', { card: JSON.stringify(stub.card('disguised')) }, msg));
    check('  … and so is the same card pasted as text', ours(pasted), [false, true]);
    check('an address that is no web address is refused', (await byAddress(u1.token, 'file:///etc/passwd')).ok, false);
    check('nothing was connected', (await ownerPeers()).length, 0);

    section('an outside colleague a User adds is theirs alone');
    const mine = await byAddress(u1.token, `${stub.base}/helper`);
    if (!check('U1 adds one from the chat, by its address', mine.ok, true)) console.log('   ', mine.text.slice(0, 300));
    const row = (await ownerPeers()).find((p) => p.peerName === 'Outside Helper');
    check('the Owner sees it, with whose it is', [row?.visibility, row?.owner?.name, row?.createdBy?.name], ['full', u1.name, u1.name]);
    const asks = async (token) => turn(token, async (msg, me) => (await me.tools(msg)).find((t) => t.name === 'ask_agent')?.description ?? '');
    check('A may ask it in U1\'s turn', (await asks(u1.token)).includes('Outside Helper'), true);
    check('  … and in nobody else\'s: U2, the Admin, an anonymous visitor', [await asks(u2.token), await asks(admin.token), await asks(null)].map((d) => d.includes('Outside Helper')), [false, false, false]);
    const u2View = await turn(u2.token, (msg, me) => me.tool('list_my_peers', {}, msg));
    check('U2 is not shown it', silentAbout(u2View.text, ['Outside Helper', stub.base]), []);
    const answered = await turn(u1.token, (msg, me) => me.tool('ask_agent', { peer: row.id, task: 'Are you there?', reason: 'e2e' }, msg));
    if (!check('a question to it is answered by the outside agent', [answered.ok, /outside says: Are you there\?/.test(answered.text)], [true, true])) console.log('   ', answered.text.slice(0, 300));
    if (process.env.E2E_DEBUG) console.log('   outside agent received', JSON.stringify(stub.calls.at(-1)?.rpc?.params).slice(0, 600));
    check('  … which is sent no hand-over token and nobody\'s identity', silentAbout(stub.calls.at(-1) ?? 'no call', ['"pass"', 'handover', u1.id, u1.email, 'no call']), []);
    const stranger = await turn(u2.token, (msg, me) => me.tool('ask_agent', { peer: row.id, task: 'And for me?', reason: 'e2e' }, msg));
    check('U2 asking it by its id is refused, and it is not called', [stranger.ok, stub.calls.length], [false, 1]);

    section('one somebody who manages the agent adds is the agent\'s');
    const shared = await api('POST', `/agents/${A.id}/peers`, { token: owner.token, body: { url: `${stub.base}/shared` } });
    if (!check('the Owner adds one in the console', shared.status === 200 || shared.status === 201, true)) console.log('   ', shared.text.slice(0, 300));
    const sharedRow = (await ownerPeers()).find((p) => p.peerName === 'Shared Helper');
    check('it belongs to nobody in particular', sharedRow?.owner ?? null, null);
    check('A may ask it in everybody\'s turn', [await asks(u1.token), await asks(u2.token), await asks(null)].map((d) => d.includes('Shared Helper')), [true, true, true]);
  } finally {
    await rt.stop();
    await stub.stop();
  }
}

/**
 * Agents that live elsewhere: `/helper` and `/shared` are ordinary ones that
 * answer, `/redirect` sends a card request on to one of this Ranch's own
 * agents, `/disguised` is a card whose questions would go to this Ranch.
 */
async function outsideAgents() {
  const calls = [];
  const names = { helper: 'Outside Helper', shared: 'Shared Helper', disguised: 'Totally Outside' };
  let base;
  const card = (key) => ({
    name: names[key],
    description: 'An agent that lives elsewhere.',
    version: '1',
    supportedInterfaces: [
      {
        url: key === 'disguised' ? `${API}/a2a/agents/${B.id}` : `${base}/${key}/rpc`,
        protocolBinding: 'JSONRPC',
        protocolVersion: '1.0',
      },
    ],
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [{ id: 'help', name: 'Help', description: 'Answers questions.', tags: ['help'] }],
  });
  const server = http.createServer((req, res) => {
    const [, key, ...rest] = req.url.split('/');
    const tail = rest.join('/');
    if (req.method === 'GET' && tail === '.well-known/agent-card.json') {
      if (key === 'redirect') {
        res.writeHead(302, { Location: `${API}/a2a/agents/${B.id}/.well-known/agent-card.json` }).end();
        return;
      }
      if (names[key]) {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(card(key)));
        return;
      }
    }
    if (req.method === 'POST' && tail === 'rpc') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const rpc = JSON.parse(body);
        calls.push({ headers: req.headers, rpc });
        const text = (rpc.params?.message?.parts ?? []).map((p) => p.text ?? '').join(' ');
        const message = { messageId: `m-${calls.length}`, role: 'ROLE_AGENT', parts: [{ text: `outside says: ${text}` }] };
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { message } }));
      });
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  return { base, calls, card, stop: () => new Promise((resolve) => server.close(resolve)) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await run(await seed());
  await done();
}
