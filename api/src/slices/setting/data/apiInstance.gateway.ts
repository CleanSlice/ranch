import { Injectable } from '@nestjs/common';
import { PrismaService } from '#/setup/prisma/prisma.service';
import { IApiInstanceGateway } from '../domain/apiInstance.gateway';

@Injectable()
export class ApiInstanceGateway extends IApiInstanceGateway {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async heartbeat(id: string, hostname: string, at: Date): Promise<void> {
    await this.prisma.apiInstance.upsert({
      where: { id },
      create: { id, hostname, startedAt: at, lastSeenAt: at },
      update: { lastSeenAt: at },
    });
  }

  countLive(since: Date): Promise<number> {
    return this.prisma.apiInstance.count({
      where: { lastSeenAt: { gte: since } },
    });
  }

  async remove(id: string): Promise<void> {
    await this.prisma.apiInstance.deleteMany({ where: { id } });
  }

  async pruneBefore(before: Date): Promise<number> {
    const { count } = await this.prisma.apiInstance.deleteMany({
      where: { lastSeenAt: { lt: before } },
    });
    return count;
  }
}
