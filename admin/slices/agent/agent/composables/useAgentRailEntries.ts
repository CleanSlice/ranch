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

const TONE: Record<AgentStatusTypes, IRailStatusTone> = {
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
 * Live pod state wins over the DB row where we have it — the same precedence
 * `rancher/Provider.vue` uses. The DB row is reconciled asynchronously, so
 * right after a stop/restart it can lag the pod by seconds; the rail is the
 * one place where that lag is visible across every agent at once.
 *
 * No pod at all means either "never deployed" or "stopped" — both are states
 * the DB row describes correctly, so we defer to it rather than inventing one.
 */
function reconcileStatus(
  agent: IAgentData,
  pod: { phase: string; ready: boolean } | undefined,
): AgentStatusTypes {
  // 'unreachable' is precisely "pod healthy, runtime absent" — a Running+Ready
  // pod is part of the diagnosis, not evidence against it. Letting the pod
  // override to green here would re-create the incident this status exposes.
  if (agent.status === 'unreachable') return 'unreachable';
  if (!pod) return agent.status;
  if (pod.phase === 'Running') return pod.ready ? 'running' : 'deploying';
  if (pod.phase === 'Pending') return 'pending';
  if (pod.phase === 'Failed') return 'failed';
  return agent.status;
}

/**
 * The rail's view model: the agent list, reconciled against the live status
 * stream, filtered by the search term, in the list's own order.
 *
 * Deliberately carries no action handlers — a rail entry identifies an agent
 * and nothing more (FR-002). Restart/stop/delete live in the settings panel.
 */
export function useAgentRailEntries(
  agents: Ref<IAgentData[] | null | undefined>,
  activeId: Ref<string>,
  search: Ref<string>,
) {
  const agentStatusStore = useAgentStatusStore();

  return computed<IRailEntry[]>(() => {
    const term = search.value.trim().toLowerCase();
    return (agents.value ?? [])
      .filter((a) => !term || a.name.toLowerCase().includes(term))
      .map((a) => {
        const live = agentStatusStore.agents[a.id];
        // The SSE record is fresher than the fetched list (the sweep writes
        // 'unreachable' between refetches) — prefer it when present.
        const dbStatus = (live?.status as AgentStatusTypes) || a.status;
        const status = reconcileStatus(
          { ...a, status: dbStatus },
          agentStatusStore.statuses[a.id],
        );
        return {
          id: a.id,
          name: a.name,
          initials: agentInitials(a.name, a.id),
          status,
          statusReason: live?.statusReason ?? a.statusReason,
          tone: TONE[status],
          createdAt: a.createdAt,
          isAdmin: a.isAdmin,
          isActive: a.id === activeId.value,
        };
      });
  });
}
