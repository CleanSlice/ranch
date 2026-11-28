/**
 * Entry point of the summary calibration (CLEAN-270, spec 038 task T-CAL).
 * From the repository root:
 *
 *   (cd api && bun run build)
 *   bun api/scripts/summary-calibration.ts --sample <dir> [--dry] [--topics] [--vocabulary <file>]
 *
 * `--dry` checks the sample without calling the model, `--topics` lists the
 * topics a real run made, `--vocabulary <file>` starts the run with the
 * topics of that file.
 *
 * It runs the BUILT API, `api/dist`, as scripts/purgeRussianChats does: the
 * code the image runs is the code to measure, and bun cannot load every
 * slice from its TypeScript. A build older than the source is refused, so
 * that a prompt revised and not rebuilt is never measured as the old one
 * (src/scripts/summaryCalibration/build.ts): every source file under
 * `api/src` is compared with its built file, the runner's among them.
 *
 * What it does is in two folders, where the API's build type-checks it and
 * jest runs its specs. The runner, which constructs the summary service, is
 * in the chat slice: api/src/slices/chat/calibration/ (main.ts, which has
 * the runbook, and memory.ts). The pure parts are in
 * api/src/scripts/summaryCalibration/ (sample.ts, metrics.ts, report.ts,
 * build.ts), whose specs `bun run test:scripts` runs as well. This file is
 * outside `src` on purpose: it is a tool for a developer's machine, and
 * tsconfig.build.json leaves `scripts` out of the image.
 */
import 'reflect-metadata';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { staleSources } from '../src/scripts/summaryCalibration/build';

type Main = typeof import('../src/slices/chat/calibration/main').main;

/** How many stale files are named before "and N more". */
const NAMED = 5;

async function run(): Promise<number> {
  const src = join(__dirname, '..', 'src');
  const dist = join(__dirname, '..', 'dist');
  const stale = staleSources(src, dist);
  if (stale.length) {
    const more =
      stale.length > NAMED ? ` and ${stale.length - NAMED} more` : '';
    console.error(
      `the build in api/dist is older than the source (${stale.slice(0, NAMED).join(', ')}${more}).`,
    );
    console.error('Build it first: (cd api && bun run build)');
    return 2;
  }
  const built = join(dist, 'slices', 'chat', 'calibration', 'main.js');
  const { main } = (await import(pathToFileURL(built).href)) as { main: Main };
  return main(process.argv.slice(2));
}

void run().then(
  (code) => process.exit(code),
  (err) => {
    // Only the kind of failure: a message could carry what the model said
    // about a conversation.
    console.error(
      `summary calibration failed: ${err instanceof Error ? err.name : 'unknown failure'}`,
    );
    process.exit(1);
  },
);
