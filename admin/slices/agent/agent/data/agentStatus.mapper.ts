import type {
  AgentStatusEventType,
  AgentStatusStreamMessage,
  IAgentPodStatus,
  IAgentRecord,
  IAgentStatus,
} from '../domain/agentStatus.types';
import { AgentMapper } from './agent.mapper';

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
  // One decoder for an agent row, whichever transport carried it — REST and
  // the stream must not drift into two shapes of the same entity.
  private agentMapper = new AgentMapper();

  toStreamMessage(raw: unknown): AgentStatusStreamMessage | null {
    if (!raw || typeof raw !== 'object') return null;
    let o = raw as Record<string, unknown>;
    // The API's response interceptor wraps each SSE emission too, so a frame
    // arrives as `{ data: { type, payload } }`. Reading `type` off the wrapper
    // dropped every frame silently — the stream looked connected and fed
    // nothing. Accept both shapes so a bare frame keeps working.
    if (o.type === undefined && o.data && typeof o.data === 'object') {
      o = o.data as Record<string, unknown>;
    }

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
    const agent: IAgentRecord | null = this.agentMapper.toEntity(o.agent);
    if (!agent) return null;
    return {
      agent,
      pod: this.toPod(o.pod),
      bridleConnected: o.bridleConnected === true,
    };
  }

  // Pod fields come from our own API; validate presence and trust the shape.
  private toPod(raw: unknown): IAgentPodStatus | null {
    if (!raw || typeof raw !== 'object') return null;
    return raw as IAgentPodStatus;
  }
}
