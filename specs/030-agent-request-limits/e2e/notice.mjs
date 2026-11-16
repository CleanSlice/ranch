// The limit notice on the landing chat (CLEAN-224, User Story 2).
//
//   node specs/030-agent-request-limits/e2e/notice.mjs
//
// The visitor is anonymous and the agent is `limits-minute` (2 per minute) —
// the only seeded agent that allows the landing origin, so the landing page
// shows it. Two real waits of up to a minute each: this is the one script
// that watches a countdown run out.
//
// Needs: API :3333 (after seed.mjs), fakeAgent.mjs, app :3000.
import {
  AGENTS,
  NOTICE,
  WORDS,
  check,
  countdownSeconds,
  done,
  fake,
  fillUp,
  landingChat,
  launch,
  minuteRoom,
  openPage,
  readNotice,
  section,
  sendAnonymous,
  shot,
  sleep,
  until,
} from './lib.mjs';

const agent = AGENTS.minute;
const DRAFT = 'my third message — keep me';

section('Preconditions');
check(await fake.up(), 'fake agents are up');
await fake.reset();
check(await minuteRoom(agent), 'the minute window is empty');

const browser = await launch();
try {
  const page = await openPage(browser, { lang: 'en' });
  const chat = await landingChat(page);

  section('Under the limit');
  check(await chat.say('one'), 'the first message is answered');
  check(await chat.say('two'), 'the second message is answered');
  check((await readNotice(page)) === null, 'no notice while there is room');
  check(!(await chat.sendDisabled()) || (await chat.draft()) === '', 'Send is not held back by a limit');

  section('The third message is refused');
  await chat.type(DRAFT);
  await chat.send();
  const notice = await until(() => readNotice(page), { timeout: 5000 });
  check(notice, 'a notice appears on the composer');
  await shot(page, 'notice-waiting');
  check(notice?.state === 'waiting', `it is waiting (${notice?.state})`);
  check(notice?.window === 'minute', `it names the minute window (${notice?.window})`);
  check(WORDS.reached.test(notice?.text ?? ''), 'it says the agent has reached its message limit');
  check(WORDS.retryIn.test(notice?.text ?? ''), 'it says when to try again');
  const firstWait = countdownSeconds(notice?.time);
  check(firstWait > 0 && firstWait <= 60, `the wait is a countdown within the minute (${notice?.time})`);
  check(!/\b2\b.*per|limit of|из 2/i.test(notice?.text ?? ''), 'it does not reveal the limit');
  check((await chat.draft()) === DRAFT, 'the text is still in the field');
  check((await chat.userCount()) === 2, 'the refused message is not shown as sent');
  check(
    (await chat.scope.locator('[data-delivery="failed"], [data-delivery="rejected"]').count()) === 0,
    'nor as "not delivered"',
  );
  check(await chat.sendDisabled(), 'Send is visibly unavailable');
  const describedBy = await chat.sendButton.getAttribute('aria-describedby');
  check(
    Boolean(describedBy) && (await page.locator(`[id="${describedBy}"]`).count()) > 0,
    'Send is described by the notice',
  );
  const role = await page.locator(NOTICE).first().getAttribute('role');
  const liveRole =
    role ?? (await page.locator(`${NOTICE} [role="status"]`).first().getAttribute('role').catch(() => null));
  check(liveRole === 'status', 'the notice is a status, not an alert');
  await sleep(400);
  check((await fake.received(agent)).length === 2, 'the agent received only the two accepted messages');

  section('What the person can still do');
  await chat.type(`${DRAFT}, edited`);
  check((await chat.draft()) === `${DRAFT}, edited`, 'the field stays editable');
  await chat.enter();
  const nudged = await until(
    async () => (await page.locator(`${NOTICE}[data-limit-nudge]`).count()) > 0,
    { timeout: 1500, every: 50 },
  );
  check(nudged, 'Enter draws attention to the notice instead of doing nothing');
  await sleep(300);
  check((await chat.userCount()) === 2, 'Enter sent nothing');
  check((await fake.received(agent)).length === 2, 'and nothing reached the agent');
  check((await chat.draft()) === `${DRAFT}, edited`, 'the text is still there after Enter');
  const tick1 = (await readNotice(page))?.time;
  await sleep(2200);
  const tick2 = (await readNotice(page))?.time;
  check(countdownSeconds(tick2) < countdownSeconds(tick1), `the countdown runs (${tick1} → ${tick2})`);

  section('A reload and a second tab');
  const second = await page.context().newPage();
  const chatB = await landingChat(second);
  await chatB.type('from another tab');
  await chatB.send();
  const noticeB = await until(() => readNotice(second), { timeout: 5000 });
  check(noticeB?.state === 'waiting', 'a second tab is refused too');
  check(
    countdownSeconds(noticeB?.time) <= countdownSeconds(tick1),
    `it shows the remaining wait, not a fresh one (${noticeB?.time})`,
  );
  await second.reload({ waitUntil: 'networkidle' });
  await second.locator('#land-tab-chat').first().click();
  await chatB.ready();
  await chatB.type('after a reload');
  await chatB.send();
  const noticeC = await until(() => readNotice(second), { timeout: 5000 });
  check(noticeC?.state === 'waiting', 'a reload does not hand out a fresh allowance');
  await second.close();

  section('The wait ends');
  const ready = await until(async () => (await readNotice(page))?.state === 'ready', {
    timeout: 70000,
    every: 200,
  });
  check(ready, 'the notice says the message can be sent');
  const readyText = (await readNotice(page))?.text ?? '';
  check(WORDS.ready.test(readyText), `in words ("${readyText}")`);
  await shot(page, 'notice-ready');
  check((await fake.received(agent)).length === 2, 'nothing was sent by itself');
  check((await chat.draft()) === `${DRAFT}, edited`, 'the text is still in the field');

  section('Someone else takes the freed room first');
  // Other senders use up whatever room the window has just regained.
  const stolen = await sendAnonymous(agent, 'someone else');
  check(stolen.status === 200, `another sender is accepted (${stolen.status})`);
  check(await fillUp(agent), 'and the window is full again');
  await until(async () => (await readNotice(page)) === null, { timeout: 5000 });
  await chat.send();
  const again = await until(async () => {
    const n = await readNotice(page);
    return n?.state === 'waiting' ? n : null;
  }, { timeout: 5000 });
  check(again, 'the send is refused again and the notice returns');
  check(WORDS.reached.test(again?.text ?? ''), 'in the same words');
  check(countdownSeconds(again?.time) > 0, `with a new wait (${again?.time})`);
  check((await chat.draft()) === `${DRAFT}, edited`, 'the text is still in the field');
  check((await chat.scope.locator('[data-delivery="failed"]').count()) === 0, 'and it does not read as a failure');

  section('Now it goes through');
  const gone = await until(async () => (await readNotice(page)) === null, { timeout: 70000, every: 250 });
  check(gone, 'the notice leaves by itself, with no reload');
  check(!(await chat.sendDisabled()), 'Send works again');
  const before = await chat.agentCount();
  await chat.send();
  const answered = await until(async () => (await chat.agentCount()) > before, { timeout: 15000 });
  check(answered, 'one press delivers the message and the agent answers');
  check((await chat.draft()) === '', 'the field is empty after it was sent');
  const got = await fake.received(agent);
  check(
    got.some((m) => String(m.text).includes('edited')),
    'the agent received the text exactly as it was left in the field',
  );
  await shot(page, 'notice-delivered');
} finally {
  await browser.close();
}

done('notice');
