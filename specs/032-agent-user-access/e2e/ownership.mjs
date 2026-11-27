// Whose agent this is (CLEAN-259), in a real browser: the mark on the
// avatar, the "All / Mine" filter, the header and the note under the sheet,
// in both consoles, and what the API tells each role about creators.
//
//   node specs/032-agent-user-access/e2e/ownership.mjs
//   node specs/032-agent-user-access/e2e/ownership.mjs --only app     (api | app | ru | admin)
//
// Needs the local stack of lib.mjs (api :3333, app :3000, admin :3001) and
// its seed. No agent runtime: nothing here sends a message.
//
// What it sets, through the API as the Owner, before looking:
//
//   Users          Standard (so an agent ability is "own agents only")
//   first User     no setting of their own: follows the role
//   second User    follows the role, then a custom pick with restart_agent
//                  (left in place, as specs/034-rancher-access/e2e/badge.mjs
//                  leaves it)
//   the Admin      allowed access-charlie as well, so an Admin reads another
//                  person's initials. Put back to the seed's two at the end.
//
// The seed's creators are what is looked at: access-alpha by the Admin,
// access-bravo by nobody, access-charlie by the first User.
//
// Screenshots go to SHOTS_DIR (default: a folder in the system temp
// directory), never into the repo. Prints no secrets.
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  ADMIN,
  ADMIN_USER,
  AGENTS,
  API,
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
  rememberAssistantAccess,
  section,
  sleep,
  until,
  watchedPage,
} from './lib.mjs';

const SHOTS = resolve(process.env.SHOTS_DIR || resolve(tmpdir(), 'ranch-259-shots'));
mkdirSync(SHOTS, { recursive: true });
const only = arg('only');
const HEIGHTS = { 390: 844, 1440: 900 };
const shot = (page, name) => page.screenshot({ path: resolve(SHOTS, `${name}.png`) });
const noProblems = (problems) =>
  check(problems.length === 0, `no console error, no failed request${problems.length ? `: ${problems.join(' | ')}` : ''}`);

/** The 030 helper signs in as its own Owner unless told who. */
const asOwner = (path, options = {}) => api(path, { as: OWNER, ...options });

// ------------------------------------------------------------------ set-up

async function setUp() {
  section('Set-up, as the Owner');
  const users = (await asOwner('/users')).body;
  const list = Array.isArray(users) ? users : (users?.items ?? []);
  const of = (who) => list.find((u) => u.email === who.email);
  const people = { owner: of(OWNER), admin: of(ADMIN_USER), user: of(USER), user2: of(USER2) };
  check(Object.values(people).every(Boolean), 'the seeded accounts are there');

  let res = await asOwner('/assistant-access/roles/User', { method: 'PUT', body: { enabled: true, level: 'standard' } });
  check(res.status === 200, `Users on Standard (${res.status})`);
  for (const who of [people.user, people.user2]) {
    res = await asOwner(`/users/${who.id}/assistant-access`, { method: 'DELETE' });
    check(res.status === 200, `${who.email} follows the role (${res.status})`);
  }
  await setAdminReach(people.admin.id, [AGENTS.a.id, AGENTS.b.id, AGENTS.c.id]);
  return people;
}

async function setAdminReach(adminId, allowed) {
  const now = (await asOwner(`/users/${adminId}/agent-access`)).body;
  const res = await asOwner(`/users/${adminId}/agent-access`, {
    method: 'PUT',
    body: { allowed, denied: [], version: now?.version ?? null },
  });
  check(res.status === 200, `the Admin is allowed ${allowed.length} agents (${res.status})`);
}

// --------------------------------------------------------------------- API

/** Every place a creator could hide in a body, looked for by key and by value. */
function creatorLeaks(body, people) {
  const text = JSON.stringify(body);
  const found = [];
  if (/"createdById"/.test(text)) found.push('a createdById key');
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    if ('createdBy' in node && node.createdBy !== null) found.push('a createdBy that is not null');
    Object.values(node).forEach(walk);
  };
  walk(body);
  for (const person of Object.values(people)) {
    if (text.includes(person.id)) found.push(`the id of ${person.email}`);
    if (text.includes(person.email)) found.push(`the email of ${person.email}`);
  }
  return found;
}

async function apiChecks(people) {
  section('API: what each role is told about who created an agent');
  const listOf = async (who) => (await api('/agents', { as: who })).body;
  const flags = (list) => Object.fromEntries(list.map((a) => [a.name, a.createdByMe]));

  const forUser = await listOf(USER);
  check(
    forUser.every((a) => typeof a.createdByMe === 'boolean'),
    'GET /agents carries createdByMe on every agent, for a User',
  );
  check(
    flags(forUser)[AGENTS.c.name] === true && forUser.filter((a) => a.createdByMe).length === 1,
    `the first User: only ${AGENTS.c.name} is theirs`,
  );
  const forUser2 = await listOf(USER2);
  check(forUser2.every((a) => a.createdByMe === false), 'the second User created nothing: false everywhere');

  // Never a name or an id, of anybody, to a User: the list, one agent, the
  // status snapshot, the assistant, and their own assistant access.
  for (const [who, label] of [
    [USER, 'the first User'],
    [USER2, 'the second User'],
  ]) {
    const others = Object.fromEntries(Object.entries(people).filter(([, p]) => p.email !== who.email));
    const bodies = {
      'GET /agents': (await api('/agents', { as: who })).body,
      [`GET /agents/${AGENTS.b.name}`]: (await api(`/agents/${AGENTS.b.id}`, { as: who })).body,
      [`GET /agents/${AGENTS.c.name}`]: (await api(`/agents/${AGENTS.c.id}`, { as: who })).body,
      'GET /agents/status': (await api('/agents/status', { as: who })).body,
      'GET /agents/admin/current': (await api('/agents/admin/current', { as: who })).body,
      'GET /me/assistant-access': (await api('/me/assistant-access', { as: who })).body,
    };
    for (const [route, body] of Object.entries(bodies)) {
      // Their own id is theirs to see; nobody else's is, nor a resolved creator.
      const leaks = creatorLeaks(body, others).concat(
        JSON.stringify(body).includes(`"createdBy":{`) ? ['a resolved creator'] : [],
      );
      check(leaks.length === 0, `${label}, ${route}: no creator's name or id${leaks.length ? ` (found ${leaks.join(', ')})` : ''}`);
    }
  }
  const one = (await api(`/agents/${AGENTS.c.id}`, { as: USER })).body;
  check(one.createdByMe === true && one.createdBy === null, 'GET /agents/:id says "yours" to its creator and names nobody');
  const status = (await api('/agents/status', { as: USER })).body;
  check(
    status.find((s) => s.agent.id === AGENTS.c.id)?.agent.createdByMe === true &&
      status.filter((s) => s.agent.createdByMe).length === 1,
    'GET /agents/status carries the same flag',
  );

  // Operators read creators as before, and the flag beside them.
  const forAdmin = await listOf(ADMIN_USER);
  const alpha = forAdmin.find((a) => a.id === AGENTS.a.id);
  const charlie = forAdmin.find((a) => a.id === AGENTS.c.id);
  const bravo = forAdmin.find((a) => a.id === AGENTS.b.id);
  check(alpha?.createdByMe === true && alpha.createdBy?.email === ADMIN_USER.email, `the Admin: ${AGENTS.a.name} is theirs, and named`);
  check(charlie?.createdByMe === false && charlie.createdBy?.email === USER.email, `the Admin: ${AGENTS.c.name} is the first User's, by name`);
  check(bravo?.createdByMe === false && bravo.createdBy === null, `the Admin: ${AGENTS.b.name} has no creator recorded`);
  const forOwner = await listOf(OWNER);
  check(
    forOwner.every((a) => a.createdByMe === false) && forOwner.find((a) => a.id === AGENTS.a.id)?.createdBy?.email === ADMIN_USER.email,
    'the Owner created none of them and reads who did',
  );

  // Which abilities act on an agent is the server's word.
  const mine = (await api('/me/assistant-access', { as: USER })).body;
  const abilities = mine.areas.flatMap((a) => a.abilities);
  check(abilities.every((a) => typeof a.onAgent === 'boolean'), 'GET /me/assistant-access: every ability says whether it acts on an agent');
  const byName = Object.fromEntries(abilities.map((a) => [a.name, a]));
  check(
    byName.restart_agent?.onAgent === true && byName.stop_agent?.onAgent === true && byName.list_agents?.onAgent === false,
    'restart_agent and stop_agent do, list_agents does not',
  );
}

// ----------------------------------------------------------------- the app

const railOf = (page) =>
  page.evaluate(() => {
    const shown = (el) => {
      const box = el.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    };
    return [...document.querySelectorAll('li[data-agent-id]')].filter(shown).map((row) => {
      const mark = row.querySelector('[data-owner-mark]');
      const button = row.querySelector('button');
      const avatar = mark?.parentElement?.getBoundingClientRect();
      const box = mark?.getBoundingClientRect();
      return {
        id: row.getAttribute('data-agent-id'),
        mark: mark?.getAttribute('data-owner-mark') ?? null,
        markText: (mark?.textContent ?? '').trim(),
        markHidden: mark ? mark.getAttribute('aria-hidden') === 'true' : null,
        markHasGlyph: Boolean(mark?.querySelector('svg')),
        markSize: box ? [Math.round(box.width), Math.round(box.height)] : null,
        avatarSize: avatar ? Math.round(avatar.width) : null,
        // What a screen reader is given for the row: its text, in order.
        name: (button?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      };
    });
  });

const filterOf = (page) =>
  page.evaluate(() => {
    const group = [...document.querySelectorAll('[data-owner-filter]')].find((el) => el.getBoundingClientRect().width > 0);
    if (!group) return null;
    const box = group.getBoundingClientRect();
    const options = [...group.querySelectorAll('[data-owner-filter-option]')].map((button) => {
      const b = button.getBoundingClientRect();
      const x = b.left + b.width / 2;
      const hit = (y) => document.elementFromPoint(x, y)?.closest('[data-owner-filter-option]') === button;
      return {
        option: button.getAttribute('data-owner-filter-option'),
        pressed: button.getAttribute('aria-pressed') === 'true',
        text: button.textContent.replace(/\s+/g, ' ').trim(),
        // The whole height of the control answers a tap on this option.
        tapHeight: hit(box.top + 0.5) && hit(box.bottom - 0.5) ? Math.round(box.height) : Math.round(b.height),
      };
    });
    return { label: group.getAttribute('aria-label'), height: Math.round(box.height), options };
  });

const sheetOf = (page) =>
  page.evaluate(() => {
    const sheet = document.querySelector('section.agent-sheet');
    if (!sheet) return null;
    const text = (el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const h1 = sheet.querySelector('h1');
    const cls = sheet.querySelector('[data-agent-class]');
    const mark = sheet.querySelector('[data-owner-mark]');
    const note = sheet.querySelector('[data-ownership-note]');
    const created = sheet.querySelector('[data-creator]') ?? null;
    const visible = (el) => Boolean(el) && el.getBoundingClientRect().height > 0 && getComputedStyle(el).display !== 'none';
    const sheetBox = sheet.getBoundingClientRect();
    const overflowing = [...sheet.querySelectorAll('*')].filter((el) => {
      const b = el.getBoundingClientRect();
      return b.width > 0 && (b.right > sheetBox.right + 0.5 || b.left < sheetBox.left - 0.5) && !el.closest('.sr-only');
    }).length;
    // Buttons of the fold line that lie over one another.
    const buttons = [...sheet.querySelectorAll(':scope > div:first-child button')]
      .map((b) => b.getBoundingClientRect())
      .filter((b) => b.width > 0);
    let overlaps = 0;
    for (let i = 0; i < buttons.length; i++) {
      for (let j = i + 1; j < buttons.length; j++) {
        const a = buttons[i];
        const b = buttons[j];
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        // A button inside another (the switch holds its two) is not an overlap of two controls.
        const nested = (a.left >= b.left && a.right <= b.right) || (b.left >= a.left && b.right <= a.right);
        if (w > 1 && h > 1 && !nested) overlaps += 1;
      }
    }
    return {
      name: text(h1).replace(/\s*,.*$/, ''),
      nameCut: h1 ? h1.scrollWidth > h1.clientWidth + 1 : null,
      nameWidth: h1 ? Math.round(h1.getBoundingClientRect().width) : 0,
      classKind: cls?.getAttribute('data-agent-class') ?? null,
      classText: text(cls),
      classVisible: visible(cls),
      mark: mark?.getAttribute('data-owner-mark') ?? null,
      markText: text(mark),
      markHidden: mark ? mark.getAttribute('aria-hidden') === 'true' : null,
      note: note?.getAttribute('data-ownership-note') ?? null,
      noteText: text(note),
      notes: sheet.querySelectorAll('[data-ownership-note]').length,
      abilities: [...sheet.querySelectorAll('[data-note-ability]')].map(text),
      creator: created?.getAttribute('data-creator') ?? null,
      createdText: text(created),
      restart: Boolean(sheet.querySelector('button .lucide-refresh-cw, button .lucide-loader-2')),
      overflowing,
      overlaps,
      pageScrollsSideways: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });

/** A context that remembers the list view and an open sheet, as a returning person has them. */
async function appPage(browser, { width, view = 'list', lang = 'en', sheetOpen = true }) {
  const watched = await watchedPage(browser, { width, height: HEIGHTS[width] });
  await watched.context.addCookies([{ name: 'i18n_redirected', value: lang, url: APP }]);
  await watched.context.addInitScript(
    ([v, open]) => {
      try {
        window.localStorage.setItem('agent:view', v);
        window.localStorage.setItem('agent:sheetOpen', open ? '1' : '0');
      } catch {
        // Nothing to remember.
      }
    },
    [view, sheetOpen],
  );
  return watched;
}

async function openAgent(page, id) {
  await page.goto(`${APP}/agents/${id}`, { waitUntil: 'networkidle' });
  await until(async () => (await page.locator('section.agent-sheet [data-agent-class]').count()) > 0, { timeout: 20000 });
  await sleep(500);
}

/** The list: beside the chat on a desktop, one tap away on a phone. */
async function showRail(page, width) {
  if (width >= 1024) return;
  await page.locator('[data-rail-open]').click();
  await until(async () => (await railOf(page)).length > 0);
}
async function hideRail(page, width) {
  if (width >= 1024) return;
  await page.keyboard.press('Escape');
  const close = page.locator('.agent-workspace .fixed button').first();
  if (await close.isVisible().catch(() => false)) await close.click();
}

/** Every /agents answer the page itself received, for the leak check. */
function recordAgentAnswers(page) {
  const bodies = [];
  page.on('response', async (res) => {
    const url = res.url();
    if (!url.startsWith(`${API}/agents`) || url.includes('/stream')) return;
    if (!(res.headers()['content-type'] ?? '').includes('json')) return;
    try {
      bodies.push({ url: url.replace(API, ''), body: await res.json() });
    } catch {
      // Not a body to read.
    }
  });
  return bodies;
}

async function appOwner(browser, people, words, lang = 'en') {
  const tag = lang === 'en' ? 'app' : `app-${lang}`;
  for (const width of WIDTHS) {
    section(`App${lang === 'en' ? '' : `, in ${lang}`}: the User who created ${AGENTS.c.name}, ${width} px`);
    const { context, page, problems } = await appPage(browser, { width, lang });
    const answers = recordAgentAnswers(page);
    await loginAs(page, USER, APP);
    await openAgent(page, AGENTS.c.id);

    // The header, on their own agent.
    let sheet = await sheetOf(page);
    check(sheet.mark === 'mine' && sheet.markHidden === true, 'the header’s avatar carries the filled mark, hidden from a screen reader');
    check(sheet.classKind === 'mine' && sheet.classText === words.classMine && sheet.classVisible, `the class line reads "${sheet.classText}" and is on screen`);
    check(sheet.name === AGENTS.c.name && sheet.nameCut === false, `the name is read in full: "${sheet.name}" (${sheet.nameWidth} px)`);
    check(sheet.restart, 'restart is offered: the creator manages their agent');
    check(sheet.creator === 'mine' && sheet.createdText.includes(`· ${words.byYou}`), `Created says "· ${words.byYou}" ("${sheet.createdText}")`);
    check(sheet.note === 'mine' && sheet.notes === 1, 'one note, the "yours" one');
    check(
      sheet.noteText.startsWith(words.noteMineTitle) && sheet.noteText.includes(words.noteMineUser),
      `it says why, and that the role has none of it elsewhere ("${sheet.noteText.slice(0, 60)}…")`,
    );
    check(sheet.overlaps === 0, 'no control of the fold line lies over another');
    check(sheet.overflowing === 0 && !sheet.pageScrollsSideways, 'nothing runs out of the sheet, the page does not scroll sideways');
    await shot(page, `${tag}-user-own-header-${width}`);

    // The list.
    await showRail(page, width);
    let rail = await railOf(page);
    const own = rail.find((r) => r.id === AGENTS.c.id);
    check(own?.mark === 'mine' && own.markHidden === true && own.markHasGlyph, 'the list: their agent’s avatar carries the filled mark, with an icon and no letter');
    check(own?.markText === '', 'the mark holds no text to translate');
    check(
      own?.markSize?.every((n) => n >= 14 && n <= 20) && own.avatarSize === 36,
      `it is ${own?.markSize?.join('×')} px on a ${own?.avatarSize} px avatar`,
    );
    check((own?.name ?? '').replace(' ,', ',').includes(`${AGENTS.c.name}, ${words.nameMine}`), `the row is named "${AGENTS.c.name}, ${words.nameMine}"`);
    check(
      rail.filter((r) => r.id !== AGENTS.c.id).every((r) => r.mark === null),
      `no other row is marked (${rail.length} rows): a User is not told who made the rest`,
    );

    // The filter.
    let filter = await filterOf(page);
    check(Boolean(filter), 'the All / Mine filter is offered');
    check(
      filter.options.map((o) => o.text).join(' | ') === `${words.all} ${rail.length} | ${words.mine} 1`,
      `with counts: ${filter.options.map((o) => o.text).join(' | ')}`,
    );
    check(filter.options.every((o) => o.tapHeight >= 40), `each option answers a tap ${Math.min(...filter.options.map((o) => o.tapHeight))} px tall`);
    check(filter.options[0].pressed && !filter.options[1].pressed, '"All" is pressed to begin with');
    await shot(page, `${tag}-user-own-list-${width}`);
    const mineButton = page.locator('[data-owner-filter-option="mine"]:visible');
    await mineButton.click();
    rail = await railOf(page);
    filter = await filterOf(page);
    check(rail.length === 1 && rail[0].id === AGENTS.c.id && filter.options[1].pressed, '"Mine" leaves their agent only, and says it is pressed');
    await shot(page, `${tag}-user-own-list-mine-${width}`);
    // Keyboard: the buttons are focusable and Enter presses them.
    await page.locator('[data-owner-filter-option="all"]:visible').focus();
    await page.keyboard.press('Enter');
    check((await railOf(page)).length > 1 && (await filterOf(page)).options[0].pressed, 'keyboard: Enter on "All" brings the rest back');
    const outline = await page.evaluate(() => {
      const el = document.activeElement;
      const style = getComputedStyle(el);
      return el?.matches('[data-owner-filter-option]') && el.matches(':focus-visible') && style.outlineStyle !== 'none';
    });
    check(outline, 'the focused option has a focus outline');
    await hideRail(page, width);

    // Somebody else's agent, for the same person.
    await openAgent(page, AGENTS.b.id);
    sheet = await sheetOf(page);
    check(sheet.mark === null && sheet.classKind === 'agent', `${AGENTS.b.name}: no mark, the class line reads "${sheet.classText || words.classAgent}"`);
    check(!sheet.restart, 'no restart: their role manages no agent they did not create');
    check(sheet.creator === null, `Created names nobody ("${sheet.createdText}")`);
    check(sheet.note === 'available' && sheet.notes === 1 && sheet.noteText.startsWith(words.noteAvailableTitle), `one note: "${sheet.noteText}"`);
    check(sheet.noteText.includes(words.noteAvailable), 'it says an administrator runs it, and what they may do');
    check(sheet.name === AGENTS.b.name && sheet.nameCut === false && sheet.overlaps === 0 && sheet.overflowing === 0, 'the name is read in full, nothing overlaps or overflows');
    await shot(page, `${tag}-user-other-header-${width}`);

    // The assistant: nothing misleading, and its name is read in full
    // beside the level badge.
    await openAgent(page, AGENTS.ranch.id);
    sheet = await sheetOf(page);
    check(sheet.note === null && sheet.mark === null, 'the Ranch admin agent: no note and no mark');
    check(sheet.name === AGENTS.ranch.name && sheet.nameCut === false, `its name is read in full beside the level badge: "${sheet.name}" (${sheet.nameWidth} px)`);
    check(sheet.overlaps === 0 && sheet.overflowing === 0 && !sheet.pageScrollsSideways, 'nothing overlaps or overflows');
    await shot(page, `${tag}-user-ranch-header-${width}`);

    // Nothing the page was sent names a creator.
    const others = Object.fromEntries(Object.entries(people).filter(([, p]) => p.email !== USER.email));
    const leaks = answers.flatMap((a) => creatorLeaks(a.body, others).map((l) => `${a.url}: ${l}`));
    check(answers.length > 0 && leaks.length === 0, `of ${answers.length} /agents answers the page received, none names a creator${leaks.length ? ` (${leaks.join('; ')})` : ''}`);
    noProblems(problems);
    await context.close();

    // The map, where there is room for one.
    if (width >= 1024 && lang === 'en') {
      section(`App: the map, the same User, ${width} px`);
      const map = await appPage(browser, { width, view: 'orbit', sheetOpen: false });
      await loginAs(map.page, USER, APP);
      await openAgent(map.page, AGENTS.b.id);
      await until(async () => (await map.page.locator('[data-orbit-node]').count()) >= 3, { timeout: 15000 });
      await sleep(900);
      const nodes = () =>
        map.page.evaluate(() =>
          [...document.querySelectorAll('[data-orbit-node]')].map((node) => {
            const mark = node.querySelector('[data-owner-mark]');
            const m = mark?.getBoundingClientRect();
            // Everything else that sits on the node's corners.
            const others = [...node.querySelectorAll(':scope > span')].filter((s) => s !== mark).map((s) => s.getBoundingClientRect());
            const hits = m
              ? others.filter((o) => Math.min(m.right, o.right) - Math.max(m.left, o.left) > 0 && Math.min(m.bottom, o.bottom) - Math.max(m.top, o.top) > 0).length
              : 0;
            return {
              id: node.getAttribute('data-agent-id'),
              mark: mark?.getAttribute('data-owner-mark') ?? null,
              label: node.getAttribute('aria-label'),
              dim: Number(getComputedStyle(node).opacity) < 0.5,
              hits,
            };
          }),
        );
      let placed = await nodes();
      const mine = placed.find((n) => n.id === AGENTS.c.id);
      check(mine?.mark === 'mine' && placed.filter((n) => n.mark).length === 1, 'the map: their agent’s node carries the mark, and no other node');
      check(mine?.label.endsWith('created by you'), `the node is named "${mine?.label}"`);
      check(mine?.hits === 0, 'the mark touches neither the pin, the admin dot nor the status pulse');
      const sheetFolded = await sheetOf(map.page);
      check(sheetFolded.name === AGENTS.b.name && sheetFolded.nameCut === false, `beside the map the name is read in full: "${sheetFolded.name}" (${sheetFolded.nameWidth} px)`);
      await shot(map.page, `app-user-map-${width}`);
      await map.page.locator('[data-owner-filter-option="mine"]:visible').click();
      await sleep(500);
      placed = await nodes();
      check(
        placed.filter((n) => !n.dim).map((n) => n.id).join() === AGENTS.c.id,
        '"Mine" dims every node but theirs, and none leaves its place',
      );
      await shot(map.page, `app-user-map-mine-${width}`);
      // Their own agent beside the map: all four controls, none over another.
      await openAgent(map.page, AGENTS.c.id);
      const ownFolded = await sheetOf(map.page);
      check(ownFolded.restart && ownFolded.overlaps === 0 && ownFolded.nameCut === false, 'their own agent beside the map: restart and stop are there, no control over another, the name in full');
      check(ownFolded.classVisible && ownFolded.classText === 'YOUR AGENT', 'and "YOUR AGENT" stays under the name in the narrow column');
      await shot(map.page, `app-user-map-own-${width}`);
      noProblems(map.problems);
      await map.context.close();
    }
  }
}

async function appOthers(browser, people) {
  // Somebody with nothing of their own, on the role's level.
  for (const width of WIDTHS) {
    section(`App: a User who created nothing, ${width} px`);
    const { context, page, problems } = await appPage(browser, { width });
    await loginAs(page, USER2, APP);
    await openAgent(page, AGENTS.a.id);
    const sheet = await sheetOf(page);
    check(sheet.mark === null && sheet.classKind === 'agent', 'no mark in the header, the class line reads "AGENT"');
    check(sheet.note === 'available' && sheet.notes === 1, `one note: "${sheet.noteText}"`);
    check(sheet.abilities.length === 0, 'it names no ability: none is theirs on this agent');
    check(!sheet.restart && sheet.creator === null, 'no restart, and Created names nobody');
    await showRail(page, width);
    const rail = await railOf(page);
    check(rail.length >= 3 && rail.every((r) => r.mark === null), `no row of the list is marked (${rail.length} rows)`);
    check((await filterOf(page)) === null, 'no filter: "Mine" would be empty');
    await shot(page, `app-user2-nothing-list-${width}`);
    await hideRail(page, width);
    await shot(page, `app-user2-nothing-header-${width}`);
    noProblems(problems);
    await context.close();
  }

  // The same person, once "Restart an agent" was ticked for them.
  section('Set-up: "Restart an agent" is ticked for the second User');
  const res = await asOwner(`/users/${people.user2.id}/assistant-access`, {
    method: 'PUT',
    body: { enabled: true, level: 'custom', on: ['restart_agent', 'get_agent_logs', 'list_agents'] },
  });
  check(res.status === 200, `a custom pick (${res.status})`);
  const mine = (await api('/me/assistant-access', { as: USER2 })).body;
  const expected = mine.areas.flatMap((a) => a.abilities).filter((a) => a.onAgent && a.state === 'included').map((a) => a.title);
  check(expected.join() === 'Restart an agent', `the route gives one agent ability as included: ${expected.join(', ')}`);

  for (const width of WIDTHS) {
    section(`App: the User with the ticked restart, ${width} px`);
    const { context, page, problems } = await appPage(browser, { width });
    await loginAs(page, USER2, APP);
    await openAgent(page, AGENTS.a.id);
    await until(async () => (await sheetOf(page)).note === 'assistant', { timeout: 10000 });
    let sheet = await sheetOf(page);
    check(sheet.note === 'assistant' && sheet.notes === 1, `one note: "${sheet.noteText}"`);
    check(sheet.abilities.join() === expected.join(), `it names what the route gives: ${sheet.abilities.join(', ')}`);
    check(!sheet.noteText.includes('Read pod logs'), 'and not what was ticked but stays with the creator ("Read pod logs")');
    check(!sheet.restart, 'the console still offers no restart button: the ability is the assistant’s');
    check(sheet.overflowing === 0 && !sheet.pageScrollsSideways, 'nothing runs out of the sheet');
    await shot(page, `app-user2-restart-header-${width}`);
    await openAgent(page, AGENTS.ranch.id);
    sheet = await sheetOf(page);
    check(sheet.note === null, 'the Ranch admin agent: no note, ticked or not');
    noProblems(problems);
    await context.close();
  }
}

// --------------------------------------------------------------- the admin

/** 400s the workspace asks for on a fixture with no bucket and no pod. */
const NO_BUCKET = [{ status: 400, url: /\/agents\/[^/]+\/(env|channels|files|secrets)(\?|\/|$)/ }];

const headerOf = (page) =>
  page.evaluate(() => {
    const row = document.querySelector('[data-agent-header]');
    const h1 = row?.querySelector('h1');
    if (!row || !h1) return null;
    const text = (el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const mark = row.querySelector('[data-owner-mark]');
    const dot = row.querySelector('[role="img"][aria-label]');
    const line = row.querySelector('[data-agent-creator]');
    const m = mark?.getBoundingClientRect();
    const d = dot?.getBoundingClientRect();
    const lineBox = line?.getBoundingClientRect();
    return {
      name: text(h1),
      nameCut: h1.scrollWidth > h1.clientWidth + 1,
      mark: mark?.getAttribute('data-owner-mark') ?? null,
      markText: text(mark),
      markHidden: mark ? mark.getAttribute('aria-hidden') === 'true' : null,
      markOnDot: m && d ? Math.min(m.right, d.right) - Math.max(m.left, d.left) > 0 && Math.min(m.bottom, d.bottom) - Math.max(m.top, d.top) > 0 : false,
      creator: line?.getAttribute('data-agent-creator') ?? null,
      creatorText: text(line),
      // Written out, or kept for a screen reader only.
      creatorOnScreen: Boolean(lineBox) && lineBox.width > 2 && lineBox.height > 2,
      ownerManaged: text(document.querySelector('[data-owner-managed]')),
      // One row of controls is 32 px tall; two are 70.
      height: Math.round(row.getBoundingClientRect().height - parseFloat(getComputedStyle(row).paddingBottom)),
      pageScrollsSideways: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });

async function openAdminAgent(page, id, tab) {
  await page.goto(`${ADMIN}/agents/${id}${tab ? `?tab=${tab}` : ''}`, { waitUntil: 'networkidle' });
  await until(async () => (await page.locator('[data-workspace-tab="chat"], [data-owner-managed]').count()) > 0, { timeout: 20000 });
  await sleep(500);
}

async function createdByOf(page) {
  const block = page.locator('[data-advanced]').first();
  await block.waitFor({ state: 'visible', timeout: 15000 });
  if ((await page.locator('[data-created-by]').count()) === 0) {
    await block.locator('button, summary, [role="button"]').first().click();
  }
  const row = page.locator('[data-created-by]').first();
  await row.waitFor({ state: 'visible', timeout: 10000 });
  await row.scrollIntoViewIfNeeded();
  return {
    state: await row.getAttribute('data-state'),
    text: ((await row.locator('dd').textContent()) ?? '').replace(/\s+/g, ' ').trim(),
  };
}

async function showAdminRail(page, width) {
  if (width >= 1024) return;
  await page.locator('[data-rail-open]').click();
  await until(async () => (await railOf(page)).length > 0);
}
async function hideAdminRail(page, width) {
  if (width >= 1024) return;
  await page.locator('.fixed button:has(.sr-only)').first().click();
}

async function adminAsAdmin(browser) {
  for (const width of WIDTHS) {
    section(`Admin console, the Admin, ${width} px`);
    const { context, page, problems } = await watchedPage(browser, { width, height: HEIGHTS[width], expected: NO_BUCKET });
    await loginAs(page, ADMIN_USER, ADMIN);
    await openAdminAgent(page, AGENTS.a.id);

    let header = await headerOf(page);
    check(header.mark === 'mine' && header.markHidden === true, `${AGENTS.a.name}: the header’s avatar carries the filled mark, hidden from a screen reader`);
    check(!header.markOnDot, 'it does not touch the status dot');
    check(header.creator === 'mine' && header.creatorText === 'Your agent' && header.creatorOnScreen, 'beside the name, written out: "Your agent"');
    check(header.name === AGENTS.a.name && !header.nameCut && !header.pageScrollsSideways, 'the name is read in full, the page does not scroll sideways');
    await shot(page, `admin-admin-own-header-${width}`);

    await showAdminRail(page, width);
    let rail = await railOf(page);
    const own = rail.find((r) => r.id === AGENTS.a.id);
    const theirs = rail.find((r) => r.id === AGENTS.c.id);
    const nobody = rail.find((r) => r.id === AGENTS.b.id);
    check(own?.mark === 'mine' && own.markHasGlyph && own.markText === '' && own.markHidden === true, 'the list: their agent carries the filled mark, an icon and no letter');
    check((own?.name ?? '').replace(' ,', ',').includes(`${AGENTS.a.name}, created by you`), `the row is named "${AGENTS.a.name}, created by you"`);
    check(theirs?.mark === 'other' && theirs.markText === 'AU' && !theirs.markHasGlyph, `${AGENTS.c.name}: an outlined mark with its creator’s initials (${theirs?.markText})`);
    check((theirs?.name ?? '').replace(' ,', ',').includes(`${AGENTS.c.name}, created by access-user`), `named "${AGENTS.c.name}, created by access-user"`);
    check(nobody?.mark === null && !/created by/.test(nobody?.name ?? ''), `${AGENTS.b.name}, older than the field: no mark`);
    let filter = await filterOf(page);
    check(
      filter?.options.map((o) => o.text).join(' | ') === `All ${rail.length} | Mine 1`,
      `the All / Mine filter, with counts: ${filter?.options.map((o) => o.text).join(' | ')}`,
    );
    check(filter.options.every((o) => o.tapHeight >= 40), `each option answers a tap ${Math.min(...filter.options.map((o) => o.tapHeight))} px tall`);
    await shot(page, `admin-admin-list-${width}`);
    await page.locator('[data-owner-filter-option="mine"]:visible').click();
    rail = await railOf(page);
    check(rail.length === 1 && rail[0].id === AGENTS.a.id, '"Mine" leaves their agent only');
    await page.locator('[data-owner-filter-option="all"]:visible').focus();
    await page.keyboard.press('Enter');
    check((await railOf(page)).length > 1, 'keyboard: Enter on "All" brings the rest back');
    await hideAdminRail(page, width);

    // "Created by", written out.
    await openAdminAgent(page, AGENTS.a.id, 'overview');
    let by = await createdByOf(page);
    check(by.state === 'known' && by.text === `You · access-admin · ${ADMIN_USER.email}`, `Created by, on their own: "${by.text}"`);
    await shot(page, `admin-admin-own-created-by-${width}`);

    await openAdminAgent(page, AGENTS.c.id, 'overview');
    header = await headerOf(page);
    check(header.mark === 'other' && header.markText === 'AU' && !header.markOnDot, `${AGENTS.c.name}: the header carries the creator’s initials, clear of the status dot`);
    check(header.creator === 'other' && header.creatorText === 'by access-user' && !header.creatorOnScreen, 'and says "by access-user" to a screen reader');
    by = await createdByOf(page);
    check(by.state === 'known' && by.text === `access-user · ${USER.email}`, `Created by: "${by.text}"`);
    await shot(page, `admin-admin-other-${width}`);

    await openAdminAgent(page, AGENTS.b.id, 'overview');
    header = await headerOf(page);
    check(header.mark === null && header.creator === 'unknown' && header.creatorText === 'creator not recorded', `${AGENTS.b.name}: no mark; a screen reader is told "creator not recorded"`);
    by = await createdByOf(page);
    check(by.state === 'unknown' && by.text === 'Creator not recorded', `Created by: "${by.text}"`);
    await shot(page, `admin-admin-unrecorded-${width}`);

    // The Ranch admin agent, which an Admin talks to and does not manage.
    await openAdminAgent(page, AGENTS.ranch.id);
    header = await headerOf(page);
    check(header.ownerManaged === 'This agent is managed by the Owner.', `the Ranch admin agent still says: "${header.ownerManaged}"`);
    check(header.mark === null && header.creator === null, 'and nothing about who created it: no mark, no line');
    check((await page.locator('[data-ownership-note]').count()) === 0, 'no ownership note');
    await shot(page, `admin-admin-ranch-${width}`);
    noProblems(problems);
    await context.close();
  }
}

async function adminAsOwner(browser) {
  for (const width of WIDTHS) {
    section(`Admin console, the Owner, ${width} px`);
    const { context, page, problems } = await watchedPage(browser, { width, height: HEIGHTS[width], expected: NO_BUCKET });
    await loginAs(page, OWNER, ADMIN);
    await openAdminAgent(page, AGENTS.a.id);
    const header = await headerOf(page);
    check(header.mark === 'other' && header.markText === 'AA', `${AGENTS.a.name}: the header carries its creator’s initials (${header.markText})`);
    check(header.creator === 'other' && !header.creatorOnScreen, 'no "Your agent": the Owner did not create it');
    if (width >= 1024) check(header.height <= 40, `the header is still one row (${header.height} px)`);
    await showAdminRail(page, width);
    const rail = await railOf(page);
    const marks = Object.fromEntries(rail.map((r) => [r.id, r.mark === 'other' ? r.markText : r.mark]));
    check(marks[AGENTS.a.id] === 'AA' && marks[AGENTS.c.id] === 'AU', `the list: initials on ${AGENTS.a.name} (AA) and ${AGENTS.c.name} (AU)`);
    check(marks[AGENTS.b.id] === null && marks[AGENTS.ranch.id] === null, `none on ${AGENTS.b.name} and the Ranch admin agent, which have no creator recorded`);
    check(rail.every((r) => r.mark !== 'mine') && (await filterOf(page)) === null, 'no filled mark and no filter: the Owner created none of them');
    await shot(page, `admin-owner-list-${width}`);
    await hideAdminRail(page, width);
    await openAdminAgent(page, AGENTS.ranch.id, 'overview');
    const by = await createdByOf(page);
    check(by.text === 'Creator not recorded', `the Ranch admin agent, Created by: "${by.text}"`);
    await shot(page, `admin-owner-ranch-created-by-${width}`);
    noProblems(problems);
    await context.close();
  }
}

// -------------------------------------------------------------------- runs

const EN = {
  classMine: 'YOUR AGENT',
  classAgent: 'AGENT',
  byYou: 'by you',
  nameMine: 'created by you',
  all: 'All',
  mine: 'Mine',
  noteMineTitle: 'This is your agent.',
  noteMineUser: 'even though your role has none of that for other agents',
  noteAvailableTitle: 'This agent is available to you.',
  noteAvailable: 'An administrator runs it',
};

async function russianWords() {
  const ru = JSON.parse(await readFile(new URL('../../../app/slices/agent/i18n/locales/ru.json', import.meta.url), 'utf8'));
  return {
    classMine: ru.sheet.class_mine,
    classAgent: ru.sheet.class_agent,
    byYou: ru.sheet.created_by_you,
    nameMine: ru.ownership.name_mine,
    all: ru.ownership.filter_all,
    mine: ru.ownership.filter_mine,
    noteMineTitle: ru.ownership.note_mine_title,
    // The second half of the sentence is the part a User gets.
    noteMineUser: ru.ownership.note_mine_user.split(', ').pop().replace(/\.$/, ''),
    noteAvailableTitle: ru.ownership.note_available_title,
    noteAvailable: ru.ownership.note_available.split(':')[0],
  };
}

// The set-up puts Users on Standard, and a later step gives the second User
// a custom pick. What was there before comes back at the end.
const putAssistantAccessBack = await rememberAssistantAccess();
const people = await setUp();
const browser = await launch();
try {
  if (!only || only === 'api') await apiChecks(people);
  if (!only || only === 'app') {
    await appOwner(browser, people, EN);
    await appOthers(browser, people);
  }
  if (!only || only === 'ru') {
    const words = await russianWords();
    check(
      words.classMine === 'ВАШ АГЕНТ' && words.mine === 'Мои' && words.nameMine === 'создан вами',
      `the Russian reads: "${words.classMine}", "${words.mine}", "${words.nameMine}"`,
    );
    await appOwner(browser, people, words, 'ru');
  }
  if (!only || only === 'admin') {
    await adminAsAdmin(browser);
    await adminAsOwner(browser);
  }
} finally {
  await browser.close();
  section('Putting the Admin’s access and the assistant setting back');
  await setAdminReach(people.admin.id, [AGENTS.a.id, AGENTS.b.id]);
  const failed = await putAssistantAccessBack();
  check(failed.length === 0, `both roles and every account are as this script found them${failed.length ? `: ${failed.join(', ')}` : ''}`);
}
done('ownership');
