// Every Overview check, then every request-limit check, in one run (CLEAN-228,
// FR-048 to FR-050).
//
//   node specs/031-agent-overview-redesign/e2e/all.mjs
//
// It owns the API and the fake agents for the length of the run, through the
// runner it shares with specs/030-agent-request-limits/e2e/all.mjs:
//
//   seed → start API → start fake agents → nav, summary, edit, limit, access,
//   rest → seed again and restart the API → the whole CLEAN-224 suite in its
//   own order (restart-survival check included) → stop both.
//
// The second seed is not a formality: the CLEAN-224 scenarios that go first
// stand on an hour window the seed fills, and that window frees about five
// minutes later — less than the six scripts before them take.
//
// What it does NOT start: Postgres (docker compose up -d postgres-local, with
// migrations applied and `bun run build` done in api/), the app console on
// :3000 and the admin console on :3001. It says so and stops if one of them
// is missing, or if something else already listens on the API port.
//
// Exit code 0 only when every script passed. `--only a,b` runs a subset, by
// the names in the summary (`--only nav,edit`, `--only settings`).
import { HERE } from './lib.mjs';
import { limitsScenarios, runSuite } from '../../030-agent-request-limits/e2e/runner.mjs';

const OVERVIEW = ['nav', 'summary', 'edit', 'limit', 'access', 'rest'];

await runSuite({
  before: async (suite) => {
    for (const name of OVERVIEW) await suite.scenario(name, { dir: HERE });
  },
  scenarios: limitsScenarios,
  // Two suites in one run: the ten-minute budget is the CLEAN-224 suite's own.
  budget: null,
});
