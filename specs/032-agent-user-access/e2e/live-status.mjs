// The admin console still follows an agent live, now that the public status
// stream carries status facts only (CLEAN-232).
//
//   node specs/032-agent-user-access/e2e/live-status.mjs
//
// The Owner opens an agent in the admin console and leaves the page alone.
// Then, from outside the page:
//
//   1. the fake runtime drops that agent's socket: the header says
//      "runtime offline" (hub connectivity, a fact the stream carries);
//   2. the agent is renamed through the API, and the socket comes back: the
//      frame of that reconnect has a later `updatedAt` than the record the
//      page holds, so the page reads the row through GET /agents/:id and the
//      new name is on screen, with no reload. The name is not in the stream.
//
// The name is put back at the end.
//
// Needs: API :3333 (after seed.mjs), admin :3001, fakeRuntime.mjs.
import { ADMIN, AGENTS, OWNER, api, check, done, fake, launch, loginAs, section, until, watchedPage } from './lib.mjs';

const agent = AGENTS.a;
const renamed = `${agent.name}-live`;

section('Preconditions');
check((await fake.health())?.connected?.includes(agent.id), `the fake runtime holds ${agent.name}`);

const browser = await launch();
const requests = [];
try {
  // The local stack has no bucket: the workspace's counts of files, secrets and
  // channels answer 400 (the same allowance owner-only.mjs makes).
  const NO_BUCKET = [{ status: 400, url: /\/agents\/[^/]+\/(env|channels|files|secrets)(\?|\/|$)/ }];
  const { page, problems } = await watchedPage(browser, { width: 1440, height: 900, expected: NO_BUCKET });
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (req.method() === 'GET' && /^\/agents(\/|$)/.test(url.pathname)) requests.push(url.pathname);
  });
  await loginAs(page, OWNER, ADMIN);
  await page.goto(`${ADMIN}/agents/${agent.id}`, { waitUntil: 'networkidle' });
  const body = () => page.locator('body').innerText();

  section('The page as it opens');
  check((await body()).includes(agent.name), `the header names ${agent.name}`);
  check(requests.some((p) => p === '/agents/status/stream'), 'the page opened the public status stream');
  check(!(await body()).includes('runtime offline'), 'it does not say "runtime offline"');

  section('The runtime drops off the hub');
  await fake.disconnect(agent.id);
  const offline = await until(async () => (await body()).includes('runtime offline'), { timeout: 15000, every: 250 });
  check(Boolean(offline), 'the header says "runtime offline", with no reload');

  section('The agent is renamed elsewhere, and the runtime comes back');
  const before = requests.length;
  const put = await api(`/agents/${agent.id}`, { method: 'PUT', body: { name: renamed }, as: OWNER });
  check(put.status >= 200 && put.status < 300, `PUT /agents/<alpha> renames it (${put.status})`);
  await fake.connect(agent.id);
  const online = await until(async () => !(await body()).includes('runtime offline'), { timeout: 15000, every: 250 });
  check(Boolean(online), '"runtime offline" is gone again');
  const shown = await until(async () => (await body()).includes(renamed), { timeout: 15000, every: 250 });
  check(Boolean(shown), `the new name is on screen (${renamed}), which the stream does not carry`);
  const fetched = requests.slice(before).filter((p) => p === `/agents/${agent.id}`);
  check(fetched.length >= 1, `because the page read the row through GET /agents/${'<alpha>'} (${fetched.length} request${fetched.length === 1 ? '' : 's'})`);
  check(problems.length === 0, `no console error, no unexpected failed request${problems.length ? `: ${problems.join(' | ')}` : ''}`);
} finally {
  await api(`/agents/${agent.id}`, { method: 'PUT', body: { name: agent.name }, as: OWNER });
  await fake.connect(agent.id);
  await browser.close().catch(() => undefined);
  section('Afterwards');
  const back = (await api(`/agents/${agent.id}`, { as: OWNER })).body;
  check(back?.name === agent.name, `the agent is called ${agent.name} again`);
}

done('live-status');
