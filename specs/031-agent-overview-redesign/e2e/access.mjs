// The Access block: landing page, allowed origins, embed code (CLEAN-228,
// User Story 5).
//
//   node specs/031-agent-overview-redesign/e2e/access.mjs
//
// An origin typed and entered becomes a chip; a duplicate is not added; a
// path or a missing scheme is refused with the hint; a chip goes by pointer
// and by keyboard; the saved list survives a reload. Embed code is closed
// until asked for, shows one of three snippets at a time, and Copy puts the
// snippet on the clipboard — with no token for a public agent and a
// placeholder for a private one. Turning the landing page on with no limit is
// refused, pointing at Request limit. The share-link warning is still there.
//
// Leaves `limits-off` as the seed made it.
//
// Needs: API :3333 (after seed.mjs), admin :3001.
import {
  AGENTS,
  adminPage,
  agentOf,
  agentPut,
  captureRequests,
  check,
  done,
  hook,
  launch,
  limitsOf,
  openOverview,
  remember,
  saveBar,
  section,
  shot,
  textOf,
  unfold,
  until,
} from './lib.mjs';

const agent = AGENTS.off;
const SHOP = 'https://shop.example.test';
const DOCS = 'https://docs.example.test';
const KB = 'https://kb.example.test:8443';

const block = (page) => hook(page, 'block', 'access').first();
const field = (page) => hook(page, 'origin-input').first();
const hint = (page) => textOf(hook(page, 'origin-hint'));
const chips = (page) =>
  block(page)
    .locator('[data-origins] [data-origin]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-origin')));
const chipsAre = (page, list) => until(async () => (await chips(page)).join(' ') === list.join(' '), { timeout: 4000 });
async function enter(page, text, key = 'Enter') {
  await field(page).fill(text);
  await field(page).press(key);
}
/** The snippets on screen right now (one, when the block behaves). */
const snippets = (page) =>
  page.locator('[data-embed] [data-embed-code]').evaluateAll((els) =>
    els.filter((el) => el.getBoundingClientRect().height > 0).map((el) => (el.textContent ?? '').trim()),
  );
async function showKind(page, kind) {
  const before = (await snippets(page))[0] ?? '';
  await hook(page, 'embed-kind', kind).first().click();
  await until(async () => (await snippets(page)).length === 1 && ((await snippets(page))[0] !== before || kind === 'bubble'), {
    timeout: 3000,
  });
  return (await snippets(page))[0] ?? '';
}
const copyButton = (page) => page.locator('[data-embed] [data-embed-copy]').locator('visible=true').first();
const clipboard = (page) => page.evaluate(() => navigator.clipboard.readText());
const same = (a, b) => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();

section('Preconditions');
const start = await remember(agent);
check(start.agent?.isPublic === false && start.limits === null, 'limits-off is private with no limits');
check((start.agent?.allowedOrigins ?? []).length === 0, 'and allows no origin');
check((await agentOf(AGENTS.minute))?.isPublic === true, 'limits-minute is public');

const browser = await launch();
try {
  const page = await adminPage(browser, {
    width: 1440,
    height: 1000,
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const bar = saveBar(page);
  const puts = captureRequests(page, agentPut(agent), 'PUT');

  section('One block for access');
  await openOverview(page, agent);
  await block(page).scrollIntoViewIfNeeded();
  check((await hook(page, 'visibility-saved').first().getAttribute('data-visibility-saved')) === 'private', 'the agent is saved as private');
  check((await block(page).locator('[data-visibility-public]').count()) === 1, 'the landing-page switch is in Access');
  check((await hook(page, 'visibility-public').count()) === 1, 'and nowhere else on Overview');
  const words = await textOf(block(page));
  check(/private/i.test(words) && /hidden/i.test(words), 'it says what the state means: private, hidden from the public list');
  check((await hook(page, 'visibility-origins').count()) === 0, 'the old one-per-line origins field is gone');

  section('Adding origins');
  check((await chips(page)).length === 0, 'no origins yet');
  const noneYet = await hint(page);
  check(/token/i.test(noneYet), `the hint says every origin needs a token ("${noneYet}")`);
  await enter(page, SHOP);
  check(await chipsAre(page, [SHOP]), 'an origin typed and entered becomes a chip');
  check((await field(page).inputValue()) === '', 'the field is empty for the next one');
  check(await bar.counts(1), 'it counts as one unsaved change');
  check((await hint(page)) !== noneYet && /without/i.test(await hint(page)), `the hint now says those pages need no token ("${await hint(page)}")`);
  await field(page).fill('');
  await field(page).focus();
  await page.keyboard.type(`${DOCS},`);
  check(await chipsAre(page, [SHOP, DOCS]), 'a comma adds one too');
  check(await bar.counts(1), 'the list is still one change');

  section('What is not added');
  await enter(page, SHOP);
  check(await chipsAre(page, [SHOP, DOCS]), 'a duplicate is not added twice');
  await field(page).fill('');
  await enter(page, `${SHOP}/`);
  check(await chipsAre(page, [SHOP, DOCS]), 'nor the same origin with a trailing slash');
  await field(page).fill('');
  await enter(page, `${SHOP}/pricing`);
  check(await chipsAre(page, [SHOP, DOCS]), 'an address with a path is not an origin');
  const refusedHint = await hint(page);
  check(/scheme|host|path|https?:\/\//i.test(refusedHint), `the hint says what an origin looks like ("${refusedHint}")`);
  await shot(page, 'access-origin-refused');
  await field(page).fill('');
  await enter(page, 'shop.example.test');
  check(await chipsAre(page, [SHOP, DOCS]), 'nor is a host with no scheme');
  check(/scheme|host|path|https?:\/\//i.test(await hint(page)), 'with the same hint');
  await field(page).fill('');

  section('Removing origins');
  const removeDocs = block(page).locator(`[aria-label="Remove ${DOCS}"]`).first();
  check((await removeDocs.count()) === 1, 'the remove button names its origin for a screen reader');
  await removeDocs.click();
  check(await chipsAre(page, [SHOP]), 'a chip goes with the pointer');
  await enter(page, KB);
  check(await chipsAre(page, [SHOP, KB]), 'an origin with a port is accepted');
  // By keyboard: Backspace in the empty field takes the last chip; where it
  // does not, the chip's own button does, focused and pressed.
  await field(page).focus();
  await page.keyboard.press('Backspace');
  if (!(await chipsAre(page, [SHOP]))) {
    await block(page).locator(`[aria-label="Remove ${KB}"]`).first().focus();
    await page.keyboard.press('Enter');
  }
  check(await chipsAre(page, [SHOP]), 'and with the keyboard');
  await enter(page, DOCS);
  check(await chipsAre(page, [SHOP, DOCS]), 'two origins to save');
  await shot(page, 'access-origins');

  section('Save and reload');
  check((await agentOf(agent))?.allowedOrigins?.length === 0, 'nothing was saved while editing');
  await bar.save();
  check(await bar.leaves(10000), 'one Save');
  check(
    puts.length === 1 && Object.keys(puts[0] ?? {}).join(',') === 'allowedOrigins',
    `sends the origins and nothing else (${Object.keys(puts[0] ?? {}).join(', ')})`,
  );
  check(((await agentOf(agent))?.allowedOrigins ?? []).join(' ') === `${SHOP} ${DOCS}`, 'the server has both, in order');
  await openOverview(page, agent);
  check(await chipsAre(page, [SHOP, DOCS]), 'after a reload both chips are there');
  check(!(await bar.present()), 'with nothing unsaved');

  section('Embed code, private agent');
  const embed = hook(page, 'embed').first();
  await embed.scrollIntoViewIfNeeded();
  check((await embed.getAttribute('data-state')) === 'closed', 'Embed code is closed by default');
  check((await snippets(page)).length === 0, 'no snippet is on the page');
  check(await unfold(page, 'embed'), 'it opens when asked');
  check((await hook(page, 'embed-kind').count()) === 3, 'three choices: Floating bubble, Inline, Mint a token');
  check(
    await until(async () => (await snippets(page)).length === 1, { timeout: 4000 }),
    'one snippet is shown at a time',
  );
  const bubble = await showKind(page, 'bubble');
  check(bubble.includes(agent), 'Floating bubble: the snippet carries the agent id');
  check(/data-token=/.test(bubble), 'and, for a private agent, the token placeholder');
  await copyButton(page).click();
  check(await until(async () => same(await clipboard(page), bubble), { timeout: 4000 }), 'Copy puts that snippet on the clipboard');
  const inline = await showKind(page, 'inline');
  check(inline !== bubble && inline.includes(agent) && /data-token=/.test(inline), 'Inline: another snippet, same agent, same placeholder');
  check((await snippets(page)).length === 1, 'shown instead of the first, not under it');
  await copyButton(page).click();
  check(await until(async () => same(await clipboard(page), inline), { timeout: 4000 }), 'Copy follows the snippet on screen');
  const token = await showKind(page, 'token');
  check(/\/auth\/embed\/token/.test(token), 'Mint a token: the request your backend makes');
  await copyButton(page).click();
  check(await until(async () => same(await clipboard(page), token), { timeout: 4000 }), 'and Copy copies it');
  await shot(page, 'access-embed');

  section('Embed code, public agent');
  await openOverview(page, AGENTS.minute);
  check((await hook(page, 'embed').first().getAttribute('data-state')) === 'closed', 'closed again on another agent');
  await unfold(page, 'embed');
  const publicBubble = await showKind(page, 'bubble');
  check(publicBubble.includes(AGENTS.minute), 'the snippet is for this agent');
  check(!/data-token/.test(publicBubble), 'and has no token in it');
  const publicInline = await showKind(page, 'inline');
  check(!/data-token/.test(publicInline), 'neither has the inline one');

  section('Landing page on, with no limit');
  await openOverview(page, agent);
  puts.length = 0;
  await hook(page, 'visibility-public').first().click();
  check(await bar.counts(1), 'turning the switch on is one unsaved change');
  await bar.save();
  const limitRefusal = page.locator('[data-block="limit"] [data-limits-error-code="PUBLIC_AGENT_NEEDS_LIMITS"]');
  check(
    await until(async () => (await limitRefusal.count()) > 0 && (await limitRefusal.first().isVisible()), { timeout: 8000 }),
    'the save is refused in the Request limit block',
  );
  const here = block(page).locator('[data-field-error], [data-limits-error]').locator('visible=true');
  check((await here.count()) > 0, 'and by the switch itself');
  check(/limit/i.test(await textOf(here)), `in words that point at the request limit ("${await textOf(here)}")`);
  check((await hook(page, 'visibility-saved').first().getAttribute('data-visibility-saved')) === 'private', 'what is saved still reads private');
  check((await agentOf(agent))?.isPublic === false && (await limitsOf(agent)) === null, 'and the server agrees');
  check(await bar.present(), 'the bar stays for the fix');
  await shot(page, 'access-public-needs-limits');
  await bar.discard();
  check(await bar.leaves(), 'Discard clears it');

  section('A private agent with a share link and no limits');
  await openOverview(page, AGENTS.share);
  check(
    await until(async () => (await hook(page, 'limits-share-warning').count()) > 0, { timeout: 8000 }),
    'the warning from CLEAN-224 is still shown',
  );
  check((await block(page).locator('[data-limits-share-warning]').count()) > 0, 'in Access');
} finally {
  await browser.close();
  // Back to the seed's state, whatever happened above.
  await start.restore();
}

done('access');
