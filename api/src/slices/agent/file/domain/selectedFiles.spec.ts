import { BadRequestException } from '@nestjs/common';
import * as unzipper from 'unzipper';
import { IMPORT_MAX_FILES } from './file.limits';
import {
  buildFilesZip,
  expectedEtags,
  isZipSignature,
  normaliseTargetFolder,
  resolveSelectedFiles,
  toArchiveEntries,
  validateTargets,
  type IExistingFile,
} from './selectedFiles';

const existing: IExistingFile[] = [
  { path: 'SOUL.md', size: 10, etag: 'aaa' },
  { path: 'skills/research/SKILL.md', size: 20, etag: 'bbb' },
  { path: 'skills/writer/SKILL.md', size: 30, etag: 'ccc' },
  { path: 'data/memory.sqlite', size: 40, etag: 'ddd' },
  { path: 'sessions/notes.md', size: 5, etag: 'eee' },
  { path: 'data/sessions/log.md', size: 5, etag: 'fff' },
];

describe('resolveSelectedFiles', () => {
  it('replaces a unique match wherever it lives', () => {
    const [soul, sqlite] = resolveSelectedFiles(
      ['SOUL.md', 'memory.sqlite'],
      '',
      existing,
    );
    expect(soul).toEqual({
      name: 'SOUL.md',
      match: 'unique',
      path: 'SOUL.md',
      candidates: [],
      size: 10,
    });
    expect(sqlite).toMatchObject({
      match: 'unique',
      path: 'data/memory.sqlite',
      size: 40,
    });
  });

  it('adds an unknown name in the target folder, root by default', () => {
    expect(resolveSelectedFiles(['notes.md'], undefined, existing)[0]).toEqual({
      name: 'notes.md',
      match: 'none',
      path: 'notes.md',
      candidates: [],
      size: null,
    });
    expect(
      resolveSelectedFiles(['notes.md'], 'skills/x/', existing)[0].path,
    ).toBe('skills/x/notes.md');
  });

  it('lists candidates for an ambiguous name and chooses nothing', () => {
    expect(resolveSelectedFiles(['SKILL.md'], '', existing)[0]).toEqual({
      name: 'SKILL.md',
      match: 'ambiguous',
      path: null,
      candidates: ['skills/research/SKILL.md', 'skills/writer/SKILL.md'],
      size: null,
    });
  });

  it('never matches runtime-owned session state', () => {
    expect(resolveSelectedFiles(['notes.md'], '', existing)[0].match).toBe(
      'none',
    );
    expect(resolveSelectedFiles(['log.md'], '', existing)[0].match).toBe(
      'none',
    );
  });

  it('matches case-sensitively', () => {
    expect(resolveSelectedFiles(['Soul.md'], '', existing)[0]).toMatchObject({
      match: 'none',
      path: 'Soul.md',
    });
  });

  it('refuses duplicate names, separators, control characters and dots', () => {
    const refuse = (names: string[], re: RegExp) =>
      expect(() => resolveSelectedFiles(names, '', existing)).toThrow(re);
    refuse(['a.md', 'a.md'], /duplicate name \(a\.md\)/);
    refuse(['x/y.md'], /path separator/);
    refuse(['x\\y.md'], /path separator/);
    refuse(['bad\u0000.md'], /control character/);
    refuse(['..'], /invalid/);
    refuse([], /at least one/);
  });

  it('caps the count at the configured limit', () => {
    const names = Array.from(
      { length: IMPORT_MAX_FILES + 1 },
      (_, i) => `f${i}.md`,
    );
    expect(() => resolveSelectedFiles(names, '', existing)).toThrow(
      /too many files/,
    );
  });

  it('refuses a target folder that leaves the workspace', () => {
    expect(() => resolveSelectedFiles(['a.md'], '../up', existing)).toThrow(
      BadRequestException,
    );
    expect(() => normaliseTargetFolder('/abs')).toThrow(/absolute/);
    expect(normaliseTargetFolder(undefined)).toBe('');
    expect(normaliseTargetFolder('skills\\x\\')).toBe('skills/x');
  });
});

describe('validateTargets', () => {
  const rows = resolveSelectedFiles(
    ['SOUL.md', 'SKILL.md', 'notes.md'],
    'docs',
    existing,
  );

  it('accepts the unique match, a candidate, and add-as-new for an ambiguous name', () => {
    const paths = validateTargets(
      [
        { name: 'SOUL.md', path: 'SOUL.md' },
        { name: 'SKILL.md', path: 'skills/writer/SKILL.md' },
        { name: 'notes.md', path: 'docs/notes.md' },
      ],
      rows,
      'docs',
    );
    expect([...paths.entries()]).toEqual([
      ['SOUL.md', 'SOUL.md'],
      ['SKILL.md', 'skills/writer/SKILL.md'],
      ['notes.md', 'docs/notes.md'],
    ]);
    expect(
      validateTargets(
        [
          { name: 'SOUL.md', path: 'SOUL.md' },
          { name: 'SKILL.md', path: 'docs/SKILL.md' },
          { name: 'notes.md', path: 'docs/notes.md' },
        ],
        rows,
        'docs',
      ).get('SKILL.md'),
    ).toBe('docs/SKILL.md');
  });

  it('refuses a path outside the resolved set, a missing name and an unknown name', () => {
    const base = [
      { name: 'SOUL.md', path: 'SOUL.md' },
      { name: 'SKILL.md', path: 'skills/writer/SKILL.md' },
      { name: 'notes.md', path: 'docs/notes.md' },
    ];
    expect(() =>
      validateTargets(
        base.map((t) =>
          t.name === 'SOUL.md' ? { ...t, path: 'elsewhere/SOUL.md' } : t,
        ),
        rows,
        'docs',
      ),
    ).toThrow(/SOUL\.md cannot go to elsewhere\/SOUL\.md/);
    expect(() =>
      validateTargets(
        base.map((t) =>
          t.name === 'SKILL.md' ? { ...t, path: 'skills/other/SKILL.md' } : t,
        ),
        rows,
        'docs',
      ),
    ).toThrow(/cannot go to/);
    expect(() => validateTargets(base.slice(0, 2), rows, 'docs')).toThrow(
      /no target for notes\.md/,
    );
    expect(() =>
      validateTargets(
        [...base, { name: 'ghost.md', path: 'ghost.md' }],
        rows,
        'docs',
      ),
    ).toThrow(/unknown file name/);
    expect(() =>
      validateTargets(
        base.map((t) => (t.name === 'notes.md' ? { ...t, path: '../x' } : t)),
        rows,
        'docs',
      ),
    ).toThrow(/traversal/);
  });
});

describe('toArchiveEntries / expectedEtags', () => {
  it('builds entries with md5 at the chosen paths and records the ETag each was planned against', () => {
    const entries = toArchiveEntries(
      [
        { name: 'SOUL.md', bytes: Buffer.from('new soul') },
        { name: 'notes.md', bytes: Buffer.from('') },
      ],
      new Map([
        ['SOUL.md', 'SOUL.md'],
        ['notes.md', 'docs/notes.md'],
      ]),
    );
    expect(entries.map((e) => [e.path, e.size])).toEqual([
      ['SOUL.md', 8],
      ['docs/notes.md', 0],
    ]);
    expect(entries[0].md5).toMatch(/^[0-9a-f]{32}$/);
    expect(expectedEtags(entries, existing)).toEqual({
      'SOUL.md': 'aaa',
      'docs/notes.md': null,
    });
  });
});

describe('buildFilesZip', () => {
  it('round-trips the given paths verbatim, including a shared custom folder', async () => {
    const zip = await buildFilesZip([
      { path: 'notes/a.md', bytes: Buffer.from('a') },
      { path: 'notes/b.md', bytes: Buffer.from('b') },
    ]);
    expect(isZipSignature(zip)).toBe(true);
    const dir = await unzipper.Open.buffer(zip);
    const files = dir.files.filter((f) => f.type !== 'Directory');
    expect(files.map((f) => f.path).sort()).toEqual([
      'notes/a.md',
      'notes/b.md',
    ]);
    const a = files.find((f) => f.path === 'notes/a.md')!;
    expect((await a.buffer()).toString()).toBe('a');
  });

  it('recognises what is not a zip', () => {
    expect(isZipSignature(Buffer.from('# SOUL'))).toBe(false);
    expect(isZipSignature(Buffer.alloc(0))).toBe(false);
  });
});
