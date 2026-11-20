// CLEAN-236: every scenario, one seed. `node specs/033-identity-boundaries/e2e/all.mjs`
// against the local API of quickstart.md §2. One scenario by name:
// `node …/all.mjs handover visitors`.
import { done } from './lib.mjs';
import { seed } from './seed.mjs';

const SCENARIOS = ['hidden', 'connect', 'outside', 'visitors', 'handover', 'record', 'conversations', 'consoles'];

const wanted = process.argv.slice(2);
const unknown = wanted.filter((w) => !SCENARIOS.includes(w));
if (unknown.length) {
  console.error(`No such scenario: ${unknown.join(', ')}. There are: ${SCENARIOS.join(', ')}.`);
  process.exit(2);
}

const people = await seed();
for (const name of wanted.length ? wanted : SCENARIOS) {
  console.log(`\n######## ${name}`);
  const { run } = await import(`./${name}.mjs`);
  await run(people);
}
await done();
