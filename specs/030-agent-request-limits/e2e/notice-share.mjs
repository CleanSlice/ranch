// The limit notice on the share page (CLEAN-224, User Story 2).
//
//   node specs/030-agent-request-limits/e2e/notice-share.mjs
//
// A share-link visitor needs no special handling: they draw on the agent's
// allowance like everyone else. `limits-share` is private with a share link
// and no limits; this script sets 1 per minute on it, checks the notice, and
// switches the limits off again.
//
// Needs: API :3333 (after seed.mjs), fakeAgent.mjs, app :3000.
import {
  AGENTS,
  APP,
  WORDS,
  api,
  chatOn,
  check,
  countdownSeconds,
  done,
  fake,
  launch,
  minuteRoom,
  openPage,
  readNotice,
  section,
  setLimits,
  shot,
  until,
} from './lib.mjs';

const agent = AGENTS.share;

section('Preconditions');
check(await fake.up(), 'fake agents are up');
await fake.reset();
const link = await api(`/agents/${agent}/share-link`);
const token = link.body?.token;
check(link.status === 200 && typeof token === 'string' && token.startsWith('sl_'), 'the agent has an active share link');
check((await setLimits(agent, { perMinute: 1 })).status === 200, 'a private agent takes limits (1 per minute)');
check(await minuteRoom(agent), 'its minute window is empty');

const browser = await launch();
try {
  const page = await openPage(browser, { lang: 'en' });
  await page.goto(`${APP}/share?token=${encodeURIComponent(token)}`, { waitUntil: 'networkidle' });
  const chat = chatOn(page);
  await chat.ready();

  section('Under the limit');
  check(await chat.say('hello through the link'), 'the first message is answered');

  section('At the limit');
  await chat.type('and a second one');
  await chat.send();
  const notice = await until(() => readNotice(page), { timeout: 5000 });
  check(notice?.state === 'waiting', 'the share visitor gets the same notice');
  check(WORDS.reached.test(notice?.text ?? ''), 'it says the agent has reached its message limit');
  check(countdownSeconds(notice?.time) > 0, `with a countdown (${notice?.time})`);
  check((await chat.draft()) === 'and a second one', 'the text stays in the field');
  check((await chat.userCount()) === 1, 'nothing is added to the conversation');
  check(await chat.sendDisabled(), 'Send is unavailable');
  check((await fake.received(agent)).length === 1, 'the agent received one message');
  await shot(page, 'notice-share');

  section('Limits switched off while waiting');
  check((await setLimits(agent, {})).status === 200, 'a private agent may have its limits removed');
  // A minute window is never announced or called off by the hub, so the
  // notice stays until its countdown; what must hold is that the composer is
  // not locked on the countdown alone once the notice is gone.
  const off = await api(`/agents/${agent}/limits/enabled`);
  check(off.body?.enabled === false, 'limits are off again');
} finally {
  await browser.close();
  await setLimits(agent, {});
}

done('notice-share');
