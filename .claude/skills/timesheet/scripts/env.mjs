// Shared plumbing for the timesheet scripts: git calls, `.env.project`, Jira requests.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// These scripts are read by a person or an agent: one line saying what is wrong, no stack.
process.on('uncaughtException', (error) => {
  console.error(`timesheet: ${error.message}`);
  process.exit(1);
});

export function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

export function tryGit(cwd, args) {
  try {
    return git(cwd, args);
  } catch {
    return '';
  }
}

export function repoRoot() {
  const root = tryGit(process.cwd(), ['rev-parse', '--show-toplevel']);
  if (!root) throw new Error('Run this from inside the git clone.');
  return root;
}

// A worktree may not carry its own `.env.project`, so the main checkout is the second place to look.
export function loadEnv(root) {
  const candidates = [join(root, '.env.project')];
  const common = tryGit(root, ['rev-parse', '--git-common-dir']);
  if (common) candidates.push(join(dirname(resolve(root, common)), '.env.project'));
  const file = candidates.find((path) => existsSync(path));
  if (!file) throw new Error('.env.project not found. It holds JIRA_DOMAIN, JIRA_EMAIL and JIRA_API_TOKEN.');

  const env = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].trim();
  }
  for (const key of ['JIRA_DOMAIN', 'JIRA_EMAIL', 'JIRA_API_TOKEN']) {
    if (!env[key]) throw new Error(`${key} is missing in .env.project. Add it there.`);
  }
  return env;
}

export function jiraBase(env) {
  const domain = env.JIRA_DOMAIN.replace(/\/+$/, '');
  return /^https?:\/\//.test(domain) ? domain : `https://${domain}`;
}

export function jiraClient(env) {
  const base = jiraBase(env);
  const headers = {
    Authorization: 'Basic ' + Buffer.from(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`).toString('base64'),
    Accept: 'application/json',
  };
  return async function jira(path, { allowMissing = false } = {}) {
    const response = await fetch(base + path, { headers });
    if (allowMissing && (response.status === 404 || response.status === 403)) return null;
    if (!response.ok) {
      const body = (await response.text()).slice(0, 300);
      throw new Error(`Jira ${response.status} on ${path.split('?')[0]}: ${body}`);
    }
    return response.json();
  };
}

const pad = (n) => String(n).padStart(2, '0');

export const localDate = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
export const localTime = (date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

export const DAY_NAMES = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

// "2026-09" -> local-time bounds of the month and its name for file names.
export function monthBounds(month) {
  const match = /^(\d{4})-(\d{2})$/.exec(month ?? '');
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) {
    throw new Error(`--month expects YYYY-MM, got "${month}".`);
  }
  const year = Number(match[1]);
  const index = Number(match[2]) - 1;
  return { start: new Date(year, index, 1), end: new Date(year, index + 1, 1) };
}

// Before the 15th people are closing the month that just ended; after it, the current one.
export function defaultMonth(now = new Date()) {
  const anchor = now.getDate() >= 15 ? now : new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${anchor.getFullYear()}-${pad(anchor.getMonth() + 1)}`;
}

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(argv[i]);
    if (!match) throw new Error(`Unexpected argument "${argv[i]}".`);
    if (match[2] !== undefined) args[match[1]] = match[2];
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) args[match[1]] = argv[(i += 1)];
    else args[match[1]] = true;
  }
  return args;
}
