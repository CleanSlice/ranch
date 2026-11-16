// The limit notice in the app console chat (CLEAN-224, User Story 2).
//
//   node specs/030-agent-request-limits/e2e/notice-app.mjs
//
// A signed-in User is the agent's audience and is limited like any visitor;
// an Owner is not. English and Russian. No real waits: this script only needs
// the refusal, so it fills the minute window first.
//
// Needs: API :3333 (after seed.mjs), fakeAgent.mjs, app :3000.
import {
  AGENTS,
  APP,
  OWNER,
  USER,
  WORDS,
  chatOn,
  check,
  countdownSeconds,
  done,
  fake,
  fillUp,
  launch,
  loginAs,
  openPage,
  readNotice,
  section,
  shot,
  sleep,
  until,
} from './lib.mjs';

const agent = AGENTS.minute;

section('Preconditions');
check(await fake.up(), 'fake agents are up');
check(await fillUp(agent), 'the minute window of limits-minute is full');
await fake.reset();

async function refusedAs(browser, lang) {
  const page = await openPage(browser, { lang });
  await loginAs(page, USER);
  await page.goto(`${APP}/agents/${agent}`, { waitUntil: 'networkidle' });
  const chat = chatOn(page);
  await chat.ready();
  // Only the minute window is full: nothing is announced ahead of a send.
  await sleep(1500);
  check((await readNotice(page)) === null, `[${lang}] no notice before sending — a minute window is not announced`);
  const before = await chat.userCount();
  await chat.type('hello from the console');
  await chat.send();
  const notice = await until(() => readNotice(page), { timeout: 5000 });
  check(notice?.state === 'waiting', `[${lang}] a signed-in User is refused with the notice`);
  check(countdownSeconds(notice?.time) > 0, `[${lang}] with a countdown (${notice?.time})`);
  check((await chat.draft()) === 'hello from the console', `[${lang}] the text stays in the field`);
  check((await chat.userCount()) === before, `[${lang}] nothing is added to the conversation`);
  check(await chat.sendDisabled(), `[${lang}] Send is unavailable`);
  await shot(page, `notice-app-${lang}`);
  return { page, notice };
}

const browser = await launch();
try {
  section('English');
  const en = await refusedAs(browser, 'en');
  check(
    /This agent has reached its message limit\./.test(en.notice?.text ?? ''),
    `the English sentence ("${en.notice?.text}")`,
  );
  check(/Try again in \d+:\d{2}\./.test(en.notice?.text ?? ''), 'and "Try again in m:ss."');
  await en.page.context().close();

  section('Russian');
  const ru = await refusedAs(browser, 'ru');
  check(
    /У этого агента достигнут лимит сообщений\./.test(ru.notice?.text ?? ''),
    `the Russian sentence ("${ru.notice?.text}")`,
  );
  check(/Попробуйте через \d+:\d{2}\./.test(ru.notice?.text ?? ''), 'and «Попробуйте через m:ss.»');
  check(!WORDS.reached.test('') && !/[A-Za-z]{4,}/.test((ru.notice?.text ?? '').replace(/\d|:/g, '')), 'no English left in it');
  await ru.page.context().close();

  section('An Owner in the app console');
  const page = await openPage(browser, { lang: 'en' });
  await loginAs(page, OWNER);
  await page.goto(`${APP}/agents/${agent}`, { waitUntil: 'networkidle' });
  const chat = chatOn(page);
  await chat.ready();
  check(await chat.say('owner checking in'), 'the Owner is answered by an agent that is at its limit');
  check((await readNotice(page)) === null, 'and sees no notice');
  check(
    (await fake.received(agent)).some((m) => m.text === 'owner checking in'),
    'the message reached the agent',
  );
  await page.context().close();
} finally {
  await browser.close();
}

done('notice-app');
