/**
 * The agent workspace's tabs. Formerly `item/tabs.ts`, then briefly a
 * right-hand settings navigator, now a horizontal tab bar under the agent
 * header (specs/006-agent-workspace-tabs, R2).
 *
 * The `value` strings are a URL contract: `?tab=<value>` deep links predate
 * this screen, so the original nine are byte-identical — including `chat`,
 * which is the default tab again. `logs` is the one new value.
 */

/** Tabs that can say how much they hold before you open them. */
export type SectionCountKey = 'knowledge' | 'files' | 'secrets' | 'channels';

/** `null` = not known yet, or the source failed. Distinct from `0`. */
export type SectionCounts = Record<SectionCountKey, number | null>;

export const AGENT_TABS = [
  {
    value: 'chat',
    title: 'Chat',
    desc: 'Talk to the agent.',
    countKey: null,
    primary: true,
  },
  {
    value: 'overview',
    title: 'Overview',
    desc: 'Usage, runtime, visibility & embed.',
    countKey: null,
    primary: true,
  },
  {
    value: 'knowledge',
    title: 'Knowledge',
    desc: 'Knowledge bases the agent can query.',
    countKey: 'knowledge',
    primary: true,
  },
  {
    value: 'files',
    title: 'Files',
    desc: 'Browse and edit S3-stored agent data.',
    countKey: 'files',
    primary: true,
  },
  {
    value: 'channels',
    title: 'Channels',
    desc: 'Messaging platforms (Telegram, …) the agent talks on.',
    countKey: 'channels',
    primary: true,
  },
  {
    value: 'logs',
    title: 'Logs',
    desc: 'Pod logs, full width.',
    countKey: null,
    primary: true,
  },
  // Everything below folds into the "More" menu. The split is the reference's
  // own: the six above are what an operator reaches for; these four are
  // deliberate visits.
  {
    value: 'secrets',
    title: 'Secrets',
    desc: 'User-scoped secrets the runtime stores.',
    countKey: 'secrets',
    primary: false,
  },
  {
    value: 'env',
    title: 'Environment',
    desc: 'Env vars injected at deploy time.',
    countKey: null,
    primary: false,
  },
  {
    value: 'chats',
    title: 'Chats',
    desc: 'Conversation history across channels.',
    countKey: null,
    primary: false,
  },
  {
    value: 'paddock',
    title: 'Paddock',
    desc: 'Run evaluations & manage scenarios.',
    countKey: null,
    primary: false,
  },
] as const satisfies ReadonlyArray<{
  value: string;
  title: string;
  desc: string;
  countKey: SectionCountKey | null;
  primary: boolean;
}>;

export type AgentTab = (typeof AGENT_TABS)[number]['value'];
export type IAgentTab = (typeof AGENT_TABS)[number];

/** The tab the workspace opens on, and the one that carries no query param. */
export const DEFAULT_TAB: AgentTab = 'chat';

export const PRIMARY_TABS = AGENT_TABS.filter((t) => t.primary);
export const OVERFLOW_TABS = AGENT_TABS.filter((t) => !t.primary);

const TAB_VALUES: readonly string[] = AGENT_TABS.map((t) => t.value);

/**
 * Normalise whatever arrived in `?tab=`. Anything unrecognised falls back to
 * the default rather than erroring — a stale link should land somewhere
 * sensible, not on a broken screen.
 */
export function toAgentTab(value: unknown): AgentTab {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === 'string' && TAB_VALUES.includes(v)
    ? (v as AgentTab)
    : DEFAULT_TAB;
}
