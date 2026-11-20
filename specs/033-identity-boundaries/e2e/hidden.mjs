// CLEAN-236, Story 2: a connection to an agent somebody does not reach does
// not exist for them. Not in a list, not by its id, not by the difference
// between two refusals.
import { api, check, done, section, silentAbout } from './lib.mjs';
import { AGENTS, GHOST, connect, fresh, seed } from './seed.mjs';

const { A, B, C, R } = AGENTS;
const NO_SUCH_PEER = '00000000-0000-4000-8000-000000000000';
/** A refusal with what differs between any two requests taken out. */
const refusal = (res) => {
  const { timestamp, path, ...rest } = res.json ?? {};
  return { status: res.status, ...rest };
};

export async function run(people) {
  const { owner, admin, u1 } = people;
  await fresh();
  const ab = await connect(owner.token, A, B);
  await connect(owner.token, A, C);
  const peers = async (token) => (await api('GET', `/agents/${A.id}/peers`, { token })).data;
  const ids = (list) => list.map((p) => p.peerAgentId).sort();

  section('the list of an agent\'s connections');
  check('the Owner sees both', ids(await peers(owner.token)), [B.id, C.id]);
  const first = (await peers(owner.token)).find((p) => p.id === ab);
  check('  … with who connected it and what they may do', [first.createdBy?.name, first.visibility, first.openToVisitors, first.canRemove, first.canSetVisitors], [owner.name, 'full', false, true, true]);
  const forAdmin = await peers(admin.token);
  check('the Admin, denied B, sees C only', ids(forAdmin), [C.id]);
  check('  … and nothing in the answer names B', silentAbout(forAdmin, [B.id, B.name, ab]), []);
  check('a User is not shown the console\'s list at all', (await api('GET', `/agents/${A.id}/peers`, { token: u1.token })).status, (s) => s === 403 || s === 404);

  section('the agents offered for a new connection');
  const candidates = async (token) =>
    (await api('GET', `/agents/${A.id}/peers/candidates`, { token })).data.map((c) => c.id).sort();
  check('the Owner is offered every other agent', await candidates(owner.token), [B.id, C.id, R.id]);
  check('the Admin is offered neither B nor the Ranch admin agent', await candidates(admin.token), [C.id]);

  section('acting on a connection that is hidden');
  const hidden = await api('DELETE', `/agents/${A.id}/peers/${ab}`, { token: admin.token });
  const absent = await api('DELETE', `/agents/${A.id}/peers/${NO_SUCH_PEER}`, { token: admin.token });
  check('removing it answers 404', hidden.status, 404);
  check('  … exactly as for a connection that does not exist', refusal(hidden), refusal(absent));
  check('re-reading its card answers 404', (await api('POST', `/agents/${A.id}/peers/${ab}/refresh`, { token: admin.token })).status, 404);
  const toHidden = await api('POST', `/agents/${A.id}/peers`, { token: admin.token, body: { peerAgentId: B.id } });
  const toGhost = await api('POST', `/agents/${A.id}/peers`, { token: admin.token, body: { peerAgentId: GHOST } });
  check('connecting to the hidden agent answers as for an agent that does not exist', refusal(toHidden), refusal(toGhost));
  check('  … so an already existing connection is not given away either', toHidden.status, 404);
  check('connecting to the Ranch admin agent answers 404 for an Admin', (await api('POST', `/agents/${A.id}/peers`, { token: admin.token, body: { peerAgentId: R.id } })).status, 404);
  check('the hidden connection is untouched', ids(await peers(owner.token)), [B.id, C.id]);

  section('the public card of an agent');
  const card = async (agentId, token) =>
    (await api('GET', `/a2a/agents/${agentId}/.well-known/agent-card.json`, { token })).status;
  check('an agent the Admin manages', await card(C.id, admin.token), 200);
  check('the Ranch admin agent: 200 for the Owner, 404 for an Admin', [await card(R.id, owner.token), await card(R.id, admin.token)], [200, 404]);
  check('an agent the Admin is denied, and one that does not exist: the same 404', [await card(B.id, admin.token), await card(GHOST, admin.token)], [404, 404]);
  check('a User\'s console token opens no card', await card(C.id, u1.token), 401);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await run(await seed());
  await done();
}
