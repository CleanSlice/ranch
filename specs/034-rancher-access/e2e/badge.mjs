// The assistant badge and its card, and the editor's mark on the abilities
// that stay with an agent's creator (CLEAN-257), in a real browser.
//
//   node specs/034-rancher-access/e2e/badge.mjs
//   node specs/034-rancher-access/e2e/badge.mjs --only app      (app | ru | admin | editor)
//
// Needs the local stack of specs/032-agent-user-access/e2e/lib.mjs (api
// :3333, app :3000, admin :3001) and its seed. No agent runtime: nothing
// here sends a message.
//
// What it sets, through the API as the Owner, before looking. None of it is
// put back: they are plain settings an Owner changes back in the console.
// The agent lists of the seed are left alone; who has the assistant is its
// own setting, and the role settings below switch it on for everybody.
//
//   Users        Standard
//   Admins       Standard, so an Admin has abilities that are not included
//   first User   no setting of their own: follows the role
//   second User  a custom pick: restart_agent, get_agent_logs, list_agents
//
// Screenshots go to SHOTS_DIR (default: a folder in the system temp
// directory), never into the repo. Prints no secrets.
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  ADMIN,
  ADMIN_USER,
  AGENTS,
  APP,
  OWNER,
  USER,
  USER2,
  WIDTHS,
  api,
  arg,
  check,
  done,
  launch,
  loginAs,
  section,
  until,
  watchedPage,
} from '../../032-agent-user-access/e2e/lib.mjs';

const SHOTS = resolve(process.env.SHOTS_DIR || resolve(tmpdir(), 'ranch-257-shots'));
mkdirSync(SHOTS, { recursive: true });
const only = arg('only');
const HEIGHTS = { 390: 844, 1440: 900 };
/** The seven tools that refuse a person who did not create the agent. */
const CREATOR_ONLY = [
  'get_agent_env',
  'get_agent_logs',
  'import_agent_from_card',
  'import_external_agent',
  'list_agent_mcps',
  'set_agent_channels',
  'set_agent_visibility',
];

const shot = async (page, name) => {
  await page.screenshot({ path: resolve(SHOTS, `${name}.png`) });
};

// ------------------------------------------------------------------ set-up

/** The 030 helper signs in as its own Owner unless told who. */
const asOwner = (path, options = {}) => api(path, { as: OWNER, ...options });

async function setUp() {
  section('Set-up, as the Owner');
  const users = (await asOwner('/users')).body;
  const list = Array.isArray(users) ? users : (users?.items ?? []);
  const idOf = (who) => list.find((u) => u.email === who.email)?.id;
  const ids = { admin: idOf(ADMIN_USER), user: idOf(USER), user2: idOf(USER2) };
  check(ids.admin && ids.user && ids.user2, 'the seeded accounts are there');

  let res = await asOwner('/assistant-access/roles/User', { method: 'PUT', body: { enabled: true, level: 'standard' } });
  check(res.status === 200, `Users on Standard (${res.status})`);
  res = await asOwner('/assistant-access/roles/Admin', { method: 'PUT', body: { enabled: true, level: 'standard' } });
  check(res.status === 200, `Admins on Standard (${res.status})`);
  res = await asOwner(`/users/${ids.user}/assistant-access`, { method: 'DELETE' });
  check(res.status === 200, `the first User follows the role (${res.status})`);
  res = await asOwner(`/users/${ids.user2}/assistant-access`, {
    method: 'PUT',
    body: { enabled: true, level: 'custom', on: ['restart_agent', 'get_agent_logs', 'list_agents'] },
  });
  check(res.status === 200, `the second User has a custom pick (${res.status})`);

  // What the card must agree with: the route itself.
  const mine = async (who) => (await api('/me/assistant-access', { as: who })).body;
  return { ids, mine };
}

// --------------------------------------------------------------- the card

const BADGE = '[data-assistant-badge] > button';
const CARD = '#assistant-badge-areas';

/** What is on screen of the card, read in one go inside the page. */
const readCard = (page) =>
  page.evaluate((selector) => {
    const card = document.querySelector(selector);
    if (!card) return null;
    const box = card.getBoundingClientRect();
    const inside = (x, y) => {
      const el = document.elementFromPoint(x, y);
      return Boolean(el && card.contains(el));
    };
    const areas = [...card.querySelectorAll('[data-area]')].map((area) => {
      const row = area.querySelector(':scope > button');
      const items = [...area.querySelectorAll('[data-ability-state]')];
      const rowBox = row?.getBoundingClientRect();
      return {
        key: area.getAttribute('data-area'),
        expandable: Boolean(row),
        expanded: row?.getAttribute('aria-expanded') === 'true',
        text: (row ?? area).textContent.replace(/\s+/g, ' ').trim(),
        height: rowBox ? Math.round(rowBox.height) : 0,
        states: items.map((i) => i.getAttribute('data-ability-state')),
        items: items.map((i) => ({
          state: i.getAttribute('data-ability-state'),
          text: i.textContent.replace(/\s+/g, ' ').trim(),
          check: Boolean(i.querySelector('svg')),
          color: getComputedStyle(i).color,
          widest: Math.max(...[...i.querySelectorAll('*')].map((e) => e.getBoundingClientRect().right), 0),
        })),
      };
    });
    return {
      left: box.left,
      right: box.right,
      top: box.top,
      bottom: box.bottom,
      width: box.width,
      scrollHeight: card.scrollHeight,
      clientHeight: card.clientHeight,
      viewport: { width: document.documentElement.clientWidth, height: window.innerHeight },
      pageScrollsSideways: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      // Every corner of what is visible of it belongs to it: no ancestor clips it, nothing covers it.
      corners: [
        inside(box.left + 6, box.top + 6),
        inside(box.right - 6, box.top + 6),
        inside(box.left + 6, Math.min(box.bottom, window.innerHeight) - 6),
        inside(box.right - 6, Math.min(box.bottom, window.innerHeight) - 6),
      ],
      areas,
    };
  }, CARD);

const numbersOf = (text) => (text.match(/\d+/g) ?? []).map(Number);

/**
 * The whole look at one card: `expected` is the route's answer for the
 * person signed in, `words` the three strings as this console says them.
 */
async function lookAtCard(page, { name, width, expected, words }) {
  const badge = page.locator(BADGE).first();
  check(Boolean(await until(() => badge.isVisible(), { timeout: 20000 })), 'the level badge is by the assistant’s name');
  await badge.click();
  check(Boolean(await until(() => page.locator(CARD).isVisible())), 'a tap opens the card');
  check((await badge.getAttribute('aria-expanded')) === 'true', 'the badge says it is expanded');
  let card = await readCard(page);
  await shot(page, `${name}-collapsed`);

  check(
    card.areas.length === expected.areas.length && card.areas.every((a) => a.expandable && !a.expanded),
    `every area is a row that can be opened, closed to begin with (${card.areas.length} areas)`,
  );
  check(
    card.areas.every((a, i) => {
      const [offered, available] = numbersOf(a.text.replace(expected.areas[i].title, ''));
      return offered === expected.areas[i].offered && available === expected.areas[i].available;
    }),
    'the count on each row is the route’s',
  );
  check(
    card.areas.every((a) => a.height >= 40),
    `a row is at least 40 px tall to tap (${Math.min(...card.areas.map((a) => a.height))} px)`,
  );

  // Keyboard first, on the first row: focus, Enter opens, Enter closes.
  const firstRow = page.locator(`${CARD} [data-area] > button`).first();
  await firstRow.focus();
  await page.keyboard.press('Enter');
  const opened = (await firstRow.getAttribute('aria-expanded')) === 'true';
  await page.keyboard.press('Enter');
  const closed = (await firstRow.getAttribute('aria-expanded')) === 'false';
  check(opened && closed, 'keyboard: Enter on a focused row opens it, Enter again closes it (aria-expanded flips)');
  await badge.focus();
  await page.keyboard.press('Tab');
  check(
    await page.evaluate((s) => document.activeElement === document.querySelector(`${s} [data-area] > button`), CARD),
    'keyboard: Tab from the badge lands on the first row',
  );

  // Then every row, by tapping.
  const rows = page.locator(`${CARD} [data-area] > button`);
  for (let i = 0; i < (await rows.count()); i++) await rows.nth(i).click();
  card = await readCard(page);
  check(card.areas.every((a) => a.expanded), 'a tap opens every row');
  check(
    card.areas.every((a, i) => a.states.length === expected.areas[i].available),
    'an open row lists every ability of the person’s role in that area',
  );
  check(
    card.areas.every((a, i) => a.states.filter((s) => s === 'included').length === expected.areas[i].offered),
    'the count on a row is the number of included items under it',
  );
  const order = { included: 0, own_agents_only: 1, not_included: 2 };
  check(
    card.areas.every((a) => a.states.every((s, i) => i === 0 || order[a.states[i - 1]] <= order[s])),
    'included first, then own agents only, then not included',
  );
  const items = card.areas.flatMap((a) => a.items);
  const by = (state) => items.filter((i) => i.state === state);
  const wanted = (state) =>
    expected.areas.flatMap((a) => a.abilities).filter((a) => a.state === state).length;
  check(
    ['included', 'own_agents_only', 'not_included'].every((s) => by(s).length === wanted(s)),
    `the three states are the route’s (${by('included').length} included, ${by('own_agents_only').length} own agents only, ${by('not_included').length} not included)`,
  );
  check(by('included').every((i) => i.check) && items.filter((i) => i.state !== 'included').every((i) => !i.check), 'a check mark on what is included, and on nothing else');
  check(
    by('own_agents_only').every((i) => i.text.includes(words.own)),
    `what works on their own agents only says so: "${words.own}"`,
  );
  check(
    by('included').every((i) => i.text.includes(words.included)) &&
      by('not_included').every((i) => i.text.includes(words.notIncluded)),
    `a screen reader is told "${words.included}" and "${words.notIncluded}"`,
  );
  if (by('included').length && by('not_included').length) {
    check(by('included')[0].color !== by('not_included')[0].color, 'what is not included is dimmed');
  }
  check(
    items.every((i) => i.widest <= card.right + 0.5),
    'no title runs out of the card',
  );

  // Where it sits.
  check(card.left >= 0 && card.right <= card.viewport.width + 0.5, `the card is inside the viewport (${Math.round(card.left)}–${Math.round(card.right)} of ${card.viewport.width})`);
  if (width === 390) check(card.left >= 15.5 && card.right <= card.viewport.width - 15.5, 'with a gutter on both sides on a phone');
  check(!card.pageScrollsSideways, 'the page does not scroll sideways');
  check(card.bottom <= card.viewport.height + 0.5, `the card ends above the bottom of the screen (${Math.round(card.bottom)} of ${card.viewport.height})`);
  check(card.corners.every(Boolean), `no ancestor clips it and nothing covers it (${card.corners.map((c) => (c ? 'y' : 'n')).join('')})`);
  const scrolls = card.scrollHeight > card.clientHeight + 1;
  if (scrolls) {
    const moved = await page.evaluate((s) => {
      const el = document.querySelector(s);
      el.scrollTop = el.scrollHeight;
      return el.scrollTop;
    }, CARD);
    check(moved > 0, `a long list scrolls inside the card (${card.scrollHeight} px in ${card.clientHeight})`);
    await shot(page, `${name}-open-end`);
    await page.evaluate((s) => (document.querySelector(s).scrollTop = 0), CARD);
  } else {
    check(true, `everything fits without scrolling (${card.scrollHeight} px)`);
  }
  await shot(page, `${name}-open`);

  // Closing.
  await page.keyboard.press('Escape');
  check(!(await page.locator(CARD).isVisible()), 'Esc closes it');
  await badge.click();
  await badge.click();
  check(!(await page.locator(CARD).isVisible()), 'a second tap on the badge closes it');
  await badge.click();
  await page.mouse.click(card.viewport.width - 8, card.viewport.height - 8);
  check(!(await page.locator(CARD).isVisible()), 'a tap anywhere else closes it');
  return items;
}

const EN = { own: 'only on agents you created', included: 'included', notIncluded: 'not included' };

// -------------------------------------------------------------------- runs

async function appCards(browser, mine) {
  for (const width of WIDTHS) {
    for (const [who, label] of [
      [USER, 'user-standard'],
      [USER2, 'user2-custom'],
    ]) {
      section(`App, ${who.email} (${label}), ${width} px`);
      const { context, page, problems } = await watchedPage(browser, { width, height: HEIGHTS[width] });
      await loginAs(page, who, APP);
      await page.goto(`${APP}/agents/${AGENTS.ranch.id}`, { waitUntil: 'networkidle' });
      const expected = await mine(who);
      const items = await lookAtCard(page, { name: `app-${label}-${width}`, width, expected, words: EN });
      if (who === USER2) {
        const titles = Object.fromEntries(
          expected.areas.flatMap((a) => a.abilities).map((a) => [a.name, a.title]),
        );
        const stateOf = (name) => items.find((i) => i.text.startsWith(titles[name]))?.state;
        check(stateOf('restart_agent') === 'included', `"${titles.restart_agent}" was ticked: included`);
        check(stateOf('get_agent_logs') === 'own_agents_only', `"${titles.get_agent_logs}" was ticked: only on agents you created`);
        check(stateOf('list_agents') === 'included', `"${titles.list_agents}": included`);
      }
      check(problems.length === 0, `no console error, no failed request${problems.length ? `: ${problems.join(' | ')}` : ''}`);
      await context.close();
    }
  }
}

async function appRussian(browser, mine) {
  for (const width of WIDTHS) {
    section(`App in Russian, ${USER.email}, ${width} px`);
    const { context, page, problems } = await watchedPage(browser, { width, height: HEIGHTS[width] });
    await context.addCookies([{ name: 'i18n_redirected', value: 'ru', url: APP }]);
    await loginAs(page, USER, APP);
    await page.goto(`${APP}/agents/${AGENTS.ranch.id}`, { waitUntil: 'networkidle' });
    const ru = JSON.parse(
      await (await import('node:fs/promises')).readFile(
        new URL('../../../app/slices/user/assistantAccess/i18n/locales/ru.json', import.meta.url),
        'utf8',
      ),
    ).assistantAccess;
    const expected = await mine(USER);
    const items = await lookAtCard(page, {
      name: `app-ru-${width}`,
      width,
      expected,
      words: { own: ru.ability_own_agents, included: ru.ability_included, notIncluded: ru.ability_not_included },
    });
    const titles = new Set(expected.areas.flatMap((a) => a.abilities).map((a) => a.title));
    check(
      items.every((i) => [...titles].some((t) => i.text.startsWith(t))),
      'the titles are the server’s, shown as received',
    );
    check(/[а-я]/i.test(await page.locator(BADGE).first().innerText()), 'the level on the badge is in Russian');
    check(problems.length === 0, `no console error, no failed request${problems.length ? `: ${problems.join(' | ')}` : ''}`);
    await context.close();
  }
}

async function adminCard(browser, mine) {
  for (const width of WIDTHS) {
    section(`Admin, ${ADMIN_USER.email}, the assistant’s page, ${width} px`);
    const { context, page, problems } = await watchedPage(browser, { width, height: HEIGHTS[width] });
    await loginAs(page, ADMIN_USER, ADMIN);
    await page.goto(`${ADMIN}/rancher`, { waitUntil: 'networkidle' });
    const expected = await mine(ADMIN_USER);
    await lookAtCard(page, {
      name: `admin-badge-${width}`,
      width,
      expected,
      words: { own: 'only on agents you created', included: '(included)', notIncluded: '(not included)' },
    });
    check(problems.length === 0, `no console error, no failed request${problems.length ? `: ${problems.join(' | ')}` : ''}`);
    await context.close();
  }
}

const PANEL = '[data-assistant-advanced]';

/** Opens every area of the open Advanced panel and reads the marks. */
async function readPanel(page) {
  await until(() => page.locator(PANEL).isVisible(), { timeout: 15000 });
  const rows = page.locator(`${PANEL} section[data-area] button[aria-expanded]`);
  for (let i = 0; i < (await rows.count()); i++) {
    if ((await rows.nth(i).getAttribute('aria-expanded')) !== 'true') await rows.nth(i).click();
  }
  return page.evaluate((selector) => {
    const panel = document.querySelector(selector);
    const box = panel.getBoundingClientRect();
    const abilities = [...panel.querySelectorAll('[data-ability]')].map((el) => {
      const pill = el.querySelector('[data-ability-own-agents]');
      const input = el.querySelector('button[role="checkbox"], input[type="checkbox"]');
      return {
        name: el.getAttribute('data-ability'),
        pill: pill ? pill.textContent.trim() : null,
        disabled: input ? input.hasAttribute('disabled') || input.getAttribute('aria-disabled') === 'true' : null,
        right: Math.max(...[...el.querySelectorAll('*')].map((e) => e.getBoundingClientRect().right)),
      };
    });
    return {
      left: box.left,
      right: box.right,
      viewport: document.documentElement.clientWidth,
      pageScrollsSideways: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      count: (panel.querySelector('[data-advanced-count]')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      abilities,
    };
  }, PANEL);
}

async function scrollPanelTo(page, name) {
  await page.locator(`${PANEL} [data-ability="${name}"]`).first().scrollIntoViewIfNeeded();
}

function judgePanel(panel, { marked }) {
  const named = panel.abilities.filter((a) => a.pill).map((a) => a.name).sort();
  if (marked) {
    check(
      JSON.stringify(named) === JSON.stringify([...CREATOR_ONLY].sort()),
      `the seven, and only they, carry the pill (${named.length}: ${named.join(', ')})`,
    );
    check(
      panel.abilities.filter((a) => a.pill).every((a) => a.pill === 'Only on agents they created'),
      'it reads "Only on agents they created"',
    );
    check(
      panel.abilities.filter((a) => a.pill).every((a) => a.disabled === false),
      'they stay tickable: the agent’s creator uses them',
    );
  } else {
    check(named.length === 0, 'no such pill: an Admin manages by role');
  }
  check(panel.left >= -0.5 && panel.right <= panel.viewport + 0.5 && !panel.pageScrollsSideways, 'the panel is inside the viewport, and the page does not scroll sideways');
  check(
    panel.abilities.every((a) => a.right <= panel.right + 0.5),
    'no row runs out of the panel',
  );
}

async function editor(browser, ids) {
  for (const width of WIDTHS) {
    section(`Admin, ${OWNER.email}, the editor, ${width} px`);
    const { context, page, problems } = await watchedPage(browser, { width, height: HEIGHTS[width] });
    await loginAs(page, OWNER, ADMIN);
    await page.goto(`${ADMIN}/settings/rancher`, { waitUntil: 'networkidle' });

    await page.locator('[data-assistant-advanced-open="User"]').click();
    let panel = await readPanel(page);
    console.log(`  Users: ${panel.count}`);
    judgePanel(panel, { marked: true });
    await scrollPanelTo(page, 'get_agent_logs');
    await shot(page, `editor-users-${width}`);
    await page.keyboard.press('Escape');
    await until(async () => !(await page.locator(PANEL).isVisible()));

    await page.locator('[data-assistant-advanced-open="Admin"]').click();
    panel = await readPanel(page);
    console.log(`  Admins: ${panel.count}`);
    judgePanel(panel, { marked: false });
    await scrollPanelTo(page, 'get_agent_logs');
    await shot(page, `editor-admins-${width}`);
    await page.keyboard.press('Escape');
    await until(async () => !(await page.locator(PANEL).isVisible()));

    await page.goto(`${ADMIN}/users/${ids.user2}`, { waitUntil: 'networkidle' });
    await page.locator('[data-assistant-account-advanced]').click();
    panel = await readPanel(page);
    console.log(`  the second User: ${panel.count}`);
    judgePanel(panel, { marked: true });
    check(/Custom · 3 of/.test(panel.count), `their pick is three ticks (${panel.count})`);
    await scrollPanelTo(page, 'get_agent_logs');
    await shot(page, `editor-user2-${width}`);

    check(problems.length === 0, `no console error, no failed request${problems.length ? `: ${problems.join(' | ')}` : ''}`);
    await context.close();
  }
}

const { ids, mine } = await setUp();
const browser = await launch();
try {
  if (!only || only === 'app') await appCards(browser, mine);
  if (!only || only === 'ru') await appRussian(browser, mine);
  if (!only || only === 'admin') await adminCard(browser, mine);
  if (!only || only === 'editor') await editor(browser, ids);
} finally {
  await browser.close();
}
console.log(`\nscreenshots: ${SHOTS}`);
done('badge');
