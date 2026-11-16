// The Settings section list (CLEAN-228, User Story 1).
//
//   node specs/031-agent-overview-redesign/e2e/nav.mjs
//
// Eleven one-line rows in the new order under three headings, narrow and
// fully visible on a 1280×720 screen; counts that are shown or absent, never
// a false zero; the selected row announced as current; every address that
// opened a section before still opens it; the keyboard reaches and opens a
// section; and on a phone the list is one sideways row with no headings.
// Changes nothing.
//
// Needs: API :3333 (after seed.mjs), admin :3001.
import {
  AGENTS,
  SECTION_ORDER,
  adminPage,
  api,
  check,
  done,
  hook,
  inViewport,
  launch,
  noSidewaysScroll,
  openSettings,
  section,
  shot,
  until,
} from './lib.mjs';

const agent = AGENTS.off;
const GROUPS = ['configure', 'data', 'observe'];
/** The first row under each heading. */
const OPENS = { configure: 'knowledge', data: 'files', observe: 'logs' };
const COUNTED = ['knowledge', 'a2a', 'channels', 'secrets', 'files'];
/** `?tab=` value → the row that must end up current. */
const ADDRESSES = [
  ...SECTION_ORDER.map((value) => [value, value]),
  ['peers', 'a2a'],
  ['settings', 'overview'],
];

const row = (page, value) => page.locator(`[data-section-nav] [data-section="${value}"]`).first();
const current = (page) =>
  page
    .locator('[data-section-nav] [data-section][aria-current="page"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-section')));
const focused = (page) => page.evaluate(() => document.activeElement?.getAttribute('data-section') ?? null);

/** Every row's box and text, plus the list's own box and scroll sizes. */
const measure = (page) =>
  page.evaluate(() => {
    const nav = document.querySelector('[data-section-nav]');
    const box = nav.getBoundingClientRect();
    return {
      role: nav.getAttribute('role'),
      orientation: nav.getAttribute('aria-orientation'),
      width: box.width,
      height: box.height,
      bottom: box.bottom,
      scrollHeight: nav.scrollHeight,
      clientHeight: nav.clientHeight,
      scrollWidth: nav.scrollWidth,
      clientWidth: nav.clientWidth,
      // Rows and headings in document order, as one list.
      items: [...nav.querySelectorAll('[data-section], [data-section-group]')].map((el) => {
        const r = el.getBoundingClientRect();
        const count = el.querySelector('[data-section-count]');
        return {
          section: el.getAttribute('data-section'),
          group: el.getAttribute('data-section-group'),
          role: el.getAttribute('role'),
          top: r.top,
          bottom: r.bottom,
          height: r.height,
          count: count ? (count.textContent ?? '').trim() : null,
          text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
        };
      }),
    };
  });

section('Preconditions');
check((await api(`/agents/${agent}`)).status === 200, 'limits-off exists (run seed.mjs first)');

const browser = await launch();
try {
  const page = await adminPage(browser, { width: 1280, height: 720 });

  section('Eleven rows, three headings');
  await openSettings(page, agent);
  const list = await measure(page);
  const rows = list.items.filter((i) => i.section);
  const headings = list.items.filter((i) => i.group);
  check(rows.length === 11, `the list has eleven rows (${rows.length})`);
  check(
    rows.map((r) => r.section).join(',') === SECTION_ORDER.join(','),
    `in the new order (${rows.map((r) => r.section).join(', ')})`,
  );
  check(
    headings.map((h) => h.group).join(',') === GROUPS.join(','),
    `under three headings: Configure, Data, Observe (${headings.map((h) => h.group).join(', ')})`,
  );
  const order = list.items.map((i) => i.section ?? `#${i.group}`);
  check(order[0] === 'overview', 'Overview stands alone above the first heading');
  check(
    GROUPS.every((g) => order[order.indexOf(`#${g}`) + 1] === OPENS[g]),
    'each heading sits right above the first row of its group',
  );
  check(list.role === 'tablist' && rows.every((r) => r.role === 'tab'), 'the list is a tab list of tabs');
  check(list.orientation === 'vertical', `announced as vertical (${list.orientation})`);

  section('Compact, and all of it on a 1280×720 screen');
  const tallest = Math.max(...rows.map((r) => r.height));
  check(tallest <= 36, `every row is at most 36 px high (tallest ${tallest.toFixed(1)})`);
  // A name and a count are a couple of words; a description is a sentence.
  const wordy = rows.filter((r) => r.text.length > 24);
  check(wordy.length === 0, `and carries a name and a count, no description (${wordy.map((r) => r.text).join(' | ') || 'none does'})`);
  check(list.width <= 200, `the list is at most 200 px wide (${list.width.toFixed(0)})`);
  check(list.height <= 480, `and at most 480 px high (${list.height.toFixed(0)})`);
  check(list.scrollHeight <= list.clientHeight, 'the list has nothing to scroll');
  check(
    list.items.every((i) => i.top >= 0 && i.bottom <= 720),
    'every row and heading is inside the screen',
  );
  await shot(page, 'nav-1280x720');

  section('Counts');
  const uncounted = rows.filter((r) => !COUNTED.includes(r.section) && r.count !== null);
  check(uncounted.length === 0, `only sections that hold things carry a count (${uncounted.map((r) => r.section).join(', ') || 'none else'})`);
  const shown = rows.filter((r) => r.count !== null);
  check(
    shown.every((r) => /^\d+$/.test(r.count)),
    `a count that is shown is a whole number (${shown.map((r) => `${r.section} ${r.count}`).join(', ') || 'none shown'})`,
  );
  const channels = await api(`/agents/${agent}/channels`);
  if (channels.status === 200 && Array.isArray(channels.body)) {
    const count = await until(async () => (await measure(page)).items.find((i) => i.section === 'channels')?.count, {
      timeout: 8000,
    });
    check(Number(count) === channels.body.length, `Channels shows what the API has (${count} vs ${channels.body.length})`);
  } else {
    check(false, `GET /agents/:id/channels did not answer with a list (${channels.status})`);
  }

  section('A count that cannot be known');
  // The two requests behind Secrets and Channels fail; the others do not.
  const broken = new RegExp(`/agents/${agent}/(secrets|channels)(\\?.*)?$`);
  await page.route(broken, (route) =>
    route.request().method() === 'GET' ? route.fulfill({ status: 500, body: '{}' }) : route.continue(),
  );
  await openSettings(page, agent);
  // Give the counts that can load the time to arrive, then read once.
  await until(async () => (await measure(page)).items.some((i) => i.section === 'files' && i.count !== null), {
    timeout: 8000,
  });
  const after = (await measure(page)).items;
  const secretsRow = after.find((i) => i.section === 'secrets');
  const channelsRow = after.find((i) => i.section === 'channels');
  check(secretsRow?.count === null, `Secrets shows no number rather than a zero (${secretsRow?.count ?? 'absent'})`);
  check(channelsRow?.count === null, `and so does Channels (${channelsRow?.count ?? 'absent'})`);
  check(
    after.find((i) => i.section === 'files')?.count !== null,
    'while Files, whose source answered, still has its count',
  );
  await page.unroute(broken);

  section('The selected row');
  await openSettings(page, agent, 'secrets');
  check((await current(page)).join(',') === 'secrets', 'exactly one row is the current one');
  check((await row(page, 'secrets').getAttribute('aria-selected')) === 'true', 'and it is the selected tab');
  check((await row(page, 'files').getAttribute('aria-selected')) !== 'true', 'another row is not');
  const look = (value) =>
    row(page, value).evaluate((el) => {
      const s = getComputedStyle(el);
      return { weight: Number(s.fontWeight), shadow: s.boxShadow, border: s.borderLeftWidth + s.borderLeftStyle };
    });
  const [on, off] = [await look('secrets'), await look('files')];
  check(
    on.weight > off.weight || on.shadow !== off.shadow || on.border !== off.border,
    'it differs by weight or a marker, not by colour alone',
  );

  section('Choosing a section');
  await row(page, 'env').click();
  check(await until(async () => (await current(page)).join(',') === 'env', { timeout: 6000 }), 'a click opens it');
  check(page.url().includes('tab=env'), `and the address says so (${new URL(page.url()).search})`);

  section('Every address that worked before');
  for (const [value, expected] of ADDRESSES) {
    await openSettings(page, agent, value);
    const got = await until(async () => ((await current(page)).join(',') === expected ? expected : null), {
      timeout: 6000,
    });
    check(got === expected, `?tab=${value} opens ${expected}${got ? '' : ` (current: ${(await current(page)).join(',') || 'none'})`}`);
  }

  section('Keyboard only');
  await openSettings(page, agent);
  await row(page, 'overview').focus();
  check((await focused(page)) === 'overview', 'the first row takes focus');
  // Arrow keys walk a tab list; a list of plain buttons is walked with Tab.
  // Either way: every row, in order, without a pointer.
  const walked = ['overview'];
  let key = 'ArrowDown';
  for (let i = 1; i < SECTION_ORDER.length; i++) {
    const before = await focused(page);
    await page.keyboard.press(key);
    if ((await focused(page)) === before && key === 'ArrowDown') {
      key = 'Tab';
      await page.keyboard.press(key);
    }
    walked.push(await focused(page));
  }
  check(walked.join(',') === SECTION_ORDER.join(','), `${key} reaches every row in order (${walked.join(', ')})`);
  const mark = await page.evaluate(() => {
    const el = document.activeElement;
    const s = getComputedStyle(el);
    return {
      keyboard: el.matches(':focus-visible'),
      outline: s.outlineStyle !== 'none' && s.outlineWidth !== '0px',
      shadow: s.boxShadow !== 'none',
    };
  });
  check(mark.keyboard && (mark.outline || mark.shadow), 'the focused row has a visible focus mark');
  check((await current(page)).join(',') === 'overview', 'walking the list opens nothing by itself');
  await page.keyboard.press('Enter');
  check(await until(async () => (await current(page)).join(',') === 'paddock', { timeout: 6000 }), 'Enter opens the focused section');
  check(page.url().includes('tab=paddock'), 'and the address follows');

  section('The list stays while the section scrolls');
  await openSettings(page, agent);
  await hook(page, 'overview').first().waitFor({ state: 'visible', timeout: 20000 });
  await hook(page, 'block', 'danger').first().scrollIntoViewIfNeeded();
  check(await inViewport(hook(page, 'block', 'danger')), 'the end of Overview is scrolled into view');
  check(
    (await inViewport(row(page, 'overview'))) && (await inViewport(row(page, 'paddock'))),
    'and the first and the last row of the list are still on screen',
  );
  await page.context().close();

  section('A phone-width screen');
  const phone = await adminPage(browser, { width: 390, height: 844 });
  await openSettings(phone, agent);
  const narrow = await measure(phone);
  const narrowRows = narrow.items.filter((i) => i.section);
  check(narrowRows.length === 11, `still eleven rows (${narrowRows.length})`);
  check(narrow.items.filter((i) => i.group).length === 0, 'the group headings are gone');
  check(narrow.orientation === 'horizontal', `the list is announced as horizontal (${narrow.orientation})`);
  const tops = narrowRows.map((r) => Math.round(r.top));
  check(Math.max(...tops) - Math.min(...tops) <= 2, 'all rows sit on one line');
  check(narrow.scrollWidth > narrow.clientWidth, 'which scrolls sideways inside the list');
  check(narrow.height <= 56, `and takes one row of height (${narrow.height.toFixed(0)} px)`);
  check(await noSidewaysScroll(phone), 'the page itself does not scroll sideways');
  const content = await hook(phone, 'overview').first().boundingBox();
  check(content !== null && content.width >= 390 - 48, `the content takes the full width (${content?.width.toFixed(0)} of 390)`);
  await row(phone, 'paddock').click();
  check(
    await until(async () => (await current(phone)).join(',') === 'paddock', { timeout: 6000 }),
    'a row at the far end can be scrolled to and opened',
  );
  check(await noSidewaysScroll(phone), 'still with no sideways scroll of the page');
  await shot(phone, 'nav-390');
  await phone.context().close();
} finally {
  await browser.close();
}

done('nav');
