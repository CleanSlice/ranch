import { Injectable } from '@nestjs/common';
import { AgentShareLink } from '@prisma/client';
import { IShareLinkData } from '../domain';

@Injectable()
export class ShareLinkMapper {
  // Prisma record → domain entity. Dates cross the boundary as ISO strings so
  // the domain (and everything downstream of it) never juggles Date objects.
  toEntity(record: AgentShareLink): IShareLinkData {
    return {
      id: record.id,
      agentId: record.agentId,
      token: record.token,
      revokedAt: iso(record.revokedAt),
      rotatedAt: iso(record.rotatedAt),
      rotationCount: record.rotationCount,
      createdBy: record.createdBy,
      updatedBy: record.updatedBy,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}
