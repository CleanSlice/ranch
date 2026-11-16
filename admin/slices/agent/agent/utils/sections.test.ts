import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_SECTION,
  DEFAULT_TAB,
  SECTION_GROUPS,
  SECTIONS,
  WORKSPACE_TABS,
  sectionOf,
  settingsSectionOf,
  toAgentTab,
  workspaceTabOf,
  type AgentTab,
  type SectionGroup,
} from '#agent/components/agent/workspace/sections';

// The `?tab=` vocabulary is a shared-link contract
// (specs/017-compact-agent-workspace/contracts/url-tab-contract.md): every
// value that worked before the Settings hub keeps landing on its section.
// `events` (CLEAN-139) is the one a failure notification links to.
const SECTION_VALUES = [
  'overview',
  'knowledge',
  'a2a',
  'channels',
  'secrets',
  'env',
  'files',
  'chats',
  'logs',
  'events',
  'paddock',
] as const;

// The list is grouped (specs/031-agent-overview-redesign, FR-002): Overview
// alone on top, then one heading per group.
const SECTION_GROUP_OF: Record<
  (typeof SECTION_VALUES)[number],
  SectionGroup | null
> = {
    overview: null,
    knowledge: 'configure',
    a2a: 'configure',
    channels: 'configure',
    secrets: 'configure',
    env: 'configure',
    files: 'data',
    chats: 'data',
    logs: 'observe',
    events: 'observe',
    paddock: 'observe',
  };

describe('SECTIONS', () => {
  test('lists the eleven sections in hub order', () => {
    expect(SECTIONS.map((s) => s.value)).toEqual([...SECTION_VALUES]);
  });

  test('every section sits in its group, and only overview has none', () => {
    for (let i = 0; i < SECTIONS.length; i += 1) {
      const s = SECTIONS[i]!;
      expect(s.group).toBe(SECTION_GROUP_OF[s.value]);
      expect(s.group === null).toBe(s.value === 'overview');
    }
  });

  test('a group is one unbroken run, in the order of its heading', () => {
    const runs: string[] = [];
    for (let i = 0; i < SECTIONS.length; i += 1) {
      const g = SECTIONS[i]!.group;
      if (g === null) continue;
      if (runs[runs.length - 1] !== g) runs.push(g);
    }
    expect(runs).toEqual(SECTION_GROUPS.map((g) => g.value));
  });

  test('the three group headings are Configure, Data, Observe', () => {
    expect(SECTION_GROUPS.map((g) => g.value)).toEqual([
      'configure',
      'data',
      'observe',
    ]);
    expect(SECTION_GROUPS.map((g) => g.title)).toEqual([
      'Configure',
      'Data',
      'Observe',
    ]);
  });

  test('every section carries a title, a description and an icon', () => {
    for (let i = 0; i < SECTIONS.length; i += 1) {
      const s = SECTIONS[i]!;
      expect(s.title.length > 0).toBe(true);
      expect(s.desc.length > 0).toBe(true);
      expect(Boolean(s.icon)).toBe(true);
    }
  });

  test('only the five countable sections have a count key', () => {
    const countable = SECTIONS.filter((s) => s.countKey !== null).map(
      (s) => s.value,
    );
    expect(countable).toEqual(['knowledge', 'a2a', 'channels', 'secrets', 'files']);
  });

  test('the workspace has exactly two tabs and chat is the default', () => {
    expect(WORKSPACE_TABS).toEqual(['chat', 'settings']);
    expect(DEFAULT_TAB).toBe('chat');
  });
});

describe('toAgentTab', () => {
  test('keeps every pre-existing section value byte-for-byte', () => {
    for (let i = 0; i < SECTION_VALUES.length; i += 1) {
      const v = SECTION_VALUES[i]!;
      expect(toAgentTab(v)).toBe(v);
    }
  });

  test('accepts the new hub value', () => {
    expect(toAgentTab('settings')).toBe('settings');
  });

  test('still maps the legacy peers alias to a2a', () => {
    expect(toAgentTab('peers')).toBe('a2a');
  });

  test('falls back to chat for nothing, junk, and non-strings', () => {
    expect(toAgentTab(undefined)).toBe('chat');
    expect(toAgentTab(null)).toBe('chat');
    expect(toAgentTab('')).toBe('chat');
    expect(toAgentTab('bogus')).toBe('chat');
    expect(toAgentTab(42)).toBe('chat');
    expect(toAgentTab('chat')).toBe('chat');
  });

  test('takes the first value of a repeated parameter', () => {
    expect(toAgentTab(['files', 'chat'])).toBe('files');
  });
});

describe('workspaceTabOf', () => {
  test('is chat only for chat', () => {
    expect(workspaceTabOf('chat')).toBe('chat');
  });

  test('is settings for the hub and for every section', () => {
    expect(workspaceTabOf('settings')).toBe('settings');
    for (let i = 0; i < SECTION_VALUES.length; i += 1) {
      expect(workspaceTabOf(SECTION_VALUES[i]!)).toBe('settings');
    }
  });
});

describe('settingsSectionOf', () => {
  test('is null only for the chat', () => {
    expect(settingsSectionOf('chat')).toBe(null);
  });

  test('a bare settings lands on the default section', () => {
    expect(DEFAULT_SECTION).toBe('overview');
    expect(settingsSectionOf('settings')?.value).toBe('overview');
  });

  test('a section value opens that section', () => {
    for (let i = 0; i < SECTION_VALUES.length; i += 1) {
      const v: AgentTab = SECTION_VALUES[i]!;
      expect(settingsSectionOf(v)?.value).toBe(v);
    }
  });
});

describe('sectionOf', () => {
  test('is null for chat and for the hub itself', () => {
    expect(sectionOf('chat')).toBe(null);
    expect(sectionOf('settings')).toBe(null);
  });

  test('returns the matching record for every section value', () => {
    for (let i = 0; i < SECTION_VALUES.length; i += 1) {
      const v: AgentTab = SECTION_VALUES[i]!;
      expect(sectionOf(v)?.value).toBe(v);
    }
  });
});
