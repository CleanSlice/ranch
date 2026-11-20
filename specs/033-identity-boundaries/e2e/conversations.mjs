// CLEAN-236, Story 5: every administrator has a conversation of their own.
// The fake runtime reports the id and the `admin` word it was sent, which
// is what a real one decides a turn by.
import { api, check, done, section } from './lib.mjs';
import { AGENTS, fresh, seed } from './seed.mjs';
import { runtimes } from './fakeRuntime.mjs';

const { A, C, R } = AGENTS;

export async function run(people) {
  const { owner, admin, u1 } = people;
  await fresh();
  const rt = await runtimes({ A, C, R });
  const say = async (agent, token, text) => {
    const res = await api('POST', `/api/agent/${agent.id}/message/sync`, { ...(token ? { token } : {}), body: { text } });
    return { res, msg: rt[agent === A ? 'A' : agent === C ? 'C' : 'R'].received.at(-1) };
  };
  try {
    section('who a message arrives as');
    const asOwner = (await say(C, owner.token, 'hi')).msg;
    const asAdmin = (await say(C, admin.token, 'hi')).msg;
    const asUser = (await say(C, u1.token, 'hi')).msg;
    const asVisitor = (await say(A, null, 'hi')).msg;
    check('the Owner keeps the conversation the administrators shared', [asOwner.clientId, asOwner.admin], ['admin', true]);
    check('an Admin has their own, and is still an administrator to the agent', [asAdmin.clientId, asAdmin.admin], [admin.id, true]);
    check('a User has their own, and is not', [asUser.clientId, asUser.admin ?? null], [u1.id, null]);
    check('an anonymous visitor is neither', [/^(sync|anon|http)-/.test(asVisitor.clientId), asVisitor.admin ?? null, asVisitor.acting ?? null], [true, null, null]);
    check('each signed-in person is vouched for by a token of their own', [asOwner, asAdmin, asUser].map((m) => [typeof m.acting?.token, m.acting?.role]), [['string', 'Owner'], ['string', 'Admin'], ['string', 'User']]);

    section('a message sent while somebody else\'s turn is running');
    let release;
    const held = new Promise((r) => (release = r));
    rt.C.handler = async (msg) => {
      if (msg.clientId === 'admin') await held;
      return `to ${msg.clientId}`;
    };
    const ownerTurn = say(C, owner.token, 'a long task');
    await new Promise((r) => setTimeout(r, 300));
    const adminTurn = await say(C, admin.token, 'while that runs');
    check('the Admin\'s message is its own turn, answered while the Owner\'s still runs', adminTurn.res.data?.text, `to ${admin.id}`);
    release();
    check('the Owner\'s turn ends with its own answer', (await ownerTurn).res.data?.text, 'to admin');
    rt.C.handler = async (msg) => `echo: ${msg.text}`;

    section('reading a conversation');
    const transcript = (agent, token, channel) =>
      api('GET', `/api/agent/${agent.id}/transcript${channel ? `?channel=${channel}` : ''}`, { token });
    check('by default each reads their own', [(await transcript(C, owner.token)).data?.channel, (await transcript(C, admin.token)).data?.channel, (await transcript(C, u1.token)).data?.channel], ['admin', admin.id, u1.id]);
    check('an Admin reads the Owner\'s with an agent they manage: supervision', (await transcript(C, admin.token, 'admin')).status, 200);
    check('  … and a User\'s', (await transcript(C, admin.token, u1.id)).status, 200);
    check('an Admin reads nothing of the Owner\'s with the Ranch admin agent', (await transcript(R, admin.token, 'admin')).status, (s) => s === 403 || s === 404);
    check('a User reads nobody else\'s', [(await transcript(C, u1.token, 'admin')).status, (await transcript(C, u1.token, admin.id)).status], [403, 403]);

    section('the list of an agent\'s conversations');
    const chats = async (token, agentId) => (await api('GET', `/chats?agentId=${agentId}`, { token })).data;
    check('an Admin lists none of the Ranch admin agent', (await chats(admin.token, R.id)).total, 0);
    check('the Owner\'s request for it is answered', typeof (await chats(owner.token, R.id)).total, 'number');
  } finally {
    await rt.stop();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await run(await seed());
  await done();
}
