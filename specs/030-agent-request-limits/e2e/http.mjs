// Request limits over HTTP (CLEAN-224, User Story 4): an integration is
// refused in a way it can act on.
//
//   node specs/030-agent-request-limits/e2e/http.mjs
//
// Needs the API on API_URL (:3333) after seed.mjs, and fakeAgent.mjs running.
// No browser. Uses `limits-minute` (2 per minute) and leaves its minute window
// full, so run it last or wait a minute before a script that needs room.
import { AGENTS, OWNER, USER, api, check, done, fake, section, sleep, until } from './lib.mjs';

const agent = AGENTS.minute;
const msg = (path, opts) => api(`/api/agent/${agent}/${path}`, { method: 'POST', body: { text: 'ping' }, ...opts });

section('Preconditions');
check(await fake.up(), 'fake agents are up');
await fake.reset();
// Start from an empty minute window, whatever ran before.
const room = await until(
  async () => {
    const load = await api(`/agents/${agent}/load`);
    return load.status === 200 && load.body.windows[0].used === 0 ? load.body : null;
  },
  { timeout: 65000, every: 1000 },
);
check(room, 'the minute window of limits-minute is empty');

section('Under the limit');
const first = await msg('message', { as: null });
check(first.status === 200, `anonymous send is accepted (${first.status})`);
check(
  !first.headers.get('x-ratelimit-remaining'),
  'an anonymous caller is told nothing about what is left',
);

const second = await msg('message/sync', { as: USER });
check(second.status === 200, `signed-in sync send is accepted (${second.status})`);
check(String(second.body?.text ?? '').startsWith('echo:'), 'the sync route returns the agent answer');
check(second.headers.get('x-ratelimit-remaining') === '0', 'a caller with a credential is told how much is left (0)');
const reset = Number(second.headers.get('x-ratelimit-reset'));
check(reset > 0 && reset <= 60, `…and when room comes back (${reset} s)`);

section('At the limit');
for (const [path, who, label] of [
  ['message', null, 'anonymous, fire-and-forget'],
  ['message/sync', null, 'anonymous, synchronous'],
  ['message/sync', USER, 'signed-in user, synchronous'],
]) {
  const started = Date.now();
  const refused = await msg(path, { as: who });
  const took = Date.now() - started;
  check(refused.status === 429, `${label}: 429 (${refused.status})`);
  check(took < 1000, `${label}: answered at once (${took} ms), not held open`);
  const retryAfter = Number(refused.headers.get('retry-after'));
  check(retryAfter > 0 && retryAfter <= 60, `${label}: Retry-After ${retryAfter} s`);
  const body = refused.raw?.data ?? refused.raw ?? {};
  const code = body.code ?? body.error?.code ?? body.message?.code;
  check(
    JSON.stringify(refused.raw).includes('RATE_LIMITED'),
    `${label}: the body names RATE_LIMITED${code ? '' : ' (somewhere in the envelope)'}`,
  );
  check(
    !refused.headers.get('x-ratelimit-remaining'),
    `${label}: no pacing header on a refusal`,
  );
}

section('What reached the agent');
await sleep(300);
const got = await fake.received(agent);
check(got.length === 2, `the agent received exactly the two accepted requests (${got.length})`);

section('Who is not limited');
const asOwner = await msg('message/sync', { as: OWNER });
check(asOwner.status === 200, `an Owner still gets through an agent at its limit (${asOwner.status})`);
const load = (await api(`/agents/${agent}/load`)).body;
check(load.windows[0].used === 2, `the Owner's request used no allowance (used ${load.windows[0].used} of 2)`);
check(load.exemptLastHour >= 1, 'and is shown as traffic that is not counted');
check(load.refused.lastHour >= 3, `the refusals are counted (${load.refused.lastHour})`);

section('Limits off');
for (let i = 0; i < 25; i++) {
  const res = await api(`/api/agent/${AGENTS.off}/message`, { method: 'POST', body: { text: 'ping' }, as: null });
  if (res.status !== 200) {
    check(false, `limits-off refused request ${i + 1} with ${res.status}`);
    break;
  }
  if (i === 24) check(true, '25 requests in a row to limits-off, none refused');
}

done('http');
