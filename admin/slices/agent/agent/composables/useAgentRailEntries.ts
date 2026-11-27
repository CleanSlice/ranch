import type { Ref } from 'vue';
import type {
  AgentStatusTypes,
  IAgentData,
  IAgentLimitEntry,
} from '#agent/domain';
import { railOrder } from '#agent/utils/railOrder';
import {
  filterByOwner,
  ownerMark,
  type OwnerFilterTypes,
  type OwnerMarkTypes,
} from '#agent/utils/agentOwnership';

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
  /** Pinned by an operator: marked, and listed right after Rancher (CLEAN-216). */
  pinned: boolean;
  /** A request limit is full right now: visitors are being refused (CLEAN-224). */
  atLimit: boolean;
  /** Public with no request limits — made public before limits existed. */
  needsLimits: boolean;
  /** Running, with tool servers still being reached or missing (CLEAN-245). */
  tools: 'connecting' | 'limited' | null;
  /** Whose agent it is, for the badge on the avatar (CLEAN-259): the
   *  viewer's own, somebody else's by initials, or no badge. */
  mark: OwnerMarkTypes | null;
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

/**
 * 1–2 uppercase letters; falls back to the id when the name is empty. An
 * initial is the word's first code point, not its first UTF-16 unit: a name
 * that starts with an emoji gave half a character (CLEAN-270; the app
 * console's twin is `app/slices/agent/utils/agentStatus.ts`).
 */
export function agentInitials(name: string, id: string): string {
  const source = name?.trim() || id;
  return (
    source
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => Array.from(part)[0]?.toUpperCase() ?? '')
      .slice(0, 2)
      .join('') || '?'
  );
}

/**
 * The rail's view model: the agent store's records, filtered by the search
 * term, in rail order (`utils/railOrder`): the Ranch admin agent (Rancher)
 * first — it is the agent an operator reaches for most — then the pinned
 * agents (CLEAN-216), and the rest keep the list's own order.
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
  // The limit store's records by agent id. The two marks are read from there
  // and nowhere else, so a row and the open agent's cards cannot disagree.
  limits?: Ref<Record<string, IAgentLimitEntry>>,
  // The status store's word per agent on its tool servers. A row names no
  // server: the detail is read for the open agent only.
  tools?: Ref<Record<string, 'connecting' | 'limited'>>,
  // "All" or "Mine" (CLEAN-259), already resolved by the rail: "mine" is
  // read off the records here, never kept as a second list.
  ownerFilter?: Ref<OwnerFilterTypes>,
) {
  return computed<IRailEntry[]>(() => {
    const term = search.value.trim().toLowerCase();
    return railOrder(
      filterByOwner(agents.value ?? [], ownerFilter?.value ?? 'all').filter(
        (a) => !term || a.name.toLowerCase().includes(term),
      ),
    ).map((a) => ({
        id: a.id,
        name: a.name,
        initials: agentInitials(a.name, a.id),
        status: a.status,
        statusReason: a.statusReason,
        tone: TONE[a.status],
        createdAt: a.createdAt,
        isAdmin: a.isAdmin,
        pinned: a.pinned,
        atLimit: limits?.value[a.id]?.atLimit === true,
        needsLimits: limits?.value[a.id]?.needsLimits === true,
        tools: a.status === 'running' ? (tools?.value[a.id] ?? null) : null,
        mark: ownerMark(a),
        isActive: a.id === activeId.value,
      }));
  });
}
