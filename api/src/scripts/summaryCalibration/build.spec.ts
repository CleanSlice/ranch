import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { staleSources } from './build';

/**
 * The calibration runs the built API, so that what it measures is what the
 * image runs. A prompt edited and not rebuilt would be measured as the old
 * prompt, and the numbers written into the contract would be of that one.
 */
describe('staleSources', () => {
  let root: string;
  const src = () => join(root, 'src');
  const dist = () => join(root, 'dist');

  /** A file whose modification time is `at` seconds. */
  const file = (path: string, at: number) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '');
    utimesSync(path, at, at);
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'calibration-build-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('is empty when every source file has a build that is not older', () => {
    file(join(src(), 'main.ts'), 100);
    file(join(dist(), 'main.js'), 100);
    file(join(src(), 'slices/chat/domain/chatInsight.prompt.ts'), 100);
    file(join(dist(), 'slices/chat/domain/chatInsight.prompt.js'), 250);

    expect(staleSources(src(), dist())).toEqual([]);
  });

  it('names a source file edited after it was built', () => {
    file(join(src(), 'slices/chat/domain/chatInsight.prompt.ts'), 300);
    file(join(dist(), 'slices/chat/domain/chatInsight.prompt.js'), 250);
    file(join(src(), 'main.ts'), 100);
    file(join(dist(), 'main.js'), 100);

    expect(staleSources(src(), dist())).toEqual([
      'slices/chat/domain/chatInsight.prompt.ts',
    ]);
  });

  it('names a source file that was never built', () => {
    file(join(src(), 'slices/chat/calibration/main.ts'), 100);

    expect(staleSources(src(), dist())).toEqual([
      'slices/chat/calibration/main.ts',
    ]);
  });

  it('names everything when there is no build at all', () => {
    file(join(src(), 'a.ts'), 100);
    file(join(src(), 'b/c.ts'), 100);

    expect(staleSources(src(), dist())).toEqual(['a.ts', 'b/c.ts']);
  });

  it('passes over what the build leaves out: specs, and files that are not TypeScript', () => {
    file(join(src(), 'slices/chat/chat.tool.spec.ts'), 300);
    file(join(src(), 'slices/chat/chat.prisma'), 300);
    file(join(src(), 'slices/chat/types.d.ts'), 300);

    expect(staleSources(src(), dist())).toEqual([]);
  });
});
