// Limits in the "Visibility & embed" card (CLEAN-224, User Story 1).
//
//   node specs/030-agent-request-limits/e2e/settings.mjs
//
// An Owner in the admin console: a public agent cannot be saved without a
// limit, visibility and limits go in one save, and what is saved is what the
// hub enforces. Leaves every agent as the seed made it.
//
// Needs: API :3333 (after seed.mjs), fakeAgent.mjs, admin :3001.
import {
  ADMIN,
  AGENTS,
  OWNER,
  api,
  check,
  done,
  fake,
  launch,
  loginAs,
  section,
  sendAnonymous,
  setLimits,
  shot,
  sleep,
  until,
} from './lib.mjs';

const input = (page, window) => page.locator(`[data-limit-input="${window}"]`).first();
const errorCodes = (page) =>
  page.locator('[data-limits-error]').evaluateAll((els) =>
    els
      .filter((el) => el.getBoundingClientRect().height > 0)
      .map((el) => el.getAttribute('data-limits-error-code'))
      .filter(Boolean),
  );
const savedAs = (page) => page.locator('[data-visibility-saved]').first().getAttribute('data-visibility-saved');
const agentOf = async (id) => (await api(`/agents/${id}`)).body;
const limitsOf = async (id) => (await api(`/agents/${id}/limits`)).body?.limits ?? null;

// The three helpers below work on the card as CLEAN-224 shipped it and on the
// Overview of CLEAN-228 (specs/031-agent-overview-redesign, research R13):
// Save lives in a bar that exists only while something is changed, the limits
// have a switch, and origins are chips instead of one text field.
async function openCard(page, agentId) {
  await page.goto(`${ADMIN}/agents/${agentId}?tab=overview`, { waitUntil: 'networkidle' });
  await input(page, 'minute').waitFor({ state: 'visible', timeout: 20000 });
  await input(page, 'minute').scrollIntoViewIfNeeded();
}
async function setFields(page, values) {
  const windows = ['minute', 'hour', 'day'];
  // Where the limits have a switch and it is off, typing a limit starts by
  // switching it on.
  const limitSwitch = page.locator('[data-limit-switch]').first();
  const wantsOne = windows.some((window) => values[window] !== undefined);
  if (wantsOne && (await limitSwitch.count()) > 0 && (await limitSwitch.getAttribute('aria-checked')) === 'false') {
    await limitSwitch.click();
  }
  for (const window of windows) {
    const text = values[window] === undefined ? '' : String(values[window]);
    const field = input(page, window);
    // A field that is switched off is already empty.
    if (text === '' && !(await field.isEditable())) continue;
    await field.fill(text);
  }
}
/** One allowed origin: a chip (type it, Enter) or the old one-per-line field. */
async function addOrigin(page, origin) {
  const chips = page.locator('[data-origin-input]').first();
  if ((await chips.count()) > 0) {
    await chips.fill(origin);
    await chips.press('Enter');
    return;
  }
  await page.locator('[data-visibility-origins]').first().fill(origin);
}
const save = (page) => page.locator('[data-visibility-save]').first().click();
const togglePublic = (page) => page.locator('[data-visibility-public]').first().click();

section('Preconditions');
check(await fake.up(), 'fake agents are up');
await fake.reset();
const start = await agentOf(AGENTS.off);
check(start?.isPublic === false && (await limitsOf(AGENTS.off)) === null, 'limits-off is private with no limits');

const browser = await launch();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 200)));
  await loginAs(page, OWNER, ADMIN);

  section('Private → public with no limit');
  await openCard(page, AGENTS.off);
  check((await savedAs(page)) === 'private', 'the card shows the agent as private');
  check(
    /telegram/i.test((await page.locator('[data-limits-uncovered]').first().textContent()) ?? ''),
    'the card says what limits do not cover (Telegram, …)',
  );
  await togglePublic(page);
  await setFields(page, {});
  await save(page);
  const refused = await until(async () => (await errorCodes(page)).includes('PUBLIC_AGENT_NEEDS_LIMITS'), {
    timeout: 6000,
  });
  check(refused, 'the save is refused: a public agent needs at least one limit');
  await shot(page, 'settings-public-needs-limits');
  check((await agentOf(AGENTS.off))?.isPublic === false, 'the agent is still private on the server');
  check((await savedAs(page)) === 'private', 'and the card still says private');

  section('The same save, with a limit');
  await setFields(page, { minute: 3 });
  await save(page);
  check(await until(async () => (await savedAs(page)) === 'public', { timeout: 8000 }), 'one save makes it public');
  check((await agentOf(AGENTS.off))?.isPublic === true, 'public on the server');
  const saved = await limitsOf(AGENTS.off);
  check(
    saved?.perMinute === 3 && saved?.perHour === null && saved?.perDay === null,
    `with 3 per minute and nothing else (${JSON.stringify(saved)})`,
  );
  check((await errorCodes(page)).length === 0, 'and no refusal left on screen');
  await shot(page, 'settings-public-with-limit');

  section('What was saved is what is enforced');
  const statuses = [];
  for (let i = 0; i < 4; i++) statuses.push((await sendAnonymous(AGENTS.off, `request ${i + 1}`)).status);
  check(statuses.join(',') === '200,200,200,429', `three requests accepted, the fourth refused (${statuses.join(',')})`);
  await sleep(300);
  check((await fake.received(AGENTS.off)).length === 3, 'the agent received exactly three');

  section('Switching limits off on a public agent');
  await setFields(page, {});
  await save(page);
  check(
    await until(async () => (await errorCodes(page)).includes('PUBLIC_AGENT_NEEDS_LIMITS'), { timeout: 6000 }),
    'refused, with the reason',
  );
  check((await limitsOf(AGENTS.off))?.perMinute === 3, 'the limit is still there');

  section('Values that make no sense');
  await setFields(page, { minute: 10, hour: 5 });
  await save(page);
  check(
    await until(async () => (await errorCodes(page)).includes('LIMIT_WINDOWS_CONTRADICT'), { timeout: 6000 }),
    'an hour limit below the minute limit is refused',
  );
  await setFields(page, { minute: 0 });
  await save(page);
  check(
    await until(async () => (await errorCodes(page)).includes('LIMIT_OUT_OF_RANGE'), { timeout: 6000 }),
    'zero is refused: the smallest limit is one',
  );
  check((await limitsOf(AGENTS.off))?.perMinute === 3, 'neither changed what is saved');

  section('Public → private');
  await setFields(page, { minute: 3 });
  await togglePublic(page);
  await save(page);
  check(await until(async () => (await savedAs(page)) === 'private', { timeout: 8000 }), 'saved as private');
  check((await limitsOf(AGENTS.off))?.perMinute === 3, 'the limits stay, now optional');
  await setFields(page, {});
  await save(page);
  check(
    await until(async () => (await limitsOf(AGENTS.off)) === null, { timeout: 8000 }),
    'and a private agent may switch them off',
  );

  section('An agent that was public before limits existed');
  const mark = page.locator(`li[data-agent-id="${AGENTS.legacy}"][data-agent-needs-limits]`);
  check(await until(async () => (await mark.count()) > 0, { timeout: 20000 }), 'is marked in the agent list');
  check(/public without limits/i.test((await mark.first().textContent()) ?? ''), 'with words, not colour alone');
  const renamed = await api(`/agents/${AGENTS.legacy}`, { method: 'PUT', body: { name: 'limits-legacy renamed' } });
  check(renamed.status === 200, `can still be renamed (${renamed.status})`);
  await api(`/agents/${AGENTS.legacy}`, { method: 'PUT', body: { name: 'limits-legacy' } });
  await openCard(page, AGENTS.legacy);
  check((await page.locator('[data-limits-needed]').count()) > 0, 'its card asks for limits');
  // Save is unavailable until something on the card changes; an operator who
  // touches its visibility settings at all is then asked for limits.
  await addOrigin(page, 'https://example.test');
  await save(page);
  check(
    await until(async () => (await errorCodes(page)).includes('PUBLIC_AGENT_NEEDS_LIMITS'), { timeout: 6000 }),
    'and saving its visibility settings requires them',
  );
  await shot(page, 'settings-legacy');

  section('A private agent with a share link and no limits');
  await openCard(page, AGENTS.share);
  check(
    await until(async () => (await page.locator('[data-limits-share-warning]').count()) > 0, { timeout: 8000 }),
    'shows a warning',
  );
  check((await errorCodes(page)).length === 0, 'and no refusal: for a private agent limits stay optional');
} finally {
  await browser.close();
  // Back to the seed's state, whatever happened above.
  await api(`/agents/${AGENTS.off}`, { method: 'PUT', body: { isPublic: false, limits: null } });
  await setLimits(AGENTS.share, {});
}

done('settings');
