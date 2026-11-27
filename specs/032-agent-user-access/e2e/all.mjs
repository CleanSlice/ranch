// Every acting-party check in one run (CLEAN-232, Part A of spec 032).
//
//   node specs/032-agent-user-access/e2e/all.mjs
//   node specs/032-agent-user-access/e2e/all.mjs --only routes,acting
//   node specs/032-agent-user-access/e2e/all.mjs --skip assistant
//
//   seed → fake runtime → routes → acting → http → owner-only → live-status → switch →
//   owner-editor → ceiling → deletion → enforce → pins → assistant → ownership →
//   assistant-pages → badge → assistant-built-from → table
//
// What it does NOT start: Postgres, the API on :3333 (built, `node
// dist/main`), the app console on :3000 and the admin console on :3001
// (quickstart.md §2). It says so and stops if one is missing. It starts the
// fake runtime when none is running, and stops the one it started.
//
// `assistant` starts the real runtime and spends the project's model key (a
// handful of short turns); it also restarts the API process and leaves the
// new one running. `--skip assistant` runs everything else.
//
// Screenshots and logs go to E2E_OUT, never into the repo. Exit code 0 only
// when every script passed.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { ADMIN, API, APP, HERE, OUT, arg, fake, until } from './lib.mjs';

// assistant-built-from goes last: it runs seed.mjs again when it is done.
// `badge` is the script of specs/034 (the assistant setting, CLEAN-240): it
// runs on the same fixtures and belongs to the same set.
const SCRIPTS = ['routes', 'acting', 'http', 'owner-only', 'live-status', 'switch', 'owner-editor', 'ceiling', 'deletion', 'enforce', 'pins', 'assistant', 'ownership', 'assistant-pages', 'badge', 'assistant-built-from'];
/** Where a script lives when it is not next to this one. */
const ELSEWHERE = { badge: '../../034-rancher-access/e2e/badge.mjs' };
const only = typeof arg('only') === 'string' ? arg('only').split(',') : null;
const skip = typeof arg('skip') === 'string' ? arg('skip').split(',') : [];
const wanted = (name) => (!only || only.includes(name)) && !skip.includes(name);

const reachable = async (url) => {
  try {
    return (await fetch(url)).status < 500;
  } catch {
    return false;
  }
};

/** Runs one script; resolves with its exit code and its last line (the tally). */
function run(script, args = []) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [resolve(HERE, script), ...args], {
      stdio: ['ignore', 'pipe', 'inherit'],
      env: { ...process.env, E2E_OUT: OUT },
    });
    let tail = '';
    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk);
      tail = (tail + chunk.toString()).slice(-2000);
    });
    child.on('exit', (code) =>
      done({ code: code ?? 1, last: tail.trim().split(/\r?\n/).filter(Boolean).pop() ?? '' }),
    );
  });
}

const started = Date.now();
const results = [];
let fakeChild = null;

try {
  for (const [name, url] of [
    ['API', `${API}/agents/public`],
    ['app console', `${APP}/login`],
    ['admin console', `${ADMIN}/login`],
  ]) {
    if (!(await reachable(url))) throw new Error(`the ${name} is not running at ${url} (see quickstart.md §2).`);
  }

  console.log('━━ seed');
  const seed = await run('seed.mjs');
  results.push({ name: 'seed', ok: seed.code === 0, note: seed.code === 0 ? seed.last.slice(0, 70) : 'seed failed — is Postgres up and migrated?', seconds: 0 });
  if (seed.code !== 0) throw new Error('seed failed');

  if (!(await fake.health())) {
    fakeChild = spawn(process.execPath, [resolve(HERE, 'fakeRuntime.mjs')], { stdio: 'ignore' });
  }
  const connected = await until(async () => ((await fake.health())?.connected?.length ?? 0) === 4, { timeout: 30000, every: 500 });
  if (!connected) throw new Error('the fake runtime could not connect all four agents to the hub.');

  for (const name of SCRIPTS) {
    if (!wanted(name)) {
      results.push({ name, ok: null, note: 'skipped', seconds: 0 });
      continue;
    }
    console.log(`\n━━ ${name} ${'━'.repeat(Math.max(0, 60 - name.length))}`);
    const t = Date.now();
    const { code, last } = await run(ELSEWHERE[name] ?? `${name}.mjs`);
    results.push({ name, ok: code === 0, note: last, seconds: Math.round((Date.now() - t) / 1000) });
  }
} catch (err) {
  console.error(`\nall: ${err.message}`);
  if (!results.some((r) => r.ok === false)) results.push({ name: 'setup', ok: false, note: err.message, seconds: 0 });
} finally {
  if (fakeChild && fakeChild.exitCode === null) fakeChild.kill();
}

const total = Math.round((Date.now() - started) / 1000);
console.log(`\n━━ summary ${'━'.repeat(53)}`);
for (const r of results) {
  const mark = r.ok === null ? 'skip' : r.ok ? 'ok  ' : 'FAIL';
  console.log(`  ${mark} ${r.name.padEnd(11)} ${String(r.seconds ? `${r.seconds} s` : '').padEnd(6)} ${r.note}`);
}
const failed = results.filter((r) => r.ok === false).length;
const ran = results.filter((r) => r.ok !== null).length;
console.log(`\nall: ${ran - failed}/${ran} passed in ${Math.floor(total / 60)} min ${total % 60} s; screenshots and logs in ${OUT}`);
process.exit(failed ? 1 : 0);
