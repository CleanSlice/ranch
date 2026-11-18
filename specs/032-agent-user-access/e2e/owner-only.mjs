// The Ranch admin agent is the Owner's alone, in the admin console
// (CLEAN-232, User Story 10).
//
//   node specs/032-agent-user-access/e2e/owner-only.mjs
//
// As an Admin: the Ranch admin agent shows one line, "This agent is managed
// by the Owner.", and none of its management tabs, panels or controls; no
// request is sent that the API would answer 404; the promote-to-admin
// control is not offered on any agent. As the Owner all of it is there.
// "Created by" shows the seeded creator, and "Unknown" for an agent that has
// none. And one call from the script: an Admin cannot edit the Owner.
//
// Runs at 390 px and 1440 px. Fails on any console error and any failed
// request that is not listed in EXPECTED below.
//
// Needs: API :3333 (after seed.mjs), admin :3001, fakeRuntime.mjs.
import {
  ADMIN,
  ADMIN_USER,
  AGENTS,
  OWNER,
  USER,
  WIDTHS,
  api,
  check,
  done,
  launch,
  loginAs,
  section,
  shot,
  sleep,
  until,
  watchedPage,
} from './lib.mjs';

/**
 * Failed requests this scenario expects, and why. The local stack has no S3
 * bucket configured, so the routes that read an agent's workspace answer the
 * Owner 400 "S3 bucket is not configured": its environment preview (the
 * Overview reads it) and the counts of files, secrets and channels in the
 * section list. They are the Owner's requests only: for an Admin on the
 * Ranch admin agent none of them may be sent at all, so nothing is expected
 * there.
 */
const NO_BUCKET = [{ status: 400, url: /\/agents\/[^/]+\/(env|channels|files|secrets)(\?|\/|$)/ }];

const MANAGEMENT_SECTIONS = ['channels', 'secrets', 'env', 'files', 'logs', 'a2a'];
const workspace = (id, tab) => `${ADMIN}/agents/${id}${tab ? `?tab=${tab}` : ''}`;
const count = (page, selector) => page.locator(selector).count();
const textOf = async (page, selector) =>
  ((await page.locator(selector).first().textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();

async function open(page, url) {
  await page.goto(url, { waitUntil: 'networkidle' });
  // The workspace decides what to show once the agent has loaded.
  await until(async () => (await count(page, '[data-workspace-tab="chat"], [data-owner-managed]')) > 0, { timeout: 15000 });
  await sleep(400);
}

/** Opens the folded Advanced block of the Overview. */
async function openAdvanced(page) {
  const block = page.locator('[data-advanced]').first();
  await block.waitFor({ state: 'visible', timeout: 15000 });
  if ((await count(page, '[data-created-by]')) === 0) {
    await block.locator('button, summary, [role="button"]').first().click();
  }
  await page.locator('[data-created-by]').first().waitFor({ state: 'visible', timeout: 10000 });
}

// Since CLEAN-231 the seeded Admin is limited to access-alpha and
// access-bravo, so the Ranch admin agent is simply not there for them. This
// script is about what an Admin who DOES reach it may see and do, so for its
// own run the Owner also allows it for the Admin, through the access route,
// and takes it back at the end.
const adminAccountId = (await api('/users', { as: OWNER })).body.find((u) => u.email === ADMIN_USER.email)?.id;
async function setAdminAccess(allowed) {
  const current = (await api(`/users/${adminAccountId}/agent-access`, { as: OWNER })).body;
  return api(`/users/${adminAccountId}/agent-access`, {
    method: 'PUT',
    as: OWNER,
    body: { allowed, denied: [], version: current?.version ?? null },
  });
}
{
  const res = await setAdminAccess([AGENTS.a.id, AGENTS.b.id, AGENTS.ranch.id]);
  check(res.status === 200 && res.body?.allowed?.length === 3, `for this run the Admin is allowed the Ranch admin agent too (${res.status})`);
}

const browser = await launch();
try {
  for (const width of WIDTHS) {
    const height = width < 600 ? 844 : 900;

    // ------------------------------------------------------------- Admin
    section(`Admin console, ${width} px, as an Admin`);
    {
      const { context, page, problems } = await watchedPage(browser, { width, height });
      await loginAs(page, ADMIN_USER, ADMIN);

      await open(page, workspace(AGENTS.ranch.id));
      const line = page.locator('[data-owner-managed]');
      check((await line.count()) === 1 && (await line.first().isVisible()), 'the Ranch admin agent shows the owner-managed line, once');
      check(
        (await textOf(page, '[data-owner-managed]')) === 'This agent is managed by the Owner.',
        `it reads "This agent is managed by the Owner." ("${await textOf(page, '[data-owner-managed]')}")`,
      );
      check((await count(page, '[data-workspace-tab="settings"]')) === 0, 'no Settings tab');
      check((await count(page, '[data-section-nav]')) === 0, 'no section list (files, secrets, logs, channels, environment)');
      check(
        (await count(page, '[data-agent-toggle-running]')) === 0 && (await count(page, '[data-agent-actions]')) === 0,
        'no Stop/Start and no actions menu (restart, delete)',
      );
      check((await count(page, '[data-delete-agent]')) === 0 && (await count(page, '[data-debug-toggle]')) === 0, 'no delete block, no Debug toggle');
      await shot(page, `owner-only-admin-ranch-${width}`);

      // A typed address gets no further than the tab that is offered.
      for (const tab of ['files', 'secrets', 'logs', 'channels', 'env', 'overview']) {
        await open(page, workspace(AGENTS.ranch.id, tab));
        const shown =
          (await count(page, '[data-section-nav]')) + (await count(page, `[data-section="${tab}"]`)) + (await count(page, '[data-delete-agent]'));
        check(shown === 0 && (await count(page, '[data-owner-managed]')) === 1, `?tab=${tab} shows the line and no panel`);
      }
      await shot(page, `owner-only-admin-ranch-typed-tab-${width}`);
      check(
        problems.length === 0,
        `on the Ranch admin agent: no console error and no failed request, so nothing was asked that answers 404${problems.length ? `: ${problems.join(' | ')}` : ''}`,
      );
      problems.length = 0;
      await context.close();
    }
    {
      // An ordinary agent, which an Admin manages: the workspace is whole,
      // only the promote control is the Owner's.
      const { context, page, problems } = await watchedPage(browser, { width, height, expected: NO_BUCKET });
      await loginAs(page, ADMIN_USER, ADMIN);
      await open(page, workspace(AGENTS.a.id, 'overview'));
      check((await count(page, '[data-owner-managed]')) === 0, `${AGENTS.a.name}: no owner-managed line, an Admin manages it`);
      check((await count(page, '[data-workspace-tab="settings"]')) === 1, 'the Settings tab is offered');
      await openAdvanced(page);
      check((await count(page, '[data-admin-action]')) === 0, 'the promote-to-admin control is not offered');
      check(
        /Only the Owner can change which agent is the Ranch admin\.$/.test(await textOf(page, '[data-admin-owner-only]')),
        `instead: "${await textOf(page, '[data-admin-owner-only]')}"`,
      );
      check(
        (await textOf(page, '[data-created-by][data-state="known"] dd')) === `access-admin · ${ADMIN_USER.email}`,
        `Created by shows the seeded creator ("${await textOf(page, '[data-created-by] dd')}")`,
      );
      await shot(page, `owner-only-admin-alpha-${width}`);

      await open(page, workspace(AGENTS.b.id, 'overview'));
      await openAdvanced(page);
      check(
        (await textOf(page, '[data-created-by][data-state="unknown"] dd')) === 'Unknown',
        `${AGENTS.b.name}, with no creator recorded: "${await textOf(page, '[data-created-by] dd')}"`,
      );
      await shot(page, `owner-only-admin-bravo-${width}`);
      check(problems.length === 0, `no console error, no unexpected failed request${problems.length ? `: ${problems.join(' | ')}` : ''}`);
      await context.close();
    }

    // ------------------------------------------------------------- Owner
    section(`Admin console, ${width} px, as the Owner`);
    {
      const { context, page, problems } = await watchedPage(browser, { width, height, expected: NO_BUCKET });
      await loginAs(page, OWNER, ADMIN);

      await open(page, workspace(AGENTS.ranch.id, 'overview'));
      check((await count(page, '[data-owner-managed]')) === 0, 'the Ranch admin agent shows no owner-managed line');
      check((await count(page, '[data-workspace-tab="settings"]')) === 1, 'the Settings tab is there');
      const missing = [];
      for (const s of MANAGEMENT_SECTIONS) if ((await count(page, `[data-section-nav] [data-section="${s}"]`)) === 0) missing.push(s);
      check(missing.length === 0, `the section list has ${MANAGEMENT_SECTIONS.join(', ')}${missing.length ? ` (missing: ${missing.join(', ')})` : ''}`);
      check(
        (await count(page, '[data-agent-toggle-running]')) >= 1 && (await count(page, '[data-agent-actions]')) >= 1,
        'Stop/Start and the actions menu are there',
      );
      await openAdvanced(page);
      check((await count(page, '[data-admin-action="demote"]')) === 1, 'the Ranch admin control is offered: Demote');
      check((await count(page, '[data-delete-agent]')) >= 1, 'and the delete block');
      await shot(page, `owner-only-owner-ranch-${width}`);

      for (const tab of ['files', 'secrets', 'logs']) {
        await open(page, workspace(AGENTS.ranch.id, tab));
        check((await count(page, `[data-section-nav] [data-section="${tab}"]`)) === 1, `?tab=${tab} opens its panel for the Owner`);
      }
      await shot(page, `owner-only-owner-ranch-logs-${width}`);

      await open(page, workspace(AGENTS.a.id, 'overview'));
      await openAdvanced(page);
      check(
        (await count(page, '[data-admin-action="promote"]')) === 1 && /Promote to admin/.test(await textOf(page, '[data-admin-action="promote"]')),
        `${AGENTS.a.name}: "Promote to admin" is offered`,
      );
      await open(page, workspace(AGENTS.c.id, 'overview'));
      await openAdvanced(page);
      check(
        (await textOf(page, '[data-created-by][data-state="known"] dd')) === `access-user · ${USER.email}`,
        `${AGENTS.c.name}: Created by shows the User who created it ("${await textOf(page, '[data-created-by] dd')}")`,
      );
      await shot(page, `owner-only-owner-charlie-${width}`);
      check(problems.length === 0, `no console error, no unexpected failed request${problems.length ? `: ${problems.join(' | ')}` : ''}`);
      await context.close();
    }
  }
} finally {
  await browser.close();
}

section('From the script: the ceiling on accounts and on the Ranch admin agent');
{
  const users = (await api('/users', { as: OWNER })).body;
  const owner = users.find((u) => u.email === OWNER.email);
  const edit = await api(`/users/${owner.id}`, { method: 'PUT', body: { name: 'Renamed by an Admin' }, as: ADMIN_USER });
  check(edit.status === 403, `as an Admin, PUT /users/<owner id> answers 403 (${edit.status})`);
  const after = (await api('/users', { as: OWNER })).body.find((u) => u.id === owner.id);
  check(after?.name === owner.name && after?.role === 'Owner', 'and the Owner’s account is unchanged');

  const promote = await api(`/agents/${AGENTS.a.id}/promote-admin`, { method: 'POST', as: ADMIN_USER });
  check(promote.status === 403, `as an Admin, POST /agents/<alpha>/promote-admin answers 403 (${promote.status})`);
  for (const path of ['env', 'metrics', 'mcp-status', 'mcps', 'card', 'peers', 'peers/candidates', 'delegations']) {
    const res = await api(`/agents/${AGENTS.ranch.id}/${path}`, { as: ADMIN_USER });
    check(
      res.status === 404 && res.body?.message === 'Agent not found',
      `as an Admin, GET /agents/<ranch admin agent>/${path} answers 404 Agent not found (${res.status})`,
    );
  }
  const candidates = (await api(`/agents/${AGENTS.a.id}/peers/candidates`, { as: ADMIN_USER })).body;
  check(
    Array.isArray(candidates) && candidates.length > 0 && !candidates.some((c) => c.id === AGENTS.ranch.id),
    'the peer candidates an Admin is offered do not include the Ranch admin agent',
  );
  const forOwner = (await api(`/agents/${AGENTS.a.id}/peers/candidates`, { as: OWNER })).body;
  check(forOwner.some((c) => c.id === AGENTS.ranch.id), 'the Owner’s do');
  const mcps = await api(`/agents/${AGENTS.ranch.id}/mcps`, { as: OWNER });
  check(mcps.status === 200, `the Owner reads the Ranch admin agent’s MCP servers (${mcps.status})`);
}

{
  const back = await setAdminAccess([AGENTS.a.id, AGENTS.b.id]);
  check(back.status === 200 && back.body?.allowed?.length === 2, `the Admin is limited to access-alpha and access-bravo again (${back.status})`);
}

done('owner-only');
