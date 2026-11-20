/**
 * Rewrites `.env.project` from Infisical, where the values actually live.
 *
 *   bun run env:pull
 *
 * `.env.project` used to be edited by hand in every clone and worktree, and the
 * copies drifted: a key rotated in one place kept answering 401 in another.
 * Infisical is the source now and the file is a copy of it. It stays on disk
 * because i18n-sync, the timesheet skill, the CLI's GHCR login and the e2e
 * probes read it directly.
 *
 * The login is a read-only machine identity in `.env.infisical` (gitignored,
 * one per repo, copied into worktrees next to `.env.project`):
 *
 *   INFISICAL_UNIVERSAL_AUTH_CLIENT_ID=
 *   INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET=
 *   INFISICAL_PROJECT_ID=
 *   INFISICAL_ENV=dev                          # the environment's slug, not its name
 *   INFISICAL_DOMAIN=https://eu.infisical.com  # optional, with the scheme
 *
 * Values are written bare, `KEY=value`: the readers above split on the first
 * `=` and take the rest as is, so a quoted value reaches the vendor with its
 * quotes on. A key Infisical does not have is kept and named, never dropped.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOGIN_FILE = '.env.infisical';
const TARGET_FILE = '.env.project';
const REQUIRED = [
  'INFISICAL_UNIVERSAL_AUTH_CLIENT_ID',
  'INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET',
  'INFISICAL_PROJECT_ID',
  'INFISICAL_ENV',
];

type Env = Record<string, string>;

/** Reads `KEY=value` lines; one pair of surrounding quotes is taken off. */
export function parseEnv(text: string): Env {
  const env: Env = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_]+)=(.*)$/.exec(line.trim());
    if (!match) continue;
    const value = match[2]!.trim();
    const quoted = /^(["'])(.*)\1$/.exec(value);
    env[match[1]!] = quoted ? quoted[2]! : value;
  }
  return env;
}

/** Infisical wins on every key it has; what only the local file has is kept. */
export function mergeEnv(pulled: Env, local: Env): { env: Env; localOnly: string[] } {
  const localOnly = Object.keys(local).filter((key) => !(key in pulled)).sort();
  return { env: { ...local, ...pulled }, localOnly };
}

export function renderEnv(env: Env): string {
  const lines = Object.keys(env)
    .sort()
    .map((key) => {
      const value = env[key]!;
      if (/[\r\n]/.test(value)) {
        throw new Error(`${key} spans several lines; ${TARGET_FILE} holds one value per line.`);
      }
      return `${key}=${value}`;
    });
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------- infisical

/** A worktree made by plain `git worktree add` has no login file; the main checkout does. */
function findLoginFile(): string {
  const candidates = [join(ROOT, LOGIN_FILE)];
  const common = spawnSync('git', ['rev-parse', '--git-common-dir'], { cwd: ROOT, encoding: 'utf8' });
  if (common.status === 0) {
    candidates.push(join(dirname(resolve(ROOT, common.stdout.trim())), LOGIN_FILE));
  }
  const file = candidates.find((path) => existsSync(path));
  if (!file) {
    throw new Error(`${LOGIN_FILE} not found. It holds ${REQUIRED.join(', ')}.`);
  }
  return file;
}

function infisical(args: string[], env: Env): string {
  const result = spawnSync('infisical', args, {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    windowsHide: true,
  });
  if (result.error) {
    throw new Error('The infisical CLI is not installed: https://infisical.com/docs/cli/overview');
  }
  if (result.status !== 0) {
    throw new Error(`infisical ${args[0]} failed:\n${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout.trim();
}

function pull(login: Env): Env {
  const domain = login.INFISICAL_DOMAIN ? [`--domain=${login.INFISICAL_DOMAIN}`] : [];

  // The identity goes in through the environment: arguments show up in `ps`.
  const token = infisical(['login', '--method=universal-auth', '--silent', '--plain', ...domain], {
    INFISICAL_UNIVERSAL_AUTH_CLIENT_ID: login.INFISICAL_UNIVERSAL_AUTH_CLIENT_ID!,
    INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET: login.INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET!,
  });

  const exported = infisical(
    [
      'export',
      '--format=json',
      `--projectId=${login.INFISICAL_PROJECT_ID}`,
      `--env=${login.INFISICAL_ENV}`,
      ...domain,
    ],
    { INFISICAL_TOKEN: token },
  );

  const env: Env = {};
  for (const secret of JSON.parse(exported) as { key: string; value: string }[]) {
    env[secret.key] = secret.value;
  }
  return env;
}

function main(): void {
  const login = parseEnv(readFileSync(findLoginFile(), 'utf8'));
  const missing = REQUIRED.filter((key) => !login[key]);
  if (missing.length) throw new Error(`${missing.join(', ')} missing in ${LOGIN_FILE}.`);

  const pulled = pull(login);
  if (!Object.keys(pulled).length) {
    throw new Error(
      `Infisical returned no secrets for environment "${login.INFISICAL_ENV}". ${TARGET_FILE} is left as it was.`,
    );
  }

  const target = join(ROOT, TARGET_FILE);
  const local = existsSync(target) ? parseEnv(readFileSync(target, 'utf8')) : {};
  const { env, localOnly } = mergeEnv(pulled, local);

  // Written next to the target and moved over it, so a failure halfway leaves the old file.
  const draft = `${target}.tmp`;
  writeFileSync(draft, renderEnv(env), { mode: 0o600 });
  renameSync(draft, target);

  console.log(`${TARGET_FILE}: ${Object.keys(pulled).length} keys from Infisical (${login.INFISICAL_ENV}).`);
  if (localOnly.length) {
    console.log(`Kept, not in Infisical: ${localOnly.join(', ')}. Add them there or delete them here.`);
  }
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
