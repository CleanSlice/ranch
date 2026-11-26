import { createServiceGetter } from '#common/composables/createServiceGetter';
import type {
  AgentStatusConnectionTypes,
  AgentStatusGateway,
} from '#agent/data/agentStatus.gateway';
import type { LaunchPodFacts } from '#agent/utils/launchSteps';
import {
  frameIsNewer,
  type IAgentStatusFrame,
  type IAgentStatusMessage,
} from '#agent/utils/statusFrame';

const getGateway = createServiceGetter<AgentStatusGateway>('$agentStatusGateway');

/**
 * What the live status stream says that exists nowhere else (CLEAN-247): an
 * agent's pod and whether its runtime is on the hub. The launch step list is
 * read from these.
 *
 * No agents here on purpose (docs/state.md): the status a frame carries is
 * patched into the agent store, the one place an agent lives.
 */
export const useAgentStatusStore = defineStore('agentStatus', () => {
  const connectionState = ref<AgentStatusConnectionTypes>('idle');
  const pods = ref<Record<string, LaunchPodFacts | null>>({});
  const hub = ref<Record<string, boolean>>({});
  const agentStore = useAgentStore();

  // Several views mount and unmount the stream; one EventSource is open.
  let subscribers = 0;
  let active = false;

  // The frame's status goes onto the row the agent store holds, and only when
  // it is news: a frame as old as the row would undo the optimistic
  // 'deploying' the row is wearing while a restart call is out.
  function patchStatus(frame: IAgentStatusFrame) {
    const row = agentStore.byId(frame.agentId);
    if (!row || !frame.status || row.status === frame.status) return;
    if (!frameIsNewer(frame.updatedAt, row.updatedAt)) return;
    agentStore.patch(frame.agentId, {
      status: frame.status,
      updatedAt: frame.updatedAt,
    });
  }

  function applyMessage(message: IAgentStatusMessage) {
    // A snapshot is the whole picture: what it does not name is gone.
    const nextPods = message.snapshot ? {} : { ...pods.value };
    const nextHub = message.snapshot ? {} : { ...hub.value };
    for (const frame of message.frames) {
      nextPods[frame.agentId] = frame.pod;
      nextHub[frame.agentId] = frame.hubConnected;
      patchStatus(frame);
    }
    pods.value = nextPods;
    hub.value = nextHub;
  }

  function connect() {
    subscribers += 1;
    if (active || !import.meta.client) return;
    active = true;
    getGateway().subscribe({
      onMessage: applyMessage,
      onConnectionStateChange: (state) => {
        connectionState.value = state;
      },
    });
  }

  function disconnect() {
    subscribers = Math.max(0, subscribers - 1);
    if (subscribers > 0 || !active) return;
    active = false;
    getGateway().unsubscribe();
    connectionState.value = 'idle';
  }

  return { connectionState, pods, hub, connect, disconnect };
});
