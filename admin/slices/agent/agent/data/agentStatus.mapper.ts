import type {
  AgentStatusEventType,
  AgentStatusStreamMessage,
  IAgentPodStatus,
  IAgentRecord,
  IAgentStatus,
} from '../domain/agentStatus.types';

const EVENT_TYPES = new Set<AgentStatusEventType>([
  'added',
  'modified',
  'deleted',
]);

/**
 * Decodes a raw status-stream frame into a typed domain message, validating the
 * discriminant (`type` / `eventType`) and requiring a well-formed agent record
 * so the store's reducer can't crash on a malformed payload.
 */
export class AgentStatusMapper {
  toStreamMessage(raw: unknown): AgentStatusStreamMessage | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;

    if (o.type === 'snapshot') {
      const items = Array.isArray(o.payload) ? o.payload : [];
      return {
        type: 'snapshot',
        payload: items
          .map((s) => this.toStatus(s))
          .filter((s): s is IAgentStatus => s !== null),
      };
    }

    if (o.type === 'event') {
      const p =
        o.payload && typeof o.payload === 'object'
          ? (o.payload as Record<string, unknown>)
          : null;
      if (!p) return null;
      const eventType = p.eventType;
      if (typeof eventType !== 'string' || !EVENT_TYPES.has(eventType as AgentStatusEventType)) {
        return null;
      }
      const status = this.toStatus(p.status);
      if (!status) return null;
      return {
        type: 'event',
        payload: { eventType: eventType as AgentStatusEventType, status },
      };
    }

    return null;
  }

  private toStatus(raw: unknown): IAgentStatus | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    const agent = this.toAgent(o.agent);
    if (!agent) return null;
    return { agent, pod: this.toPod(o.pod) };
  }

  private toAgent(raw: unknown): IAgentRecord | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.id !== 'string') return null;
    return {
      id: o.id,
      name: typeof o.name === 'string' ? o.name : '',
      status: typeof o.status === 'string' ? o.status : '',
    };
  }

  // Pod fields come from our own API; validate presence and trust the shape.
  private toPod(raw: unknown): IAgentPodStatus | null {
    if (!raw || typeof raw !== 'object') return null;
    return raw as IAgentPodStatus;
  }
}
