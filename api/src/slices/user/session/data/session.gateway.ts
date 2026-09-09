import { Injectable } from '@nestjs/common';
import { PrismaService } from '#/setup/prisma/prisma.service';
import {
  IPruneSessionsBefore,
  ISessionGateway,
} from '../domain/session.gateway';
import { ICreateSessionData, ISessionData } from '../domain/session.types';
import { SessionMapper } from './session.mapper';

@Injectable()
export class SessionGateway extends ISessionGateway {
  constructor(
    private prisma: PrismaService,
    private mapper: SessionMapper,
  ) {
    super();
  }

  async create(data: ICreateSessionData): Promise<ISessionData> {
    const record = await this.prisma.session.create({
      data: this.mapper.toCreate(data),
    });
    return this.mapper.toEntity(record);
  }

  async findByHash(secretHash: string): Promise<ISessionData | null> {
    const record = await this.prisma.session.findUnique({
      where: { secretHash },
    });
    return record ? this.mapper.toEntity(record) : null;
  }

  async touch(id: string, expiresAt: Date): Promise<ISessionData> {
    const record = await this.prisma.session.update({
      where: { id },
      data: { expiresAt, lastSeenAt: new Date() },
    });
    return this.mapper.toEntity(record);
  }

  async revoke(id: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async pruneForUser(
    userId: string,
    before: IPruneSessionsBefore,
  ): Promise<number> {
    const result = await this.prisma.session.deleteMany({
      where: {
        userId,
        OR: [
          { absoluteExpiresAt: { lt: before.absoluteBefore } },
          { revokedAt: { lt: before.revokedBefore } },
        ],
      },
    });
    return result.count;
  }
}
