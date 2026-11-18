import type { SetAgentAccessDto } from '#api/data/repositories/api/types.gen';
import type {
  AccessOutcomeKind,
  IAccessOutcome,
  IAgentAccessData,
  ISetAgentAccessInput,
} from '../domain/agentAccess.types';

const KINDS = new Set<string>(['all', 'all_except', 'only', 'none']);

function ids(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is string => typeof id === 'string' && id !== '');
}

/** Maps the agent access API onto domain shapes; reads defensively. */
export class AgentAccessMapper {
  toEntity(raw: unknown): IAgentAccessData | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.userId !== 'string') return null;
    const outcome = this.toOutcome(o.outcome);
    if (!outcome) return null;
    return {
      userId: o.userId,
      allowed: ids(o.allowed),
      denied: ids(o.denied),
      outcome,
      needsReview: o.needsReview === true,
      hasEntriesOutsideView: o.hasEntriesOutsideView === true,
      version: typeof o.version === 'string' ? o.version : null,
    };
  }

  toOutcome(raw: unknown): IAccessOutcome | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.kind !== 'string' || !KINDS.has(o.kind)) return null;
    return {
      kind: o.kind as AccessOutcomeKind,
      count: typeof o.count === 'number' ? o.count : 0,
    };
  }

  toSetDto(input: ISetAgentAccessInput): SetAgentAccessDto {
    return {
      allowed: [...input.allowed],
      denied: [...input.denied],
      version: input.version,
      // Sent only when the person confirmed: the server asks otherwise.
      ...(input.confirmOpen === true ? { confirmOpen: true } : {}),
    };
  }
}
