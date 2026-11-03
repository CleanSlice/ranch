import { describe, expect, test } from 'bun:test';
import type { IImportPlan, IResolveRow } from '#agentFile/domain';
import {
  addAsNewPath,
  allSettled,
  confirmable,
  duplicateName,
  isLoneZip,
  overLimits,
  rowLabel,
  targetPathOf,
  toTargetRows,
  toTargets,
} from './importTargets';

const rows: IResolveRow[] = [
  { name: 'SOUL.md', match: 'unique', path: 'SOUL.md', candidates: [], size: 10 },
  { name: 'notes.md', match: 'none', path: 'docs/notes.md', candidates: [], size: null },
  {
    name: 'SKILL.md',
    match: 'ambiguous',
    path: null,
    candidates: ['skills/a/SKILL.md', 'skills/b/SKILL.md'],
    size: null,
  },
];

const file = (name: string, size = 1): File => ({ name, size }) as File;

describe('target rows', () => {
  test('labels unique, none and ambiguous rows', () => {
    const [soul, notes, skill] = toTargetRows(rows);
    expect(rowLabel(soul, 'docs')).toBe('replaces SOUL.md');
    expect(rowLabel(notes, 'docs')).toBe('new, docs');
    expect(rowLabel(notes, '')).toBe('new, root');
    expect(rowLabel(skill, 'docs')).toBe('choose…');
    expect(rowLabel({ ...skill, chosen: 'skills/b/SKILL.md' }, 'docs')).toBe(
      'replaces skills/b/SKILL.md',
    );
    expect(rowLabel({ ...skill, chosen: 'docs/SKILL.md' }, 'docs')).toBe('new, docs');
  });

  test('is settled only once an ambiguous row has a choice', () => {
    const t = toTargetRows(rows);
    expect(targetPathOf(t[0])).toBe('SOUL.md');
    expect(targetPathOf(t[2])).toBe(null);
    expect(allSettled(t)).toBe(false);
    t[2].chosen = 'skills/a/SKILL.md';
    expect(allSettled(t)).toBe(true);
    expect(toTargets(t)).toEqual([
      { name: 'SOUL.md', path: 'SOUL.md' },
      { name: 'notes.md', path: 'docs/notes.md' },
      { name: 'SKILL.md', path: 'skills/a/SKILL.md' },
    ]);
    expect(allSettled([])).toBe(false);
  });

  test('builds the add-as-new path', () => {
    expect(addAsNewPath('', 'a.md')).toBe('a.md');
    expect(addAsNewPath('skills/x/', 'a.md')).toBe('skills/x/a.md');
  });
});

describe('gates', () => {
  const plan = (add: number, change: number, unchanged: number): IImportPlan => ({
    importId: 'i',
    mode: 'merge',
    includeSessions: false,
    wrapperStripped: null,
    counts: { add, change, unchanged, remove: 0, skip: 0 },
    totalBytes: 0,
    entries: [],
    more: 0,
    warnings: [],
  });

  test('confirmable only when something will be written', () => {
    expect(confirmable(null)).toBe(false);
    expect(confirmable(plan(0, 0, 3))).toBe(false);
    expect(confirmable(plan(1, 0, 3))).toBe(true);
    expect(confirmable(plan(0, 2, 0))).toBe(true);
  });

  test('a lone zip is recognised case-insensitively', () => {
    expect(isLoneZip([file('ws.zip')])).toBe(true);
    expect(isLoneZip([file('WS.ZIP')])).toBe(true);
    expect(isLoneZip([file('ws.zip'), file('a.md')])).toBe(false);
    expect(isLoneZip([file('a.md')])).toBe(false);
  });

  test('names the first limit broken', () => {
    const limits = { importMaxFiles: 2, importMaxFileBytes: 100 };
    expect(overLimits([file('a'), file('b')], limits)).toBe(null);
    expect(overLimits([file('a'), file('b'), file('c')], limits)).toContain('limit is 2');
    expect(overLimits([file('big.bin', 101)], limits)).toContain('big.bin');
    expect(overLimits([file('big.bin', 101)], limits, (n) => `${n} bytes`)).toContain(
      '100 bytes per file',
    );
    expect(overLimits([file('big.bin', 101)], null)).toBe(null);
  });

  test('finds a duplicate name', () => {
    expect(duplicateName([file('a.md'), file('b.md')])).toBe(null);
    expect(duplicateName([file('a.md'), file('a.md')])).toBe('a.md');
  });
});
