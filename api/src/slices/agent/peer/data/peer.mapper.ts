import { Injectable } from '@nestjs/common';
import { AgentPeer } from '@prisma/client';
import { PeerOrigins, type PeerOrigin } from '../domain';
import type { IAgentPeerData } from '../domain';
import type { IA2aAgentCard } from '../domain';

@Injectable()
export class PeerMapper {
  // Prisma record → domain entity. Dates cross the boundary as ISO strings so
  // the domain (and everything downstream of it) never juggles Date objects.
  toEntity(record: AgentPeer): IAgentPeerData {
    return {
      id: record.id,
      agentId: record.agentId,
      peerAgentId: record.peerAgentId,
      // Rows written before CLEAN-95 carry the column default.
      origin: (record.origin as PeerOrigin) ?? PeerOrigins.Internal,
      token: record.token,
      outboundToken: record.outboundToken,
      // Stored as Json: Prisma types it as JsonValue, but every write goes
      // through this slice and writes a card, so the cast is the boundary
      // where that guarantee is stated once.
      cardSnapshot: record.cardSnapshot as unknown as IA2aAgentCard,
      cardUrl: record.cardUrl,
      cardReadAt: record.cardReadAt.toISOString(),
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}
