import { describe, expect, test } from 'bun:test';
import type { ITemplateData } from '../domain/template.types';
import { draftDiff, inSizeBucket, selectTemplates } from './templateList';

const t = (
  id: string,
  name: string,
  memory: string,
  createdAt: string,
  description = '',
): ITemplateData => ({
  id,
  name,
  description,
  image: 'ghcr.io/cleanslice/runtime:latest',
  defaultConfig: {},
  defaultResources: { cpu: '1000m', memory },
  defaultKnowledgeIds: [],
  skillIds: [],
  mcpServerIds: [],
  createdAt,
  updatedAt: createdAt,
});

const list = [
  t('coder', 'Coder', '2Gi', '2026-06-01T00:00:00Z', 'Coding agent'),
  t('default', 'Default', '512Mi', '2026-05-07T00:00:00Z', 'Basic agent'),
  t('jira', 'Jira Manager', '1Gi', '2026-07-28T00:00:00Z'),
  t('bonsite', 'bonsite', '2Gi', '2026-08-07T00:00:00Z', 'Answers visitors'),
];

describe('inSizeBucket', () => {
  test('buckets by memory in MiB', () => {
    expect(inSizeBucket('512Mi', 's')).toBe(true);
    expect(inSizeBucket('1Gi', 's')).toBe(false);
    expect(inSizeBucket('1Gi', 'm')).toBe(true);
    expect(inSizeBucket('1536Mi', 'm')).toBe(true);
    expect(inSizeBucket('2Gi', 'm')).toBe(false);
    expect(inSizeBucket('2Gi', 'l')).toBe(true);
    expect(inSizeBucket('4Gi', 'l')).toBe(true);
  });

  test('"all" takes everything, including unreadable memory', () => {
    expect(inSizeBucket('', 'all')).toBe(true);
    expect(inSizeBucket('', 's')).toBe(false);
  });
});

describe('selectTemplates', () => {
  test('newest first by default', () => {
    expect(selectTemplates(list, { query: '', size: 'all', sort: 'recent' }).map((x) => x.id)).toEqual([
      'bonsite',
      'jira',
      'coder',
      'default',
    ]);
  });

  test('by name ignores case', () => {
    expect(selectTemplates(list, { query: '', size: 'all', sort: 'name' }).map((x) => x.id)).toEqual([
      'bonsite',
      'coder',
      'default',
      'jira',
    ]);
  });

  test('query matches name or description, case-insensitively', () => {
    expect(selectTemplates(list, { query: 'AGENT', size: 'all', sort: 'name' }).map((x) => x.id)).toEqual([
      'coder',
      'default',
    ]);
    expect(selectTemplates(list, { query: '  visitors ', size: 'all', sort: 'name' }).map((x) => x.id)).toEqual([
      'bonsite',
    ]);
  });

  test('size filter and query combine', () => {
    expect(selectTemplates(list, { query: 'agent', size: 's', sort: 'recent' }).map((x) => x.id)).toEqual([
      'default',
    ]);
  });
});

describe('draftDiff', () => {
  test('counts what the draft adds and removes against the saved set', () => {
    expect(draftDiff(['a', 'b'], ['b', 'c', 'd'])).toEqual({ added: 2, removed: 1 });
  });

  test('order does not matter', () => {
    expect(draftDiff(['a', 'b'], ['b', 'a'])).toEqual({ added: 0, removed: 0 });
  });
});
