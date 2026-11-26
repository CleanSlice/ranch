import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * The launch step list is built from two twin files (CLEAN-247): the Multi
 * Step Loader vendored from Inspira UI, and the pure function that turns
 * reported facts into steps. `admin` and `app` cannot import from each other,
 * so each carries a copy, and a copy that is allowed to differ will: one
 * console would then show a launch the other does not.
 */
const root = resolve(import.meta.dir, '..');

const TWINS: Array<[label: string, admin: string, app: string]> = [
  [
    'the Multi Step Loader',
    'admin/slices/setup/theme/components/ui/multi-step-loader/MultiStepLoader.vue',
    'app/slices/setup/theme/components/ui/multi-step-loader/MultiStepLoader.vue',
  ],
  [
    'its index',
    'admin/slices/setup/theme/components/ui/multi-step-loader/index.ts',
    'app/slices/setup/theme/components/ui/multi-step-loader/index.ts',
  ],
  [
    'the step derivation',
    'admin/slices/agent/agent/utils/launchSteps.ts',
    'app/slices/agent/utils/launchSteps.ts',
  ],
  [
    'the step derivation tests',
    'admin/slices/agent/agent/utils/launchSteps.test.ts',
    'app/slices/agent/utils/launchSteps.test.ts',
  ],
];

const read = (path: string) => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');

describe('launch step twins', () => {
  test.each(TWINS)('admin and app carry the same text of %s', (_label, admin, app) => {
    expect(read(admin)).toBe(read(app));
  });

  test('the loader still says where it came from', () => {
    const source = read(TWINS[0]![1]);
    expect(source.includes('unovue/inspira-ui')).toBe(true);
    expect(source.includes('5ea509ce')).toBe(true);
  });

  test('the derivation carries no wording and no framework', () => {
    const source = read(TWINS[2]![1]);
    expect(/from ['"](vue|#|~|@)/.test(source)).toBe(false);
    expect(source.includes('Date.now')).toBe(false);
  });
});
