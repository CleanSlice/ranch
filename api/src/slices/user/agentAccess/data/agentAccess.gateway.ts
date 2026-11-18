import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '#/setup/prisma/prisma.service';
import {
  IAgentAccessGateway,
  IAgentAccessTx,
  IAgentAccessWrite,
} from '../domain/agentAccess.gateway';
import {
  AGENT_ACCESS_REFUSALS,
  AgentAccessError,
  AgentAccessErrorCodes,
  type IAgentAccessState,
} from '../domain/agentAccess.types';
import {
  AgentAccessMapper,
  IAccountAccessRow,
  IAgentAccessRow,
} from './agentAccess.mapper';

type Tx = Prisma.TransactionClient;

/**
 * The key of the per-account lock. Every write of one account's access
 * takes it first, inside its transaction, so a row that does not exist yet
 * is locked as well as one that does.
 */
const lockKey = (userId: string): string => `agent-access:${userId}`;

@Injectable()
export class AgentAccessGateway extends IAgentAccessGateway {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mapper: AgentAccessMapper,
  ) {
    super();
  }

  load(userId: string): Promise<IAgentAccessState> {
    return this.loadWith(this.prisma, userId);
  }

  async loadMany(userIds: string[]): Promise<Map<string, IAgentAccessState>> {
    const out = new Map<string, IAgentAccessState>();
    if (userIds.length === 0) return out;
    const rows = await this.prisma.$queryRaw<IAgentAccessRow[]>`
      SELECT a."userId", a."limited", a."updatedAt", e."agentId", e."list"
      FROM "UserAgentAccess" a
      LEFT JOIN "UserAgentAccessEntry" e ON e."userId" = a."userId"
      WHERE a."userId" IN (${Prisma.join(userIds)})`;
    const byUser = new Map<string, IAgentAccessRow[]>();
    for (const row of rows) {
      byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row]);
    }
    for (const userId of userIds) {
      out.set(userId, this.mapper.toState(userId, byUser.get(userId) ?? []));
    }
    return out;
  }

  agentIds(): Promise<string[]> {
    return this.agentIdsWith(this.prisma);
  }

  async agentExists(agentId: string): Promise<boolean> {
    if (!agentId) return false;
    const row = await this.prisma.agent.findUnique({
      where: { id: agentId },
      select: { id: true },
    });
    return row !== null;
  }

  async transaction<T>(
    userId: string,
    fn: (tx: IAgentAccessTx) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lock(tx, userId);
        return fn({
          load: () => this.loadWith(tx, userId),
          agentIds: () => this.agentIdsWith(tx),
          save: (next) => this.save(tx, userId, next),
        });
      });
    } catch (err) {
      // An agent deleted between the read and the write: its entry has
      // nothing to point at. The same answer as any unknown agent.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2003'
      ) {
        throw new AgentAccessError(
          AgentAccessErrorCodes.AgentNotFound,
          AGENT_ACCESS_REFUSALS.agentNotFound,
        );
      }
      throw err;
    }
  }

  async allowCreated(
    tx: unknown,
    userId: string,
    agentId: string,
  ): Promise<boolean> {
    if (!userId || !agentId) return false;
    const client = tx as Tx;
    await this.lock(client, userId);
    const row = await client.userAgentAccess.findUnique({ where: { userId } });
    if (!row?.limited) return false;
    await client.userAgentAccessEntry.upsert({
      where: { userId_agentId: { userId, agentId } },
      create: { userId, agentId, list: 'allowed' },
      update: { list: 'allowed' },
    });
    // The lists changed, so the version does: an editor holding the old one
    // is told to reload instead of saving over the new entry.
    await client.userAgentAccess.update({
      where: { userId },
      data: { updatedAt: this.nextStamp(row.updatedAt) },
    });
    return true;
  }

  async removeUser(userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, userId);
      await tx.userAgentAccessEntry.deleteMany({ where: { userId } });
      await tx.userAgentAccess.deleteMany({ where: { userId } });
    });
  }

  private async save(
    tx: Tx,
    userId: string,
    next: IAgentAccessWrite,
  ): Promise<IAgentAccessState> {
    const current = await tx.userAgentAccess.findUnique({ where: { userId } });
    const updatedAt = this.nextStamp(current?.updatedAt ?? null);
    await tx.userAgentAccess.upsert({
      where: { userId },
      create: {
        userId,
        limited: next.limited,
        updatedById: next.updatedById,
        updatedAt,
      },
      update: {
        limited: next.limited,
        updatedById: next.updatedById,
        updatedAt,
      },
    });
    // One row per agent: an agent that changes list is an update of that
    // row, never a second one (the primary key would refuse it anyway).
    await tx.userAgentAccessEntry.deleteMany({
      where: { userId, agentId: { notIn: next.entries.map((e) => e.agentId) } },
    });
    for (const entry of next.entries) {
      await tx.userAgentAccessEntry.upsert({
        where: { userId_agentId: { userId, agentId: entry.agentId } },
        create: { userId, agentId: entry.agentId, list: entry.list },
        update: { list: entry.list },
      });
    }
    return this.loadWith(tx, userId);
  }

  /**
   * The row's `updatedAt` is the editor's `version`, so it must move on
   * every write, also on two writes inside one millisecond.
   */
  private nextStamp(previous: Date | null): Date {
    const now = Date.now();
    return new Date(previous ? Math.max(now, previous.getTime() + 1) : now);
  }

  private async lock(tx: Tx, userId: string): Promise<void> {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey(userId)}))::text AS locked`;
  }

  /**
   * One query, from the account itself: its access row and entries when it
   * has them. No row at all means the account does not exist, which is not
   * the same as an account nobody edited (the mapper tells them apart): a
   * token survives its account, and a deleted account must reach nothing.
   */
  private async loadWith(
    client: Tx | PrismaService,
    userId: string,
  ): Promise<IAgentAccessState> {
    const rows = await client.$queryRaw<IAccountAccessRow[]>`
      SELECT u."id" AS "userId", a."limited", a."updatedAt", e."agentId", e."list"
      FROM "User" u
      LEFT JOIN "UserAgentAccess" a ON a."userId" = u."id"
      LEFT JOIN "UserAgentAccessEntry" e ON e."userId" = a."userId"
      WHERE u."id" = ${userId}`;
    return this.mapper.toAccountState(userId, rows);
  }

  private async agentIdsWith(client: Tx | PrismaService): Promise<string[]> {
    const rows = await client.agent.findMany({ select: { id: true } });
    return rows.map((r) => r.id);
  }
}
