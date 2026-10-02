import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * The chat markdown stylesheet is a twin file (CLEAN-137): `admin` and `app`
 * cannot import from each other, so each carries its own copy, and a copy
 * that is allowed to differ will. It did — the rules lived in three
 * components, and the chat history ended up with no table styles at all.
 *
 * Two guards: the two files are the same text, and no component grows a
 * `.chat-md` rule of its own again.
 */
const root = resolve(import.meta.dir, '..');
const ADMIN = 'admin/slices/bridle/assets/chat-md.css';
const APP = 'app/slices/bridle/assets/chat-md.css';

const read = (path: string) => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(root, dir))) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const path = `${dir}/${name}`;
    if (statSync(join(root, path)).isDirectory()) sources(path, out);
    else if (name.endsWith('.vue') || name.endsWith('.css')) out.push(path);
  }
  return out;
}

describe('chat markdown stylesheet', () => {
  test('admin and app carry the same text', () => {
    expect(read(ADMIN)).toBe(read(APP));
  });

  test('it styles what an agent actually writes', () => {
    const css = read(ADMIN);
    for (const selector of ['.chat-md table', '.chat-md th', '.chat-md ul', '.chat-md code', '.chat-md pre', '.chat-md blockquote']) {
      expect(css.includes(selector)).toBe(true);
    }
  });

  test('no component defines .chat-md rules of its own', () => {
    const offenders = [...sources('admin/slices'), ...sources('app/slices')]
      .filter((path) => path !== ADMIN && path !== APP)
      .filter((path) => /^\s*\.chat-md[^\n{]*\{/m.test(read(path)));
    expect(offenders).toEqual([]);
  });
});
