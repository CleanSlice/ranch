import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '#/setup/prisma/prisma.service';
import {
  DelegationStatuses,
  IAgentDelegationData,
  ICreateDelegationData,
  IDelegationAgentScope,
  IDelegationCounts,
  IDelegationGateway,
  IDelegationPeerCount,
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
        forUserId: input.forUserId ?? null,
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

  async countForClient(
    clientId: string,
    from: Date,
    to: Date,
    agentScope?: IDelegationAgentScope,
  ): Promise<IDelegationCounts> {
    const groups = await this.prisma.agentDelegation.groupBy({
      by: ['peerAgentId', 'peerName', 'status'],
      where: {
        // An equality and a range: the index on [clientId, startedAt].
        clientId,
        startedAt: { gte: from, lte: to },
        ...(agentScope ? { agentId: agentScope } : {}),
      },
      _count: { _all: true },
      _max: { startedAt: true },
    });

    let total = 0;
    let answered = 0;
    const peers = new Map<string, IDelegationPeerCount & { namedAt: number }>();
    for (const group of groups) {
      const count = group._count._all;
      total += count;
      if (group.status === DelegationStatuses.Answered) answered += count;

      // An agent of this Ranch is one peer under whatever names it had in
      // the period, and is shown under the latest. An agent outside has no
      // id here (CLEAN-95), so its name is all that tells it apart.
      const key =
        group.peerAgentId !== null
          ? `agent:${group.peerAgentId}`
          : `name:${group.peerName}`;
      const peer = peers.get(key) ?? {
        peerAgentId: group.peerAgentId,
        name: group.peerName,
        count: 0,
        namedAt: -1,
      };
      peer.count += count;
      const at = group._max.startedAt?.getTime() ?? 0;
      if (at > peer.namedAt) {
        peer.name = group.peerName;
        peer.namedAt = at;
      }
      peers.set(key, peer);
    }

    return {
      total,
      answered,
      peers: [...peers.values()]
        .map(({ peerAgentId, name, count }) => ({ peerAgentId, name, count }))
        // By name among equals, so two calls give one order.
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    };
  }

  async firstRecordAt(): Promise<Date | null> {
    // No index leads with `startedAt`, so this reads the table once. It is
    // asked once in an installation's life, at the boot that first sees the
    // hand-overs figure (FigureRegistry), not when a page is viewed.
    const found = await this.prisma.agentDelegation.aggregate({
      _min: { startedAt: true },
    });
    return found._min.startedAt;
  }
}
