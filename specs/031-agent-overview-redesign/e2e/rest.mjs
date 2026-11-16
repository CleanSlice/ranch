// Usage, Advanced, Delete — and the page as a whole (CLEAN-228, User Story 6).
//
//   node specs/031-agent-overview-redesign/e2e/rest.mjs
//
// Usage figures equal the API's; seven bars with their values, days with no
// usage included; an empty state for an agent that used nothing; "All 30
// days" opens the full panel. Advanced is closed by default; the debug switch
// counts as a change and saves through the bar; promote and demote ask first.
// Delete opens the dialog with its backup and wipe options, and Cancel leaves
// the agent. No sideways scroll at six widths; nothing animated for a reader
// who asked for less motion.
//
// Nothing is deleted, promoted or demoted: those dialogs are opened and
// cancelled. Leaves `limits-off` as the seed made it.
//
// Needs: API :3333 (after seed.mjs), admin :3001.
import {
  AGENTS,
  FIXTURES,
  about,
  adminPage,
  agentAny,
  agentOf,
  agentPut,
  api,
  captureRequests,
  check,
  confirmDialog,
  done,
  hook,
  inViewport,
  launch,
  mentions,
  noSidewaysScroll,
  openOverview,
  parseMoney,
  remember,
  saveBar,
  section,
  shot,
  sleep,
  states,
  textOf,
  unfold,
  until,
  usageOf,
} from './lib.mjs';

const agent = AGENTS.off;
const WIDTHS = [390, 768, 1024, 1280, 1440, 1920];
const BLOCKS = ['summary', 'config', 'limit', 'access', 'usage', 'advanced', 'danger'];
const DAY = 24 * 60 * 60 * 1000;

const kpi = (page, name) => textOf(hook(page, 'usage-kpi', name));
const days = (page) =>
  page.locator('[data-block="usage"] [data-usage-day]').evaluateAll((els) =>
    els.map((el) => ({
      date: el.getAttribute('data-usage-day'),
      value: Number(el.getAttribute('data-value')),
      height: el.getBoundingClientRect().height,
    })),
  );
const isoDay = (t) => new Date(t).toISOString().slice(0, 10);
/** Today as the browser's own calendar has it, which near midnight is not the UTC day. */
const localDay = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/** Any dialog a person would see: the console's confirm, or another modal. */
const anyDialog = (page) => page.locator('[data-confirm-dialog], [role="alertdialog"], [role="dialog"]').locator('visible=true');
async function cancelDialog(page) {
  const own = page.locator('[data-confirm-cancel]').locator('visible=true');
  if ((await own.count()) > 0) await own.first().click();
  else {
    const named = anyDialog(page).getByRole('button', { name: /^cancel$/i });
    if ((await named.count()) > 0) await named.first().click();
    else await page.keyboard.press('Escape');
  }
  return until(async () => (await anyDialog(page).count()) === 0, { timeout: 4000 });
}

section('Preconditions');
const start = await remember(agent);
const usage = await usageOf(agent);
check(usage?.totals?.callCount > 0, 'limits-off has seeded usage (run seed.mjs first)');
check(((await usageOf(AGENTS.legacy))?.last30days ?? []).length === 0, 'limits-legacy has none');
check(start.agent?.debugEnabled === false, 'debug mode is off on limits-off');

const browser = await launch();
try {
  const page = await adminPage(browser, { width: 1440, height: 1000 });
  const bar = saveBar(page);
  const dialog = confirmDialog(page);
  const puts = captureRequests(page, agentPut(agent), 'PUT');
  const deletes = captureRequests(page, agentAny(agent), 'DELETE');
  const posts = captureRequests(page, agentAny(agent), 'POST');

  section('The page in order');
  await openOverview(page, agent);
  const order = await hook(page, 'overview')
    .first()
    .evaluate((root) =>
      [...root.querySelectorAll('[data-summary], [data-block]')].map((el) =>
        el.hasAttribute('data-summary') ? 'summary' : el.getAttribute('data-block'),
      ),
    );
  check(order.join(',') === BLOCKS.join(','), `summary, Configuration, Request limit, Access, Usage, Advanced, Delete (${order.join(', ')})`);

  section('Usage figures');
  const block = hook(page, 'block', 'usage').first();
  await block.scrollIntoViewIfNeeded();
  await until(async () => (await hook(page, 'usage-kpi').count()) === 4, { timeout: 8000 });
  check((await hook(page, 'usage-kpi').count()) === 4, 'four figures: cost, calls, input tokens, output tokens');
  const cost = parseMoney(await kpi(page, 'cost'));
  check(Math.abs(cost - usage.totals.costUsd) < 0.006, `cost is the API's ($${cost} vs ${usage.totals.costUsd.toFixed(4)})`);
  check(states(await kpi(page, 'calls'), usage.totals.callCount), `calls are the API's (${usage.totals.callCount})`);
  check(mentions(await kpi(page, 'input'), usage.totals.inputTokens), `input tokens are the API's (${await kpi(page, 'input')} for ${usage.totals.inputTokens})`);
  check(mentions(await kpi(page, 'output'), usage.totals.outputTokens), `output tokens are the API's (${await kpi(page, 'output')} for ${usage.totals.outputTokens})`);

  section('The last seven days');
  const shown = await days(page);
  check(shown.length === 7, `seven bars (${shown.length})`);
  const dates = shown.map((d) => d.date);
  const consecutive = dates.every((d, i) => i === 0 || Date.parse(d) - Date.parse(dates[i - 1]) === DAY);
  check(consecutive, `seven days in a row, oldest first (${dates[0]} … ${dates[6]})`);
  check(dates[6] === isoDay(Date.now()) || dates[6] === localDay(), `ending today (${dates[6]})`);
  const perDay = new Map();
  for (const row of usage.last30days) perDay.set(row.date, (perDay.get(row.date) ?? 0) + row.inputTokens);
  const wrong = shown.filter((d) => d.value !== (perDay.get(d.date) ?? 0));
  check(
    wrong.length === 0,
    `each bar carries that day's input tokens, summed across models (${wrong.map((d) => `${d.date}: ${d.value} vs ${perDay.get(d.date) ?? 0}`).join('; ') || 'all seven match'})`,
  );
  const zero = shown.filter((d) => d.value === 0);
  check(zero.length > 0, `days with no usage are there as zero, not skipped (${zero.map((d) => d.date).join(', ')})`);
  const busiest = shown.reduce((a, b) => (b.value > a.value ? b : a), shown[0]);
  check(
    mentions(await textOf(block), busiest?.value ?? -1),
    `the value of a day is written, not only drawn (${busiest?.value} on ${busiest?.date})`,
  );
  check(/today/i.test(await textOf(block)), 'and today so far is stated');
  check((await hook(page, 'usage-empty').count()) === 0, 'no empty state for an agent with usage');
  await shot(page, 'rest-usage');

  section('All 30 days');
  await hook(page, 'usage-all').first().click();
  check(
    await until(async () => (await anyDialog(page).count()) > 0, { timeout: 6000 }),
    'opens the full usage panel',
  );
  const panel = await textOf(anyDialog(page));
  check(FIXTURES.usage.models.some((m) => panel.includes(m)), 'with the per-model rows the strip does not show');
  check(about(parseMoney(panel), usage.totals.costUsd) || panel.includes(usage.last30days[0]?.date ?? '—'), 'for the same agent');
  await page.keyboard.press('Escape');
  check(await until(async () => (await anyDialog(page).count()) === 0, { timeout: 4000 }), 'and closes again');

  section('An agent with no usage');
  await openOverview(page, AGENTS.legacy);
  check(
    await until(async () => (await hook(page, 'usage-empty').count()) > 0, { timeout: 8000 }),
    'the block says there is no usage',
  );
  check((await textOf(hook(page, 'usage-empty'))).length > 5, 'in words');
  check((await days(page)).length === 0, 'instead of drawing seven empty bars');
  await shot(page, 'rest-usage-empty');

  section('Advanced');
  await openOverview(page, agent);
  const advanced = hook(page, 'advanced').first();
  await advanced.scrollIntoViewIfNeeded();
  check((await advanced.getAttribute('data-state')) === 'closed', 'closed by default');
  const debug = hook(page, 'field', 'debug').first();
  check(!((await debug.count()) > 0 && (await debug.isVisible())), 'with debug mode out of sight');
  check(/debug/i.test(await textOf(advanced)), 'its header says what is inside');
  check(await unfold(page, 'advanced'), 'it opens when asked');
  check(await debug.isVisible(), 'debug mode is inside');
  check((await textOf(hook(page, 'agent-id-text'))).includes(agent), "and the agent's identifier, as text that can be selected");
  await shot(page, 'rest-advanced');

  section('Debug mode goes through the bar');
  check((await debug.getAttribute('aria-checked')) === 'false', 'the switch is off');
  await debug.click();
  check(await bar.counts(1), 'switching it counts as one unsaved change');
  check((await debug.getAttribute('data-changed')) !== null, 'and the switch is marked as changed');
  check((await agentOf(agent))?.debugEnabled === false, 'nothing is saved yet');
  await bar.save();
  check(await bar.leaves(10000), 'Save');
  check(
    puts.length === 1 && Object.keys(puts[0] ?? {}).join(',') === 'debugEnabled' && puts[0].debugEnabled === true,
    `sends debug mode and nothing else (${Object.keys(puts[0] ?? {}).join(', ')})`,
  );
  check((await agentOf(agent))?.debugEnabled === true, 'and the server has it');

  section('Admin tools ask first');
  posts.length = 0;
  const promote = hook(page, 'admin-action', 'promote').first();
  check((await promote.count()) > 0, 'an ordinary agent is offered promotion');
  await promote.click();
  check(await until(async () => (await anyDialog(page).count()) > 0, { timeout: 4000 }), 'promoting asks for confirmation');
  check((await textOf(anyDialog(page))).length > 20, 'with its warning');
  check(await cancelDialog(page), 'Cancel closes it');
  await sleep(300);
  check(posts.length === 0 && (await agentOf(agent))?.isAdmin === false, 'and nothing was promoted');
  // Demotion can only be shown on the installation's admin agent. It is
  // opened and cancelled, never carried out.
  const admin = (await api('/agents/admin/current')).body;
  if (admin?.id) {
    const adminDeletes = captureRequests(page, agentAny(admin.id), 'DELETE');
    await openOverview(page, admin.id);
    await unfold(page, 'advanced');
    const demote = hook(page, 'admin-action', 'demote').first();
    check((await demote.count()) > 0, `the Ranch admin agent (${admin.name}) is offered demotion`);
    await demote.click();
    check(await until(async () => (await anyDialog(page).count()) > 0, { timeout: 4000 }), 'demoting asks first');
    check(await cancelDialog(page), 'Cancel closes it');
    await sleep(300);
    check(
      adminDeletes.length === 0 && (await agentOf(admin.id))?.isAdmin === true,
      'and the agent still has its admin tools',
    );
    await openOverview(page, agent);
  } else {
    console.log('  note this installation has no Ranch admin agent: "demote asks first" was not exercised');
  }

  section('Delete agent');
  const danger = hook(page, 'block', 'danger').first();
  await danger.scrollIntoViewIfNeeded();
  check(/cannot be undone/i.test(await textOf(danger)), 'the block says deletion cannot be undone');
  await hook(page, 'delete-agent').first().click();
  const deleteDialog = hook(page, 'delete-dialog').first();
  check(
    await until(async () => (await deleteDialog.count()) > 0 && (await deleteDialog.isVisible()), { timeout: 4000 }),
    'pressing Delete opens a confirmation',
  );
  check(!(await bar.present()), 'on its own, not through the save bar');
  check((await hook(page, 'delete-download').count()) > 0, 'it offers to download the files first');
  check((await hook(page, 'delete-wipe').count()) > 0, 'and to wipe the stored files too');
  check((await hook(page, 'delete-confirm').count()) > 0, 'next to the button that really deletes');
  await shot(page, 'rest-delete-dialog');
  const cancel = deleteDialog.getByRole('button', { name: /^cancel$/i });
  if ((await cancel.count()) > 0) await cancel.first().click();
  else await page.keyboard.press('Escape');
  check(
    await until(async () => !((await deleteDialog.count()) > 0 && (await deleteDialog.isVisible())), { timeout: 4000 }),
    'Cancel closes it',
  );
  await sleep(300);
  check(deletes.length === 0 && (await api(`/agents/${agent}`)).status === 200, 'and the agent is still there');
  check(!(await dialog.visible()), 'with no other question left open');

  section('No sideways scroll');
  await unfold(page, 'advanced');
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width < 800 ? 844 : 900 });
    await sleep(400);
    const fits = await noSidewaysScroll(page);
    check(fits, `${width} px: the page does not scroll sideways`);
    if (width === 390) await shot(page, 'rest-390');
    if (width === 1440) await shot(page, 'rest-1440');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await openOverview(page, agent);
  const name = hook(page, 'field', 'name').first();
  await name.scrollIntoViewIfNeeded();
  await name.fill('limits-off on a phone');
  check((await bar.appears()) && (await inViewport(bar.bar)), '390 px: the save bar is on screen while a field is edited');
  check(await noSidewaysScroll(page), 'and brings no sideways scroll with it');
  await shot(page, 'rest-390-save-bar');
  await bar.discard();
  await bar.leaves();
  await page.context().close();

  section('Reduced motion');
  const calm = await adminPage(browser, { width: 1280, height: 860, reduced: true });
  await openOverview(calm, agent);
  await unfold(calm, 'advanced');
  await unfold(calm, 'embed');
  await hook(calm, 'field', 'name').first().fill('limits-off calm');
  await saveBar(calm).appears();
  await sleep(600);
  const moving = await calm
    .locator('[data-section-nav], [data-section-nav] *, [data-overview], [data-overview] *, [data-save-bar], [data-save-bar] *')
    .evaluateAll((els) => {
      const names = new Set();
      const animated = (c) =>
        c.animationName !== 'none' && c.display !== 'none' && c.visibility !== 'hidden' && parseFloat(c.animationDuration) > 0;
      for (const el of els) {
        for (const pseudo of [null, '::before', '::after']) {
          const c = getComputedStyle(el, pseudo);
          if (animated(c)) names.add(c.animationName);
        }
      }
      return [...names];
    });
  check(moving.length === 0, `nothing on the page is animated for a reader who asked for less motion (${moving.join(', ') || 'none'})`);
  const running = await calm.evaluate(
    () => document.getAnimations().filter((a) => a.playState === 'running' && (a.effect?.getTiming().duration ?? 0) > 0).length,
  );
  check(running === 0, `and nothing is in motion once the page has settled (${running})`);
  await saveBar(calm).discard();
  await calm.context().close();
} finally {
  await browser.close();
  // Back to the seed's state, whatever happened above.
  await start.restore();
}

done('rest');
