/**
 * The agent workspace's tab model (specs/017-compact-agent-workspace, R1).
 *
 * The header shows two tabs, Chat and Settings. Settings is a hub of cards,
 * one per SECTION below, and a card opens its section at full width. That
 * replaced the eleven-tab bar of specs/006, which in turn replaced a
 * right-hand navigator, which replaced an accordion.
 *
 * `?tab=` stays the single address of the screen and keeps its whole old
 * vocabulary: the `value` strings are a shared-link contract that predates
 * every one of those redesigns, so the ten section values are byte-identical
 * (including `logs`, and `peers` as a legacy alias of `a2a`, CLEAN-95). The
 * only addition is `settings`, the hub itself. `chat` is the default and
 * carries no parameter.
 */
import type { Component } from 'vue';
import {
  IconBook2,
  IconFileText,
  IconFlask,
  IconFolder,
  IconKey,
  IconLayoutDashboard,
  IconMessageCircle,
  IconMessages,
  IconUsers,
  IconVariable,
} from '@tabler/icons-vue';

/** Sections that can say how much they hold before you open them. */
export type SectionCountKey =
  | 'knowledge'
  | 'a2a'
  | 'files'
  | 'secrets'
  | 'channels';

/** `null` = not known yet, or the source failed. Distinct from `0`. */
export type SectionCounts = Record<SectionCountKey, number | null>;

export interface ISection {
  value: string;
  title: string;
  desc: string;
  countKey: SectionCountKey | null;
  icon: Component;
}

/** What the header renders. */
export const WORKSPACE_TABS = ['chat', 'settings'] as const;
export type WorkspaceTab = (typeof WORKSPACE_TABS)[number];

/** The Settings hub, in card order. */
export const SECTIONS = [
  {
    value: 'overview',
    title: 'Overview',
    desc: 'Usage, runtime, visibility & embed.',
    countKey: null,
    icon: IconLayoutDashboard,
  },
  {
    value: 'knowledge',
    title: 'Knowledge',
    desc: 'Knowledge bases the agent can query.',
    countKey: 'knowledge',
    icon: IconBook2,
  },
  {
    value: 'a2a',
    title: 'A2A',
    desc: 'Agent-to-agent: card, peers & delegations.',
    countKey: 'a2a',
    icon: IconUsers,
  },
  {
    value: 'files',
    title: 'Files',
    desc: 'Browse and edit S3-stored agent data.',
    countKey: 'files',
    icon: IconFolder,
  },
  {
    value: 'channels',
    title: 'Channels',
    desc: 'Messaging platforms (Telegram, …) the agent talks on.',
    countKey: 'channels',
    icon: IconMessageCircle,
  },
  {
    value: 'logs',
    title: 'Logs',
    desc: 'Pod logs, full width.',
    countKey: null,
    icon: IconFileText,
  },
  {
    value: 'secrets',
    title: 'Secrets',
    desc: 'User-scoped secrets the runtime stores.',
    countKey: 'secrets',
    icon: IconKey,
  },
  {
    value: 'env',
    title: 'Environment',
    desc: 'Env vars injected at deploy time.',
    countKey: null,
    icon: IconVariable,
  },
  {
    value: 'chats',
    title: 'Chats',
    desc: 'Conversation history across channels.',
    countKey: null,
    icon: IconMessages,
  },
  {
    value: 'paddock',
    title: 'Paddock',
    desc: 'Run evaluations & manage scenarios.',
    countKey: null,
    icon: IconFlask,
  },
] as const satisfies ReadonlyArray<ISection>;

export type SectionValue = (typeof SECTIONS)[number]['value'];

/** The full `?tab=` vocabulary. */
export type AgentTab = WorkspaceTab | SectionValue;

/** The tab the workspace opens on, and the one that carries no query param. */
export const DEFAULT_TAB: AgentTab = 'chat';

const SECTION_VALUES: readonly string[] = SECTIONS.map((s) => s.value);
const TAB_VALUES: readonly string[] = [...WORKSPACE_TABS, ...SECTION_VALUES];

// Renamed values old deep links may still carry (CLEAN-95).
const LEGACY_TAB_ALIASES: Record<string, AgentTab> = { peers: 'a2a' };

/**
 * Normalise whatever arrived in `?tab=`. Anything unrecognised falls back to
 * the default rather than erroring — a stale link should land somewhere
 * sensible, not on a broken screen.
 */
export function toAgentTab(value: unknown): AgentTab {
  const v = Array.isArray(value) ? value[0] : value;
  if (typeof v !== 'string') return DEFAULT_TAB;
  if (v in LEGACY_TAB_ALIASES) return LEGACY_TAB_ALIASES[v]!;
  return TAB_VALUES.includes(v) ? (v as AgentTab) : DEFAULT_TAB;
}

/** Which header tab is lit: Chat for the conversation, Settings for the hub
 *  and for every section opened from it. */
export function workspaceTabOf(tab: AgentTab): WorkspaceTab {
  return tab === 'chat' ? 'chat' : 'settings';
}

/** The section a `?tab=` value opens; `null` for the chat and for the hub. */
export function sectionOf(tab: AgentTab): ISection | null {
  for (let i = 0; i < SECTIONS.length; i += 1) {
    if (SECTIONS[i]!.value === tab) return SECTIONS[i]!;
  }
  return null;
}
