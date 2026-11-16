// The operator's chat with an agent that is at its limit (CLEAN-224).
//
//   node specs/030-agent-request-limits/e2e/operator.mjs
//
// An Owner is never limited — they have to reach the agent to test it and to
// fix it — but they must not conclude it is fine for everybody: a line says
// visitors are being asked to wait.
//
// Needs: API :3333 (started after seed.mjs, hour window of limits-hour still
// full), fakeAgent.mjs, admin :3001.
import {
  ADMIN,
  AGENTS,
  OWNER,
  chatOn,
  check,
  done,
  fake,
  getLoad,
  launch,
  loginAs,
  section,
  shot,
  until,
} from './lib.mjs';

const agent = AGENTS.hour;
const LINE = '[data-visitor-limit-line]';

section('Preconditions');
check(await fake.up(), 'fake agents are up');
await fake.reset();
const left = (await getLoad(agent))?.windows?.[1]?.retryAfterSec ?? 0;
check(left > 30, `the hour window of limits-hour is full (${left} s left) — reseed and restart the API if not`);

const browser = await launch();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 200)));
  await loginAs(page, OWNER, ADMIN);
  await page.goto(`${ADMIN}/agents/${agent}?tab=chat`, { waitUntil: 'networkidle' });
  const chat = chatOn(page);
  await chat.ready();

  section('What the operator is told');
  const line = await until(async () => ((await page.locator(LINE).count()) > 0 ? page.locator(LINE).first() : null), {
    timeout: 8000,
  });
  check(line, 'a line appears above the input');
  const text = ((await line?.textContent()) ?? '').replace(/\s+/g, ' ');
  check(/visitors are being asked to wait/i.test(text), 'it says visitors are being asked to wait');
  check(/your messages are not limited/i.test(text), 'and that the operator is not limited');
  check((await page.locator('[data-limit-notice]').count()) === 0, 'the operator gets no visitor notice');
  await shot(page, 'operator-line');

  section('The operator is not limited');
  check(!(await chat.sendDisabled()) || (await chat.draft()) === '', 'Send is not held back');
  check(await chat.say('operator checking in'), 'the message is answered by the agent');
  check(
    (await fake.received(agent)).some((m) => m.text === 'operator checking in'),
    'it reached the agent',
  );
  check((await chat.scope.locator('[data-delivery="failed"]').count()) === 0, 'nothing is marked as not delivered');
  const load = await getLoad(agent);
  check(load.windows[1].used === load.windows[1].limit, 'and it used none of the visitors’ allowance');

  section('The way to the limits');
  await page.locator('[data-visitor-limit-link]').first().click();
  check(
    await until(async () => page.url().includes('tab=overview') || page.url().includes('visibility-embed'), {
      timeout: 6000,
    }),
    'the link leads to the Visibility & embed card',
  );
  check(
    await until(async () => page.locator('[data-visibility-save]').first().isVisible(), { timeout: 8000 }),
    'where the limits can be changed',
  );
} finally {
  await browser.close();
}

done('operator');
