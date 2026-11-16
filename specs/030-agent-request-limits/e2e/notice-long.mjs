// Long waits and the notice that is there before anyone types (CLEAN-224).
//
//   node specs/030-agent-request-limits/e2e/notice-long.mjs
//
// `limits-hour` and `limits-day` were seeded with their windows already full,
// and the API rebuilt its counters from those rows at boot — so nothing here
// waits an hour. Run it soon after seed.mjs + an API start: the hour window
// frees about five minutes after the seed.
//
// Needs: API :3333 (started after seed.mjs), fakeAgent.mjs, app :3000.
import {
  AGENTS,
  APP,
  NOTICE,
  USER,
  WORDS,
  chatOn,
  check,
  countdownSeconds,
  done,
  fake,
  getLoad,
  launch,
  loginAs,
  openPage,
  readNotice,
  section,
  setLimits,
  shot,
  sleep,
  until,
} from './lib.mjs';

section('Preconditions');
check(await fake.up(), 'fake agents are up');
const hourLoad = await getLoad(AGENTS.hour);
const hourLeft = hourLoad?.windows?.[1]?.retryAfterSec ?? 0;
check(hourLeft > 45, `the hour window of limits-hour is still full (${hourLeft} s left) — reseed and restart the API if not`);
const dayLoad = await getLoad(AGENTS.day);
check((dayLoad?.windows?.[2]?.retryAfterSec ?? 0) > 3600, 'the day window of limits-day is full for more than an hour');

const browser = await launch();
try {
  const page = await openPage(browser, { lang: 'en' });
  await loginAs(page, USER);

  section('An hour limit that is already full');
  await page.goto(`${APP}/agents/${AGENTS.hour}`, { waitUntil: 'networkidle' });
  const chat = chatOn(page);
  await chat.ready();
  const onOpen = await until(() => readNotice(page), { timeout: 8000 });
  check(onOpen?.state === 'waiting', 'the notice is there on opening, before anything is typed');
  check(onOpen?.window === 'hour', `it names the hour window (${onOpen?.window})`);
  check((await chat.draft()) === '', 'the field is empty: nobody had to write a message to find out');
  const shown = countdownSeconds(onOpen?.time);
  check(shown > 0 && Math.abs(shown - hourLeft) < 20, `the countdown matches the real wait (${onOpen?.time} vs ${hourLeft} s)`);
  check(await chat.sendDisabled(), 'Send is unavailable');
  await chat.type('typed while waiting');
  check((await chat.draft()) === 'typed while waiting', 'the field can be typed into');
  await shot(page, 'notice-hour-on-open');

  section('The operator raises the limit');
  check((await setLimits(AGENTS.hour, { perHour: 50 })).status === 200, 'limit raised to 50 per hour');
  const cleared = await until(async () => (await readNotice(page)) === null, { timeout: 6000 });
  check(cleared, 'the notice leaves without a reload');
  check(!(await chat.sendDisabled()), 'Send works');
  check((await chat.draft()) === 'typed while waiting', 'what was typed is still there');
  check(await chat.say('typed while waiting'), 'and the message goes through');

  section('The operator lowers it again');
  check((await setLimits(AGENTS.hour, { perHour: 5 })).status === 200, 'limit back to 5 per hour');
  const back = await until(() => readNotice(page), { timeout: 6000 });
  check(back?.state === 'waiting', 'the notice returns without a reload and without a send');
  check(back?.window === 'hour', 'for the hour window');

  section('A day limit: the time of day, no running clock');
  await page.goto(`${APP}/agents/${AGENTS.day}`, { waitUntil: 'networkidle' });
  await chatOn(page).ready();
  const day = await until(() => readNotice(page), { timeout: 8000 });
  check(day?.window === 'day', `the notice names the day window (${day?.window})`);
  check(WORDS.retryAfter.test(day?.text ?? ''), `it says "Try again after …" ("${day?.text}")`);
  check(/\d{1,2}:\d{2}/.test(day?.time ?? ''), `with a time of day (${day?.time})`);
  await sleep(2500);
  check((await readNotice(page))?.time === day?.time, 'which does not tick');
  await shot(page, 'notice-day');

  section('Phone width');
  await page.setViewportSize({ width: 390, height: 780 });
  await sleep(400);
  const box = await page.locator(NOTICE).first().boundingBox();
  const fieldBox = await chatOn(page).field.boundingBox();
  check(box && box.height <= 76, `the notice fits in two lines (${Math.round(box?.height ?? 0)} px high)`);
  check(
    fieldBox && fieldBox.y + fieldBox.height <= 780 && fieldBox.y >= 0,
    'and the message field is still on screen',
  );
  check(
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    'with no sideways scroll',
  );
  await shot(page, 'notice-day-phone');
  await page.context().close();

  section('Past midnight: "tomorrow"');
  const late = await openPage(browser, { lang: 'en' });
  // The browser believes it is 23:00; a wait of about three hours ends on
  // the next day. The wait itself comes from the server as a duration.
  const eleven = new Date();
  eleven.setHours(23, 0, 0, 0);
  await late.clock.install({ time: eleven });
  await loginAs(late, USER);
  await late.goto(`${APP}/agents/${AGENTS.day}`, { waitUntil: 'networkidle' });
  await chatOn(late).ready();
  const tomorrow = await until(() => readNotice(late), { timeout: 8000 });
  check(WORDS.tomorrow.test(tomorrow?.text ?? ''), `the notice says "tomorrow" ("${tomorrow?.text}")`);
  await shot(late, 'notice-tomorrow');
  await late.context().close();

  section('Reduced motion');
  const calm = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 860 } });
  await calm.addCookies([{ name: 'i18n_redirected', value: 'en', url: APP }]);
  const still = await calm.newPage();
  await loginAs(still, USER);
  await still.goto(`${APP}/agents/${AGENTS.day}`, { waitUntil: 'networkidle' });
  await until(() => readNotice(still), { timeout: 8000 });
  const animated = await still.locator(`${NOTICE}, ${NOTICE} *`).evaluateAll((els) =>
    els.some((el) => {
      const s = getComputedStyle(el);
      const before = getComputedStyle(el, '::before');
      const after = getComputedStyle(el, '::after');
      const moving = (c) => c.animationName !== 'none' && c.display !== 'none' && c.visibility !== 'hidden';
      return moving(s) || moving(before) || moving(after);
    }),
  );
  check(!animated, 'nothing in the notice is animated when the reader asked for less motion');
  await calm.close();
} finally {
  await browser.close();
  // Leave the hour agent as the seed made it.
  await setLimits(AGENTS.hour, { perHour: 5 });
}

done('notice-long');
