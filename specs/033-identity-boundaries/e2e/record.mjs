// CLEAN-236, Story 9 (scenario 4) and the migration: a connection made
// before this feature. It kept working for everybody, because that is what
// it did; it says nobody connected it and asks to be looked at. Scenarios
// 1 to 3 of the story are in connect.mjs.
import { api, check, done, prisma, section } from './lib.mjs';
import { AGENTS, connect, fresh, openToVisitors, seed } from './seed.mjs';
import { runtimes } from './fakeRuntime.mjs';

const { A, B } = AGENTS;

export async function run(people) {
  const { owner, admin, u2 } = people;
  await fresh();
  const ab = await connect(owner.token, A, B);
  // What the migration leaves on a row that existed before it.
  await prisma().$executeRawUnsafe(
    `UPDATE "AgentPeer" SET "createdById" = NULL, "openToVisitors" = true, "needsReview" = true, "openedById" = NULL, "openedAt" = NULL WHERE id = $1`,
    ab,
  );
  const row = async (token) => (await api('GET', `/agents/${A.id}/peers`, { token })).data.find((p) => p.id === ab);
  const rt = await runtimes({ A, B });
  try {
    section('a connection from before the record');
    const before = await row(owner.token);
    check('says nobody connected it, and that it wants a look', [before.createdBy ?? null, before.needsReview, before.openToVisitors], [null, true, true]);
    rt.A.handler = async (msg, me) => {
      const ask = (await me.tools(msg)).find((t) => t.name === 'ask_agent');
      if (!ask) return 'NO-ASK-TOOL';
      const res = await me.tool('ask_agent', { peer: ask.description.match(/Colleague \d+/)?.[0] ?? ab, task: 'still there?', reason: 'e2e' }, msg);
      return res.ok ? res.text : `REFUSED: ${res.text}`;
    };
    const ask = async (token) => (await api('POST', `/api/agent/${A.id}/message/sync`, { ...(token ? { token } : {}), body: { text: 'q' } })).data?.text;
    check('it still answers a visitor, as it did before the upgrade', await ask(null), /echo: still there\?/);
    check('  … and somebody who does not reach B', await ask(u2.token), /echo: still there\?/);
    // The mark is for whoever can settle it; the Admin can do nothing about B.
    check('the Admin, denied B, sees it masked, without the mark', await row(admin.token).then((r) => [r?.visibility, r?.needsReview]), ['masked', false]);

    section('once somebody who manages both agents has decided');
    await openToVisitors(owner.token, A, ab, false);
    const after = await row(owner.token);
    check('closed: no longer open, no longer asking for a look', [after.openToVisitors, after.needsReview], [false, false]);
    check('  … and no longer answering a visitor', await ask(null), /NO-ASK-TOOL|REFUSED/);
    check('  … nor shown to the Admin', (await row(admin.token)) ?? null, null);
    await openToVisitors(owner.token, A, ab);
    const reopened = await row(owner.token);
    check('opened on purpose: open, and settled', [reopened.openToVisitors, reopened.needsReview], [true, false]);
  } finally {
    await rt.stop();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await run(await seed());
  await done();
}
