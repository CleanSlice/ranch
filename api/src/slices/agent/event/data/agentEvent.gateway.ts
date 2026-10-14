import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '#/setup/prisma/prisma.service';
import { IAgentEventGateway } from '../domain/agentEvent.gateway';
import {
  DestinationKindTypes,
  IAgentEventData,
  IAgentIncidentData,
  IAgentIncidentView,
  IAgentNotificationData,
  IClosedNotificationPayload,
  ICreateAgentEventData,
  IEventListFilter,
  IIncidentListFilter,
  IJoinedNotificationPayload,
  INotificationDestination,
  INotificationPayload,
  IOpenedNotificationPayload,
  IOpenIncidentInput,
  IOpenIncidentWithAgent,
  IRunningNotificationPayload,
  IncidentResolutionTypes,
  IPage,
  SlackReactionTypes,
} from '../domain/agentEvent.types';
import { AgentEventMapper } from './agentEvent.mapper';

// One destination per install; the row's id is fixed, its `kind` says which
// transport it is.
const DESTINATION_ID = 'slack';

// How many times a claim is retried when another replica took the row first.
const CLAIM_ATTEMPTS = 5;

const isUniqueViolation = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

/** Opaque page cursor: the sort key of the last row handed out. */
function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}|${id}`).toString('base64url');
}

function decodeCursor(cursor: string): { at: Date; id: string } | null {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const at = new Date(iso);
  if (!id || Number.isNaN(at.getTime())) return null;
  return { at, id };
}

type Tx = Prisma.TransactionClient;

@Injectable()
export class AgentEventGateway extends IAgentEventGateway {
  constructor(
    private prisma: PrismaService,
    private mapper: AgentEventMapper,
  ) {
    super();
  }

  // ── Events ────────────────────────────────────────────────────────────

  async createEvent(
    data: ICreateAgentEventData,
  ): Promise<IAgentEventData | null> {
    try {
      const record = await this.prisma.agentEvent.create({ data });
      return this.mapper.toEvent(record);
    } catch (err) {
      // The only unique column is dedupeKey: the same event, sent twice.
      if (isUniqueViolation(err)) return null;
      throw err;
    }
  }

  async findEventByDedupeKey(key: string): Promise<IAgentEventData | null> {
    const record = await this.prisma.agentEvent.findUnique({
      where: { dedupeKey: key },
    });
    return record ? this.mapper.toEvent(record) : null;
  }

  countEventsByKeySince(apiKeyId: string, since: Date): Promise<number> {
    return this.prisma.agentEvent.count({
      where: { apiKeyId, receivedAt: { gte: since } },
    });
  }

  async oldestEventAtByKeySince(
    apiKeyId: string,
    since: Date,
  ): Promise<Date | null> {
    const record = await this.prisma.agentEvent.findFirst({
      where: { apiKeyId, receivedAt: { gte: since } },
      orderBy: { receivedAt: 'asc' },
      select: { receivedAt: true },
    });
    return record?.receivedAt ?? null;
  }

  async listEvents(filter: IEventListFilter): Promise<IPage<IAgentEventData>> {
    const before = filter.before ? decodeCursor(filter.before) : null;
    const records = await this.prisma.agentEvent.findMany({
      where: {
        ...(filter.agentId && { agentId: filter.agentId }),
        ...(filter.incidentId && { incidentId: filter.incidentId }),
        ...(filter.since && { receivedAt: { gte: filter.since } }),
        // Strictly after the cursor row in (receivedAt desc, id desc): two
        // events of the same millisecond are neither repeated nor skipped.
        ...(before && {
          OR: [
            { receivedAt: { lt: before.at } },
            { receivedAt: before.at, id: { lt: before.id } },
          ],
        }),
      },
      orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
      take: filter.limit + 1,
    });
    const page = records.slice(0, filter.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => this.mapper.toEvent(r)),
      nextCursor:
        records.length > filter.limit && last
          ? encodeCursor(last.receivedAt, last.id)
          : null,
    };
  }

  // ── Incidents ─────────────────────────────────────────────────────────

  async findOpenIncident(agentId: string): Promise<IAgentIncidentData | null> {
    const record = await this.prisma.agentIncident.findUnique({
      where: { openKey: agentId },
    });
    return record ? this.mapper.toIncident(record) : null;
  }

  async findIncidentById(id: string): Promise<IAgentIncidentData | null> {
    const record = await this.prisma.agentIncident.findUnique({
      where: { id },
    });
    return record ? this.mapper.toIncident(record) : null;
  }

  async openIncident(
    input: IOpenIncidentInput,
    payload: IOpenedNotificationPayload,
  ): Promise<IAgentIncidentData | null> {
    try {
      const record = await this.prisma.$transaction(async (tx) => {
        const incident = await tx.agentIncident.create({
          // openKey = the agent id: the unique column that makes a second
          // open incident for this agent a P2002 instead of a second alarm.
          data: {
            ...input,
            openKey: input.agentId,
            // The report that opens it is its first.
            eventCount: 1,
            witnesses: [payload.senderName],
          },
        });
        await this.queue(tx, incident.id, payload);
        return incident;
      });
      return this.mapper.toIncident(record);
    } catch (err) {
      if (isUniqueViolation(err)) return null;
      throw err;
    }
  }

  async touchIncidentFailure(
    id: string,
    at: Date,
    ranchWitnessed: boolean,
    senderName: string,
    reply: Omit<IJoinedNotificationPayload, 'eventCount'> | null,
    gapMs: number,
  ): Promise<'joined' | 'joined_quiet' | 'closed'> {
    const touched = await this.prisma.agentIncident.updateMany({
      where: { id, openKey: { not: null } },
      data: {
        lastFailureAt: at,
        // A new failure ends whatever recovery was under way.
        upSince: null,
        eventCount: { increment: 1 },
        ...(ranchWitnessed && { ranchWitnessed: true }),
      },
    });
    if (touched.count !== 1) return 'closed';
    await this.addWitness(id, senderName);
    if (!reply) return 'joined';

    // "Nothing queued in the last minute" is in the WHERE: two reports
    // arriving together on two replicas queue one reply, and the other
    // only marks the root stale.
    const since = new Date(at.getTime() - gapMs);
    const allowed = await this.prisma.agentIncident.updateMany({
      where: {
        id,
        OR: [
          { lastJoinedNotifiedAt: null },
          { lastJoinedNotifiedAt: { lt: since } },
        ],
      },
      data: { lastJoinedNotifiedAt: at },
    });
    if (allowed.count !== 1) {
      await this.prisma.agentIncident.updateMany({
        where: { id },
        data: { rootStale: true },
      });
      return 'joined_quiet';
    }
    await this.prisma.$transaction(async (tx) => {
      const { eventCount } = await tx.agentIncident.findUniqueOrThrow({
        where: { id },
        select: { eventCount: true },
      });
      await this.queue(tx, id, { ...reply, eventCount });
    });
    return 'joined';
  }

  async noteIncidentReport(id: string, senderName: string): Promise<void> {
    await this.prisma.agentIncident.updateMany({
      where: { id },
      data: { eventCount: { increment: 1 } },
    });
    await this.addWitness(id, senderName);
  }

  // "Not there yet" is in the WHERE, so two reports from a new sender
  // arriving together add its name once.
  private async addWitness(id: string, senderName: string): Promise<void> {
    await this.prisma.agentIncident.updateMany({
      where: { id, NOT: { witnesses: { has: senderName } } },
      data: { witnesses: { push: senderName } },
    });
  }

  async setIncidentUpSince(
    agentId: string,
    at: Date,
    reply: IRunningNotificationPayload | null,
  ): Promise<void> {
    // The first up-turn since the last failure is the one worth a reply;
    // "upSince was null" in the WHERE decides it, once, across replicas.
    const first = await this.prisma.agentIncident.updateMany({
      where: { openKey: agentId, upSince: null },
      data: { upSince: at },
    });
    if (first.count === 1) {
      if (!reply) return;
      const incident = await this.prisma.agentIncident.findUnique({
        where: { openKey: agentId },
        select: { id: true },
      });
      if (!incident) return;
      await this.prisma.$transaction((tx) =>
        this.queue(tx, incident.id, reply),
      );
      return;
    }
    await this.prisma.agentIncident.updateMany({
      where: { openKey: agentId },
      data: { upSince: at },
    });
  }

  async listOpenIncidentsWithAgent(): Promise<IOpenIncidentWithAgent[]> {
    const records = await this.prisma.agentIncident.findMany({
      where: { openKey: { not: null } },
      include: { agent: { select: { status: true } } },
    });
    return records.map((r) => ({
      incident: this.mapper.toIncident(r),
      agentStatus: r.agent?.status ?? null,
      firstSenderName: r.witnesses[0] ?? null,
    }));
  }

  closeIncident(
    id: string,
    resolution: IncidentResolutionTypes,
    closedAt: Date,
    payload: IClosedNotificationPayload | null,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      // "Still open" is in the WHERE: of two replicas sweeping at once, one
      // matches no row and queues nothing.
      const closed = await tx.agentIncident.updateMany({
        where: { id, openKey: { not: null } },
        data: { openKey: null, closedAt, resolution },
      });
      if (closed.count === 0) return false;
      if (payload) await this.queue(tx, id, payload);
      return true;
    });
  }

  async listIncidents(
    filter: IIncidentListFilter,
  ): Promise<IPage<IAgentIncidentView>> {
    const before = filter.before ? decodeCursor(filter.before) : null;
    const records = await this.prisma.agentIncident.findMany({
      where: {
        ...(filter.agentId && { agentId: filter.agentId }),
        ...(filter.state === 'open' && { openKey: { not: null } }),
        ...(filter.state === 'closed' && { openKey: null }),
        ...(filter.since && { openedAt: { gte: filter.since } }),
        ...(before && {
          OR: [
            { openedAt: { lt: before.at } },
            { openedAt: before.at, id: { lt: before.id } },
          ],
        }),
      },
      orderBy: [{ openedAt: 'desc' }, { id: 'desc' }],
      take: filter.limit + 1,
      // Nothing here reads AgentEvent: the count and the witnesses are on
      // the row, so this costs the same at ten reports and at a million.
      include: { notifications: { orderBy: { seq: 'asc' } } },
    });
    const page = records.slice(0, filter.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => ({
        ...this.mapper.toIncident(r),
        notifications: r.notifications.map((n) =>
          this.mapper.toNotificationSummary(n),
        ),
      })),
      nextCursor:
        records.length > filter.limit && last
          ? encodeCursor(last.openedAt, last.id)
          : null,
    };
  }

  // ── The bot's root message ────────────────────────────────────────────

  async setIncidentRoot(id: string, channel: string, ts: string) {
    await this.prisma.agentIncident.updateMany({
      where: { id },
      data: { slackChannel: channel, slackTs: ts },
    });
  }

  async setIncidentReaction(id: string, name: SlackReactionTypes) {
    await this.prisma.agentIncident.updateMany({
      where: { id },
      data: { slackReaction: name },
    });
  }

  async listStaleBotIncidents(): Promise<IAgentIncidentData[]> {
    const records = await this.prisma.agentIncident.findMany({
      where: { rootStale: true, transport: 'bot', slackTs: { not: null } },
    });
    return records.map((r) => this.mapper.toIncident(r));
  }

  async clearRootStale(id: string): Promise<void> {
    await this.prisma.agentIncident.updateMany({
      where: { id },
      data: { rootStale: false },
    });
  }

  // ── Notifications (the outbox) ────────────────────────────────────────

  /**
   * One row with the incident's next `seq`. The counter lives on the
   * incident and is bumped in the same transaction as the insert, so two
   * replicas queueing at once get two different positions.
   */
  private async queue(
    tx: Tx,
    incidentId: string,
    payload: INotificationPayload,
  ): Promise<void> {
    const bumped = await tx.agentIncident.update({
      where: { id: incidentId },
      data: { notificationSeq: { increment: 1 } },
      select: { notificationSeq: true },
    });
    await tx.agentNotification.create({
      data: {
        incidentId,
        kind: payload.kind,
        seq: bumped.notificationSeq - 1,
        payload: payload as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async claimDueNotification(
    now: Date,
    lockedUntil: Date,
  ): Promise<IAgentNotificationData | null> {
    for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt += 1) {
      // Due, unclaimed, and with nothing of the same incident still waiting
      // ahead of it (a smaller seq that is pending — whether it is in flight
      // on another replica or waiting for its retry). Rows of one incident
      // therefore leave in order; across incidents the outbox is free.
      const candidates = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT n.id
        FROM "AgentNotification" n
        WHERE n.status = 'pending'
          AND n."nextAttemptAt" <= ${now}
          AND (n."lockedUntil" IS NULL OR n."lockedUntil" < ${now})
          AND NOT EXISTS (
            SELECT 1 FROM "AgentNotification" e
            WHERE e."incidentId" = n."incidentId"
              AND e.seq < n.seq
              AND e.status = 'pending'
          )
        ORDER BY n."nextAttemptAt" ASC
        LIMIT 1
      `;
      const candidate = candidates[0];
      if (!candidate) return null;
      // The claim repeats the condition: if another replica took the row
      // between the read and this write, nothing matches and we look again.
      const claimed = await this.prisma.agentNotification.updateMany({
        where: {
          id: candidate.id,
          status: 'pending',
          nextAttemptAt: { lte: now },
          OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
        },
        data: { lockedUntil },
      });
      if (claimed.count === 1) {
        const record = await this.prisma.agentNotification.findUniqueOrThrow({
          where: { id: candidate.id },
        });
        return this.mapper.toNotification(record);
      }
    }
    return null;
  }

  async markNotificationSent(id: string, at: Date): Promise<void> {
    await this.prisma.agentNotification.update({
      where: { id },
      data: {
        status: 'sent',
        sentAt: at,
        attempts: { increment: 1 },
        lockedUntil: null,
        lastError: null,
      },
    });
  }

  async markNotificationRetry(
    id: string,
    attempts: number,
    nextAttemptAt: Date,
    error: string,
  ): Promise<void> {
    await this.prisma.agentNotification.update({
      where: { id },
      data: { attempts, nextAttemptAt, lastError: error, lockedUntil: null },
    });
  }

  async markNotificationFailed(
    id: string,
    attempts: number,
    error: string,
  ): Promise<void> {
    await this.prisma.agentNotification.update({
      where: { id },
      data: { status: 'failed', attempts, lastError: error, lockedUntil: null },
    });
  }

  async markNotificationSkipped(id: string): Promise<void> {
    await this.prisma.agentNotification.update({
      where: { id },
      data: { status: 'skipped', lockedUntil: null },
    });
  }

  // ── Destination ───────────────────────────────────────────────────────

  async getDestination(): Promise<INotificationDestination | null> {
    const record = await this.prisma.agentEventDestination.findUnique({
      where: { id: DESTINATION_ID },
    });
    return record ? this.mapper.toDestination(record) : null;
  }

  async saveDestination(input: {
    kind: DestinationKindTypes;
    webhookUrl: string | null;
    botToken: string | null;
    channelId: string | null;
    hint: string;
    updatedBy: string;
  }): Promise<INotificationDestination> {
    // A new destination starts with a clean delivery record: the last
    // outcome belonged to the one it replaces. Every field is written, so
    // the other kind's secret is gone.
    const fresh = {
      ...input,
      lastDeliveryAt: null,
      lastDeliveryOk: null,
      lastDeliveryError: null,
    };
    const record = await this.prisma.agentEventDestination.upsert({
      where: { id: DESTINATION_ID },
      create: { id: DESTINATION_ID, ...fresh },
      update: fresh,
    });
    return this.mapper.toDestination(record);
  }

  async removeDestination(): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.agentEventDestination.deleteMany({
        where: { id: DESTINATION_ID },
      }),
      this.prisma.agentNotification.updateMany({
        where: { status: 'pending' },
        data: { status: 'skipped', lockedUntil: null },
      }),
    ]);
  }

  async recordDelivery(
    at: Date,
    ok: boolean,
    error: string | null,
  ): Promise<void> {
    // updateMany: a destination removed mid-send is not an error.
    await this.prisma.agentEventDestination.updateMany({
      where: { id: DESTINATION_ID },
      data: {
        lastDeliveryAt: at,
        lastDeliveryOk: ok,
        lastDeliveryError: error,
      },
    });
  }

  // ── Retention ─────────────────────────────────────────────────────────

  async deleteEventsBefore(cutoff: Date): Promise<number> {
    const deleted = await this.prisma.agentEvent.deleteMany({
      where: { receivedAt: { lt: cutoff } },
    });
    return deleted.count;
  }

  async deleteClosedIncidentsBefore(cutoff: Date): Promise<number> {
    // Open incidents are never deleted, however old.
    const deleted = await this.prisma.agentIncident.deleteMany({
      where: { openKey: null, closedAt: { lt: cutoff } },
    });
    return deleted.count;
  }
}
