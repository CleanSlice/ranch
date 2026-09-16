import { createServiceGetter } from '#common/composables/createServiceGetter';
import { useAgentStore } from '#agent/stores/agent';
import type { PeerService } from '#peer/domain';
import type {
  IAgentCard,
  IAgentDelegation,
  IAgentPeer,
  IAgentPeerCandidate,
  IPeersState,
} from '#peer/domain';

export type {
  IAgentCard,
  IAgentDelegation,
  IAgentPeer,
  IAgentPeerCandidate,
  IAgentSkill,
  IPeersState,
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
  const stateByAgent = ref<Record<string, IPeersState | null>>({});

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

  function peersState(agentId: string): IPeersState | null {
    return stateByAgent.value[agentId] ?? null;
  }

  /** Armed/pending indicator (CLEAN-95). Silent failure: the indicator must
   *  never take the tab down with it. */
  async function loadState(agentId: string): Promise<void> {
    try {
      const state = await getService().peersState(agentId);
      stateByAgent.value = { ...stateByAgent.value, [agentId]: state };
    } catch {
      stateByAgent.value = { ...stateByAgent.value, [agentId]: null };
    }
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

  /** Same review step for an external address (CLEAN-95): read, never save. */
  function previewByUrl(
    agentId: string,
    url: string,
    token?: string,
  ): Promise<IAgentCard | null> {
    return getService().previewByUrl(agentId, url, token);
  }

  async function connect(agentId: string, peerAgentId: string): Promise<void> {
    const created = await getService().connect(agentId, peerAgentId);
    peersByAgent.value = {
      ...peersByAgent.value,
      [agentId]: [...peers(agentId), created],
    };
    markConnected(agentId, peerAgentId, true);
    useAgentStore().markPendingRestart(agentId);
    void loadState(agentId);
  }

  /** Import an external agent by address (CLEAN-95). A re-import of a known
   *  address comes back as the same row id — replaced in place, no dupes. */
  async function importByUrl(
    agentId: string,
    url: string,
    token?: string,
  ): Promise<IAgentPeer> {
    const imported = await getService().importByUrl(agentId, url, token);
    const current = peers(agentId);
    const known = current.some((p) => p.id === imported.id);
    peersByAgent.value = {
      ...peersByAgent.value,
      [agentId]: known
        ? current.map((p) => (p.id === imported.id ? imported : p))
        : [...current, imported],
    };
    useAgentStore().markPendingRestart(agentId);
    void loadState(agentId);
    return imported;
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
    if (removed?.peerAgentId) {
      markConnected(agentId, removed.peerAgentId, false);
    }
    useAgentStore().markPendingRestart(agentId);
    void loadState(agentId);
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
    stateByAgent,
    loading,
    error,
    peers,
    card,
    candidates,
    delegations,
    peersState,
    load,
    loadCandidates,
    loadState,
    previewCard,
    previewByUrl,
    connect,
    importByUrl,
    refresh,
    remove,
    loadDelegations,
    clearError,
  };
});
