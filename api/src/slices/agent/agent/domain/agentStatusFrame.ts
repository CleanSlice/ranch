import type { AgentStatusTypes } from './agent.types';
import type { PodPhaseTypes } from '#/agent/pod/domain/pod.types';
import type { ToolSummaryTypes } from './toolState.types';
import type {
  AgentStatusStreamMessage,
  IAgentStatus,
} from './agentStatus.service';

/**
 * What `GET /agents/status/stream` says about one agent (CLEAN-232).
 *
 * The stream is public: an EventSource cannot send a token, so whoever opens
 * the URL reads it. It used to carry the agent's whole row, operator `config`
 * included, and the pod's name and Kubernetes message. It now carries status
 * facts and nothing else:
 *
 *  - which agent (`id`), its status, and when its row last changed
 *    (`updatedAt`), so a console knows the record it holds is stale and reads
 *    it again through a route that knows who is asking (`GET /agents/:id`);
 *  - of the pod, what a status dot is drawn from, and one word on whether
 *    it is the pod of the launch under way (`superseded`, CLEAN-247): a
 *    restart leaves the old pod Running for as long as it takes to
 *    terminate, and a console that showed a launch step by step would take
 *    it for the new one. Never the pod's name, never when it started;
 *  - whether the runtime is on the hub;
 *  - one word on its tool servers (`tools`, CLEAN-245): `connecting` while
 *    it is still reaching some of them, `limited` when it runs without
 *    some, null otherwise. Never which server, never why.
 *
 * No name, no configuration, no credential or workflow id, no reason text.
 * This is the only place that decides what the stream says; the exact keys
 * are pinned by agentStatusFrame.spec.ts.
 */
export interface IAgentStatusFrame {
  agent: { id: string; status: AgentStatusTypes; updatedAt: Date };
  pod: {
    phase: PodPhaseTypes;
    ready: boolean;
    restartCount: number;
    containerWaitingReason: string | null;
    superseded: boolean;
  } | null;
  bridleConnected: boolean;
  tools: ToolSummaryTypes;
}

export type AgentStatusFrameMessage =
  | { type: 'snapshot'; payload: IAgentStatusFrame[] }
  | {
      type: 'event';
      payload: {
        eventType: 'added' | 'modified' | 'deleted';
        status: IAgentStatusFrame;
      };
    };

/**
 * Whether a pod belongs to a launch that has been replaced: it is being
 * deleted, or it started before the agent's current launch began (the same
 * judgment DeployTracker.isStale makes in memory, here off the row, so it
 * holds after an API restart too).
 *
 * Kubernetes reports a pod's start to the second, rounded down, so the
 * launch's own stamp is rounded down the same way before comparing: a pod
 * that started within the second the launch began is this launch's pod.
 */
export function podSuperseded(
  pod: { terminating: boolean; startedAt: string | null },
  launchStartedAt: Date | null,
): boolean {
  if (pod.terminating) return true;
  if (!pod.startedAt || !launchStartedAt) return false;
  const podStart = new Date(pod.startedAt).getTime();
  const launchStart = Math.floor(launchStartedAt.getTime() / 1000) * 1000;
  return Number.isFinite(podStart) && podStart < launchStart;
}

export function toStatusFrame(status: IAgentStatus): IAgentStatusFrame {
  const { agent, pod } = status;
  return {
    agent: { id: agent.id, status: agent.status, updatedAt: agent.updatedAt },
    pod: pod
      ? {
          phase: pod.phase,
          ready: pod.ready,
          restartCount: pod.restartCount,
          containerWaitingReason: pod.containerWaitingReason,
          superseded: podSuperseded(pod, agent.lastDeployStartedAt),
        }
      : null,
    bridleConnected: status.bridleConnected === true,
    tools:
      status.tools === 'connecting' || status.tools === 'limited'
        ? status.tools
        : null,
  };
}

/** A whole stream message, snapshot or event, as the public stream sends it. */
export function toStatusFrameMessage(
  message: AgentStatusStreamMessage,
): AgentStatusFrameMessage {
  if (message.type === 'snapshot') {
    return { type: 'snapshot', payload: message.payload.map(toStatusFrame) };
  }
  return {
    type: 'event',
    payload: {
      eventType: message.payload.eventType,
      status: toStatusFrame(message.payload.status),
    },
  };
}
