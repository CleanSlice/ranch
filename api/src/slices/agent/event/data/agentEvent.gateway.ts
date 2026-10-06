import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '#/setup/prisma/prisma.service';
import { IAgentEventGateway } from '../domain/agentEvent.gateway';
import {
  IAgentEventData,
  IAgentIncidentData,
  IAgentIncidentView,
  IAgentNotificationData,
  IClosedNotificationPayload,
  ICreateAgentEventData,
  IEventListFilter,
  IIncidentListFilter,
  INotificationDestination,
  IOpenedNotificationPayload,
  IOpenIncidentInput,
  IOpenIncidentWithAgent,
  IncidentResolutionTypes,
  IPage,
} from '../domain/agentEvent.types';
import { AgentEventMapper } from './agentEvent.mapper';

// One destination per install; the row's id says which kind it is.
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

  async openIncident(
    input: IOpenIncidentInput,
    payload: IOpenedNotificationPayload,
  ): Promise<IAgentIncidentData | null> {
    try {
      const record = await this.prisma.$transaction(async (tx) => {
        const incident = await tx.agentIncident.create({
          // openKey = the agent id: the unique column that makes a second
          // open incident for this agent a P2002 instead of a second alarm.
          data: { ...input, openKey: input.agentId },
        });
        await tx.agentNotification.create({
          data: {
            incidentId: incident.id,
            kind: 'opened',
            payload: payload as unknown as Prisma.InputJsonValue,
          },
        });
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
  ): Promise<boolean> {
    const touched = await this.prisma.agentIncident.updateMany({
      where: { id, openKey: { not: null } },
      data: {
        lastFailureAt: at,
        // A new failure ends whatever recovery was under way.
        upSince: null,
        ...(ranchWitnessed && { ranchWitnessed: true }),
      },
    });
    return touched.count === 1;
  }

  async setIncidentUpSince(agentId: string, at: Date): Promise<void> {
    await this.prisma.agentIncident.updateMany({
      where: { openKey: agentId },
      data: { upSince: at },
    });
  }

  async listOpenIncidentsWithAgent(): Promise<IOpenIncidentWithAgent[]> {
    const records = await this.prisma.agentIncident.findMany({
      where: { openKey: { not: null } },
      include: {
        agent: { select: { status: true } },
        events: {
          orderBy: { receivedAt: 'asc' },
          take: 1,
          select: { senderName: true },
        },
      },
    });
    return records.map((r) => ({
      incident: this.mapper.toIncident(r),
      agentStatus: r.agent?.status ?? null,
      firstSenderName: r.events[0]?.senderName ?? null,
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
      if (payload) {
        await tx.agentNotification.create({
          data: {
            incidentId: id,
            kind: 'closed',
            payload: payload as unknown as Prisma.InputJsonValue,
          },
        });
      }
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
      include: {
        events: { select: { senderName: true }, distinct: ['senderName'] },
        notifications: { orderBy: { createdAt: 'asc' } },
        _count: { select: { events: true } },
      },
    });
    const page = records.slice(0, filter.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => ({
        ...this.mapper.toIncident(r),
        witnesses: r.events.map((e) => e.senderName),
        eventCount: r._count.events,
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

  // ── Notifications (the outbox) ────────────────────────────────────────

  async claimDueNotification(
    now: Date,
    lockedUntil: Date,
  ): Promise<IAgentNotificationData | null> {
    const due: Prisma.AgentNotificationWhereInput = {
      status: 'pending',
      nextAttemptAt: { lte: now },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
    };
    for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt += 1) {
      const candidate = await this.prisma.agentNotification.findFirst({
        where: due,
        orderBy: { nextAttemptAt: 'asc' },
      });
      if (!candidate) return null;
      // The claim repeats the condition: if another replica took the row
      // between the read and this write, nothing matches and we look again.
      const claimed = await this.prisma.agentNotification.updateMany({
        where: { ...due, id: candidate.id },
        data: { lockedUntil },
      });
      if (claimed.count === 1) return this.mapper.toNotification(candidate);
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
    webhookUrl: string;
    hint: string;
    updatedBy: string;
  }): Promise<INotificationDestination> {
    // A new address starts with a clean delivery record: the last outcome
    // belonged to the address it replaces.
    const fresh = {
      ...input,
      lastDeliveryAt: null,
      lastDeliveryOk: null,
      lastDeliveryError: null,
    };
    const record = await this.prisma.agentEventDestination.upsert({
      where: { id: DESTINATION_ID },
      create: { id: DESTINATION_ID, kind: 'slack', ...fresh },
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
