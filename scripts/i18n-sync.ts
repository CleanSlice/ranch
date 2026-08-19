/**
 * Keeps the app console's non-English locale files in step with `en.json`.
 *
 *   bun run i18n:sync    translate whatever is missing or stale, write it back
 *   bun run i18n:check   verify only — no network, no API key, CI-safe
 *
 * `en.json` is written by hand and is the source of truth. Every other locale
 * is generated from it, one Claude request per slice per locale, and only for
 * the keys that actually need work.
 *
 * Staleness lives in app/i18n.sync.json: the hash of the English value at the
 * time a key was translated. Without it we'd only ever notice *new* keys, and
 * an edited English string would silently keep its outdated translation.
 *
 * Run with bun (not node) — it imports the LOCALES constant straight from the
 * TypeScript slice config, so the script and the app can't disagree about which
 * languages exist.
 */
import { createHash } from 'node:crypto';
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LOCALES, SOURCE_LOCALE } from '../app/slices/setup/i18n/locales';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SLICES_DIR = join(ROOT, 'app', 'slices');
const MANIFEST_PATH = join(ROOT, 'app', 'i18n.sync.json');
const ENV_FILE = join(ROOT, '.env.project');

const MODEL = 'claude-opus-5';

type FlatMessages = Record<string, string>;
type Manifest = { version: number; hashes: Record<string, FlatMessages> };

/** Slice with a locale directory: `app/slices/bridle` → `.../i18n/locales`. */
type Slice = { name: string; localesDir: string };

// ---------------------------------------------------------------- json utils

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/** 2-space + trailing newline, matching the hand-written locale files. */
function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/** `{ chat: { send: 'Send' } }` → `{ 'chat.send': 'Send' }`. */
function flatten(value: unknown, prefix = ''): FlatMessages {
  const out: FlatMessages = {};
  if (value === null || typeof value !== 'object') return out;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child !== null && typeof child === 'object') Object.assign(out, flatten(child, path));
    else if (typeof child === 'string') out[path] = child;
  }
  return out;
}

/**
 * Rebuilds nested JSON, walking `shape` (the English file) so the translated
 * file keeps the same key order — the two read side by side in a diff.
 */
function nestLike(shape: unknown, flat: FlatMessages, prefix = ''): unknown {
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(shape as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child !== null && typeof child === 'object') out[key] = nestLike(child, flat, path);
    else if (path in flat) out[key] = flat[path];
  }
  return out;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

/**
 * vue-i18n compiles every message, and a bare `@` starts a linked-message
 * reference — so `jane@example.com` fails the build with a compiler error and
 * has to be written as the literal `jane{'@'}mail.com`. Worth checking here
 * because CI runs typecheck/lint/test and this script, not `nuxt build`, so a
 * broken message would otherwise surface in production.
 *
 * `|` is deliberately NOT checked: it separates plural branches
 * ("no slots free | {count} slot free | {count} slots free"), which is a
 * feature we use, not a mistake.
 */
function unsafeMessage(value: string): boolean {
  const withoutLiterals = value.replace(/\{'[^']*'\}/g, '').replace(/\{\s*\w+\s*\}/g, '');
  // `@:key` and `@.lower:key` are the intentional linked-message forms.
  return /@(?![:.])/.test(withoutLiterals);
}

// ------------------------------------------------------------------ discovery

/** Every `<slice>/i18n/locales` directory under app/slices, at any nesting. */
function findSlices(dir: string, out: Slice[] = []): Slice[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'node_modules') continue;
    const path = join(dir, entry.name);
    const localesDir = join(path, 'i18n', 'locales');
    if (existsSync(localesDir) && statSync(localesDir).isDirectory()) {
      out.push({ name: relative(SLICES_DIR, path).replace(/\\/g, '/'), localesDir });
      continue;
    }
    findSlices(path, out);
  }
  return out;
}

// ------------------------------------------------------------------- planning

type Work = {
  slice: Slice;
  locale: string;
  source: FlatMessages;
  target: FlatMessages;
  /** Keys the target is missing entirely. */
  missing: string[];
  /** Keys whose English text changed since they were translated. */
  stale: string[];
  /** Translated by hand, never recorded — adopted as-is, not re-translated. */
  unrecorded: string[];
  /** Keys the target has but English no longer does. */
  orphaned: string[];
  /** Keys whose text would fail the vue-i18n message compiler. */
  invalid: string[];
};

function plan(manifest: Manifest): Work[] {
  const targets = LOCALES.filter((l) => l.code !== SOURCE_LOCALE);
  const work: Work[] = [];

  for (const slice of findSlices(SLICES_DIR)) {
    const sourceRaw = readJson<Record<string, unknown>>(
      join(slice.localesDir, `${SOURCE_LOCALE}.json`),
      {},
    );
    const source = flatten(sourceRaw);

    for (const { code, file } of targets) {
      const target = flatten(readJson<Record<string, unknown>>(join(slice.localesDir, file), {}));
      const known = manifest.hashes[`${slice.name}:${code}`] ?? {};

      const present = Object.keys(source).filter((k) => k in target);

      work.push({
        slice,
        locale: code,
        source,
        target,
        missing: Object.keys(source).filter((k) => !(k in target)),
        // A recorded hash that no longer matches means the English text was
        // edited — retranslate. No recorded hash at all means somebody wrote
        // this translation by hand, so adopt it instead of overwriting their
        // wording with a fresh machine translation.
        stale: present.filter((k) => known[k] !== undefined && known[k] !== hash(source[k]!)),
        unrecorded: present.filter((k) => known[k] === undefined),
        orphaned: Object.keys(target).filter((k) => !(k in source)),
        // Both sides: an unescaped @ in en.json breaks the build just as surely
        // as one the model wrote into ru.json.
        invalid: [
          ...Object.keys(source).filter((k) => unsafeMessage(source[k]!)),
          ...Object.keys(target).filter((k) => unsafeMessage(target[k]!)),
        ].filter((k, i, all) => all.indexOf(k) === i),
      });
    }
  }
  return work;
}

// ---------------------------------------------------------------- translation

function readApiKey(): string {
  const fromEnv = process.env.CLAUDE_API_KEY ?? process.env.ANTHROPIC_API_KEY;
  if (fromEnv) return fromEnv;

  if (existsSync(ENV_FILE)) {
    // .env.project is CRLF on Windows checkouts — trim or the key carries a \r
    // and every request comes back 401.
    for (const line of readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
      const match = /^CLAUDE_API_KEY=(.*)$/.exec(line.trim());
      if (match?.[1]) return match[1].trim();
    }
  }

  throw new Error(
    'No CLAUDE_API_KEY. Add it to .env.project (gitignored) or export it, then re-run.',
  );
}

const SYSTEM_PROMPT = [
  'You translate UI strings for Ranch, a platform for deploying AI agents on Kubernetes.',
  '',
  'Rules:',
  '- Return ONLY a JSON object mapping each key you were given to its translation.',
  '- Translate the value, never the key.',
  '- Keep placeholders exactly as they appear: {name}, {count}, @:some.key, and any HTML.',
  "- Never write a bare @ — vue-i18n reads it as a linked-message reference. An escaped literal such as {'@'} must come back verbatim.",
  '- A source message split by | is a plural set. Return the branch count the target language needs, in the order zero | one | few | many: English has 3 branches (zero | one | other), Russian needs 4 — "нет свободных слотов | {count} слот свободен | {count} слота свободно | {count} слотов свободно".',
  '- Do not translate product or component names: Ranch, Bridle, Paddock, Kubernetes, Argo Workflows, Docker.',
  '- Match the register of a modern product UI: short, direct, no marketing filler.',
  '- Keep the ending punctuation and letter case style of the source string.',
  '- Button and menu labels stay short enough to fit the same control.',
].join('\n');

async function translate(
  locale: string,
  slice: string,
  entries: FlatMessages,
): Promise<FlatMessages> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: readApiKey() });

  const request = [
    `Target language: ${locale}`,
    `Context: these strings belong to the "${slice}" area of the app.`,
    '',
    JSON.stringify(entries, null, 2),
  ].join('\n');

  for (let attempt = 1; attempt <= 2; attempt++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: 'low' },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: request }],
    });

    const text = response.content
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim()
      .replace(/^```(?:json)?\s*|\s*```$/g, '');

    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const missing = Object.keys(entries).filter((k) => typeof parsed[k] !== 'string');
      if (missing.length) throw new Error(`missing keys in reply: ${missing.join(', ')}`);
      const broken = Object.keys(entries).filter((k) => unsafeMessage(parsed[k] as string));
      if (broken.length)
        throw new Error(`unescaped @ or | in reply: ${broken.join(', ')}`);
      return parsed as FlatMessages;
    } catch (error) {
      if (attempt === 2) throw new Error(`${slice} → ${locale}: ${(error as Error).message}`);
    }
  }

  throw new Error('unreachable');
}

// ---------------------------------------------------------------------- modes

function report(work: Work[]): number {
  let problems = 0;

  for (const item of work) {
    const lines: string[] = [];
    if (item.missing.length) lines.push(`  missing (${item.missing.length}): ${item.missing.join(', ')}`);
    if (item.stale.length) lines.push(`  stale (${item.stale.length}): ${item.stale.join(', ')}`);
    if (item.unrecorded.length)
      lines.push(`  unrecorded (${item.unrecorded.length}): ${item.unrecorded.join(', ')}`);
    if (item.orphaned.length) lines.push(`  orphaned (${item.orphaned.length}): ${item.orphaned.join(', ')}`);
    if (item.invalid.length)
      lines.push(
        `  unescaped @ (${item.invalid.length}): ${item.invalid.join(', ')} — write it as {'@'}`,
      );
    if (!lines.length) continue;

    problems +=
      item.missing.length +
      item.stale.length +
      item.unrecorded.length +
      item.orphaned.length +
      item.invalid.length;
    console.error(`${item.slice.name} → ${item.locale}`);
    for (const line of lines) console.error(line);
  }

  if (problems) {
    console.error(`\n${problems} problem(s). Run: bun run i18n:sync`);
    return 1;
  }
  console.log(`i18n: ${work.length} slice/locale pair(s) in sync.`);
  return 0;
}

async function sync(work: Work[], manifest: Manifest): Promise<void> {
  let translated = 0;
  let adopted = 0;

  for (const item of work) {
    const todo = [...item.missing, ...item.stale];
    const key = `${item.slice.name}:${item.locale}`;
    const merged: FlatMessages = { ...item.target };
    for (const orphan of item.orphaned) delete merged[orphan];

    if (todo.length) {
      const payload = Object.fromEntries(todo.map((k) => [k, item.source[k]!]));
      console.log(`${key}: translating ${todo.length} key(s)…`);
      Object.assign(merged, await translate(item.locale, item.slice.name, payload));
      translated += todo.length;
    }
    if (item.orphaned.length) console.log(`${key}: dropped ${item.orphaned.length} orphaned key(s)`);
    if (item.unrecorded.length) {
      console.log(`${key}: adopting ${item.unrecorded.length} hand-written key(s)`);
      adopted += item.unrecorded.length;
    }

    if (todo.length || item.orphaned.length) {
      const shape = readJson<Record<string, unknown>>(
        join(item.slice.localesDir, `${SOURCE_LOCALE}.json`),
        {},
      );
      const file = LOCALES.find((l) => l.code === item.locale)!.file;
      writeJson(join(item.slice.localesDir, file), nestLike(shape, merged));
    }

    // Record only what the target file actually holds, so a key that failed to
    // translate stays reported as missing instead of being silently blessed.
    manifest.hashes[key] = Object.fromEntries(
      Object.keys(item.source)
        .filter((k) => k in merged)
        .sort()
        .map((k) => [k, hash(item.source[k]!)]),
    );
  }

  writeJson(MANIFEST_PATH, {
    version: manifest.version,
    hashes: Object.fromEntries(Object.entries(manifest.hashes).sort(([a], [b]) => a.localeCompare(b))),
  });

  const summary = [
    translated ? `translated ${translated} key(s)` : '',
    adopted ? `adopted ${adopted} key(s)` : '',
  ].filter(Boolean);
  console.log(summary.length ? `i18n: ${summary.join(', ')}.` : 'i18n: nothing to do.');
}

// ----------------------------------------------------------------------- main

const checkOnly = process.argv.includes('--check');
const manifest = readJson<Manifest>(MANIFEST_PATH, { version: 1, hashes: {} });
const work = plan(manifest);

if (checkOnly) {
  process.exit(report(work));
} else {
  await sync(work, manifest);
}
