// Every request-limit check in one run (CLEAN-224, FR-038 to FR-041).
//
//   node specs/030-agent-request-limits/e2e/all.mjs
//
// It owns the API and the fake agents for the length of the run, because the
// hour and day scenarios need the API to boot on freshly seeded rows:
//
//   seed → start API → start fake agents → scenarios → restart API (and check
//   that nothing was forgotten) → the rest → stop both.
//
// What it does NOT start: Postgres (docker compose up -d postgres-local, with
// migrations applied and `bun run build` done in api/), the app console on
// :3000 and the admin console on :3001. It says so and stops if one of them
// is missing, or if something else already listens on the API port.
//
// Exit code 0 only when every script passed. `--only a,b` runs a subset.
//
// The process handling and the list of scenarios live in runner.mjs, shared
// with specs/031-agent-overview-redesign/e2e/all.mjs.
import { limitsScenarios, runSuite } from './runner.mjs';

await runSuite({ scenarios: limitsScenarios });
