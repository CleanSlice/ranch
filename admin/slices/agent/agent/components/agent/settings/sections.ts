/**
 * The agent's settings sections. Formerly `item/tabs.ts` — the vertical tab
 * column is gone, the settings panel navigates these and the workspace canvas
 * renders them (see specs/006-agent-workspace-tabs, R2).
 *
 * The `value` strings are a URL contract: `?tab=<value>` deep links predate
 * this screen and must keep working, so these eight are byte-identical to the
 * old AGENT_TABS values. The old `chat` entry is gone — the conversation is
 * the canvas now, not a section.
 */

/** Sections that can say how much they hold before you open them. */
export type SectionCountKey = 'knowledge' | 'files' | 'secrets' | 'channels';

/** `null` = not known yet, or the source failed. Distinct from `0`. */
export type SectionCounts = Record<SectionCountKey, number | null>;

export const AGENT_SETTINGS_SECTIONS = [
  {
    value: 'overview',
    title: 'Overview',
    desc: 'Usage, runtime, visibility & embed.',
    countKey: null,
  },
  {
    value: 'knowledge',
    title: 'Knowledge',
    desc: 'Knowledge bases the agent can query.',
    countKey: 'knowledge',
  },
  {
    value: 'files',
    title: 'Files',
    desc: 'Browse and edit S3-stored agent data.',
    countKey: 'files',
  },
  {
    value: 'secrets',
    title: 'Secrets',
    desc: 'User-scoped secrets the runtime stores.',
    countKey: 'secrets',
  },
  {
    value: 'env',
    title: 'Environment',
    desc: 'Env vars injected at deploy time.',
    countKey: null,
  },
  {
    value: 'channels',
    title: 'Channels',
    desc: 'Messaging platforms (Telegram, …) the agent talks on.',
    countKey: 'channels',
  },
  {
    value: 'chats',
    title: 'Chats',
    desc: 'Conversation history across channels.',
    countKey: null,
  },
  {
    value: 'paddock',
    title: 'Paddock',
    desc: 'Run evaluations & manage scenarios.',
    countKey: null,
  },
] as const satisfies ReadonlyArray<{
  value: string;
  title: string;
  desc: string;
  countKey: SectionCountKey | null;
}>;

export type AgentSettingsSection =
  (typeof AGENT_SETTINGS_SECTIONS)[number]['value'];

export type IAgentSettingsSection = (typeof AGENT_SETTINGS_SECTIONS)[number];

const SECTION_VALUES: readonly string[] = AGENT_SETTINGS_SECTIONS.map(
  (s) => s.value,
);

/**
 * Normalise whatever arrived in `?tab=`. Legacy `chat` and anything
 * unrecognised become "no section" — the canvas shows the conversation and
 * the stale parameter is stripped rather than erroring.
 */
export function toSettingsSection(
  value: unknown,
): AgentSettingsSection | null {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === 'string' && SECTION_VALUES.includes(v)
    ? (v as AgentSettingsSection)
    : null;
}
