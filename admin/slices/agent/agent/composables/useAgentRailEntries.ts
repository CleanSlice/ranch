import type { Ref } from 'vue';
import type { AgentStatusTypes, IAgentData } from '#agent/domain';

export interface IRailStatusTone {
  dot: string;
  text: string;
  pulse: boolean;
}

export interface IRailEntry {
  id: string;
  name: string;
  initials: string;
  status: AgentStatusTypes;
  statusReason: string | null;
  tone: IRailStatusTone;
  createdAt: string;
  isAdmin: boolean;
  isActive: boolean;
}

// Shared with the workspace header's avatar dot (status/Dot.vue), so the rail
// row and the open agent never disagree on what a colour means.
export const TONE: Record<AgentStatusTypes, IRailStatusTone> = {
  running: {
    dot: 'bg-emerald-500',
    text: 'text-emerald-700 dark:text-emerald-400',
    pulse: true,
  },
  deploying: {
    dot: 'bg-amber-500',
    text: 'text-amber-700 dark:text-amber-400',
    pulse: true,
  },
  pending: {
    dot: 'bg-amber-500',
    text: 'text-amber-700 dark:text-amber-400',
    pulse: true,
  },
  failed: {
    dot: 'bg-rose-500',
    text: 'text-rose-700 dark:text-rose-400',
    pulse: false,
  },
  stopped: {
    dot: 'bg-muted-foreground',
    text: 'text-muted-foreground',
    pulse: false,
  },
  // Deliberately NOT the running green and NOT the failed rose: the pod is
  // healthy but the runtime never reached the bridle hub — its own state.
  unreachable: {
    dot: 'bg-orange-500',
    text: 'text-orange-700 dark:text-orange-400',
    pulse: false,
  },
};

/** 1–2 uppercase letters; falls back to the id when the name is empty. */
export function agentInitials(name: string, id: string): string {
  const source = name?.trim() || id;
  return (
    source
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .slice(0, 2)
      .join('') || '?'
  );
}

/**
 * The rail's view model: the agent store's records, filtered by the search
 * term. The Ranch admin agent (Rancher) is pinned first — it is the agent an
 * operator reaches for most — and the rest keep the list's own order.
 *
 * A row shows the record's own `status` / `statusReason` — exactly what the
 * open agent's header shows (docs/state.md). It used to derive a status of its
 * own from the pod phase, which is a second opinion the header never shared:
 * two derivations of one fact is how a row and a header end up disagreeing.
 * The server reconciles pod state into the row and the status stream delivers
 * it here.
 *
 * Deliberately carries no action handlers — a rail entry identifies an agent
 * and nothing more (FR-002). Restart/stop/delete live in the settings panel.
 */
export function useAgentRailEntries(
  agents: Ref<IAgentData[] | null | undefined>,
  activeId: Ref<string>,
  search: Ref<string>,
) {
  return computed<IRailEntry[]>(() => {
    const term = search.value.trim().toLowerCase();
    return (agents.value ?? [])
      .filter((a) => !term || a.name.toLowerCase().includes(term))
      // Stable sort: admin agents float to the top, everything else keeps
      // its relative order.
      .sort((a, b) => Number(b.isAdmin) - Number(a.isAdmin))
      .map((a) => ({
        id: a.id,
        name: a.name,
        initials: agentInitials(a.name, a.id),
        status: a.status,
        statusReason: a.statusReason,
        tone: TONE[a.status],
        createdAt: a.createdAt,
        isAdmin: a.isAdmin,
        isActive: a.id === activeId.value,
      }));
  });
}
