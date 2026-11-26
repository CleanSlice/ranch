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

const PHASES = new Set<IAgentPodStatus['phase']>([
  'Pending',
  'Running',
  'Succeeded',
  'Failed',
  'Unknown',
]);

/**
 * Decodes a raw status-stream frame into a typed domain message, validating the
 * discriminant (`type` / `eventType`) and requiring a well-formed agent record
 * so the store's reducer can't crash on a malformed payload.
 */
export class AgentStatusMapper {
  // The status word is decoded by the agent row's own decoder, so REST and
  // the stream cannot disagree about which statuses exist.
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
    const row = this.agentMapper.toEntity(o.agent);
    if (!row) return null;
    // Status facts only: whatever else a frame held is not read.
    const agent: IAgentRecord = {
      id: row.id,
      status: row.status,
      updatedAt: row.updatedAt,
    };
    return {
      agent,
      pod: this.toPod(o.pod),
      bridleConnected: o.bridleConnected === true,
      tools:
        o.tools === 'connecting' || o.tools === 'limited' ? o.tools : null,
    };
  }

  private toPod(raw: unknown): IAgentPodStatus | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    return {
      phase: PHASES.has(o.phase as IAgentPodStatus['phase'])
        ? (o.phase as IAgentPodStatus['phase'])
        : 'Unknown',
      ready: o.ready === true,
      restartCount: typeof o.restartCount === 'number' ? o.restartCount : 0,
      containerWaitingReason:
        typeof o.containerWaitingReason === 'string'
          ? o.containerWaitingReason
          : null,
      superseded: o.superseded === true,
    };
  }
}
