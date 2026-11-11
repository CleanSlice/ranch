import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Error tracking (CLEAN-218) has one rule set for three projects that cannot
 * import from each other, so the rules file is copied — and a copy that is
 * allowed to differ will. `share` already shipped two `buildShareUrl`s that
 * way (CLEAN-111).
 *
 * Three guards: the rules are the same text in `api`, `admin` and `app`; the
 * console slice is the same directory in both consoles; and no real reporting
 * destination is committed, so a fork that merges this code reports nowhere.
 */
const root = resolve(import.meta.dir, '..');
const RULES = 'sentry.rules.ts';
const API = 'api/src/slices/setup/sentry';
const ADMIN = 'admin/slices/setup/sentry';
const APP = 'app/slices/setup/sentry';

const read = (path: string) => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');

const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'coverage', 'graft', '.git', '.nuxt', '.output', '.turbo']);

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(root, dir))) {
    if (SKIPPED_DIRS.has(name)) continue;
    const path = dir ? `${dir}/${name}` : name;
    if (statSync(join(root, path)).isDirectory()) files(path, out);
    else out.push(path);
  }
  return out;
}

const relative = (dir: string) =>
  files(dir)
    .map((path) => path.slice(dir.length + 1))
    .sort();

describe('error-tracking rules', () => {
  test('api, admin and app carry the same text', () => {
    const api = read(`${API}/${RULES}`);
    expect(read(`${ADMIN}/${RULES}`)).toBe(api);
    expect(read(`${APP}/${RULES}`)).toBe(api);
  });

  test('the rules import nothing and read no global', () => {
    const rules = read(`${API}/${RULES}`);
    expect(/^\s*import\s/m.test(rules)).toBe(false);
    expect(/\brequire\(/.test(rules)).toBe(false);
    expect(/\b(process|window|document|globalThis)\./.test(rules)).toBe(false);
  });
});

describe('console error-tracking slice', () => {
  test('admin and app hold the same files', () => {
    expect(relative(APP)).toEqual(relative(ADMIN));
  });

  test('every file is the same text in both consoles', () => {
    const differing = relative(ADMIN).filter((file) => read(`${ADMIN}/${file}`) !== read(`${APP}/${file}`));
    expect(differing).toEqual([]);
  });
});

describe('reporting destinations', () => {
  // A DSN is `scheme://<32 hex key>@host/<project>`. A placeholder on
  // example.com is how a test or a doc may show the shape.
  const DSN = /https?:\/\/[0-9a-f]{32}@[^\s"'`<>)]+/gi;
  const TEXT = /\.(ts|tsx|js|mjs|cjs|vue|json|ya?ml|md|mdc|sh|env|example|template|toml|tf|txt)$|(^|\/)(Dockerfile|Makefile)$/;

  test('none is committed', () => {
    const offenders: string[] = [];
    for (const path of files('')) {
      const name = path.split('/').pop() ?? '';
      // Local, gitignored files hold real values by design.
      if (name === '.env' || (name.startsWith('.env.') && !name.endsWith('.example'))) continue;
      if (!TEXT.test(path)) continue;
      let text: string;
      try {
        text = read(path);
      } catch {
        continue;
      }
      for (const match of text.match(DSN) ?? []) {
        if (!match.includes('example.com')) offenders.push(path);
      }
    }
    expect(offenders).toEqual([]);
  });
});
