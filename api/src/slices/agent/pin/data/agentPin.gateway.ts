import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '#/setup/prisma/prisma.service';
import { IAgentPinGateway } from '../domain/agentPin.gateway';

@Injectable()
export class AgentPinGateway extends IAgentPinGateway {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async pin(userId: string, agentId: string): Promise<boolean> {
    try {
      await this.prisma.agentPin.upsert({
        where: { userId_agentId: { userId, agentId } },
        create: { userId, agentId },
        update: {},
      });
      return true;
    } catch (err) {
      // The foreign key: there is no such agent to pin.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2003'
      ) {
        return false;
      }
      throw err;
    }
  }

  async unpin(userId: string, agentId: string): Promise<boolean> {
    await this.prisma.agentPin.deleteMany({ where: { userId, agentId } });
    const agent = await this.prisma.agent.findUnique({
      where: { id: agentId },
      select: { id: true },
    });
    return agent !== null;
  }

  async pinnedIds(userId: string): Promise<Set<string>> {
    if (!userId) return new Set();
    const rows = await this.prisma.agentPin.findMany({
      where: { userId },
      select: { agentId: true },
    });
    return new Set(rows.map((r) => r.agentId));
  }

  async removeUser(userId: string): Promise<void> {
    await this.prisma.agentPin.deleteMany({ where: { userId } });
  }
}
