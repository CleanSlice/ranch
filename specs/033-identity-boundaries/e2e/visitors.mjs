// CLEAN-236, Story 6: opening a connection to visitors, and what somebody
// who does not reach the colleague is then shown. The use of an open
// connection is in handover.mjs; the page itself is checked by hand
// (quickstart.md §4).
import { api, check, done, section, silentAbout } from './lib.mjs';
import { AGENTS, connect, fresh, seed } from './seed.mjs';

const { A, B, C } = AGENTS;

export async function run(people) {
  const { owner, admin, u1 } = people;
  await fresh();
  const ab = await connect(owner.token, A, B);
  const ac = await connect(owner.token, A, C);
  const visitors = (peerId, token, body) =>
    api('PUT', `/agents/${A.id}/peers/${peerId}/visitors`, { token, body });
  const peers = async (token) => (await api('GET', `/agents/${A.id}/peers`, { token })).data;

  section('who may open a connection to visitors');
  const bare = await visitors(ab, owner.token, { open: true });
  check('opening asks to be confirmed', [bare.status, bare.json?.code], [409, 'PEER_VISITORS_NEEDS_CONFIRM']);
  check('  … and nothing was opened', (await peers(owner.token)).find((p) => p.id === ab).openToVisitors, false);
  check('the Admin cannot open a connection to an agent they do not reach', (await visitors(ab, admin.token, { open: true, confirm: true })).status, 404);
  check('the Admin opens and closes one between two agents they manage', [(await visitors(ac, admin.token, { open: true, confirm: true })).status, (await visitors(ac, admin.token, { open: false })).status], [200, 200]);
  check('a User cannot', (await visitors(ac, u1.token, { open: true, confirm: true })).status, (s) => s === 403 || s === 404);
  check('closing needs no confirmation', [(await visitors(ab, owner.token, { open: true, confirm: true })).status, (await visitors(ab, owner.token, { open: false })).status, (await visitors(ab, owner.token, { open: true, confirm: true })).status], [200, 200, 200]);

  section('an open connection, for somebody who does not reach the colleague');
  const row = (await peers(admin.token)).find((p) => p.id === ab);
  check('the Admin sees it, masked', [row?.visibility, row?.peerName, row?.peerAgentId, row?.cardUrl, row?.peerStatus], ['masked', 'A colleague', null, '', 'hidden']);
  check('  … with no description and nobody named as having connected it', [row?.card?.description ?? '', row?.createdBy ?? null], ['', null]);
  check('  … and nothing that names B', silentAbout(row, [B.id, B.name]), []);
  check('  … and may neither remove nor close it', [row?.canRemove, row?.canSetVisitors], [false, false]);
  const removal = await api('DELETE', `/agents/${A.id}/peers/${ab}`, { token: admin.token });
  check('removing it is refused, not hidden: they were shown it', [removal.status, removal.json?.code], [403, 'PEER_FORBIDDEN']);
  check('closing it is refused too', (await visitors(ab, admin.token, { open: false })).status, 404);
  const forOwner = (await peers(owner.token)).find((p) => p.id === ab);
  check('the Owner sees who opened it', [forOwner.visibility, forOwner.openToVisitors, forOwner.peerName], ['full', true, B.name]);

  section('closed again');
  await visitors(ab, owner.token, { open: false });
  check('the Admin\'s list no longer has it', (await peers(admin.token)).map((p) => p.id), [ac]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await run(await seed());
  await done();
}
