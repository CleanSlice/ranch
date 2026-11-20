import { describe, expect, test } from 'bun:test';
import { listedAgents, searchNamesAssistant } from './assistantRow';

const AGENTS = [
  { id: 'a', name: 'OneMazda Intra', isAdmin: false },
  { id: 'r', name: 'Rancher', isAdmin: true },
  { id: 's', name: 'Support bot', isAdmin: false },
];

describe('the assistant is not a row in the access lists', () => {
  test('the rows are every agent but the assistant', () => {
    expect(listedAgents(AGENTS).map((a) => a.id)).toEqual(['a', 's']);
  });

  test('a search that finds only the assistant says where it is set', () => {
    expect(searchNamesAssistant(AGENTS, 'ranch')).toBe(true);
    expect(searchNamesAssistant(AGENTS, '  RANCHER ')).toBe(true);
  });

  test('a search that finds an ordinary agent too, or nothing, does not', () => {
    // "ra" is in Rancher and in OneMazda Intra.
    expect(searchNamesAssistant(AGENTS, 'ra')).toBe(false);
    expect(searchNamesAssistant(AGENTS, 'zzz')).toBe(false);
    expect(searchNamesAssistant(AGENTS, '')).toBe(false);
  });
});
