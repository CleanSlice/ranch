/**
 * Fails when a value's language could come from the wrong place.
 *
 *   bun run locale:check    no network, no API key, CI-safe
 *
 * `admin` is English whatever the browser says; `app` follows its active
 * language. Both are true only while every date, number and name order is
 * formatted by the console's own format module — so that is what this checks:
 * where a call sits, never what its arguments mean. "Is this the right locale"
 * needs understanding; "is this call in the one file allowed to make it" is a
 * lookup.
 *
 * It sits next to `i18n:check`, which asks a different question (does every key
 * exist in every language) about `app` only.
 *
 * Exceptions live in scripts/locale-check.allow.json, each with a reason. There
 * is no inline "ignore next line": an excuse written next to the code it
 * excuses gets copied along with the code.
 *
 * The contract is specs/018-english-admin-locale/contracts/locale-check.md.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse as parseTemplate } from '@vue/compiler-dom';
import { parse as parseSfc } from '@vue/compiler-sfc';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ALLOWLIST_PATH = join(ROOT, 'scripts', 'locale-check.allow.json');

export type Rule = 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'allowlist';

export type Finding = {
  rule: Rule;
  /** Repo-relative, forward slashes. */
  file: string;
  /** 1-based; 0 when the finding is about a file as a whole. */
  line: number;
  /** The offending text, trimmed. */
  found: string;
  /** One sentence: what to use instead. */
  fix: string;
};

export type AllowEntry = {
  file: string;
  rule: Rule;
  /** Excuse only a finding whose text is exactly this; omit to excuse the file. */
  match?: string;
  reason: string;
};

export type Result = {
  findings: Finding[];
  /** Files actually read. Printed on every run: a pass over zero files is how
   *  a wrong path looks, and it must not look like success. */
  files: number;
  /** Roots that do not exist. */
  missing: string[];
};

type Console = 'admin' | 'app';

// ------------------------------------------------------------------- scope

const CONSOLES: Console[] = ['admin', 'app'];
/** Files a console keeps beside `slices/` that render or configure text. */
const CONSOLE_ROOT_FILES = ['app.vue', 'error.vue', 'nuxt.config.ts'];
const API_ROOT = 'api/src';
const SKIPPED_DIRS = new Set(['node_modules', '.nuxt', '.output', 'dist']);

function consoleOf(path: string): Console | null {
  if (path.startsWith('admin/')) return 'admin';
  if (path.startsWith('app/')) return 'app';
  return null;
}

function isTool(path: string): boolean {
  return path.startsWith(`${API_ROOT}/`) && path.endsWith('.tool.ts');
}

/** Whether a repo-relative path is one the check reads. */
export function isChecked(path: string): boolean {
  if (path.split('/').some((part) => SKIPPED_DIRS.has(part))) return false;
  if (/\.(test|spec)\.ts$/.test(path)) return false;
  if (isTool(path)) return true;
  if (!consoleOf(path)) return false;
  // The SDK is generated from the API spec; nobody writes it and nobody reads
  // it on screen.
  if (path.includes('/repositories/api/')) return false;
  return /\.(vue|ts)$/.test(path);
}

// ---------------------------------------------------------------- comments

/**
 * The source with every comment blanked out, same length and same line breaks,
 * so a position in the result is a position in the file.
 *
 * Strings are tracked only to keep `//` inside `"https://…"` from starting a
 * comment; their content is kept, because a call inside a template literal
 * (`${d.toLocaleString()}`) is still a call.
 */
function withoutComments(src: string): string {
  const out = src.split('');
  const blank = (from: number, to: number) => {
    for (let i = from; i < to; i++) if (out[i] !== '\n' && out[i] !== '\r') out[i] = ' ';
  };

  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    const next = src[i + 1];

    if (ch === '"' || ch === "'") {
      // A quoted string ends at its quote or at the line: an apostrophe in
      // template text ("don't") must not swallow the rest of the file.
      let j = i + 1;
      while (j < src.length && src[j] !== ch && src[j] !== '\n') {
        if (src[j] === '\\') j++;
        j++;
      }
      i = j + 1;
      continue;
    }
    if (ch === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== '`') {
        if (src[j] === '\\') j++;
        j++;
      }
      i = j + 1;
      continue;
    }
    if (ch === '/' && next === '/' && src[i - 1] !== ':') {
      let j = i;
      while (j < src.length && src[j] !== '\n') j++;
      blank(i, j);
      i = j;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      const j = end === -1 ? src.length : end + 2;
      blank(i, j);
      i = j;
      continue;
    }
    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4);
      const j = end === -1 ? src.length : end + 3;
      blank(i, j);
      i = j;
      continue;
    }
    i++;
  }
  return out.join('');
}

/** `found` for a finding: the line as written, trimmed, kept to one screen line. */
function lineText(lines: string[], line: number): string {
  const text = (lines[line - 1] ?? '').trim();
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}

// ---------------------------------------------------------------------- L1

/**
 * Everything that formats, compares or reads by language. A trailing `(` means
 * the name is a call; without it any mention counts, a type annotation
 * included — a component that names `Intl.DateTimeFormat` is about to build one.
 */
export const L1_CALLS = [
  'toLocaleString(',
  'toLocaleDateString(',
  'toLocaleTimeString(',
  'localeCompare(',
  'Intl.DateTimeFormat',
  'Intl.NumberFormat',
  'Intl.RelativeTimeFormat',
  'Intl.PluralRules',
  'Intl.ListFormat',
  'Intl.Collator',
  'Intl.DisplayNames',
  'useTimeAgo(',
  'useTimeAgoIntl(',
  'useDateFormat(',
  'navigator.language',
  'navigator.languages',
] as const;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const L1_PATTERN = new RegExp(
  L1_CALLS.map((name) => {
    // Not part of a longer identifier or a member of something else:
    // `notIntl.DateTimeFormat` and `myuseTimeAgo(` are different names.
    const guard = name.includes('.') ? '(?<![\\w$.])' : '(?<![\\w$])';
    return name.endsWith('(')
      ? `${guard}${escapeRegExp(name.slice(0, -1))}\\s*\\(`
      : `${guard}${escapeRegExp(name)}\\b`;
  }).join('|'),
  'g',
);

const L1_FIX: Record<Console, string> = {
  admin:
    'language-sensitive call outside the format module — use #common/utils/format ' +
    '(formatDate, formatDateTime, formatTime, formatCount, compareText, …)',
  app:
    'language-sensitive call outside the format module — use useFormat() from ' +
    '#common/composables/useFormat, or #common/utils/format with the language passed in',
};

function checkL1(file: string, target: Console, src: string): Finding[] {
  const found: Finding[] = [];
  const original = src.split('\n');
  withoutComments(src)
    .split('\n')
    .forEach((text, index) => {
      for (const _ of text.matchAll(L1_PATTERN)) {
        found.push({
          rule: 'L1',
          file,
          line: index + 1,
          found: lineText(original, index + 1),
          fix: L1_FIX[target],
        });
      }
    });
  return found;
}

// ------------------------------------------------------------------ script

const LETTER = /\p{L}/u;
const LATIN = /\p{Script=Latin}/u;
/** Letters every script shares: the micro sign, the ordinal indicators. */
const COMMON = /\p{Script=Common}/u;

/**
 * Whether the text holds a letter from a script other than Latin.
 *
 * This is what "not English" can be decided by as a rule: it catches Russian,
 * Ukrainian, Greek, Arabic, CJK. It cannot tell English from German — that is
 * a judgment, and review owns it.
 */
function hasForeignLetter(text: string): boolean {
  // Plain ASCII is the overwhelming case; skip the per-character walk for it.
  if (!/[^\x00-\x7f]/.test(text)) return false;
  for (const ch of text) {
    if (LETTER.test(ch) && !LATIN.test(ch) && !COMMON.test(ch)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------- L2

const L2_FIX =
  'admin is English-only — write this in English; text a person or the agent wrote ' +
  'belongs in data, not in source';

function checkL2(file: string, src: string): Finding[] {
  const lines = src.split('\n');
  return lines.flatMap((text, index) =>
    hasForeignLetter(text)
      ? [{ rule: 'L2' as const, file, line: index + 1, found: lineText(lines, index + 1), fix: L2_FIX }]
      : [],
  );
}

// ---------------------------------------------------------------------- L3

const isI18nConfig = (file: string) => /(^|\/)(nuxt|i18n)\.config\.ts$/.test(file);
const isLocaleFile = (file: string) => /\/i18n\/locales\/[^/]+\.json$/.test(file);

const ADMIN_LANGUAGE = 'en';
const L3_LANGUAGE = /\b(defaultLocale|fallbackLocale|locale|code)\s*:\s*(['"])([^'"]*)\2/g;

function checkL3(file: string, src: string): Finding[] {
  if (!isI18nConfig(file)) return [];
  const found: Finding[] = [];
  const original = src.split('\n');
  withoutComments(src)
    .split('\n')
    .forEach((text, index) => {
      const finding = (fix: string): Finding => ({
        rule: 'L3',
        file,
        line: index + 1,
        found: lineText(original, index + 1),
        fix,
      });
      if (/\bdetectBrowserLanguage\b/.test(text)) {
        found.push(
          finding('admin does not ask the browser for a language — remove detectBrowserLanguage'),
        );
      }
      for (const match of text.matchAll(L3_LANGUAGE)) {
        if (match[3] !== ADMIN_LANGUAGE) {
          found.push(
            finding(`admin has one language — ${match[1]} must be '${ADMIN_LANGUAGE}'`),
          );
        }
      }
    });
  return found;
}

/** A locale file that should not exist. Decided by the path alone. */
function checkLocaleFile(file: string): Finding[] {
  if (consoleOf(file) !== 'admin' || !isLocaleFile(file)) return [];
  if (file.endsWith(`/${ADMIN_LANGUAGE}.json`)) return [];
  return [
    {
      rule: 'L3',
      file,
      line: 0,
      found: `a locale file other than ${ADMIN_LANGUAGE}.json`,
      fix: 'admin is English-only — remove the file; translations belong to app',
    },
  ];
}

// ---------------------------------------------------------------------- L4

/** The three fields of a tool the admin tool catalog shows an operator. */
const L4_FIELD = /\b(title|template|description)\s*:\s*/g;
const L4_FIX =
  'the admin tool catalog shows this — write it in English; the agent recognises a ' +
  'request in any language without a sample of it';

/**
 * The string literals that make up a value, `'a ' + 'b'` included, each with
 * the offset it starts at. Stops at the first thing that is not a literal or a
 * `+` between two of them.
 */
function readLiterals(src: string, from: number): { text: string; at: number }[] {
  const out: { text: string; at: number }[] = [];
  let i = from;
  for (;;) {
    while (/\s/.test(src[i] ?? '')) i++;
    const quote = src[i];
    if (quote !== "'" && quote !== '"' && quote !== '`') return out;

    let j = i + 1;
    while (j < src.length && src[j] !== quote) {
      if (src[j] === '\\') j++;
      j++;
    }
    out.push({ text: src.slice(i + 1, j), at: i + 1 });
    i = j + 1;

    while (/\s/.test(src[i] ?? '')) i++;
    if (src[i] !== '+') return out;
    i++;
  }
}

function checkL4(file: string, src: string): Finding[] {
  const found: Finding[] = [];
  const lines = src.split('\n');
  const bare = withoutComments(src);

  for (const field of bare.matchAll(L4_FIELD)) {
    const literals = readLiterals(src, field.index + field[0].length);
    const foreign = literals.find((literal) => hasForeignLetter(literal.text));
    if (!foreign) continue;

    // The line of the first foreign letter, not of the field's name: a
    // description runs over many lines and only one of them needs fixing.
    let offset = foreign.at;
    for (const ch of foreign.text) {
      if (hasForeignLetter(ch)) break;
      offset += ch.length;
    }
    const line = src.slice(0, offset).split('\n').length;
    found.push({ rule: 'L4', file, line, found: lineText(lines, line), fix: L4_FIX });
  }
  return found;
}

// ---------------------------------------------------------------------- L5

/** Static attributes whose value a customer reads or hears. */
const L5_ATTRIBUTES = new Set(['placeholder', 'title', 'aria-label', 'alt', 'label']);
const L5_FIX =
  'interface text goes through translation — add the English to the slice’s en.json ' +
  "and render it with $t('…'), then run bun run i18n:sync";

// @vue/compiler-dom node types; the package exports them as a const enum,
// which does not survive being imported into a script.
const ELEMENT = 1;
const TEXT = 2;
const ATTRIBUTE = 6;

type TemplateNode = {
  type: number;
  content?: string;
  name?: string;
  value?: { content: string };
  loc: { start: { line: number }; source: string };
  props?: TemplateNode[];
  children?: TemplateNode[];
};

function checkL5(file: string, src: string): Finding[] {
  const { descriptor } = parseSfc(src, { filename: file, sourceMap: false });
  const template = descriptor.template;
  if (!template?.content.trim()) return [];

  // Lines inside the template block count from 1; the block starts further down.
  const firstLine = template.loc.start.line;
  const found: Finding[] = [];
  const finding = (node: TemplateNode, text: string) =>
    found.push({
      rule: 'L5',
      file,
      line: firstLine + node.loc.start.line - 1,
      found: text.length > 120 ? `${text.slice(0, 117)}…` : text,
      fix: L5_FIX,
    });

  const visit = (node: TemplateNode) => {
    if (node.type === TEXT) {
      const text = (node.content ?? '').trim();
      if (LETTER.test(text)) finding(node, text.replace(/\s+/g, ' '));
      return;
    }
    if (node.type === ELEMENT) {
      for (const prop of node.props ?? []) {
        if (
          prop.type === ATTRIBUTE &&
          L5_ATTRIBUTES.has(prop.name ?? '') &&
          LETTER.test(prop.value?.content ?? '')
        ) {
          finding(prop, `${prop.name}="${prop.value!.content}"`);
        }
      }
    }
    for (const child of node.children ?? []) visit(child);
  };

  // Read as a syntax tree, not matched as text: a `>` inside an expression or
  // an attribute spanning several lines is then nothing special. A template
  // the parser stumbles on is the build's problem to report, not this check's.
  const ast = parseTemplate(template.content, {
    comments: false,
    onError: () => {},
  }) as unknown as TemplateNode;
  visit(ast);
  return found;
}

// ------------------------------------------------------------------ source

/** Every finding in one file, before the allowlist is applied. */
export function checkSource(file: string, content: string): Finding[] {
  const src = content.replace(/\r\n/g, '\n');
  const target = consoleOf(file);
  const found: Finding[] = [];

  if (target) found.push(...checkL1(file, target, src));
  if (target === 'admin') {
    found.push(...checkL2(file, src), ...checkL3(file, src));
  }
  if (isTool(file)) found.push(...checkL4(file, src));
  if (target === 'app' && file.endsWith('.vue')) found.push(...checkL5(file, src));

  return found.sort((a, b) => a.line - b.line);
}

// --------------------------------------------------------------- allowlist

const ALLOWLIST_FILE = 'scripts/locale-check.allow.json';

/**
 * Drops what the allowlist excuses, and turns the allowlist's own faults into
 * findings: an entry with no reason, and an entry that excuses nothing — so the
 * list cannot outlive the code it was written for.
 */
export function applyAllowlist(findings: Finding[], allow: AllowEntry[]): Finding[] {
  const used = new Set<AllowEntry>();
  const valid = allow.filter((entry) => entry.reason?.trim());

  const left = findings.filter((finding) => {
    const entry = valid.find(
      (e) =>
        e.file === finding.file &&
        e.rule === finding.rule &&
        (e.match === undefined || e.match === finding.found),
    );
    if (entry) used.add(entry);
    return !entry;
  });

  for (const entry of allow) {
    const label = entry.match ? `${entry.rule} "${entry.match}"` : entry.rule;
    if (!entry.reason?.trim()) {
      left.push({
        rule: 'allowlist',
        file: entry.file,
        line: 0,
        found: `exception for ${label} has no reason`,
        fix: `say why in ${ALLOWLIST_FILE}, or remove the entry`,
      });
    } else if (!used.has(entry)) {
      left.push({
        rule: 'allowlist',
        file: entry.file,
        line: 0,
        found: `exception for ${label} excuses nothing (${entry.reason.trim()})`,
        fix: `remove the entry from ${ALLOWLIST_FILE}`,
      });
    }
  }
  return left;
}

// --------------------------------------------------------------------- run

/** Files to read into `out`; locale files, judged by their path, into `locales`. */
function walk(root: string, dir: string, out: string[], locales: string[]): void {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) walk(root, path, out, locales);
    } else if (isChecked(path)) {
      out.push(path);
    } else if (isLocaleFile(path)) {
      locales.push(path);
    }
  }
}

const isDirectory = (path: string) => existsSync(path) && statSync(path).isDirectory();

export function run(root: string, allow: AllowEntry[]): Result {
  const roots = [...CONSOLES.map((c) => `${c}/slices`), API_ROOT];
  const missing = roots.filter((dir) => !isDirectory(join(root, dir)));

  const files: string[] = [];
  const locales: string[] = [];
  for (const dir of roots) {
    if (!missing.includes(dir)) walk(root, dir, files, locales);
  }
  for (const target of CONSOLES) {
    for (const name of CONSOLE_ROOT_FILES) {
      const path = `${target}/${name}`;
      if (existsSync(join(root, path))) files.push(path);
    }
  }

  const raw = [
    ...files
      .sort()
      .flatMap((file) => checkSource(file, readFileSync(join(root, file), 'utf8'))),
    ...locales.sort().flatMap(checkLocaleFile),
  ];

  return { findings: applyAllowlist(raw, allow), files: files.length, missing };
}

export function exitCode(result: Result): 0 | 1 | 2 {
  // A check that could not run is a failure, never a pass.
  if (result.missing.length || result.files === 0) return 2;
  return result.findings.length ? 1 : 0;
}

// ------------------------------------------------------------------ report

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

export function render(result: Result): string {
  if (result.missing.length) {
    return `locale: could not run — not found: ${result.missing.join(', ')}.`;
  }
  if (result.files === 0) {
    return 'locale: could not run — no files were read.';
  }
  const checked = `${plural(result.files, 'file')} checked`;
  if (!result.findings.length) return `locale: ${checked}, no findings.`;

  const lines = result.findings.flatMap((f) => [
    `${f.line ? `${f.file}:${f.line}` : f.file}  ${f.rule}  ${f.found}`,
    `  ${f.fix}`,
    '',
  ]);

  const perRule = new Map<Rule, number>();
  for (const f of result.findings) perRule.set(f.rule, (perRule.get(f.rule) ?? 0) + 1);
  const breakdown = [...perRule]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([rule, count]) => `${rule}: ${count}`)
    .join(', ');
  const inFiles = new Set(result.findings.map((f) => f.file)).size;

  lines.push(
    `locale: ${plural(result.findings.length, 'finding')} in ${plural(inFiles, 'file')} ` +
      `(${breakdown}). ${checked}.`,
  );
  return lines.join('\n');
}

// -------------------------------------------------------------------- main

if (import.meta.main) {
  let allow: AllowEntry[];
  try {
    allow = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8')) as AllowEntry[];
  } catch (error) {
    console.error(`locale: could not run — ${ALLOWLIST_FILE}: ${(error as Error).message}`);
    process.exit(2);
  }

  const result = run(ROOT, allow);
  const code = exitCode(result);
  (code === 0 ? console.log : console.error)(render(result));
  process.exit(code);
}
