// Every launch step list check in one run (CLEAN-247).
//
//   node specs/037-agent-launch-steps/e2e/all.mjs
//   node specs/037-agent-launch-steps/e2e/all.mjs --only launch
//
// It owns the API and the shared fake agents for the length of the run,
// through the runner of specs/030-agent-request-limits/e2e:
//
//   seed → start API → start fake agents → launch, look → stop both
//
// What it does NOT start: Postgres (with migrations applied and `bun run
// build` done in api/), the app console on :3000 and the admin console on
// :3001. It says so and stops if one is missing, or if something else
// already listens on the API port.
//
// Exit code 0 only when both scripts passed.
import { HERE } from './lib.mjs';
import { runSuite } from '../../030-agent-request-limits/e2e/runner.mjs';

await runSuite({
  scenarios: async (suite) => {
    await suite.scenario('launch', { dir: HERE });
    await suite.scenario('look', { dir: HERE });
  },
  budget: null,
});
