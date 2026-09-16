import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '#/setup/prisma/prisma.service';
import {
  IAgentPeerData,
  ICreatePeerInput,
  IPeerGateway,
  IUpdateSnapshotInput,
} from '../domain';
import { PeerMapper } from './peer.mapper';

@Injectable()
export class PeerGateway extends IPeerGateway {
  constructor(
    private prisma: PrismaService,
    private mapper: PeerMapper,
  ) {
    super();
  }

  async listByAgent(agentId: string): Promise<IAgentPeerData[]> {
    const records = await this.prisma.agentPeer.findMany({
      where: { agentId },
      orderBy: { createdAt: 'asc' },
    });
    return records.map((record) => this.mapper.toEntity(record));
  }

  async findById(id: string): Promise<IAgentPeerData | null> {
    const record = await this.prisma.agentPeer.findUnique({ where: { id } });
    return record ? this.mapper.toEntity(record) : null;
  }

  async findByPair(
    agentId: string,
    peerAgentId: string,
  ): Promise<IAgentPeerData | null> {
    const record = await this.prisma.agentPeer.findUnique({
      where: { agentId_peerAgentId: { agentId, peerAgentId } },
    });
    return record ? this.mapper.toEntity(record) : null;
  }

  async findByToken(token: string): Promise<IAgentPeerData | null> {
    const record = await this.prisma.agentPeer.findUnique({ where: { token } });
    return record ? this.mapper.toEntity(record) : null;
  }

  // `@@unique([agentId, peerAgentId])` turns a concurrent double-connect into
  // a P2002 instead of two connections to the same peer; the caller decides
  // what to do with it.
  async create(input: ICreatePeerInput): Promise<IAgentPeerData> {
    const record = await this.prisma.agentPeer.create({
      data: {
        agentId: input.agentId,
        peerAgentId: input.peerAgentId,
        token: input.token,
        cardSnapshot: input.cardSnapshot as unknown as Prisma.InputJsonValue,
        cardUrl: input.cardUrl,
        cardReadAt: input.cardReadAt,
      },
    });
    return this.mapper.toEntity(record);
  }

  async updateSnapshot(
    id: string,
    input: IUpdateSnapshotInput,
  ): Promise<IAgentPeerData> {
    const record = await this.prisma.agentPeer.update({
      where: { id },
      data: {
        cardSnapshot: input.cardSnapshot as unknown as Prisma.InputJsonValue,
        cardUrl: input.cardUrl,
        cardReadAt: input.cardReadAt,
      },
    });
    return this.mapper.toEntity(record);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.agentPeer.delete({ where: { id } });
  }
}
