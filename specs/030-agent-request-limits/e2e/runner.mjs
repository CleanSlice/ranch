// The orchestration behind `all.mjs`, here and in
// specs/031-agent-overview-redesign/e2e (CLEAN-224, CLEAN-228): one place
// that owns the API and the fake agents for the length of a run.
//
//   seed → start API → start fake agents → scenarios → stop both → summary
//
//   runSuite({ scenarios })           what `all.mjs` of this folder does
//   runSuite({ before, scenarios })   `before` runs first on its own seeded
//                                     stack; then the database is seeded again
//                                     and the API restarted, so `scenarios`
//                                     start exactly as they do on their own —
//                                     the hour window the seed fills frees
//                                     about five minutes later, and whatever
//                                     `before` left behind is gone.
//
// Both callbacks get the suite: `scenario(name, { dir, script })` runs one
// script and records its exit code; `restartCheck()` is the restart-survival
// check. `limitsScenarios` is the CLEAN-224 list in its order.
//
// What it does NOT start: Postgres, the app console on :3000 and the admin
// console on :3001. It says so and stops if one is missing, or if something
// else already listens on the API port. `--only a,b` runs a subset.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { ADMIN, AGENTS, API, APP, FAKE, HERE, REPO, arg, getLoad, sleep, until } from './lib.mjs';

const reachable = async (url) => {
  try {
    return (await fetch(url)).status < 500;
  } catch {
    return false;
  }
};

/** The CLEAN-224 scenarios, in the order their seeded windows need. */
export async function limitsScenarios(suite) {
  // These two stand on windows the seed filled; the hour one frees about five
  // minutes after the seed, so they go first.
  await suite.scenario('notice-long');
  await suite.scenario('operator');

  // Restart survival (FR-019, SC-010): what was used before a restart is
  // still used after it. Counts are flushed on shutdown and rebuilt at boot.
  await suite.restartCheck();

  await suite.scenario('settings');
  await suite.scenario('load');
  await suite.scenario('notice');
  await suite.scenario('notice-app');
  await suite.scenario('notice-share');
  await suite.scenario('http');
}

/**
 * Runs a whole suite and exits the process: 0 only when every script passed.
 * `budget` is the number of seconds after which the last line says so; null
 * for no remark.
 */
export async function runSuite({ scenarios, before = null, budget = 600 }) {
  const only = typeof arg('only') === 'string' ? arg('only').split(',') : null;
  const wanted = (name) => !only || only.includes(name);
  const started = Date.now();
  const children = [];
  const results = [];

  function run(script, args = [], dir = HERE) {
    return new Promise((done) => {
      const child = spawn(process.execPath, [resolve(dir, script), ...args], { stdio: 'inherit' });
      child.on('exit', (code) => done(code ?? 1));
    });
  }

  function startApi() {
    const child = spawn(process.execPath, ['dist/main'], {
      cwd: resolve(REPO, 'api'),
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    children.push(child);
    return child;
  }
  function startFake() {
    const child = spawn(process.execPath, [resolve(HERE, 'fakeAgent.mjs')], { stdio: 'ignore' });
    children.push(child);
    return child;
  }
  function stop(child) {
    return new Promise((done) => {
      if (!child || child.exitCode !== null) return done();
      child.once('exit', () => done());
      child.kill();
    });
  }
  const apiUp = () => until(() => reachable(`${API}/agents/public`), { timeout: 60000, every: 500 });
  const agentsUp = () =>
    until(
      async () => {
        const res = await fetch(`${FAKE}/health`).then((r) => r.json());
        return res.connected === Object.keys(AGENTS).length;
      },
      { timeout: 30000, every: 500 },
    );

  let api;
  let fake;

  async function seedAndBoot() {
    console.log('━━ seed');
    if ((await run('seed.mjs')) !== 0) throw new Error('seed failed — is Postgres up and migrated?');
    api = startApi();
    if (!(await apiUp())) throw new Error('the API did not come up on its own (is api/dist built?).');
    if (!fake) fake = startFake();
    if (!(await agentsUp())) throw new Error('the fake agents could not connect to the hub.');
  }

  const suite = {
    only,
    /** One script; `dir` is the folder it lives in (this one by default). */
    async scenario(name, { dir = HERE, script = `${name}.mjs` } = {}) {
      if (!wanted(name)) return;
      console.log(`\n━━ ${name} ${'━'.repeat(Math.max(0, 60 - name.length))}`);
      const t = Date.now();
      const code = await run(script, [], dir);
      results.push({ name, ok: code === 0, seconds: Math.round((Date.now() - t) / 1000) });
    },
    /** Skipped under `--only`, as a partial run has no use for it. */
    async restartCheck() {
      if (only) return;
      console.log(`\n━━ restart ${'━'.repeat(53)}`);
      const before = {
        hour: (await getLoad(AGENTS.hour)).windows[1].used,
        day: (await getLoad(AGENTS.day)).windows[2].used,
      };
      await stop(api);
      await sleep(500);
      api = startApi();
      const up = await apiUp();
      await agentsUp();
      const after = up
        ? { hour: (await getLoad(AGENTS.hour)).windows[1].used, day: (await getLoad(AGENTS.day)).windows[2].used }
        : { hour: -1, day: -1 };
      const kept = up && after.hour >= before.hour && after.day >= before.day;
      console.log(
        `  ${kept ? 'ok  ' : 'FAIL'} usage survives a restart: hour ${before.hour} → ${after.hour}, day ${before.day} → ${after.day}`,
      );
      const stillFull = up && (await getLoad(AGENTS.day)).windows[2].retryAfterSec > 0;
      console.log(`  ${stillFull ? 'ok  ' : 'FAIL'} a full day window is still full: no fresh allowance was handed out`);
      results.push({ name: 'restart', ok: kept && stillFull, seconds: 0 });
    },
  };

  try {
    if (await reachable(`${API}/agents/public`)) {
      throw new Error(`something already answers on ${API}. Stop that API: this run starts its own, after seeding.`);
    }
    for (const [name, url] of [
      ['app console', `${APP}/login`],
      ['admin console', `${ADMIN}/login`],
    ]) {
      if (!(await reachable(url))) throw new Error(`the ${name} is not running at ${url} (see quickstart.md §2).`);
    }

    await seedAndBoot();
    if (before) {
      await before(suite);
      // A fresh start for what follows: seeded windows, seeded agents.
      await stop(api);
      await sleep(500);
      console.log('');
      await seedAndBoot();
    }
    await scenarios(suite);
  } catch (err) {
    console.error(`\nall: ${err.message}`);
    results.push({ name: 'setup', ok: false, seconds: 0 });
  } finally {
    await stop(fake);
    await stop(api);
    for (const child of children) if (child.exitCode === null) child.kill();
  }

  const total = Math.round((Date.now() - started) / 1000);
  console.log(`\n━━ summary ${'━'.repeat(53)}`);
  for (const r of results) console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${r.name.padEnd(14)} ${r.seconds ? `${r.seconds} s` : ''}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(
    `\nall: ${results.length - failed}/${results.length} passed in ${Math.floor(total / 60)} min ${total % 60} s` +
      (budget !== null && total > budget ? ' — over the ten-minute budget' : ''),
  );
  process.exit(failed ? 1 : 0);
}
