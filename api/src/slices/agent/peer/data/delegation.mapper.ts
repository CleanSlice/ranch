import { Injectable } from '@nestjs/common';
import { AgentDelegation } from '@prisma/client';
import type {
  DelegationErrorCode,
  DelegationStatus,
  IAgentDelegationData,
  IMatchedSkill,
} from '../domain';

@Injectable()
export class DelegationMapper {
  toEntity(record: AgentDelegation): IAgentDelegationData {
    return {
      id: record.id,
      agentId: record.agentId,
      peerId: record.peerId,
      peerAgentId: record.peerAgentId,
      peerName: record.peerName,
      contextId: record.contextId,
      turnId: record.turnId,
      clientId: record.clientId,
      task: record.task,
      reason: record.reason,
      matchedSkills: toSkills(record.matchedSkills),
      status: record.status as DelegationStatus,
      errorCode: (record.errorCode as DelegationErrorCode | null) ?? null,
      excerpt: record.excerpt,
      startedAt: record.startedAt.toISOString(),
      finishedAt: record.finishedAt ? record.finishedAt.toISOString() : null,
      durationMs: record.durationMs,
    };
  }
}

/** Json in, `[{ id, name }]` out. Anything unrecognisable reads as none, so a
 *  hand-edited row can never break the Recent delegations list. */
function toSkills(value: unknown): IMatchedSkill[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const { id, name } = entry as Record<string, unknown>;
    if (typeof id !== 'string' || typeof name !== 'string') return [];
    return [{ id, name }];
  });
}
