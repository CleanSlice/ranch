// Collects one person's month from Jira and the local git clones.
//
//   node .claude/skills/timesheet/scripts/collect.mjs [--month YYYY-MM] [--repos a,b] [--out file.json]
//
// The person is whoever `git config user.email` says, confirmed against Jira. Anyone can
// run this, so an address Jira does not know never silently becomes somebody's hours:
// the script falls back to the default address and says so in the first lines it prints.
import { existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import {
  DAY_NAMES,
  defaultMonth,
  git,
  jiraBase,
  jiraClient,
  loadEnv,
  localDate,
  localTime,
  monthBounds,
  parseArgs,
  repoRoot,
  tryGit,
} from './env.mjs';

const DEFAULT_EMAIL = 'maksym.hryzodub@dreamvention.com';
const SIBLING_REPOS = ['runtime', 'bridle'];
const FIELD_SEPARATOR = '\x1f';

const args = parseArgs(process.argv.slice(2));
const root = repoRoot();
const env = loadEnv(root);
const jira = jiraClient(env);
const project = env.JIRA_PROJECT || 'CLEAN';
const month = typeof args.month === 'string' ? args.month : defaultMonth();
const { start, end } = monthBounds(month);
const now = new Date();
const inMonth = (date) => date >= start && date < end;
const sameAddress = (a, b) => (a ?? '').toLowerCase() === (b ?? '').toLowerCase();

// Jira hides addresses in its answers, so the proof is the query itself: the full address
// goes in, and exactly one person of the project has to come back. Names are never tried,
// a name is not a credential.
async function findJiraUser(email) {
  if (sameAddress(email, env.JIRA_EMAIL)) return jira('/rest/api/3/myself');
  const query = encodeURIComponent(email);
  // The plain user search needs a global permission most tokens lack and then answers [].
  const searches = [
    `/rest/api/3/user/assignable/search?project=${project}&query=${query}`,
    `/rest/api/3/user/search?query=${query}`,
  ];
  for (const path of searches) {
    const found = (await jira(path, { allowMissing: true })) ?? [];
    const people = found.filter((user) => user.accountType === 'atlassian' && user.active !== false);
    const exact = people.filter((user) => sameAddress(user.emailAddress, email));
    if (exact.length === 1) return exact[0];
    if (people.length === 1) return people[0];
  }
  return null;
}

async function resolveIdentity() {
  const gitEmail = tryGit(root, ['config', 'user.email']);
  const gitName = tryGit(root, ['config', 'user.name']);
  const fallback = env.TIMESHEET_DEFAULT_EMAIL || DEFAULT_EMAIL;

  if (gitEmail) {
    const user = await findJiraUser(gitEmail);
    if (user) return { source: 'git', gitEmail, gitName, email: gitEmail, user, warning: null };
  }

  const reason = gitEmail
    ? `git user.email ${gitEmail} was not found in Jira`
    : 'git user.email is not set in this clone';
  const user = await findJiraUser(fallback);
  if (!user) {
    throw new Error(`${reason}, and the default address ${fallback} was not found in Jira either. Nothing to report.`);
  }
  return {
    source: 'default',
    gitEmail: gitEmail || null,
    gitName: gitName || null,
    email: fallback,
    user,
    warning:
      `${reason}. Fell back to the default address ${fallback} (Jira: ${user.displayName}). ` +
      'This table belongs to that person, not necessarily to whoever ran the command.',
  };
}

function reposToScan() {
  if (typeof args.repos === 'string') return args.repos.split(',').map((path) => resolve(path.trim()));
  // Siblings sit next to the main checkout, which is not the worktree's own parent.
  const common = tryGit(root, ['rev-parse', '--git-common-dir']);
  const main = common ? dirname(resolve(root, common)) : root;
  const siblings = SIBLING_REPOS.map((name) => join(dirname(main), name)).filter((path) =>
    existsSync(join(path, '.git')),
  );
  return [root, ...siblings];
}

function readCommits(repo) {
  const since = new Date(start.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const format = ['%H', '%aI', '%an', '%ae', '%s'].join('%x1f');
  const log = git(repo, ['log', '--all', '--no-merges', `--since=${since}`, `--pretty=format:${format}`]);
  return log
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, authored, name, email, subject] = line.split(FIELD_SEPARATOR);
      return { hash, date: new Date(authored), name, email, subject, repo: basename(repo) };
    })
    .filter((commit) => inMonth(commit.date));
}

// GitHub squash-merges keep the author's name but may swap the address for a noreply one,
// so a name that was ever seen with the person's address counts as theirs too.
function ownCommits(commits, email) {
  const names = new Set(commits.filter((commit) => sameAddress(commit.email, email)).map((commit) => commit.name));
  const seen = new Set();
  return commits
    .filter((commit) => sameAddress(commit.email, email) || names.has(commit.name))
    .filter((commit) => {
      const key = `${commit.date.getTime()} ${commit.subject}`;
      if (seen.has(commit.hash) || seen.has(key)) return false;
      seen.add(commit.hash);
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.date - b.date);
}

const ISSUE_FIELDS = 'summary,status,created,creator,assignee,comment,parent';

async function searchIssues() {
  const next = new Date(end);
  const jql =
    `project = ${project} AND updated >= "${localDate(start)}" ` +
    `AND created < "${localDate(next)}" ORDER BY key ASC`;
  const issues = [];
  let token;
  do {
    const query = new URLSearchParams({ jql, fields: ISSUE_FIELDS, expand: 'changelog', maxResults: '50' });
    if (token) query.set('nextPageToken', token);
    const page = await jira(`/rest/api/3/search/jql?${query}`);
    issues.push(...(page.issues ?? []));
    token = page.nextPageToken;
  } while (token);
  return issues;
}

function issueEvents(issue, accountId) {
  const events = [];
  const fields = issue.fields;
  const created = new Date(fields.created);
  if (fields.creator?.accountId === accountId && inMonth(created)) {
    events.push({ date: created, kind: 'created', text: 'created' });
  }
  for (const history of issue.changelog?.histories ?? []) {
    const date = new Date(history.created);
    if (history.author?.accountId !== accountId || !inMonth(date)) continue;
    for (const item of history.items) {
      if (item.field === 'status') events.push({ date, kind: 'status', text: `${item.fromString} → ${item.toString}` });
    }
  }
  for (const comment of fields.comment?.comments ?? []) {
    const date = new Date(comment.created);
    if (comment.author?.accountId === accountId && inMonth(date)) events.push({ date, kind: 'comment', text: 'comment' });
  }
  return events.sort((a, b) => a.date - b.date);
}

const identity = await resolveIdentity();
const accountId = identity.user.accountId;

const repos = reposToScan();
const commits = ownCommits(repos.flatMap(readCommits), identity.email);
const keyPattern = new RegExp(`\\b${project}-\\d+\\b`, 'g');
for (const commit of commits) commit.keys = [...new Set(commit.subject.match(keyPattern) ?? [])];

const found = new Map((await searchIssues()).map((issue) => [issue.key, issue]));
const missing = [];
for (const key of new Set(commits.flatMap((commit) => commit.keys))) {
  if (found.has(key)) continue;
  const issue = await jira(`/rest/api/3/issue/${key}?fields=${ISSUE_FIELDS}&expand=changelog`, { allowMissing: true });
  if (issue) found.set(key, issue);
  else missing.push(key);
}

const committedKeys = new Set(commits.flatMap((commit) => commit.keys));
const issues = [];
for (const issue of found.values()) {
  const events = issueEvents(issue, accountId);
  const mine = issue.fields.assignee?.accountId === accountId;
  if (!mine && events.length === 0 && !committedKeys.has(issue.key)) continue;
  issues.push({
    key: issue.key,
    summary: issue.fields.summary,
    status: issue.fields.status?.name ?? null,
    assignee: issue.fields.assignee?.displayName ?? null,
    mine,
    parent: issue.fields.parent?.key ?? null,
    events,
  });
}
issues.sort((a, b) => Number(a.key.split('-')[1]) - Number(b.key.split('-')[1]));

// One bucket per local day, holding what happened on each ticket that day.
const days = new Map();
const bucket = (date, key) => {
  const day = localDate(date);
  if (!days.has(day)) days.set(day, new Map());
  const tickets = days.get(day);
  if (!tickets.has(key)) tickets.set(key, { jira: [], git: [] });
  return tickets.get(key);
};
for (const issue of issues) {
  for (const event of issue.events) bucket(event.date, issue.key).jira.push(`${localTime(event.date)} ${event.text}`);
}
for (const commit of commits) {
  const line = `${localTime(commit.date)} ${commit.repo}: ${commit.subject}`;
  for (const key of commit.keys.length ? commit.keys : ['(no ticket)']) bucket(commit.date, key).git.push(line);
}

const weekdaysWithoutActivity = [];
const daysNotYetWorked = [];
for (let date = new Date(start); date < end; date.setDate(date.getDate() + 1)) {
  const weekend = date.getDay() === 0 || date.getDay() === 6;
  const day = localDate(date);
  if (days.has(day) || weekend) continue;
  if (day > localDate(now)) daysNotYetWorked.push(day);
  else weekdaysWithoutActivity.push(day);
}

const byKey = new Map(issues.map((issue) => [issue.key, issue]));
const report = {
  month,
  generatedAt: now.toISOString(),
  identity: {
    source: identity.source,
    gitEmail: identity.gitEmail,
    gitName: identity.gitName,
    email: identity.email,
    jiraUser: identity.user.displayName,
    warning: identity.warning,
  },
  jiraBase: jiraBase(env),
  repos: repos.map((repo) => basename(repo)),
  issues,
  missingIssues: missing,
  days: [...days.keys()].sort().map((day) => ({
    date: day,
    day: DAY_NAMES[new Date(`${day}T12:00:00`).getDay()],
    tickets: [...days.get(day)].map(([key, activity]) => ({ key, ...activity })),
  })),
  weekdaysWithoutActivity,
  daysNotYetWorked,
};

const out = typeof args.out === 'string' ? resolve(args.out) : join(tmpdir(), `timesheet-${month}.json`);
writeFileSync(out, JSON.stringify(report, null, 1), 'utf8');

const list = (values) => (values.length ? values.join(', ') : 'none');
const header = [
  identity.warning
    ? `WARNING identity: ${identity.warning}`
    : `identity: git user.email ${identity.gitEmail} -> Jira "${identity.user.displayName}" (verified)`,
  '',
  `month ${month} · repos ${report.repos.join(', ')} · ${issues.length} tickets · ${commits.length} commits`,
  `today ${localDate(now)} ${localTime(now)}`,
  `tickets named in commits but absent in Jira: ${list(missing)}`,
  `weekdays without any activity: ${list(weekdaysWithoutActivity)}`,
  `weekdays still ahead, leave them out: ${list(daysNotYetWorked)}`,
];

const digest = [...header];
for (const day of report.days) {
  digest.push('', `${day.date} ${day.day}`);
  for (const ticket of day.tickets) {
    const issue = byKey.get(ticket.key);
    const notes = issue
      ? [
          `[${issue.status}]`,
          issue.parent ? `subtask of ${issue.parent}` : '',
          issue.mine ? '' : `assignee: ${issue.assignee ?? 'nobody'}`,
        ].filter(Boolean)
      : [];
    digest.push(`  ${ticket.key}${issue ? ` ${issue.summary.slice(0, 100)} ${notes.join(' · ')}` : ''}`);
    if (ticket.jira.length) digest.push(`    jira ${ticket.jira.join('; ')}`);
    for (const line of ticket.git) digest.push(`    git  ${line}`);
  }
}

// The day-by-day part runs to hundreds of lines, more than a tool result keeps,
// so it goes to a file and only the header is printed.
const digestFile = out.replace(/\.json$/i, '') + '.txt';
writeFileSync(digestFile, digest.join('\n') + '\n', 'utf8');

console.log(header.join('\n'));
console.log(`\ndigest ${digestFile}`);
console.log(`data   ${out}`);
