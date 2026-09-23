import { describe, expect, test } from 'bun:test';
import {
  ancestorsOf,
  buildTree,
  filterTree,
  fullySelectedFolders,
  partiallySelectedFolders,
  pathsUnder,
  validateNewPath,
  type ITreeFile,
} from './fileTree';

const files: ITreeFile[] = [
  { path: 'SOUL.md', size: 10, updatedAt: '2026-09-03T00:00:00.000Z', kind: 'text', editable: true },
  { path: 'memory/2026-09-21.md', size: 3100, updatedAt: '2026-09-21T00:00:00.000Z', kind: 'text', editable: true },
  { path: 'memory/2026-09-22.md', size: 3400, updatedAt: '2026-09-22T00:00:00.000Z', kind: 'text', editable: true },
  { path: 'skills/x/SKILL.md', size: 20, updatedAt: '2026-09-15T00:00:00.000Z', kind: 'text', editable: true },
  { path: 'data/photo.png', size: 2000, updatedAt: '2026-09-19T00:00:00.000Z', kind: 'binary', editable: false },
];

describe('buildTree', () => {
  test('folders first, sorted, with recursive totals and newest date', () => {
    const tree = buildTree(files);
    expect(tree.map((n) => `${n.type}:${n.name}`)).toEqual([
      'folder:data',
      'folder:memory',
      'folder:skills',
      'file:SOUL.md',
    ]);
    const memory = tree[1];
    if (memory.type !== 'folder') throw new Error('expected folder');
    expect(memory.count).toBe(2);
    expect(memory.bytes).toBe(6500);
    expect(memory.updatedAt).toBe('2026-09-22T00:00:00.000Z');
    const skills = tree[2];
    if (skills.type !== 'folder') throw new Error('expected folder');
    expect(skills.count).toBe(1);
  });
});

describe('filterTree', () => {
  test('keeps matching files and their ancestors, recomputing totals', () => {
    const out = filterTree(buildTree(files), '2026-09-2');
    expect(out.length).toBe(1);
    const memory = out[0];
    if (memory.type !== 'folder') throw new Error('expected folder');
    expect(memory.children.map((c) => c.name)).toEqual(['2026-09-21.md', '2026-09-22.md']);
    expect(memory.count).toBe(2);
  });

  test('matches anywhere in the path, case-insensitively', () => {
    const out = filterTree(buildTree(files), 'SKILL');
    expect(out.map((n) => n.name)).toEqual(['skills']);
  });

  test('returns everything for an empty query and nothing for no match', () => {
    expect(filterTree(buildTree(files), '  ').length).toBe(4);
    expect(filterTree(buildTree(files), 'zzz').length).toBe(0);
  });
});

describe('selection helpers', () => {
  test('pathsUnder covers a folder recursively and a file exactly', () => {
    expect(pathsUnder(files, 'memory')).toEqual(['memory/2026-09-21.md', 'memory/2026-09-22.md']);
    expect(pathsUnder(files, 'SOUL.md')).toEqual(['SOUL.md']);
    expect(pathsUnder(files, 'mem')).toEqual([]);
  });

  test('fully and partially selected folders', () => {
    const tree = buildTree(files);
    const both = new Set(['memory/2026-09-21.md', 'memory/2026-09-22.md']);
    expect([...fullySelectedFolders(tree, both)]).toEqual(['memory']);
    expect([...partiallySelectedFolders(tree, both)]).toEqual([]);
    const one = new Set(['memory/2026-09-21.md']);
    expect([...fullySelectedFolders(tree, one)]).toEqual([]);
    expect([...partiallySelectedFolders(tree, one)]).toEqual(['memory']);
  });

  test('ancestorsOf lists every folder on the way', () => {
    expect([...ancestorsOf(['skills/x/SKILL.md', 'SOUL.md'])]).toEqual(['skills', 'skills/x']);
  });
});

describe('validateNewPath', () => {
  test('accepts a relative file path', () => {
    expect(validateNewPath('notes/todo.md')).toBe(null);
    expect(validateNewPath('Makefile')).toBe(null);
  });

  test('refuses absolute, traversal and folder paths', () => {
    expect(validateNewPath('/etc/x')).not.toBe(null);
    expect(validateNewPath('C:/x.md')).not.toBe(null);
    expect(validateNewPath('../x.md')).not.toBe(null);
    expect(validateNewPath('a//b.md')).not.toBe(null);
    expect(validateNewPath('notes/')).not.toBe(null);
    expect(validateNewPath('')).not.toBe(null);
  });
});
