import { createServiceGetter } from '#common/composables/createServiceGetter';
import { useAgentStore } from '#agent/stores/agent';
import type { PeerService } from '#peer/domain';
import type {
  IAgentCard,
  IAgentDelegation,
  IAgentPeer,
  IAgentPeerCandidate,
} from '#peer/domain';

export type {
  IAgentCard,
  IAgentDelegation,
  IAgentPeer,
  IAgentPeerCandidate,
  IAgentSkill,
} from '#peer/domain';

const getService = createServiceGetter<PeerService>('$peerService');

/**
 * Peers of one agent, its own card, and its recent delegations (CLEAN-74).
 *
 * Everything is keyed by agent id because the workspace keeps several agents
 * a click apart, and a stale list from the previous one would be worse than
 * an empty one.
 *
 * Connecting or removing a peer marks the agent as needing a restart. That is
 * not a formality: a pod reads its tool list once at connect, so a peer added
 * now is invisible to the running agent until it comes back up.
 */
export const usePeerStore = defineStore('peer', () => {
  const peersByAgent = ref<Record<string, IAgentPeer[]>>({});
  const cardByAgent = ref<Record<string, IAgentCard | null>>({});
  const candidatesByAgent = ref<Record<string, IAgentPeerCandidate[]>>({});
  const delegationsByAgent = ref<Record<string, IAgentDelegation[]>>({});

  const loading = ref(false);
  const error = ref<string | null>(null);

  function peers(agentId: string): IAgentPeer[] {
    return peersByAgent.value[agentId] ?? [];
  }

  function card(agentId: string): IAgentCard | null {
    return cardByAgent.value[agentId] ?? null;
  }

  function candidates(agentId: string): IAgentPeerCandidate[] {
    return candidatesByAgent.value[agentId] ?? [];
  }

  function delegations(agentId: string): IAgentDelegation[] {
    return delegationsByAgent.value[agentId] ?? [];
  }

  function fail(err: unknown, fallback: string): never {
    error.value = err instanceof Error ? err.message : fallback;
    throw err;
  }

  /** The tab's first load: what this agent advertises, and who it can ask. */
  async function load(agentId: string): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const [ownCard, list] = await Promise.all([
        getService().card(agentId),
        getService().list(agentId),
      ]);
      cardByAgent.value = { ...cardByAgent.value, [agentId]: ownCard };
      peersByAgent.value = { ...peersByAgent.value, [agentId]: list };
    } catch (err) {
      error.value =
        err instanceof Error ? err.message : 'Could not load peers';
    } finally {
      loading.value = false;
    }
  }

  async function loadCandidates(agentId: string): Promise<void> {
    try {
      const list = await getService().candidates(agentId);
      candidatesByAgent.value = { ...candidatesByAgent.value, [agentId]: list };
    } catch (err) {
      fail(err, 'Could not load the agents of this installation');
    }
  }

  /** The card of a candidate, shown for review before anything is saved. */
  function previewCard(peerAgentId: string): Promise<IAgentCard | null> {
    return getService().card(peerAgentId);
  }

  async function connect(agentId: string, peerAgentId: string): Promise<void> {
    const created = await getService().connect(agentId, peerAgentId);
    peersByAgent.value = {
      ...peersByAgent.value,
      [agentId]: [...peers(agentId), created],
    };
    markConnected(agentId, peerAgentId, true);
    useAgentStore().markPendingRestart(agentId);
  }

  async function refresh(agentId: string, peerId: string): Promise<void> {
    const updated = await getService().refresh(agentId, peerId);
    peersByAgent.value = {
      ...peersByAgent.value,
      [agentId]: peers(agentId).map((p) => (p.id === peerId ? updated : p)),
    };
    // A refreshed card changes what the agent is told its peer can do, and
    // that text is read at boot like the rest of the tool list.
    useAgentStore().markPendingRestart(agentId);
  }

  async function remove(agentId: string, peerId: string): Promise<void> {
    const removed = peers(agentId).find((p) => p.id === peerId);
    await getService().remove(agentId, peerId);
    peersByAgent.value = {
      ...peersByAgent.value,
      [agentId]: peers(agentId).filter((p) => p.id !== peerId),
    };
    if (removed) markConnected(agentId, removed.peerAgentId, false);
    useAgentStore().markPendingRestart(agentId);
  }

  async function loadDelegations(agentId: string, limit = 20): Promise<void> {
    try {
      const list = await getService().delegations(agentId, limit);
      delegationsByAgent.value = {
        ...delegationsByAgent.value,
        [agentId]: list,
      };
    } catch (err) {
      fail(err, 'Could not load recent delegations');
    }
  }

  /** Keeps an already-loaded picker honest without a round trip. */
  function markConnected(
    agentId: string,
    peerAgentId: string,
    connected: boolean,
  ): void {
    const list = candidatesByAgent.value[agentId];
    if (!list) return;
    candidatesByAgent.value = {
      ...candidatesByAgent.value,
      [agentId]: list.map((c) =>
        c.id === peerAgentId ? { ...c, connected } : c,
      ),
    };
  }

  function clearError(): void {
    error.value = null;
  }

  return {
    peersByAgent,
    cardByAgent,
    candidatesByAgent,
    delegationsByAgent,
    loading,
    error,
    peers,
    card,
    candidates,
    delegations,
    load,
    loadCandidates,
    previewCard,
    connect,
    refresh,
    remove,
    loadDelegations,
    clearError,
  };
});
