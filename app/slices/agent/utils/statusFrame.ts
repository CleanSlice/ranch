import type { LaunchPodFacts } from './launchSteps';

// One reading of the public status stream (`GET /agents/status/stream`) for
// the launch step list (CLEAN-247). Pure on purpose: no Vue, no Nuxt aliases,
// so `bun test` runs it.
//
// The stream is public and carries status facts only (CLEAN-232): which
// agents this account reaches is the agent store's business, and a frame for
// an agent it does not hold is simply never looked up.

export interface IAgentStatusFrame {
  agentId: string;
  /** The agent's status, as received. */
  status: string;
  /** When the row carrying that status was written. */
  updatedAt: string;
  /** Null: no pod is reported for this agent. */
  pod: LaunchPodFacts | null;
  /** The agent's runtime is on the hub. */
  hubConnected: boolean;
}

export interface IAgentStatusMessage {
  /** A snapshot is the whole picture: what it does not name is gone. */
  snapshot: boolean;
  frames: IAgentStatusFrame[];
}

function record(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
}

function toPod(raw: unknown): LaunchPodFacts | null {
  const o = record(raw);
  if (!o || typeof o.phase !== 'string') return null;
  return {
    phase: o.phase,
    ready: o.ready === true,
    containerWaitingReason:
      typeof o.containerWaitingReason === 'string' ? o.containerWaitingReason : null,
    // Absent from an older API: not known to be superseded.
    superseded: o.superseded === true,
  };
}

function toFrame(raw: unknown, podGone = false): IAgentStatusFrame | null {
  const o = record(raw);
  const agent = record(o?.agent);
  if (!o || !agent || typeof agent.id !== 'string') return null;
  return {
    agentId: agent.id,
    status: typeof agent.status === 'string' ? agent.status : '',
    updatedAt: typeof agent.updatedAt === 'string' ? agent.updatedAt : '',
    pod: podGone ? null : toPod(o.pod),
    hubConnected: o.bridleConnected === true,
  };
}

export function parseStatusMessage(raw: unknown): IAgentStatusMessage | null {
  let o = record(raw);
  if (!o) return null;
  // The API's response interceptor wraps each emission, so a frame arrives as
  // `{ data: { type, payload } }`. Both shapes are read.
  if (o.type === undefined) o = record(o.data);
  if (!o) return null;

  if (o.type === 'snapshot') {
    const items = Array.isArray(o.payload) ? o.payload : [];
    return {
      snapshot: true,
      frames: items
        .map((item) => toFrame(item))
        .filter((f): f is IAgentStatusFrame => f !== null),
    };
  }

  if (o.type === 'event') {
    const payload = record(o.payload);
    if (!payload) return null;
    // A deleted pod's last frame still describes it; the pod is gone.
    const frame = toFrame(payload.status, payload.eventType === 'deleted');
    return frame ? { snapshot: false, frames: [frame] } : null;
  }

  return null;
}

/**
 * Whether a frame's status is news for a row read at `rowUpdatedAt`. Strictly
 * newer only: a frame as old as the row says what the row already says, and
 * letting it through would undo an optimistic flip the row is wearing.
 */
export function frameIsNewer(frameUpdatedAt: string, rowUpdatedAt: string): boolean {
  const frame = Date.parse(frameUpdatedAt);
  const row = Date.parse(rowUpdatedAt);
  return Number.isFinite(frame) && Number.isFinite(row) && frame > row;
}
