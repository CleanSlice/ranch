import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '#/setup/prisma/prisma.service';
import {
  IAgentDelegationData,
  ICreateDelegationData,
  IDelegationGateway,
  IFinishDelegationData,
} from '../domain';
import { DelegationMapper } from './delegation.mapper';

@Injectable()
export class DelegationGateway extends IDelegationGateway {
  constructor(
    private prisma: PrismaService,
    private mapper: DelegationMapper,
  ) {
    super();
  }

  async create(input: ICreateDelegationData): Promise<IAgentDelegationData> {
    const record = await this.prisma.agentDelegation.create({
      data: {
        agentId: input.agentId,
        peerId: input.peerId,
        peerAgentId: input.peerAgentId,
        peerName: input.peerName,
        contextId: input.contextId,
        turnId: input.turnId ?? null,
        clientId: input.clientId ?? null,
        task: input.task,
        reason: input.reason,
        matchedSkills: input.matchedSkills as unknown as Prisma.InputJsonValue,
      },
    });
    return this.mapper.toEntity(record);
  }

  async finish(
    id: string,
    input: IFinishDelegationData,
  ): Promise<IAgentDelegationData> {
    const record = await this.prisma.agentDelegation.update({
      where: { id },
      data: {
        status: input.status,
        errorCode: input.errorCode ?? null,
        excerpt: input.excerpt ?? null,
        finishedAt: input.finishedAt,
        durationMs: input.durationMs,
      },
    });
    return this.mapper.toEntity(record);
  }

  async listRecent(
    agentId: string,
    limit: number,
  ): Promise<IAgentDelegationData[]> {
    const records = await this.prisma.agentDelegation.findMany({
      where: { agentId },
      orderBy: { startedAt: 'desc' },
      take: limit,
    });
    return records.map((record) => this.mapper.toEntity(record));
  }
}
