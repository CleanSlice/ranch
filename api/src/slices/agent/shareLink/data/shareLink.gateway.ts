import { Injectable } from '@nestjs/common';
import { PrismaService } from '#/setup/prisma/prisma.service';
import {
  ICreateShareLinkInput,
  IShareLinkData,
  IShareLinkGateway,
} from '../domain';
import { ShareLinkMapper } from './shareLink.mapper';

@Injectable()
export class ShareLinkGateway extends IShareLinkGateway {
  constructor(
    private prisma: PrismaService,
    private mapper: ShareLinkMapper,
  ) {
    super();
  }

  async findByAgent(agentId: string): Promise<IShareLinkData | null> {
    const record = await this.prisma.agentShareLink.findUnique({
      where: { agentId },
    });
    return record ? this.mapper.toEntity(record) : null;
  }

  async findByToken(token: string): Promise<IShareLinkData | null> {
    const record = await this.prisma.agentShareLink.findUnique({
      where: { token },
    });
    return record ? this.mapper.toEntity(record) : null;
  }

  // `agentId @unique` turns a concurrent double-share into a P2002 instead of
  // a second active link; the caller decides what to do with it.
  async create({
    agentId,
    token,
    userId,
  }: ICreateShareLinkInput): Promise<IShareLinkData> {
    const record = await this.prisma.agentShareLink.create({
      data: { agentId, token, createdBy: userId, updatedBy: userId },
    });
    return this.mapper.toEntity(record);
  }

  // One UPDATE: the old token stops resolving and the new one starts in the
  // same statement, so Regenerate is atomic (FR-007).
  async rotate(
    agentId: string,
    token: string,
    userId: string,
  ): Promise<IShareLinkData> {
    const record = await this.prisma.agentShareLink.update({
      where: { agentId },
      data: {
        token,
        revokedAt: null,
        rotatedAt: new Date(),
        rotationCount: { increment: 1 },
        updatedBy: userId,
      },
    });
    return this.mapper.toEntity(record);
  }

  // The dead token stays on the row (nothing can resolve it while revokedAt
  // is set) and is overwritten on the next rotation.
  async revoke(agentId: string, userId: string): Promise<IShareLinkData> {
    const record = await this.prisma.agentShareLink.update({
      where: { agentId },
      data: { revokedAt: new Date(), updatedBy: userId },
    });
    return this.mapper.toEntity(record);
  }
}
