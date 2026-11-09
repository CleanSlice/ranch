// One reading of an agent's runtime status for the orbit map and the sheet.
// Pure on purpose: no Vue, no Nuxt aliases, so `bun test` runs it.

export interface AgentStatusMeta {
  /** i18n key under the agent slice, or null for a status we have no wording
   *  for — the caller then shows the raw status as received. */
  labelKey: string | null;
  /** Colour of the node border, the status dot and the status text. */
  color: string;
  /** Transitional (deploying, pending): the dot breathes. */
  pulse: boolean;
  /** Something is wrong: the node asks for attention. */
  alarm: boolean;
}

const META: Record<string, AgentStatusMeta> = {
  running: { labelKey: 'status.running', color: '#2fa66b', pulse: false, alarm: false },
  deploying: { labelKey: 'status.deploying', color: '#f5a16b', pulse: true, alarm: false },
  pending: { labelKey: 'status.pending', color: '#f5a16b', pulse: true, alarm: false },
  failed: { labelKey: 'status.failed', color: '#d6453d', pulse: false, alarm: true },
  stopped: { labelKey: 'status.stopped', color: '#7e7488', pulse: false, alarm: false },
};

export function agentStatusMeta(status: string | undefined): AgentStatusMeta {
  return (
    (status ? META[status] : undefined) ?? {
      labelKey: null,
      color: '#7e7488',
      pulse: false,
      alarm: false,
    }
  );
}

/** The statuses the legend counts, in the order it lists them. */
export const LEGEND_STATUSES = ['running', 'deploying', 'pending', 'failed', 'stopped'];

/** Initials for the avatar — up to two words, the id when the name is blank. */
export function agentInitials(name: string | undefined, fallback: string): string {
  const source = name?.trim() || fallback;
  return (
    source
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .slice(0, 2)
      .join('') || '?'
  );
}
