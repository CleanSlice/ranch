import { Injectable } from '@nestjs/common';
import { PrismaService } from '#/setup/prisma/prisma.service';
import {
  IActivityBucket,
  IActivityOwner,
  IChatActivityGateway,
  IChatSettleGate,
  IUnsettledChat,
} from '../domain';

@Injectable()
export class ChatActivityGateway extends IChatActivityGateway {
  constructor(private prisma: PrismaService) {
    super();
  }

  async findUnsettled(gate: IChatSettleGate): Promise<IUnsettledChat[]> {
    const records = await this.prisma.chatSession.findMany({
      where: {
        // Due is one value of one column: null. Everything that moves a
        // conversation on puts it back to null (a counted live event, a
        // reconcile of a changed file), so this is one range of the index
        // on [activityRebuiltAt, lastMessageAt]. "Stamp older than the last
        // message" compared a column with a column, which no index answers:
        // every run walked every conversation of the last 180 days to find,
        // most of the time, none.
        activityRebuiltAt: null,
        lastMessageAt: { lt: gate.quietBefore, gte: gate.activeSince },
      },
      orderBy: { lastMessageAt: 'desc' },
      take: gate.limit,
      // Up to a batch of rows every few minutes: not the preview, the
      // summary or the insights, which the pass has no use for.
      select: {
        id: true,
        agentId: true,
        sessionKey: true,
        channel: true,
        externalUserId: true,
        lastMessageAt: true,
      },
    });
    return records.map((r) => ({
      id: r.id,
      agentId: r.agentId,
      sessionKey: r.sessionKey,
      channel: r.channel,
      externalUserId: r.externalUserId,
      lastMessageAt: r.lastMessageAt,
    }));
  }

  async raise(
    session: IActivityOwner,
    rows: IActivityBucket[],
  ): Promise<number> {
    if (!rows.length) return 0;

    const stored = await this.prisma.chatActivityHour.findMany({
      where: { sessionId: session.id, hour: { in: rows.map((r) => r.hour) } },
    });
    const storedByHour = new Map(stored.map((s) => [s.hour.getTime(), s]));

    // Not in a transaction with the read above, and it does not need one:
    // each statement below is safe by itself against a live event writing
    // the same hour at the same moment. The insert skips a row that has
    // appeared, the update carries its floor in its own condition.
    const missing = rows.filter((r) => !storedByHour.has(r.hour.getTime()));
    let created = 0;
    if (missing.length) {
      const res = await this.prisma.chatActivityHour.createMany({
        data: missing.map((r) => ({
          sessionId: session.id,
          hour: r.hour,
          agentId: session.agentId,
          channel: session.channel,
          externalUserId: session.externalUserId,
          userMessages: r.userMessages,
          agentMessages: r.agentMessages,
        })),
        skipDuplicates: true,
      });
      created = res.count;
    }
    // Fewer created than were missing: a live event created one of them
    // first. Which one is not known, so all of them are offered the raise;
    // for the ones created here it changes nothing.
    const createdAll = created === missing.length;

    let raised = 0;
    for (const row of rows) {
      const before = storedByHour.get(row.hour.getTime());
      if (!before && createdAll) continue;
      if (
        before &&
        before.userMessages >= row.userMessages &&
        before.agentMessages >= row.agentMessages
      ) {
        continue;
      }
      if (await this.raiseHour(session.id, row)) raised++;
    }
    return created + raised;
  }

  /**
   * "Set to the count where the stored one is lower", with the comparison in
   * the statement and not in a value read earlier: an increment that lands in
   * between is seen, and the count is never lowered. One statement per count,
   * because each has its own floor.
   */
  private async raiseHour(
    sessionId: string,
    row: IActivityBucket,
  ): Promise<boolean> {
    const user = await this.prisma.chatActivityHour.updateMany({
      where: {
        sessionId,
        hour: row.hour,
        userMessages: { lt: row.userMessages },
      },
      data: { userMessages: row.userMessages },
    });
    const agent = await this.prisma.chatActivityHour.updateMany({
      where: {
        sessionId,
        hour: row.hour,
        agentMessages: { lt: row.agentMessages },
      },
      data: { agentMessages: row.agentMessages },
    });
    return user.count + agent.count > 0;
  }

  async markSettled(sessionId: string, at: Date): Promise<void> {
    // Only a conversation that has not moved on since the run began. A
    // message that arrived while the transcript was being read has a later
    // lastMessageAt and has already put the column back to null; without the
    // condition this stamp would overwrite that null, and with null being
    // the only thing that makes a conversation due, the message would wait
    // for the one after it to be counted from the transcript.
    //
    // updateMany, not update: a conversation deleted while its transcript was
    // being read is no row, and must not throw. Neither must one that moved
    // on.
    await this.prisma.chatSession.updateMany({
      where: { id: sessionId, lastMessageAt: { lte: at } },
      data: { activityRebuiltAt: at },
    });
  }

  async pruneBefore(date: Date): Promise<number> {
    const res = await this.prisma.chatActivityHour.deleteMany({
      where: { hour: { lt: date } },
    });
    return res.count;
  }
}
