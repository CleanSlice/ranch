// Editing the agent in place, one save bar (CLEAN-228, User Story 3).
//
//   node specs/031-agent-overview-redesign/e2e/edit.mjs
//
// No bar until something changes; each changed field is marked and counted;
// setting a field back uncounts it; Discard restores everything; Save sends
// the changed fields and nothing else (the request body is read), and a
// reload shows them; CPU brings the restart note and "Save and restart"; a
// refused save keeps every edit; every way out with unsaved changes asks
// first; and the old Edit address lands on Overview.
//
// "Save and restart" is looked at, never pressed: on a local stack it would
// start a real deploy. Leaves `limits-off` as the seed made it.
//
// Needs: API :3333 (after seed.mjs), fakeAgent.mjs, admin :3001.
import {
  ADMIN,
  AGENTS,
  FIXTURES,
  adminPage,
  agentAny,
  agentOf,
  agentPut,
  captureRequests,
  check,
  confirmDialog,
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
  until,
} from './lib.mjs';

const agent = AGENTS.off;
const RENAMED = 'limits-off renamed';
const [base] = FIXTURES.knowledge;
const { primary, second } = FIXTURES.llm;

/** The control of a Configuration row: the hooked element, or the field inside it. */
async function control(page, field) {
  const el = hook(page, 'field', field).first();
  const tag = await el.evaluate((node) => node.tagName);
  if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(tag)) return el;
  const inner = el.locator('input, textarea, select, [role="combobox"]').first();
  return (await inner.count()) > 0 ? inner : el;
}
const changed = async (page, field) => (await hook(page, 'field', field).first().getAttribute('data-changed')) !== null;
const anyChanged = (page) => page.locator('[data-overview] [data-changed]').count();
const valueOf = async (page, field) => (await control(page, field)).inputValue();
const type = async (page, field, text) => (await control(page, field)).fill(text);

/** Picks a credential in the Model row, whether it is a native select or the theme's. */
async function pickCredential(page, cred) {
  const el = await control(page, 'llm');
  if ((await el.evaluate((node) => node.tagName)) === 'SELECT') {
    const index = await el.evaluate(
      (node, c) => [...node.options].findIndex((o) => o.value === c.id || o.text.includes(c.label) || o.text.includes(c.model)),
      cred,
    );
    await el.selectOption({ index });
    return;
  }
  await el.click();
  const options = page.getByRole('option');
  await options.first().waitFor({ state: 'visible', timeout: 4000 });
  const byLabel = options.filter({ hasText: cred.label });
  await ((await byLabel.count()) > 0 ? byLabel : options.filter({ hasText: cred.model })).first().click();
}
/** What the Model row shows as chosen: the option's value and its words. */
async function shownCredential(page) {
  const el = await control(page, 'llm');
  return el.evaluate((node) =>
    node.tagName === 'SELECT'
      ? `${node.value} ${node.selectedOptions[0]?.text ?? ''}`
      : `${node.getAttribute('data-value') ?? ''} ${node.textContent ?? ''}`,
  );
}
const shows = (text, cred) => text.includes(cred.id) || text.includes(cred.label) || text.includes(cred.model);

/**
 * "From template" or "Choose for this agent". The hook is read both ways: on
 * each of the two buttons, or on the pair with the buttons inside it.
 */
async function knowledgeMode(page, mode) {
  const direct = page.locator(`[data-knowledge-mode="${mode}"][aria-pressed]`);
  if ((await direct.count()) > 0) return direct.first().click();
  return page
    .locator('[data-knowledge-mode] [aria-pressed]')
    .nth(mode === 'template' ? 0 : 1)
    .click();
}
const option = (page, id) => hook(page, 'knowledge-option', id).first();

/** The three edits of the story: name, model, one knowledge base. */
async function editThree(page) {
  await type(page, 'name', RENAMED);
  await pickCredential(page, second);
  await knowledgeMode(page, 'own');
  await option(page, base.id).waitFor({ state: 'visible', timeout: 6000 });
  await option(page, base.id).click();
}

section('Preconditions');
const start = await remember(agent);
check(start.agent?.name === 'limits-off', `limits-off has its seeded name (${start.agent?.name})`);
check(start.agent?.llmCredentialId === primary.id, 'it runs on the first seeded credential');
check((start.agent?.knowledgeIds ?? []).length === 0, "it uses its template's knowledge bases");
check(start.agent?.isPublic === false && start.limits === null, 'it is private with no limits');

const browser = await launch();
try {
  const page = await adminPage(browser, { width: 1440, height: 900 });
  const bar = saveBar(page);
  const dialog = confirmDialog(page);
  /** Bodies of `PUT /agents/<id>`: what a save of this page sends. */
  const puts = captureRequests(page, agentPut(agent), 'PUT');
  /** Any write about this agent at all, to prove that editing sends none. */
  const writes = [
    captureRequests(page, agentAny(agent), 'PUT'),
    captureRequests(page, agentAny(agent), 'POST'),
    captureRequests(page, agentAny(agent), 'PATCH'),
    captureRequests(page, agentAny(agent), 'DELETE'),
  ];
  const written = () => writes.reduce((n, list) => n + list.length, 0);

  section('Nothing changed');
  await openOverview(page, agent);
  for (const field of ['name', 'description', 'llm', 'knowledge', 'cpu', 'memory']) {
    if ((await hook(page, 'field', field).count()) === 0) check(false, `Configuration has no ${field} row`);
  }
  check((await hook(page, 'block', 'config').count()) === 1, 'Configuration holds name, description, model, knowledge and resources');
  check((await valueOf(page, 'name')) === 'limits-off', 'the name is editable where it stands, showing what is saved');
  check(!(await bar.present()), 'there is no save bar');
  check((await anyChanged(page)) === 0, 'and no field is marked as changed');

  section('One change');
  await type(page, 'name', RENAMED);
  check(await bar.appears(), 'renaming the agent brings the save bar');
  check(await changed(page, 'name'), 'the name is marked as changed');
  check((await bar.count()) === 1, `the bar counts one change (${await bar.count()})`);
  check(/1 unsaved change\b/i.test(await bar.text()), `in words: "1 unsaved change" ("${await bar.text()}")`);
  check(
    (await hook(page, 'save-discard').first().isVisible()) && (await hook(page, 'visibility-save').first().isVisible()),
    'with Discard and Save',
  );
  check((await bar.bar.first().getAttribute('role')) === 'status', 'the bar is announced as a status');
  check((await hook(page, 'save-restart-note').count()) === 0, 'and no word about a restart');
  await shot(page, 'edit-one-change');

  section('Three changes');
  await pickCredential(page, second);
  check(await bar.counts(2), 'another model makes it two');
  check(await changed(page, 'llm'), 'the model is marked as changed');
  await knowledgeMode(page, 'own');
  await option(page, base.id).waitFor({ state: 'visible', timeout: 6000 });
  check((await hook(page, 'knowledge-option').count()) >= FIXTURES.knowledge.length, 'choosing its own knowledge lists the bases');
  check(await bar.counts(2), 'an own selection with nothing ticked is not a change yet');
  await option(page, base.id).click();
  check(await bar.counts(3), 'ticking a knowledge base makes it three');
  check(await changed(page, 'knowledge'), 'knowledge is marked as changed');
  check(written() === 0, 'nothing was sent to the server while editing');
  await shot(page, 'edit-three-changes');

  section('A field set back by hand');
  await type(page, 'name', 'limits-off');
  check(await bar.counts(2), 'the count drops to two');
  check(!(await changed(page, 'name')), 'and the name is no longer marked');
  await type(page, 'name', RENAMED);
  check(await bar.counts(3), 'changed again: three');

  section('Discard');
  await bar.discard();
  check(await bar.leaves(), 'the bar leaves');
  check((await valueOf(page, 'name')) === 'limits-off', 'the name is back');
  check(shows(await shownCredential(page), primary), 'the model is back');
  check((await hook(page, 'knowledge-option').count()) === 0, "knowledge is back on the template's, with no list");
  check((await anyChanged(page)) === 0, 'no field is marked as changed');
  check(written() === 0 && (await agentOf(agent))?.name === 'limits-off', 'and nothing reached the server');

  section('Save');
  await editThree(page);
  check(await bar.counts(3), 'the same three changes again');
  await bar.save();
  check(await bar.leaves(10000), 'after Save the bar leaves');
  check(puts.length === 1, `one request was sent (${puts.length})`);
  const body = puts[0] ?? {};
  check(
    Object.keys(body).sort().join(',') === 'knowledgeIds,llmCredentialId,name',
    `carrying the three changed fields and nothing else (${Object.keys(body).sort().join(', ')})`,
  );
  check(
    body.name === RENAMED &&
      body.llmCredentialId === second.id &&
      Array.isArray(body.knowledgeIds) &&
      body.knowledgeIds.join(',') === base.id,
    'with the values that were on screen',
  );
  const saved = await agentOf(agent);
  check(
    saved?.name === RENAMED && saved?.llmCredentialId === second.id && (saved?.knowledgeIds ?? []).join(',') === base.id,
    'the server has all three',
  );
  check((await anyChanged(page)) === 0, 'no field is marked as changed any more');

  section('After a reload');
  await openOverview(page, agent);
  check((await valueOf(page, 'name')) === RENAMED, 'the new name is there');
  check(shows(await shownCredential(page), second), 'so is the new model');
  check(
    await until(async () => (await option(page, base.id).count()) > 0, { timeout: 6000 }),
    'and the agent has its own knowledge selection, with the base in it',
  );
  check(!(await bar.present()), 'with nothing unsaved');

  section('Resources');
  puts.length = 0;
  const cpuBefore = await valueOf(page, 'cpu');
  const memoryBefore = await valueOf(page, 'memory');
  await type(page, 'cpu', '750m');
  check(await bar.counts(1), 'a CPU change is one change');
  check((await hook(page, 'save-restart-note').count()) > 0, 'the bar says resources apply on restart');
  check(/restart/i.test(await textOf(hook(page, 'save-restart-note'))), 'in words');
  check(await hook(page, 'save-restart').first().isVisible(), 'and offers "Save and restart"');
  check(await hook(page, 'visibility-save').first().isVisible(), 'next to plain Save');
  await shot(page, 'edit-restart-note');
  await type(page, 'cpu', cpuBefore);
  check(await bar.leaves(), 'CPU set back: the bar and its note leave');
  await type(page, 'memory', '768Mi');
  check((await bar.appears()) && (await hook(page, 'save-restart').count()) > 0, 'memory brings the same offer');
  await type(page, 'cpu', '750m');
  check(await bar.counts(2), 'CPU and memory are two changes');
  await bar.save();
  check(await bar.leaves(10000), 'plain Save saves without restarting');
  check(
    puts.length === 1 && Object.keys(puts[0] ?? {}).join(',') === 'resources',
    `one request with resources only (${Object.keys(puts[0] ?? {}).join(', ')})`,
  );
  const resources = (await agentOf(agent))?.resources;
  check(resources?.cpu === '750m' && resources?.memory === '768Mi', `the server has them (${JSON.stringify(resources)})`);
  check(memoryBefore !== '768Mi' && cpuBefore !== '750m', 'and they differ from what was there');

  section('A save the server refuses');
  puts.length = 0;
  await type(page, 'name', 'limits-off refused');
  await hook(page, 'visibility-public').first().click();
  check(await bar.counts(2), 'a new name and "public" with no limit: two changes');
  await bar.save();
  const refusal = page.locator('[data-limits-error-code="PUBLIC_AGENT_NEEDS_LIMITS"]');
  check(
    await until(async () => (await refusal.count()) > 0 && (await refusal.first().isVisible()), { timeout: 8000 }),
    'the save is refused, with the reason on the page',
  );
  check((await textOf(refusal)).length > 10, `in words ("${await textOf(refusal)}")`);
  check((await bar.present()) && (await bar.count()) === 2, 'the bar stays, still counting two');
  check((await valueOf(page, 'name')) === 'limits-off refused', 'the other edit is still on screen');
  const kept = await agentOf(agent);
  check(kept?.name === RENAMED && kept?.isPublic === false, 'and nothing was half-saved: name and visibility are as before');
  check((await limitsOf(agent)) === null, 'no limit appeared either');
  await shot(page, 'edit-refused');
  await bar.discard();
  check(await bar.leaves(), 'Discard clears it');

  section('Leaving with unsaved changes');
  const UNSAVED = 'limits-off unsaved';
  const dirty = async () => (await valueOf(page, 'name')) === UNSAVED && (await bar.count()) === 1;
  const stays = async (label) => {
    const asked = await dialog.appears();
    check(asked, `${label}: the console asks first`);
    if (asked) await dialog.cancel();
    check(
      page.url().includes(`/agents/${agent}`) && page.url().includes('tab=overview'),
      `${label}: Cancel stays on Overview`,
    );
    check(await dirty(), `${label}: and the edit is still there`);
  };
  await type(page, 'name', UNSAVED);
  check(await bar.counts(1), 'one unsaved change');

  await page.locator('[data-section-nav] [data-section="knowledge"]').first().click();
  await stays('another section');

  // The Chat tab of the agent page, by its hook (the section row "Chats" is
  // another thing).
  await page.locator('[data-workspace-tab="chat"]').first().click();
  await stays('the Chat tab');

  await page.locator(`li[data-agent-id="${AGENTS.minute}"]`).first().click();
  await stays('another agent');

  await page.getByRole('link', { name: 'Templates', exact: true }).first().click();
  await stays('another page');
  await shot(page, 'edit-leave-asked');

  section('Leaving anyway');
  puts.length = 0;
  await page.locator('[data-section-nav] [data-section="knowledge"]').first().click();
  check(await dialog.appears(), 'asked again');
  await dialog.accept();
  check(
    await until(async () => page.url().includes('tab=knowledge'), { timeout: 6000 }),
    'accepting opens the other section',
  );
  await openOverview(page, agent);
  check((await valueOf(page, 'name')) === RENAMED && !(await bar.present()), 'back on Overview the edit is gone');
  check(puts.length === 0 && (await agentOf(agent))?.name === RENAMED, 'and it was never saved');
  await type(page, 'name', UNSAVED);
  await bar.appears();
  await page.getByRole('link', { name: 'Templates', exact: true }).first().click();
  check(await dialog.appears(), 'another page: asked');
  await dialog.accept();
  check(
    await until(async () => !page.url().includes(`/agents/${agent}`), { timeout: 8000 }),
    `accepting leaves the agent (${new URL(page.url()).pathname})`,
  );

  section('With nothing unsaved, nobody is asked');
  await openOverview(page, agent);
  await page.locator('[data-section-nav] [data-section="knowledge"]').first().click();
  check(
    await until(async () => page.url().includes('tab=knowledge'), { timeout: 6000 }),
    'another section opens at once',
  );
  check(!(await dialog.visible()), 'with no question');

  section('The old Edit address');
  await page.goto(`${ADMIN}/agents/${agent}/edit`, { waitUntil: 'networkidle' });
  check(
    await until(async () => !page.url().includes('/edit') && page.url().includes('tab=overview'), { timeout: 10000 }),
    `/agents/:id/edit leads to ?tab=overview (${new URL(page.url()).pathname}${new URL(page.url()).search})`,
  );
  check(page.url().includes(`/agents/${agent}`), 'of the same agent');
  check(
    await until(async () => (await hook(page, 'overview').count()) > 0 && (await hook(page, 'field', 'name').count()) > 0, {
      timeout: 10000,
    }),
    'where the agent is edited now',
  );
} finally {
  await browser.close();
  // Back to the seed's state, whatever happened above.
  await start.restore();
}

done('edit');
