import { randomUUID } from 'crypto';
import { AgentStatusChanges, IAgentGateway } from '#/agent/agent/domain';
import { IInfraConfigGateway } from '#/setting/domain/infraConfig.gateway';
import {
  ApiKeyScopeTypes,
  IApiKeyData,
} from '#/user/apiKey/domain/apiKey.types';
import { IAgentEventGateway } from './agentEvent.gateway';
import {
  AgentEventService,
  TooManyEventsException,
} from './agentEvent.service';
import {
  DestinationKindTypes,
  FLOOD_LIMIT_PER_MINUTE,
  IAgentEventData,
  IAgentIncidentData,
  IAgentIncidentView,
  IAgentNotificationData,
  IClosedNotificationPayload,
  ICreateAgentEventData,
  IJoinedNotificationPayload,
  INotificationDestination,
  INotificationPayload,
  IOpenedNotificationPayload,
  IOpenIncidentInput,
  IOpenIncidentWithAgent,
  IRunningNotificationPayload,
  IncidentResolutionTypes,
  IPage,
  NotificationKindTypes,
  NotificationStatusTypes,
  QUIET_MS,
  RETRY_DELAYS_MS,
  SlackReactionTypes,
} from './agentEvent.types';
import { AgentIncidentService } from './agentIncident.service';
import { AgentNotificationWorker } from './agentNotification.worker';
import { NotificationDestinationService } from './notificationDestination.service';
import {
  INotifier,
  ISlackBotNotifier,
  NotifyResultTypes,
  PostResultTypes,
} from './notifier';

/**
 * The rules of this feature are about state over time — one open incident
 * per agent, one message when it opens and one when it closes, a quiet
 * period that a new failure restarts — so they are tested against a gateway
 * that keeps state, not against a list of expected calls. The fake enforces
 * the same two constraints the database does: one open incident per agent,
 * one stored event per dedupe key.
 */
type StoredNotification = IAgentNotificationData & {
  lockedUntil: Date | null;
  lastError: string | null;
  sentAt: Date | null;
};

class FakeGateway extends IAgentEventGateway {
  events: (IAgentEventData & { dedupeKey: string | null })[] = [];
  incidents: IAgentIncidentData[] = [];
  notifications: StoredNotification[] = [];
  destination: INotificationDestination | null = null;
  /** What Ranch holds for each agent; a missing key is a deleted agent. */
  agentStatus = new Map<string, string>();
  /** Lose the next open / close to "another replica". */
  loseNextOpen = false;
  loseNextClose = false;
  private clock = 0;

  private at(): Date {
    // A moment ago by the test's clock — so a row just written is already
    // due — and a millisecond apart, so rows keep an order.
    this.clock += 1;
    return new Date(Date.now() - 1000 + this.clock);
  }

  async createEvent(data: ICreateAgentEventData) {
    if (
      data.dedupeKey &&
      this.events.some((e) => e.dedupeKey === data.dedupeKey)
    ) {
      return null;
    }
    const event = { id: randomUUID(), ...data };
    this.events.push(event);
    return event;
  }

  async findEventByDedupeKey(key: string) {
    return this.events.find((e) => e.dedupeKey === key) ?? null;
  }

  async countEventsByKeySince(apiKeyId: string, since: Date) {
    return this.events.filter(
      (e) => e.apiKeyId === apiKeyId && e.receivedAt >= since,
    ).length;
  }

  async oldestEventAtByKeySince(apiKeyId: string, since: Date) {
    const mine = this.events
      .filter((e) => e.apiKeyId === apiKeyId && e.receivedAt >= since)
      .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
    return mine[0]?.receivedAt ?? null;
  }

  async listEvents(): Promise<IPage<IAgentEventData>> {
    return { items: this.events, nextCursor: null };
  }

  async findOpenIncident(agentId: string) {
    return this.incidents.find((i) => i.open && i.agentId === agentId) ?? null;
  }

  async findIncidentById(id: string) {
    return this.incidents.find((i) => i.id === id) ?? null;
  }

  async openIncident(
    input: IOpenIncidentInput,
    payload: IOpenedNotificationPayload,
  ) {
    if (this.loseNextOpen) {
      // Another opener got there first: its incident now exists.
      this.loseNextOpen = false;
      this.incidents.push(this.incidentOf(input, 'the-other-opener'));
      return null;
    }
    if (await this.findOpenIncident(input.agentId)) return null;
    const incident = this.incidentOf(input, payload.senderName);
    this.incidents.push(incident);
    this.queue(incident.id, payload);
    return incident;
  }

  async touchIncidentFailure(
    id: string,
    at: Date,
    ranchWitnessed: boolean,
    senderName: string,
    reply: Omit<IJoinedNotificationPayload, 'eventCount'> | null,
    gapMs: number,
  ): Promise<'joined' | 'joined_quiet' | 'closed'> {
    const incident = this.incidents.find((i) => i.id === id && i.open);
    if (!incident) return 'closed';
    incident.lastFailureAt = at;
    incident.upSince = null;
    if (ranchWitnessed) incident.ranchWitnessed = true;
    this.count(incident, senderName);
    if (!reply) return 'joined';
    const last = incident.lastJoinedNotifiedAt;
    if (last && at.getTime() - last.getTime() < gapMs) {
      incident.rootStale = true;
      return 'joined_quiet';
    }
    incident.lastJoinedNotifiedAt = at;
    this.queue(id, { ...reply, eventCount: incident.eventCount });
    return 'joined';
  }

  async noteIncidentReport(id: string, senderName: string) {
    const incident = this.incidents.find((i) => i.id === id);
    if (incident) this.count(incident, senderName);
  }

  private count(incident: IAgentIncidentData, senderName: string) {
    incident.eventCount += 1;
    if (!incident.witnesses.includes(senderName)) {
      incident.witnesses = [...incident.witnesses, senderName];
    }
  }

  async setIncidentUpSince(
    agentId: string,
    at: Date,
    reply: IRunningNotificationPayload | null,
  ) {
    const incident = await this.findOpenIncident(agentId);
    if (!incident) return;
    const first = incident.upSince === null;
    incident.upSince = at;
    if (first && reply) this.queue(incident.id, reply);
  }

  async listOpenIncidentsWithAgent(): Promise<IOpenIncidentWithAgent[]> {
    return this.incidents
      .filter((i) => i.open)
      .map((incident) => ({
        incident: { ...incident },
        agentStatus: this.agentStatus.get(incident.agentId ?? '') ?? null,
        firstSenderName: incident.witnesses[0] ?? null,
      }));
  }

  async closeIncident(
    id: string,
    resolution: IncidentResolutionTypes,
    closedAt: Date,
    payload: IClosedNotificationPayload | null,
  ) {
    const incident = this.incidents.find((i) => i.id === id && i.open);
    if (!incident) return false;
    incident.open = false;
    incident.closedAt = closedAt;
    incident.resolution = resolution;
    if (this.loseNextClose) {
      // The row is closed, but by the other replica: nothing is ours to queue.
      this.loseNextClose = false;
      return false;
    }
    if (payload) this.queue(id, payload);
    return true;
  }

  async listIncidents(): Promise<IPage<IAgentIncidentView>> {
    return { items: [], nextCursor: null };
  }

  async setIncidentRoot(id: string, channel: string, ts: string) {
    const incident = this.incidents.find((i) => i.id === id);
    if (incident) {
      incident.slackChannel = channel;
      incident.slackTs = ts;
    }
  }

  async setIncidentReaction(id: string, name: SlackReactionTypes) {
    const incident = this.incidents.find((i) => i.id === id);
    if (incident) incident.slackReaction = name;
  }

  async listStaleBotIncidents() {
    return this.incidents
      .filter((i) => i.rootStale && i.transport === 'bot' && i.slackTs)
      .map((i) => ({ ...i }));
  }

  async clearRootStale(id: string) {
    const incident = this.incidents.find((i) => i.id === id);
    if (incident) incident.rootStale = false;
  }

  async claimDueNotification(now: Date, lockedUntil: Date) {
    const due = this.notifications
      .filter(
        (n) =>
          n.status === 'pending' &&
          n.nextAttemptAt <= now &&
          (n.lockedUntil === null || n.lockedUntil < now) &&
          // Nothing of the same incident still waiting ahead of it.
          !this.notifications.some(
            (e) =>
              e.incidentId === n.incidentId &&
              e.seq < n.seq &&
              e.status === 'pending',
          ),
      )
      .sort((a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime())[0];
    if (!due) return null;
    due.lockedUntil = lockedUntil;
    return { ...due };
  }

  async markNotificationSent(id: string, at: Date) {
    this.patch(id, { status: 'sent', sentAt: at, lockedUntil: null }, 1);
  }

  async markNotificationRetry(
    id: string,
    attempts: number,
    nextAttemptAt: Date,
    error: string,
  ) {
    this.patch(id, {
      attempts,
      nextAttemptAt,
      lastError: error,
      lockedUntil: null,
    });
  }

  async markNotificationFailed(id: string, attempts: number, error: string) {
    this.patch(id, {
      status: 'failed',
      attempts,
      lastError: error,
      lockedUntil: null,
    });
  }

  async markNotificationSkipped(id: string) {
    this.patch(id, { status: 'skipped', lockedUntil: null });
  }

  async getDestination() {
    return this.destination;
  }

  async saveDestination(input: {
    kind: DestinationKindTypes;
    webhookUrl: string | null;
    botToken: string | null;
    channelId: string | null;
    hint: string;
    updatedBy: string;
  }) {
    this.destination = {
      ...input,
      updatedAt: this.at(),
      lastDeliveryAt: null,
      lastDeliveryOk: null,
      lastDeliveryError: null,
    };
    return this.destination;
  }

  async removeDestination() {
    this.destination = null;
    this.notifications
      .filter((n) => n.status === 'pending')
      .forEach((n) => (n.status = 'skipped'));
  }

  async recordDelivery(at: Date, ok: boolean, error: string | null) {
    if (!this.destination) return;
    this.destination.lastDeliveryAt = at;
    this.destination.lastDeliveryOk = ok;
    this.destination.lastDeliveryError = error;
  }

  async deleteEventsBefore(cutoff: Date) {
    const before = this.events.length;
    this.events = this.events.filter((e) => e.receivedAt >= cutoff);
    return before - this.events.length;
  }

  async deleteClosedIncidentsBefore(cutoff: Date) {
    const before = this.incidents.length;
    this.incidents = this.incidents.filter(
      (i) => i.open || !i.closedAt || i.closedAt >= cutoff,
    );
    return before - this.incidents.length;
  }

  statusOf(kind: NotificationKindTypes): NotificationStatusTypes[] {
    return this.notifications
      .filter((n) => n.kind === kind)
      .map((n) => n.status);
  }

  /** The kinds queued for one incident, in delivery order. */
  kindsOf(incidentId: string): NotificationKindTypes[] {
    return this.notifications
      .filter((n) => n.incidentId === incidentId)
      .sort((a, b) => a.seq - b.seq)
      .map((n) => n.kind);
  }

  private nextNumber = 1;

  private incidentOf(
    input: IOpenIncidentInput,
    senderName: string,
  ): IAgentIncidentData {
    return {
      id: randomUUID(),
      number: this.nextNumber++,
      agentId: input.agentId,
      agentName: input.agentName,
      open: true,
      transport: input.transport,
      slackChannel: null,
      slackTs: null,
      slackReaction: null,
      notificationSeq: 0,
      lastJoinedNotifiedAt: null,
      rootStale: false,
      status: input.status,
      reason: input.reason,
      ranchWitnessed: input.ranchWitnessed,
      witnesses: [senderName],
      eventCount: 1,
      openedAt: input.openedAt,
      lastFailureAt: input.lastFailureAt,
      upSince: null,
      closedAt: null,
      resolution: null,
    };
  }

  private queue(incidentId: string, payload: INotificationPayload) {
    const createdAt = this.at();
    const incident = this.incidents.find((i) => i.id === incidentId)!;
    const seq = incident.notificationSeq;
    incident.notificationSeq += 1;
    this.notifications.push({
      id: randomUUID(),
      incidentId,
      kind: payload.kind,
      seq,
      payload,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: createdAt,
      createdAt,
      lockedUntil: null,
      lastError: null,
      sentAt: null,
    });
  }

  private patch(
    id: string,
    patch: Partial<StoredNotification>,
    addAttempts = 0,
  ) {
    const row = this.notifications.find((n) => n.id === id)!;
    Object.assign(row, patch);
    row.attempts += addAttempts;
  }
}

const T0 = new Date('2026-10-06T21:00:00.000Z');
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

const API_KEY: IApiKeyData = {
  id: 'key-1',
  name: 'cluster-watcher',
  prefix: 'abcd',
  scopes: [ApiKeyScopeTypes.EventsWrite],
  lastUsedAt: null,
  expiresAt: null,
  createdBy: 'user-1',
  createdAt: T0,
};

function harness() {
  const gateway = new FakeGateway();
  const agents = new Map<
    string,
    { id: string; name: string; status: string }
  >();
  const addAgent = (id: string, status: string, name = `Agent ${id}`) => {
    agents.set(id, { id, name, status });
    gateway.agentStatus.set(id, status);
  };
  const setStatus = (id: string, status: string) => {
    agents.get(id)!.status = status;
    gateway.agentStatus.set(id, status);
  };
  const removeAgent = (id: string) => {
    agents.delete(id);
    gateway.agentStatus.delete(id);
  };
  // Only findById exists on purpose: an event must never write an agent.
  const agentGateway = {
    findById: jest.fn(async (id: string) => agents.get(id) ?? null),
  } as unknown as IAgentGateway;

  const sent: { address: string; text: string }[] = [];
  let nextResults: NotifyResultTypes[] = [];
  const notifier: INotifier = {
    send: jest.fn(async (address: string, message: { text: string }) => {
      sent.push({ address, text: message.text });
      return nextResults.shift() ?? ({ ok: true } as NotifyResultTypes);
    }),
  };
  const answerWith = (...results: NotifyResultTypes[]) => {
    nextResults = results;
  };

  // The bot transport: every call recorded, answers scripted, a fresh ts
  // for every post so a thread reply can be told from a root.
  type BotCall = {
    method: 'post' | 'update' | 'setReaction';
    ts?: string;
    threadTs?: string;
    text: string;
    body: string;
    name?: string;
    previous?: string | null;
  };
  const botCalls: BotCall[] = [];
  let nextBotResults: (PostResultTypes | NotifyResultTypes)[] = [];
  let nextTs = 1;
  const bodyOf = (message: { blocks: unknown[] }) =>
    JSON.stringify(message.blocks);
  const bot: ISlackBotNotifier = {
    post: jest.fn(
      async (
        _cred: unknown,
        message: { text: string; blocks: unknown[] },
        threadTs?: string,
      ) => {
        botCalls.push({
          method: 'post',
          threadTs,
          text: message.text,
          body: bodyOf(message),
        });
        const scripted = nextBotResults.shift();
        if (scripted) return scripted as PostResultTypes;
        return { ok: true as const, ts: `ts-${nextTs++}` };
      },
    ),
    update: jest.fn(
      async (
        _cred: unknown,
        ts: string,
        message: { text: string; blocks: unknown[] },
      ) => {
        botCalls.push({
          method: 'update',
          ts,
          text: message.text,
          body: bodyOf(message),
        });
        return (nextBotResults.shift() ?? { ok: true }) as NotifyResultTypes;
      },
    ),
    setReaction: jest.fn(
      async (
        _cred: unknown,
        ts: string,
        name: string,
        previous: string | null,
      ) => {
        botCalls.push({
          method: 'setReaction',
          ts,
          name,
          previous,
          text: '',
          body: '',
        });
        return (nextBotResults.shift() ?? { ok: true }) as NotifyResultTypes;
      },
    ),
  };
  const botAnswerWith = (
    ...results: (PostResultTypes | NotifyResultTypes)[]
  ) => {
    nextBotResults = results;
  };

  // The installation's label; null until a test sets one.
  let environment: string | null = null;
  const setEnvironment = (value: string | null) => {
    environment = value;
  };
  const infra = {
    getEnvironment: jest.fn(async () => environment),
  } as unknown as IInfraConfigGateway;
  const destinations = new NotificationDestinationService(
    gateway,
    notifier,
    bot,
    infra,
  );
  const incidents = new AgentIncidentService(gateway, destinations);
  const worker = new AgentNotificationWorker(
    gateway,
    notifier,
    bot,
    destinations,
    incidents,
  );
  // The service kicks the worker when it opens an incident; the tests drain
  // by hand so that every send happens at a moment the test chose.
  const kick = jest.spyOn(worker, 'kick').mockImplementation(() => undefined);
  const statusChanges = new AgentStatusChanges();
  const service = new AgentEventService(
    gateway,
    incidents,
    agentGateway,
    statusChanges,
    worker,
  );
  return {
    gateway,
    incidents,
    worker,
    service,
    statusChanges,
    addAgent,
    setStatus,
    removeAgent,
    sent,
    answerWith,
    kick,
    notifier,
    destinations,
    bot,
    botCalls,
    botAnswerWith,
    setEnvironment,
  };
}

const failure = (
  agentId: string,
  at: Date,
  witness: 'ranch' | 'external' = 'external',
) => ({
  agentId,
  agentName: `Agent ${agentId}`,
  status: 'failed' as const,
  reason: 'OOMKilled',
  witness,
  senderName: witness === 'ranch' ? 'Ranch' : 'cluster-watcher',
  tool: null,
  ranchStatus: 'running',
  occurredAt: at,
  receivedAt: at,
});

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(T0);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('AgentIncidentService — opening and joining', () => {
  it('opens an incident for the first failure and queues one opening message', async () => {
    const { gateway, incidents } = harness();

    const result = await incidents.attachFailure(failure('a1', T0));

    expect(result.outcome).toBe('opened');
    expect(gateway.incidents).toHaveLength(1);
    expect(gateway.statusOf('opened')).toEqual(['pending']);
  });

  it('joins the open incident on every later failure and queues nothing more', async () => {
    const { gateway, incidents } = harness();
    const first = await incidents.attachFailure(failure('a1', T0));

    const second = await incidents.attachFailure(failure('a1', minutes(3)));

    expect(second).toEqual({ incidentId: first.incidentId, outcome: 'joined' });
    expect(gateway.incidents).toHaveLength(1);
    expect(gateway.notifications).toHaveLength(1);
    expect(gateway.incidents[0].lastFailureAt).toEqual(minutes(3));
  });

  it('joins instead of opening a second one when another opener wins the race', async () => {
    const { gateway, incidents } = harness();
    gateway.loseNextOpen = true;

    const result = await incidents.attachFailure(failure('a1', T0));

    expect(result.outcome).toBe('joined');
    expect(gateway.incidents.filter((i) => i.open)).toHaveLength(1);
    // The winner queued the message; we must not queue a second.
    expect(gateway.notifications).toHaveLength(0);
  });

  it('keeps separate incidents for separate agents', async () => {
    const { gateway, incidents } = harness();

    await incidents.attachFailure(failure('a1', T0));
    await incidents.attachFailure(failure('a2', T0));

    expect(gateway.incidents).toHaveLength(2);
    expect(gateway.notifications).toHaveLength(2);
  });

  it('remembers that Ranch itself witnessed it once a Ranch event joins', async () => {
    const { gateway, incidents } = harness();
    await incidents.attachFailure(failure('a1', T0, 'external'));
    expect(gateway.incidents[0].ranchWitnessed).toBe(false);

    await incidents.attachFailure(failure('a1', minutes(1), 'ranch'));

    expect(gateway.incidents[0].ranchWitnessed).toBe(true);
  });

  it('never dates an incident after the moment it was heard of', async () => {
    const { gateway, incidents } = harness();

    await incidents.attachFailure({
      ...failure('a1', T0),
      occurredAt: minutes(30), // a sender whose clock runs ahead
    });

    expect(gateway.incidents[0].openedAt).toEqual(T0);
  });
});

describe('AgentIncidentService — closing', () => {
  async function openIncident(witness: 'ranch' | 'external' = 'ranch') {
    const h = harness();
    h.addAgent('a1', 'failed');
    await h.incidents.attachFailure(failure('a1', T0, witness));
    return h;
  }

  it('stays open while the agent is not running', async () => {
    const h = await openIncident();

    for (const status of ['failed', 'unreachable', 'deploying', 'pending']) {
      h.setStatus('a1', status);
      await h.incidents.sweep(minutes(600));
    }

    expect(h.gateway.incidents[0].open).toBe(true);
  });

  it('closes as recovered once the agent has run for ten quiet minutes, and says how long it was down', async () => {
    const h = await openIncident('ranch');
    h.setStatus('a1', 'running');
    await h.incidents.noteRunning('a1', minutes(6));

    expect(await h.incidents.sweep(new Date(minutes(16).getTime() - 1))).toBe(
      0,
    );
    expect(h.gateway.incidents[0].open).toBe(true);

    expect(await h.incidents.sweep(minutes(16))).toBe(1);

    const incident = h.gateway.incidents[0];
    expect(incident.open).toBe(false);
    expect(incident.resolution).toBe('recovered');
    const closing = h.gateway.notifications.find((n) => n.kind === 'closed')!;
    expect(closing.payload).toMatchObject({
      resolution: 'recovered',
      openedAt: T0.toISOString(),
      upAt: minutes(6).toISOString(),
    });
  });

  it('restarts the quiet period when a failure arrives during it', async () => {
    const h = await openIncident();
    h.setStatus('a1', 'running');
    await h.incidents.noteRunning('a1', minutes(1));

    // A crash loop: Ready for a moment, then down again at minute 9.
    await h.incidents.attachFailure(failure('a1', minutes(9), 'ranch'));
    await h.incidents.noteRunning('a1', minutes(9.5));

    expect(await h.incidents.sweep(minutes(12))).toBe(0);
    expect(await h.incidents.sweep(minutes(19))).toBe(0);
    expect(await h.incidents.sweep(minutes(19.5))).toBe(1);
    // One "failed", one "back" — nothing in between.
    expect(h.gateway.notifications.map((n) => n.kind)).toEqual([
      'opened',
      'closed',
    ]);
  });

  it('closes a failure only an outside sender saw as unconfirmed, naming who reported it', async () => {
    const h = harness();
    h.addAgent('a1', 'running');
    await h.service.acceptExternal(API_KEY, {
      agentId: 'a1',
      status: 'failed',
    });

    jest.setSystemTime(new Date(T0.getTime() + QUIET_MS));
    expect(await h.incidents.sweep(new Date())).toBe(1);

    expect(h.gateway.incidents[0].resolution).toBe('unconfirmed');
    const closing = h.gateway.notifications.find((n) => n.kind === 'closed')!;
    expect(closing.payload).toMatchObject({
      resolution: 'unconfirmed',
      firstSenderName: 'cluster-watcher',
    });
  });

  it('closes without a message when a person stopped the agent', async () => {
    const h = await openIncident();
    h.setStatus('a1', 'stopped');

    expect(await h.incidents.sweep(minutes(1))).toBe(0);

    expect(h.gateway.incidents[0].resolution).toBe('stopped');
    expect(h.gateway.notifications.map((n) => n.kind)).toEqual(['opened']);
  });

  it('closes without a message when the agent was deleted', async () => {
    const h = await openIncident();
    h.removeAgent('a1');

    await h.incidents.sweep(minutes(1));

    expect(h.gateway.incidents[0].resolution).toBe('deleted');
    expect(h.gateway.notifications.map((n) => n.kind)).toEqual(['opened']);
  });

  it('queues nothing when another replica closed the incident first', async () => {
    const h = await openIncident();
    h.setStatus('a1', 'running');
    h.gateway.loseNextClose = true;

    expect(await h.incidents.sweep(minutes(30))).toBe(0);

    expect(h.gateway.notifications.map((n) => n.kind)).toEqual(['opened']);
  });

  it('opens a new incident for a failure after the old one closed', async () => {
    const h = await openIncident();
    h.setStatus('a1', 'running');
    await h.incidents.sweep(minutes(30));

    const again = await h.incidents.attachFailure(failure('a1', minutes(40)));

    expect(again.outcome).toBe('opened');
    expect(h.gateway.incidents).toHaveLength(2);
  });
});

describe('AgentEventService — an event from outside', () => {
  it('stores who sent it from the key, not from the body', async () => {
    const h = harness();
    h.addAgent('a1', 'running', 'Support Bot');

    const { event, duplicate } = await h.service.acceptExternal(API_KEY, {
      agentId: 'a1',
      status: 'failed',
      datetime: '2026-10-06T20:59:00Z',
      reason: '<!channel> CrashLoopBackOff',
      source: 'kubernetes-event-exporter',
    });

    expect(duplicate).toBe(false);
    expect(event).toMatchObject({
      agentId: 'a1',
      agentRef: 'a1',
      agentName: 'Support Bot',
      status: 'failed',
      // Stored as sent: escaping is the renderer's job, not the record's.
      reason: '<!channel> CrashLoopBackOff',
      witness: 'external',
      apiKeyId: 'key-1',
      senderName: 'cluster-watcher',
      tool: 'kubernetes-event-exporter',
      ranchStatus: 'running',
      outcome: 'opened',
    });
    expect(event.occurredAt).toEqual(new Date('2026-10-06T20:59:00Z'));
    expect(event.receivedAt).toEqual(T0);
    expect(event.incidentId).toBe(h.gateway.incidents[0].id);
    expect(h.kick).toHaveBeenCalledTimes(1);
  });

  it('uses the time of arrival when the sender gives none', async () => {
    const h = harness();
    h.addAgent('a1', 'running');

    const { event } = await h.service.acceptExternal(API_KEY, {
      agentId: 'a1',
      status: 'failed',
    });

    expect(event.occurredAt).toEqual(T0);
    expect(event.receivedAt).toEqual(T0);
  });

  it('stores an event for an unknown agent, marked unmatched, and tells nobody', async () => {
    const h = harness();

    const { event } = await h.service.acceptExternal(API_KEY, {
      agentId: 'no-such-agent',
      status: 'failed',
    });

    expect(event).toMatchObject({
      agentId: null,
      agentRef: 'no-such-agent',
      outcome: 'unmatched',
      incidentId: null,
    });
    expect(h.gateway.incidents).toHaveLength(0);
    expect(h.gateway.notifications).toHaveLength(0);
  });

  it.each([
    ['stopped', 'suppressed_stopped'],
    ['deploying', 'suppressed_starting'],
    ['pending', 'suppressed_starting'],
  ])(
    'stores a failure for a %s agent as %s and opens nothing',
    async (status, outcome) => {
      const h = harness();
      h.addAgent('a1', status);

      const { event } = await h.service.acceptExternal(API_KEY, {
        agentId: 'a1',
        status: 'failed',
      });

      expect(event.outcome).toBe(outcome);
      expect(event.ranchStatus).toBe(status);
      expect(h.gateway.incidents).toHaveLength(0);
      expect(h.gateway.notifications).toHaveLength(0);
    },
  );

  it('files a recovery report with the open incident and changes nothing in it', async () => {
    const h = harness();
    h.addAgent('a1', 'running');
    await h.service.acceptExternal(API_KEY, {
      agentId: 'a1',
      status: 'failed',
    });
    const before = { ...h.gateway.incidents[0] };

    const { event } = await h.service.acceptExternal(API_KEY, {
      agentId: 'a1',
      status: 'recovered',
    });

    expect(event.outcome).toBe('evidence');
    expect(event.incidentId).toBe(before.id);
    // Counted as one more report of the incident — and nothing else moved:
    // not the quiet period, not the state.
    expect(h.gateway.incidents[0]).toEqual({ ...before, eventCount: 2 });
    expect(h.gateway.notifications).toHaveLength(1);
  });

  it('keeps the count of reports and who sent them on the incident itself', async () => {
    // The list of incidents is re-read every few seconds; it must not have
    // to count through the events to say "6 reports from A, B and Ranch".
    const h = harness();
    h.addAgent('a1', 'running');
    h.service.onModuleInit();
    const other = { ...API_KEY, id: 'key-2', name: 'second-watcher' };

    await h.service.acceptExternal(API_KEY, {
      agentId: 'a1',
      status: 'failed',
    });
    await h.service.acceptExternal(API_KEY, {
      agentId: 'a1',
      status: 'failed',
    });
    await h.service.acceptExternal(other, { agentId: 'a1', status: 'failed' });
    await h.service.recordRanchFailure({
      agentId: 'a1',
      status: 'failed',
      reason: 'OOMKilled',
      at: new Date(),
    });
    await h.service.acceptExternal(other, {
      agentId: 'a1',
      status: 'recovered',
    });

    const incident = h.gateway.incidents[0];
    expect(incident.eventCount).toBe(5);
    expect(incident.eventCount).toBe(
      h.gateway.events.filter((e) => e.incidentId === incident.id).length,
    );
    // First reporter first; each sender once.
    expect(incident.witnesses).toEqual([
      'cluster-watcher',
      'second-watcher',
      'Ranch',
    ]);
    h.service.onModuleDestroy();
  });

  it('stores a retry with the same eventId once', async () => {
    const h = harness();
    h.addAgent('a1', 'running');
    const body = {
      agentId: 'a1',
      status: 'failed' as const,
      eventId: 'evt-42',
    };

    const first = await h.service.acceptExternal(API_KEY, body);
    const second = await h.service.acceptExternal(API_KEY, body);

    expect(second.duplicate).toBe(true);
    expect(second.event.id).toBe(first.event.id);
    expect(h.gateway.events).toHaveLength(1);
  });

  it('treats the same agent, status and datetime from the same key as one event', async () => {
    const h = harness();
    h.addAgent('a1', 'running');
    const body = {
      agentId: 'a1',
      status: 'failed' as const,
      datetime: '2026-10-06T20:59:00+00:00',
    };

    await h.service.acceptExternal(API_KEY, body);
    const again = await h.service.acceptExternal(API_KEY, {
      ...body,
      datetime: '2026-10-06T20:59:00Z', // the same instant, written differently
    });

    expect(again.duplicate).toBe(true);
    expect(h.gateway.events).toHaveLength(1);
  });

  it('does not let one key suppress another key’s event', async () => {
    const h = harness();
    h.addAgent('a1', 'running');
    const body = {
      agentId: 'a1',
      status: 'failed' as const,
      eventId: 'evt-42',
    };

    await h.service.acceptExternal(API_KEY, body);
    const other = await h.service.acceptExternal(
      { ...API_KEY, id: 'key-2', name: 'second-watcher' },
      body,
    );

    expect(other.duplicate).toBe(false);
    expect(h.gateway.events).toHaveLength(2);
  });

  it('keeps two identical bodies as two events when nothing tells them apart', async () => {
    const h = harness();
    h.addAgent('a1', 'running');

    await h.service.acceptExternal(API_KEY, {
      agentId: 'a1',
      status: 'failed',
    });
    await h.service.acceptExternal(API_KEY, {
      agentId: 'a1',
      status: 'failed',
    });

    expect(h.gateway.events.map((e) => e.outcome)).toEqual([
      'opened',
      'joined',
    ]);
  });

  it('refuses the 61st event of a minute from one key and says when to come back', async () => {
    const h = harness();
    h.addAgent('a1', 'running');
    for (let i = 0; i < FLOOD_LIMIT_PER_MINUTE; i += 1) {
      await h.service.acceptExternal(API_KEY, {
        agentId: 'a1',
        status: 'failed',
      });
    }
    jest.setSystemTime(new Date(T0.getTime() + 20_000));

    const refused = h.service.acceptExternal(API_KEY, {
      agentId: 'a1',
      status: 'failed',
    });

    await expect(refused).rejects.toBeInstanceOf(TooManyEventsException);
    await expect(refused).rejects.toMatchObject({ retryAfterSeconds: 40 });
    expect(h.gateway.events).toHaveLength(FLOOD_LIMIT_PER_MINUTE);

    // Another key is not affected, and the first is welcome again a minute on.
    await h.service.acceptExternal(
      { ...API_KEY, id: 'key-2' },
      { agentId: 'a1', status: 'failed' },
    );
    jest.setSystemTime(new Date(T0.getTime() + 61_000));
    await h.service.acceptExternal(API_KEY, {
      agentId: 'a1',
      status: 'failed',
    });
    expect(h.gateway.events).toHaveLength(FLOOD_LIMIT_PER_MINUTE + 2);
  });

  it('holds the limit against a burst of parallel requests', async () => {
    // A count followed by an insert lets every request of a burst read "none
    // so far" and pass. The slot is taken before anything is awaited.
    const h = harness();
    h.addAgent('a1', 'running');

    const results = await Promise.allSettled(
      Array.from({ length: 200 }, () =>
        h.service.acceptExternal(API_KEY, { agentId: 'a1', status: 'failed' }),
      ),
    );

    const accepted = results.filter((r) => r.status === 'fulfilled');
    const refused = results.filter(
      (r) =>
        r.status === 'rejected' && r.reason instanceof TooManyEventsException,
    );
    expect(accepted).toHaveLength(FLOOD_LIMIT_PER_MINUTE);
    expect(refused).toHaveLength(200 - FLOOD_LIMIT_PER_MINUTE);
    expect(h.gateway.events).toHaveLength(FLOOD_LIMIT_PER_MINUTE);
  });

  it('counts a retried duplicate against the limit too — the limit is on what a key sends', async () => {
    const h = harness();
    h.addAgent('a1', 'running');
    const body = { agentId: 'a1', status: 'failed' as const, eventId: 'same' };
    for (let i = 0; i < FLOOD_LIMIT_PER_MINUTE; i += 1) {
      await h.service.acceptExternal(API_KEY, body);
    }

    await expect(
      h.service.acceptExternal(API_KEY, body),
    ).rejects.toBeInstanceOf(TooManyEventsException);
    expect(h.gateway.events).toHaveLength(1);
  });
});

describe('AgentEventService — a failure Ranch noticed itself', () => {
  const flush = async () => {
    // The subscription hands each change to an async handler.
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  };

  it('records a transition to failed or unreachable with Ranch as the witness', async () => {
    const h = harness();
    h.addAgent('a1', 'failed', 'Support Bot');
    h.service.onModuleInit();

    h.statusChanges.emit({
      agentId: 'a1',
      status: 'failed',
      reason: 'CrashLoopBackOff',
      at: T0,
    });
    await flush();

    expect(h.gateway.events).toHaveLength(1);
    expect(h.gateway.events[0]).toMatchObject({
      witness: 'ranch',
      senderName: 'Ranch',
      apiKeyId: null,
      status: 'failed',
      reason: 'CrashLoopBackOff',
      outcome: 'opened',
    });
    expect(h.gateway.incidents[0].ranchWitnessed).toBe(true);
    expect(h.gateway.statusOf('opened')).toEqual(['pending']);
    h.service.onModuleDestroy();
  });

  it('stores nothing for a stop, a start, a restart or a delete', async () => {
    const h = harness();
    h.addAgent('a1', 'running');
    h.service.onModuleInit();

    for (const status of [
      'stopped',
      'deploying',
      'pending',
      'running',
      'deleted',
    ] as const) {
      h.statusChanges.emit({ agentId: 'a1', status, reason: null, at: T0 });
    }
    await flush();

    expect(h.gateway.events).toHaveLength(0);
    expect(h.gateway.notifications).toHaveLength(0);
    h.service.onModuleDestroy();
  });

  it('tells the team once when Ranch and an outside sender report the same failure', async () => {
    const h = harness();
    h.addAgent('a1', 'running');
    h.service.onModuleInit();

    await h.service.acceptExternal(API_KEY, {
      agentId: 'a1',
      status: 'failed',
    });
    h.setStatus('a1', 'failed');
    h.statusChanges.emit({
      agentId: 'a1',
      status: 'failed',
      reason: 'OOMKilled',
      at: T0,
    });
    await flush();

    expect(h.gateway.events.map((e) => [e.witness, e.outcome])).toEqual([
      ['external', 'opened'],
      ['ranch', 'joined'],
    ]);
    expect(h.gateway.notifications).toHaveLength(1);
    h.service.onModuleDestroy();
  });

  it('starts the quiet period when Ranch sees the agent running', async () => {
    const h = harness();
    h.addAgent('a1', 'failed');
    h.service.onModuleInit();
    h.statusChanges.emit({
      agentId: 'a1',
      status: 'failed',
      reason: null,
      at: T0,
    });
    await flush();

    h.statusChanges.emit({
      agentId: 'a1',
      status: 'running',
      reason: null,
      at: minutes(4),
    });
    await flush();

    expect(h.gateway.incidents[0].upSince).toEqual(minutes(4));
    h.service.onModuleDestroy();
  });

  it('keeps listening after one change could not be recorded', async () => {
    const h = harness();
    h.addAgent('a1', 'failed');
    h.service.onModuleInit();
    const create = jest
      .spyOn(h.gateway, 'createEvent')
      .mockRejectedValueOnce(new Error('database is away'));

    h.statusChanges.emit({
      agentId: 'a1',
      status: 'failed',
      reason: null,
      at: T0,
    });
    await flush();
    h.statusChanges.emit({
      agentId: 'a1',
      status: 'unreachable',
      reason: null,
      at: minutes(1),
    });
    await flush();

    expect(create).toHaveBeenCalledTimes(2);
    expect(h.gateway.events).toHaveLength(1);
    h.service.onModuleDestroy();
  });
});

describe('AgentNotificationWorker — the outbox', () => {
  const ADDRESS = 'https://hooks.slack.com/services/T000/B000/SECRETSECRET';

  async function withOpenIncident() {
    const h = harness();
    h.addAgent('a1', 'running', 'Support Bot');
    await h.gateway.saveDestination({
      kind: 'webhook',
      webhookUrl: ADDRESS,
      botToken: null,
      channelId: null,
      hint: 'CRET',
      updatedBy: 'u1',
    });
    await h.service.acceptExternal(API_KEY, {
      agentId: 'a1',
      status: 'failed',
    });
    return h;
  }
  const row = (h: Awaited<ReturnType<typeof withOpenIncident>>) =>
    h.gateway.notifications[0];

  it('sends a queued message once and records the delivery', async () => {
    const h = await withOpenIncident();

    expect(await h.worker.drainOutbox()).toBe(1);
    expect(await h.worker.drainOutbox()).toBe(0);

    expect(h.sent).toEqual([
      { address: ADDRESS, text: 'Agent failed: Support Bot' },
    ]);
    expect(row(h)).toMatchObject({ status: 'sent', attempts: 1 });
    expect(h.gateway.destination).toMatchObject({
      lastDeliveryOk: true,
      lastDeliveryError: null,
    });
  });

  it('marks a message skipped when there is nowhere to send it', async () => {
    const h = await withOpenIncident();
    h.gateway.destination = null;

    await h.worker.drainOutbox();

    expect(h.sent).toHaveLength(0);
    expect(row(h).status).toBe('skipped');
  });

  it('waits the schedule’s gap after a failed attempt before trying again', async () => {
    const h = await withOpenIncident();
    h.answerWith({ ok: false, retryable: true, error: 'Slack answered 503' });

    expect(await h.worker.drainOutbox(() => T0)).toBe(1);

    expect(row(h)).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastError: 'Slack answered 503',
    });
    expect(row(h).nextAttemptAt.getTime()).toBe(
      T0.getTime() + RETRY_DELAYS_MS[1],
    );
    expect(h.gateway.destination).toMatchObject({ lastDeliveryOk: false });

    // Not due yet: nothing is sent again.
    expect(await h.worker.drainOutbox(() => T0)).toBe(0);
  });

  it('does not fire the retries back to back for a message that comes due late', async () => {
    const h = await withOpenIncident();
    const down: NotifyResultTypes = {
      ok: false,
      retryable: true,
      error: 'Slack answered 503',
    };
    h.answerWith(down, down, down);
    // The API was away: the message is picked up twenty minutes after it was
    // queued, when five slots of the schedule are already in the past.
    const late = new Date(row(h).createdAt.getTime() + 20 * 60_000);

    expect(await h.worker.drainOutbox(() => late)).toBe(1);

    expect(h.sent).toHaveLength(1);
    expect(row(h).nextAttemptAt.getTime()).toBe(
      late.getTime() + RETRY_DELAYS_MS[1],
    );
  });

  it('waits as long as the destination asks when that is later than the schedule', async () => {
    const h = await withOpenIncident();
    h.answerWith({
      ok: false,
      retryable: true,
      retryAfterMs: 90_000,
      error: 'Slack answered 429',
    });

    await h.worker.drainOutbox(() => T0);

    expect(row(h).nextAttemptAt.getTime()).toBe(T0.getTime() + 90_000);
  });

  it('gives up at once when the address itself is the problem', async () => {
    const h = await withOpenIncident();
    h.answerWith({
      ok: false,
      retryable: false,
      error: 'Slack answered 404: no_service',
    });

    await h.worker.drainOutbox();

    expect(row(h)).toMatchObject({
      status: 'failed',
      attempts: 1,
      lastError: 'Slack answered 404: no_service',
    });
  });

  it('marks a message not delivered after the last attempt of the schedule', async () => {
    const h = await withOpenIncident();
    const down: NotifyResultTypes = {
      ok: false,
      retryable: true,
      error: 'Slack answered 503',
    };
    h.answerWith(...RETRY_DELAYS_MS.map(() => down));
    const created = row(h).createdAt.getTime();

    for (const delay of RETRY_DELAYS_MS) {
      expect(await h.worker.drainOutbox(() => new Date(created + delay))).toBe(
        1,
      );
    }

    expect(row(h)).toMatchObject({
      status: 'failed',
      attempts: RETRY_DELAYS_MS.length,
    });
    expect(h.sent).toHaveLength(RETRY_DELAYS_MS.length);
    // The event is still there: an undelivered alarm loses nothing.
    expect(h.gateway.events).toHaveLength(1);
  });

  it('does not send a message another replica is already sending', async () => {
    const h = await withOpenIncident();
    const now = new Date();
    // The other replica's claim.
    await h.gateway.claimDueNotification(now, new Date(now.getTime() + 30_000));

    expect(await h.worker.drainOutbox(() => now)).toBe(0);
    expect(h.sent).toHaveLength(0);
  });

  it('sends the closing message the sweep queued', async () => {
    const h = await withOpenIncident();
    await h.worker.drainOutbox();

    await h.worker.sweepIncidents(new Date(T0.getTime() + QUIET_MS));
    await h.worker.drainOutbox(() => new Date(T0.getTime() + QUIET_MS + 1000));

    expect(h.sent.map((s) => s.text)).toEqual([
      'Agent failed: Support Bot',
      'No further reports: Support Bot',
    ]);
    expect(h.kick).toHaveBeenCalled();
  });

  it('drops history older than ninety days and keeps open incidents', async () => {
    const h = await withOpenIncident();
    const ninetyOneDays = 91 * 24 * 60 * 60_000;

    await h.worker.purge(new Date(T0.getTime() + ninetyOneDays));

    expect(h.gateway.events).toHaveLength(0);
    expect(h.gateway.incidents).toHaveLength(1);
  });
});

// ── The bot transport (CLEAN-165) ────────────────────────────────────────

describe('the bot transport — one root, the story in its thread', () => {
  const BOT = {
    kind: 'bot' as const,
    webhookUrl: null,
    botToken: 'xoxb-SECRETSECRET',
    channelId: 'C0123456789',
    hint: 'CRET',
    updatedBy: 'u1',
  };
  const WEBHOOK = {
    kind: 'webhook' as const,
    webhookUrl: 'https://hooks.slack.com/services/T000/B000/SECRETSECRET',
    botToken: null,
    channelId: null,
    hint: 'CRET',
    updatedBy: 'u1',
  };
  const seconds = (n: number) => new Date(T0.getTime() + n * 1000);

  type H = ReturnType<typeof harness>;
  const posts = (h: H) => h.botCalls.filter((c) => c.method === 'post');
  const roots = (h: H) => posts(h).filter((c) => !c.threadTs);
  const replies = (h: H) => posts(h).filter((c) => c.threadTs);
  const updates = (h: H) => h.botCalls.filter((c) => c.method === 'update');
  const reactions = (h: H) =>
    h.botCalls.filter((c) => c.method === 'setReaction').map((c) => c.name);
  const last = <T>(list: T[]) => list[list.length - 1];

  async function onBot(witness: 'ranch' | 'external' = 'ranch') {
    const h = harness();
    h.addAgent('a1', 'running', 'Agent a1');
    await h.gateway.saveDestination(BOT);
    await h.incidents.attachFailure(failure('a1', T0, witness));
    return h;
  }

  it('opens on the transport in force and remembers it on the incident', async () => {
    const h = await onBot();

    const incident = h.gateway.incidents[0];
    expect(incident.transport).toBe('bot');
    expect(incident.number).toBe(1);
    expect(h.gateway.kindsOf(incident.id)).toEqual(['opened']);
  });

  it('posts the root once with the mention, the first reply in its thread, and the red reaction', async () => {
    const h = await onBot();

    await h.worker.drainOutbox(() => minutes(1));

    expect(roots(h)).toHaveLength(1);
    expect(roots(h)[0].body).toContain('<!channel>');
    expect(roots(h)[0].body).toContain('incident #1 · down since');
    expect(replies(h).map((r) => [r.text, r.threadTs])).toEqual([
      ['Failed: Agent a1', 'ts-1'],
    ]);
    expect(reactions(h)).toEqual(['red_circle']);
    // The rewrite that rides on the first delivery keeps the mention: the
    // root was just posted with it and nothing has changed since.
    expect(updates(h)).toHaveLength(1);
    expect(updates(h)[0].body).toContain('<!channel>');

    const incident = h.gateway.incidents[0];
    expect(incident.slackTs).toBe('ts-1');
    expect(incident.slackChannel).toBe('C0123456789');
    expect(incident.slackReaction).toBe('red_circle');
    expect(h.gateway.statusOf('opened')).toEqual(['sent']);
    expect(h.gateway.destination?.lastDeliveryOk).toBe(true);
  });

  it('never posts a second root: a retry after the reply failed goes straight to the reply', async () => {
    const h = await onBot();
    h.botAnswerWith(
      { ok: true as const, ts: 'ts-root' },
      { ok: false, retryable: true, error: 'could not reach Slack' },
    );

    await h.worker.drainOutbox(() => minutes(1));
    expect(roots(h)).toHaveLength(1);
    expect(h.gateway.statusOf('opened')).toEqual(['pending']);
    expect(h.gateway.incidents[0].slackTs).toBe('ts-root');

    await h.worker.drainOutbox(() => minutes(2));

    expect(roots(h)).toHaveLength(1);
    // The failed attempt and the one that landed: both into the same thread.
    expect(replies(h).map((r) => r.threadTs)).toEqual(['ts-root', 'ts-root']);
    expect(h.gateway.statusOf('opened')).toEqual(['sent']);
  });

  it('queues "Failed again" at most once a minute and marks the root stale in between', async () => {
    const h = await onBot();
    const id = h.gateway.incidents[0].id;

    await h.incidents.attachFailure(failure('a1', seconds(10)));
    expect(h.gateway.kindsOf(id)).toEqual(['opened', 'joined']);

    await h.incidents.attachFailure(failure('a1', seconds(20)));
    await h.incidents.attachFailure(failure('a1', seconds(20)));
    expect(h.gateway.kindsOf(id)).toEqual(['opened', 'joined']);
    expect(h.gateway.incidents[0].rootStale).toBe(true);
    expect(h.gateway.incidents[0].eventCount).toBe(4);

    await h.incidents.attachFailure(failure('a1', seconds(71)));
    expect(h.gateway.kindsOf(id)).toEqual(['opened', 'joined', 'joined']);
    const lastJoined = last(h.gateway.notifications);
    expect(lastJoined.payload).toMatchObject({ kind: 'joined', eventCount: 5 });
  });

  it('rewrites a stale root on the sweep so its count catches up, then clears the flag', async () => {
    const h = await onBot();
    await h.worker.drainOutbox(() => minutes(1));
    await h.incidents.attachFailure(failure('a1', seconds(70)));
    await h.incidents.attachFailure(failure('a1', seconds(80)));
    expect(h.gateway.incidents[0].rootStale).toBe(true);
    const before = updates(h).length;

    expect(await h.worker.rewriteStaleRoots(minutes(2))).toBe(1);

    expect(updates(h)).toHaveLength(before + 1);
    expect(last(updates(h)).body).toContain('· 3 reports');
    expect(last(updates(h)).body).not.toContain('<!channel>');
    expect(h.gateway.incidents[0].rootStale).toBe(false);
  });

  it('says "Running again" once per up-turn, swaps the reaction and rewrites the root', async () => {
    const h = await onBot();
    const id = h.gateway.incidents[0].id;
    await h.worker.drainOutbox(() => minutes(1));

    await h.incidents.noteRunning('a1', minutes(4));
    await h.incidents.noteRunning('a1', minutes(5));
    expect(h.gateway.kindsOf(id)).toEqual(['opened', 'running']);

    await h.worker.drainOutbox(() => minutes(6));

    expect(last(replies(h)).text).toBe('Running again: Agent a1');
    expect(last(updates(h)).body).toContain('🟢');
    expect(last(updates(h)).body).toContain('up, watching since');
    expect(last(reactions(h))).toBe('large_green_circle');
    expect(h.gateway.incidents[0].slackReaction).toBe('large_green_circle');
  });

  it('closes as resolved: a reply, the root rewritten, ✅ — and no new channel message', async () => {
    const h = await onBot();
    await h.worker.drainOutbox(() => minutes(1));
    await h.incidents.noteRunning('a1', minutes(4));
    await h.worker.drainOutbox(() => minutes(5));

    expect(await h.worker.sweepIncidents(minutes(16))).toBe(1);
    await h.worker.drainOutbox(() => minutes(16));

    expect(roots(h)).toHaveLength(1);
    expect(last(replies(h)).text).toBe('Resolved: Agent a1');
    expect(last(updates(h)).body).toContain('✅');
    expect(last(updates(h)).body).toContain('· resolved');
    expect(last(updates(h)).body).toContain('downtime 4 min');
    expect(last(reactions(h))).toBe('white_check_mark');
    expect(h.gateway.statusOf('closed')).toEqual(['sent']);
  });

  it('tells the thread when a person stopped the agent, and pages nobody', async () => {
    const h = await onBot();
    const id = h.gateway.incidents[0].id;
    await h.worker.drainOutbox(() => minutes(1));

    h.setStatus('a1', 'stopped');
    await h.worker.sweepIncidents(minutes(2));
    expect(h.gateway.kindsOf(id)).toEqual(['opened', 'closed']);
    await h.worker.drainOutbox(() => minutes(2));

    expect(roots(h)).toHaveLength(1);
    expect(last(replies(h)).text).toBe('Stopped: Agent a1');
    expect(last(updates(h)).body).toContain('⏹');
    expect(last(updates(h)).body).toContain('stopped by owner');
    expect(last(reactions(h))).toBe('black_square_for_stop');
  });

  it('records a lost rewrite on the destination and still counts the reply as sent', async () => {
    const h = await onBot();
    await h.worker.drainOutbox(() => minutes(1));
    await h.incidents.noteRunning('a1', minutes(4));
    h.botAnswerWith(
      { ok: true as const, ts: 'ts-reply' },
      {
        ok: false,
        retryable: false,
        error: 'Could not update the incident message: message_not_found',
      },
    );

    await h.worker.drainOutbox(() => minutes(5));

    expect(h.gateway.statusOf('running')).toEqual(['sent']);
    expect(h.gateway.destination?.lastDeliveryOk).toBe(false);
    expect(h.gateway.destination?.lastDeliveryError).toContain(
      'Could not update the incident message',
    );
  });

  it('delivers the rows of one incident in order even when a later one is due first', async () => {
    const h = await onBot();
    await h.incidents.attachFailure(failure('a1', seconds(10)));
    const [opened, joined] = h.gateway.notifications;
    opened.nextAttemptAt = minutes(1);
    joined.nextAttemptAt = T0;

    await h.worker.drainOutbox(() => minutes(2));

    expect(posts(h).map((p) => p.text)).toEqual([
      'Agent a1 — incident #1',
      'Failed: Agent a1',
      'Failed again: Agent a1',
    ]);
  });

  it('posts a late root already in its final state, without the mention, and the replies follow in order', async () => {
    const h = await onBot();
    h.botAnswerWith({
      ok: false,
      retryable: true,
      error: 'could not reach Slack',
    });
    await h.worker.drainOutbox(() => seconds(30));
    expect(h.gateway.incidents[0].slackTs).toBeNull();

    await h.incidents.noteRunning('a1', minutes(4));
    expect(await h.worker.sweepIncidents(minutes(16))).toBe(1);
    await h.worker.drainOutbox(() => minutes(17));

    // One attempt that Slack refused, then the one that landed.
    expect(roots(h)).toHaveLength(2);
    expect(last(roots(h)).body).toContain('✅');
    expect(last(roots(h)).body).toContain('· resolved');
    expect(last(roots(h)).body).not.toContain('<!channel>');
    expect(replies(h).map((r) => r.text)).toEqual([
      'Failed: Agent a1',
      'Running again: Agent a1',
      'Resolved: Agent a1',
    ]);
    expect(h.gateway.notifications.map((n) => n.status)).toEqual([
      'sent',
      'sent',
      'sent',
    ]);
  });

  it('skips the rest of a bot incident once the owner has moved to the webhook', async () => {
    const h = await onBot();
    await h.worker.drainOutbox(() => minutes(1));
    await h.gateway.saveDestination(WEBHOOK);
    await h.incidents.noteRunning('a1', minutes(4));
    expect(await h.worker.sweepIncidents(minutes(16))).toBe(1);

    await h.worker.drainOutbox(() => minutes(16));

    expect(h.gateway.statusOf('closed')).toEqual(['skipped']);
    expect(h.sent).toHaveLength(0);
    expect(roots(h)).toHaveLength(1);
  });

  it('keeps the webhook to its two messages: joins and up-turns say nothing, a stop stays silent', async () => {
    const h = harness();
    h.addAgent('a1', 'running', 'Agent a1');
    await h.gateway.saveDestination(WEBHOOK);
    await h.incidents.attachFailure(failure('a1', T0));
    await h.incidents.attachFailure(failure('a1', seconds(10)));
    await h.incidents.attachFailure(failure('a1', seconds(80)));
    await h.incidents.noteRunning('a1', minutes(4));
    const first = h.gateway.incidents[0].id;
    expect(h.gateway.kindsOf(first)).toEqual(['opened']);

    expect(await h.worker.sweepIncidents(minutes(16))).toBe(1);
    expect(h.gateway.kindsOf(first)).toEqual(['opened', 'closed']);
    await h.worker.drainOutbox(() => minutes(16));
    expect(h.sent.map((s) => s.text)).toEqual([
      'Agent failed: Agent a1',
      'No further reports: Agent a1',
    ]);
    expect(h.botCalls).toHaveLength(0);

    await h.incidents.attachFailure(failure('a1', minutes(20)));
    h.setStatus('a1', 'stopped');
    expect(await h.worker.sweepIncidents(minutes(21))).toBe(0);
    const second = h.gateway.incidents[1];
    expect(second.open).toBe(false);
    expect(h.gateway.kindsOf(second.id)).toEqual(['opened']);
  });
});

describe('the environment label (CLEAN-167)', () => {
  const BOT = {
    kind: 'bot' as const,
    webhookUrl: null,
    botToken: 'xoxb-SECRETSECRET',
    channelId: 'C0123456789',
    hint: 'CRET',
    updatedBy: 'u1',
  };

  it('labels the root and its rewrites, never the thread', async () => {
    const h = harness();
    h.setEnvironment('dev-mazda');
    h.addAgent('a1', 'running', 'Agent a1');
    await h.gateway.saveDestination(BOT);
    await h.incidents.attachFailure(failure('a1', T0, 'ranch'));
    await h.worker.drainOutbox(() => minutes(1));
    await h.incidents.noteRunning('a1', minutes(4));
    await h.worker.drainOutbox(() => minutes(5));

    const posts = h.botCalls.filter((c) => c.method === 'post');
    const roots = posts.filter((c) => !c.threadTs);
    const replies = posts.filter((c) => c.threadTs);
    const updates = h.botCalls.filter((c) => c.method === 'update');
    expect(roots[0].body).toContain('*[dev-mazda] Agent a1 — incident #1');
    expect(roots[0].text).toBe('[dev-mazda] Agent a1 — incident #1');
    for (const u of updates) expect(u.body).toContain('[dev-mazda] Agent a1');
    for (const r of replies) expect(r.body).not.toContain('[dev-mazda]');
  });

  it('labels the webhook messages the same way, and nothing when unset', async () => {
    const h = harness();
    h.addAgent('a1', 'running', 'Agent a1');
    await h.gateway.saveDestination({
      kind: 'webhook',
      webhookUrl: 'https://hooks.slack.com/services/T/B/x',
      botToken: null,
      channelId: null,
      hint: 'x',
      updatedBy: 'u1',
    });
    await h.incidents.attachFailure(failure('a1', T0));
    await h.worker.drainOutbox(() => minutes(1));
    expect(h.sent[0].text).toBe('Agent failed: Agent a1');

    h.setEnvironment('prod-eu');
    await h.incidents.attachFailure(failure('a2', T0));
    h.addAgent('a2', 'running', 'Agent a2');
    await h.worker.drainOutbox(() => minutes(2));
    expect(h.sent[1].text).toBe('[prod-eu] Agent failed: Agent a2');
  });
});
