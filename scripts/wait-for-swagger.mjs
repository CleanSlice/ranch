#!/usr/bin/env node
// admin/app's `predev` runs `openapi-ts` against `../api/swagger-spec.json`.
// That file is gitignored and only written once the api Nest process
// actually finishes booting (docker pull + prisma migrate + Nest bootstrap
// in main.ts) — turbo runs admin#dev/app#dev/api#dev in parallel with no
// ordering, so without this wait `openapi-ts` fails instantly with ENOENT
// on every fresh `ranch dev`, which then aborts the whole turbo pipeline
// (killing api's still-running docker/migrate step via SIGHUP).
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const target = resolve(process.cwd(), '../api/swagger-spec.json');
const timeoutMs = 5 * 60 * 1000;
const intervalMs = 1000;
const reminderMs = 30 * 1000;
const start = Date.now();
let lastReminder = start;

function poll() {
  if (existsSync(target)) {
    process.exit(0);
  }

  const elapsed = Date.now() - start;

  if (elapsed > timeoutMs) {
    console.error(
      `\n✖ Timed out after ${timeoutMs / 1000}s waiting for ${target}.\n\n` +
        '  api never finished starting, so it never wrote swagger-spec.json. Check the "api:dev" lines\n' +
        '  above for the actual failure — the most common one locally is:\n\n' +
        '    docker compose up -d ... unauthorized\n\n' +
        '  which means Docker isn\'t logged into ghcr.io for the private browser-pool image. Fix with:\n\n' +
        '    docker login ghcr.io -u <your-github-username>   (PAT with read:packages as the password)\n\n' +
        '  then re-run `ranch dev`. If api is instead stuck on a migration or a slow pull, just wait —\n' +
        '  rerunning `ranch dev` once api is healthy will pick up the file immediately.\n',
    );
    process.exit(1);
  }

  if (Date.now() - lastReminder > reminderMs) {
    lastReminder = Date.now();
    console.log(
      `⏳ Still waiting for ${target} (${Math.round(elapsed / 1000)}s) — see "api:dev" logs above if this doesn't resolve soon.`,
    );
  }

  setTimeout(poll, intervalMs);
}

if (!existsSync(target)) {
  console.log(`⏳ Waiting for ${target} (api is still starting)...`);
}

poll();
