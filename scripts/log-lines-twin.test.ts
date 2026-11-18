import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * How a pod-log line is read, and what counts as a warning, is one rule set
 * for two projects that cannot import from each other (CLEAN-233): the api
 * counts the window for the collapsed Logs bar, the console paints the same
 * lines in the expanded panel. A copy that is allowed to differ will — and
 * the bar would then say "3 alerts" over a panel showing four.
 *
 * Same bind, and the same guard, as `sentry.rules.ts`: identical text, and no
 * import or global that would stop one copy running where the other does.
 */
const root = resolve(import.meta.dir, '..');
const API = 'api/src/slices/log/domain/logLines.ts';
const ADMIN = 'admin/slices/agent/agent/utils/logLines.ts';

const read = (path: string) =>
  readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');

describe('log line rules', () => {
  test('api and admin carry the same text', () => {
    expect(read(ADMIN)).toBe(read(API));
  });

  test('the rules import nothing and read no global but Date', () => {
    const rules = read(API);
    expect(/^\s*import\s/m.test(rules)).toBe(false);
    expect(/\brequire\(/.test(rules)).toBe(false);
    expect(/\b(process|window|document|globalThis)\./.test(rules)).toBe(false);
  });
});
