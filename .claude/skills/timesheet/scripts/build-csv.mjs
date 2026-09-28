// Turns the agreed rows into the CSV that Google Sheets imports.
//
//   node .claude/skills/timesheet/scripts/build-csv.mjs --rows rows.json [--out file.csv]
//
// rows.json: { "month": "2026-09", "rows": [{ "date": "2026-09-01", "key": "CLEAN-55", "text": "…", "hours": 2 }] }
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DAY_NAMES, jiraBase, loadEnv, monthBounds, parseArgs, repoRoot } from './env.mjs';

const HEADER = ['Дата', 'День', 'Задача', 'Ссылка', 'Описание', 'Часы'];
const LONG_DAY_HOURS = 10;

const args = parseArgs(process.argv.slice(2));
if (typeof args.rows !== 'string') throw new Error('--rows <file.json> is required.');

const { month, rows } = JSON.parse(readFileSync(resolve(args.rows), 'utf8'));
monthBounds(month);
if (!Array.isArray(rows) || rows.length === 0) throw new Error('rows.json has no rows.');

const base = jiraBase(loadEnv(repoRoot()));
const problems = [];
rows.forEach((row, index) => {
  const where = `row ${index + 1} (${row.date} ${row.key})`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date ?? '') || !row.date.startsWith(`${month}-`)) {
    problems.push(`${where}: date is outside ${month}`);
  }
  if (!/^[A-Z][A-Z0-9]+-\d+$/.test(row.key ?? '')) problems.push(`${where}: key is not a ticket id`);
  if (!Number.isInteger(row.hours) || row.hours < 1) problems.push(`${where}: hours must be a whole number, 1 or more`);
  if (typeof row.text !== 'string' || !row.text.trim()) problems.push(`${where}: description is empty`);
});
const pairs = rows.map((row) => `${row.date} ${row.key}`);
for (const pair of new Set(pairs.filter((value, index) => pairs.indexOf(value) !== index))) {
  problems.push(`${pair}: the same ticket appears twice on one day, merge the rows`);
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}

const sorted = rows
  .map((row, index) => ({ ...row, index }))
  .sort((a, b) => a.date.localeCompare(b.date) || a.index - b.index);

const cell = (value) => {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const perDay = new Map();
const lines = [HEADER];
for (const row of sorted) {
  const [year, monthNumber, day] = row.date.split('-');
  const name = DAY_NAMES[new Date(`${row.date}T12:00:00`).getDay()];
  lines.push([`${day}.${monthNumber}.${year}`, name, row.key, `${base}/browse/${row.key}`, row.text.trim(), row.hours]);
  perDay.set(row.date, (perDay.get(row.date) ?? 0) + row.hours);
}
const total = [...perDay.values()].reduce((sum, hours) => sum + hours, 0);
lines.push(['ИТОГО', '', '', '', `${perDay.size} рабочих дней`, total]);

const downloads = join(homedir(), 'Downloads');
const folder = existsSync(downloads) ? downloads : tmpdir();
const out = typeof args.out === 'string' ? resolve(args.out) : join(folder, `timesheet-${month}.csv`);
writeFileSync(out, lines.map((line) => line.map(cell).join(',')).join('\r\n') + '\r\n', 'utf8');

console.log(`csv   ${out}`);
console.log(`rows  ${rows.length} · days ${perDay.size} · hours ${total}`);
console.log([...perDay].map(([date, hours]) => `${date.slice(8)}:${hours}`).join('  '));
const long = [...perDay].filter(([, hours]) => hours > LONG_DAY_HOURS).map(([date, hours]) => `${date} (${hours}h)`);
if (long.length) console.log(`days above ${LONG_DAY_HOURS}h, bring them down: ${long.join(', ')}`);
