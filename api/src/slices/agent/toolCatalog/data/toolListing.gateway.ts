import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '#/setup/prisma/prisma.service';
import type { IToolListingRecorder } from '#/mcp/interfaces/tool-listing-recorder.interface';
import {
  IAgentToolListingData,
  IToolListingGateway,
} from '../domain/toolCatalog.types';

/**
 * One row per agent, overwritten on every tools/list the pod makes. The
 * upsert is the whole write path: a pod that boots twice leaves one row,
 * stamped with the later listing.
 */
@Injectable()
export class ToolListingGateway
  extends IToolListingGateway
  implements IToolListingRecorder
{
  constructor(private prisma: PrismaService) {
    super();
  }

  async record(agentId: string, toolNames: string[]): Promise<void> {
    const names = toolNames as unknown as Prisma.InputJsonValue;
    await this.prisma.agentToolListing.upsert({
      where: { agentId },
      create: { agentId, toolNames: names, listedAt: new Date() },
      update: { toolNames: names, listedAt: new Date() },
    });
  }

  async findByAgent(agentId: string): Promise<IAgentToolListingData | null> {
    const row = await this.prisma.agentToolListing.findUnique({
      where: { agentId },
    });
    if (!row) return null;
    const raw = row.toolNames;
    const toolNames = Array.isArray(raw)
      ? raw.filter((n): n is string => typeof n === 'string')
      : [];
    return { agentId: row.agentId, toolNames, listedAt: row.listedAt };
  }
}
