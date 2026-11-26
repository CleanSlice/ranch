import { Logger, NotFoundException } from '@nestjs/common';
import { captureBackgroundError } from '#/setup/sentry';
import { TranscriptReaderService } from '#/agent/file/domain';
import { IActivityBucket } from './activityBuckets';
import {
  IChatActivityGateway,
  IChatSettleGate,
  IUnsettledChat,
} from './chatActivity.gateway';
import {
  ChatActivityService,
  HORIZON_MS,
  QUIET_MS,
  RETENTION_MS,
} from './chatActivity.service';

jest.mock('#/setup/sentry', () => ({ captureBackgroundError: jest.fn() }));

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-11-27T12:00:00Z');
const at = (iso: string) => Date.parse(iso);

interface IStoredChat extends IUnsettledChat {
  activityRebuiltAt: Date | null;
}

interface IStoredHour extends IActivityBucket {
  sessionId: string;
  agentId: string;
  channel: string;
  externalUserId: string;
}

function chat(over: Partial<IStoredChat> = {}): IStoredChat {
  return {
    id: 'c1',
    agentId: 'agent-1',
    sessionKey: 'bridle:admin',
    channel: 'bridle',
    externalUserId: 'admin',
    lastMessageAt: new Date(NOW - 2 * HOUR),
    activityRebuiltAt: null,
    ...over,
  };
}

/**
 * What a counted live event does to the conversation's row, as far as the
 * pass can see it (ChatGateway.recordActivity): the last message moves, and
 * the conversation is due again.
 */
function liveMessage(c: IStoredChat, when: number): void {
  c.lastMessageAt = new Date(when);
  c.activityRebuiltAt = null;
}

/**
 * The port as the contract states it (spec 038, contracts/collection.md
 * section 3), over two arrays. What the database does with the same calls is
 * covered beside the Prisma gateway, in data/chatActivity.gateway.spec.ts.
 *
 * Due is `activityRebuiltAt === null` and nothing else; the stamp is refused
 * for a conversation with a message later than it.
 */
function makeStore(chats: IStoredChat[] = [], hours: IStoredHour[] = []) {
  const findUnsettled = jest.fn(async (gate: IChatSettleGate) =>
    chats
      .filter(
        (c) =>
          c.activityRebuiltAt === null &&
          c.lastMessageAt < gate.quietBefore &&
          c.lastMessageAt >= gate.activeSince,
      )
      .sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime())
      .slice(0, gate.limit)
      .map(({ activityRebuiltAt: _unused, ...rest }) => {
        void _unused;
        return rest;
      }),
  );
  const raise = jest.fn(
    async (
      session: Pick<
        IUnsettledChat,
        'id' | 'agentId' | 'channel' | 'externalUserId'
      >,
      rows: IActivityBucket[],
    ) => {
      let changed = 0;
      for (const row of rows) {
        const stored = hours.find(
          (h) =>
            h.sessionId === session.id &&
            h.hour.getTime() === row.hour.getTime(),
        );
        if (!stored) {
          hours.push({
            sessionId: session.id,
            agentId: session.agentId,
            channel: session.channel,
            externalUserId: session.externalUserId,
            ...row,
          });
          changed++;
          continue;
        }
        const user = Math.max(stored.userMessages, row.userMessages);
        const agent = Math.max(stored.agentMessages, row.agentMessages);
        if (user !== stored.userMessages || agent !== stored.agentMessages) {
          changed++;
        }
        stored.userMessages = user;
        stored.agentMessages = agent;
      }
      return changed;
    },
  );
  const markSettled = jest.fn(async (sessionId: string, when: Date) => {
    const found = chats.find((c) => c.id === sessionId);
    if (found && found.lastMessageAt <= when) found.activityRebuiltAt = when;
  });
  const pruneBefore = jest.fn(async (date: Date) => {
    const kept = hours.filter((h) => h.hour >= date);
    const removed = hours.length - kept.length;
    hours.splice(0, hours.length, ...kept);
    return removed;
  });
  const gateway = {
    findUnsettled,
    raise,
    markSettled,
    pruneBefore,
  } as unknown as IChatActivityGateway;
  return {
    gateway,
    chats,
    hours,
    findUnsettled,
    raise,
    markSettled,
    pruneBefore,
  };
}

type Line = { role: string; ts: number };

/** Transcripts by path; a path that is not there cannot be read. */
function makeReader(transcripts: Record<string, Line[]>) {
  const read = jest.fn(async (_agentId: string, path: string) => {
    const lines = transcripts[path];
    if (!lines) throw new Error(`NoSuchKey: ${path}`);
    return lines.map((l, i) => ({ id: `m${i}`, text: 'x', ...l }));
  });
  return { reader: { read } as unknown as TranscriptReaderService, read };
}

const PATH = 'data/sessions/bridle:admin.jsonl';

// Four messages at 09:xx, two at 10:xx, one at 12:xx of 2026-11-20.
const FULL: Line[] = [
  { role: 'user', ts: at('2026-11-20T09:01:00Z') },
  { role: 'assistant', ts: at('2026-11-20T09:01:30Z') },
  { role: 'user', ts: at('2026-11-20T09:40:00Z') },
  { role: 'assistant', ts: at('2026-11-20T09:40:20Z') },
  { role: 'user', ts: at('2026-11-20T10:05:00Z') },
  { role: 'assistant', ts: at('2026-11-20T10:05:10Z') },
  { role: 'user', ts: at('2026-11-20T12:30:00Z') },
];

const hourRow = (
  iso: string,
  userMessages: number,
  agentMessages: number,
  sessionId = 'c1',
): IStoredHour => ({
  sessionId,
  agentId: 'agent-1',
  channel: 'bridle',
  externalUserId: 'admin',
  hour: new Date(iso),
  userMessages,
  agentMessages,
});

const counts = (hours: IStoredHour[]) =>
  [...hours]
    .sort((a, b) => a.hour.getTime() - b.hour.getTime())
    .map((h) => [h.hour.toISOString(), h.userMessages, h.agentMessages]);

const reported = captureBackgroundError as jest.Mock;

beforeAll(() => {
  // The failures below are the point of their tests, not news for the reader
  // of the test run.
  for (const level of ['log', 'warn', 'error'] as const) {
    jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
  }
});

afterAll(() => {
  jest.restoreAllMocks();
});

beforeEach(() => {
  reported.mockClear();
});

describe('ChatActivityService.settle, what it picks', () => {
  it('asks for conversations quiet for an hour and active within 180 days, a batch at most', async () => {
    const store = makeStore();
    const service = new ChatActivityService(
      store.gateway,
      makeReader({}).reader,
    );

    await service.settle(NOW);

    expect(QUIET_MS).toBe(60 * MINUTE);
    expect(HORIZON_MS).toBe(180 * DAY);
    expect(store.findUnsettled).toHaveBeenCalledWith({
      quietBefore: new Date(NOW - 60 * MINUTE),
      activeSince: new Date(NOW - 180 * DAY),
      limit: 100,
    });
  });

  it('settles only those, newest first, and leaves the rest unread', async () => {
    const key = (id: string) => `bridle:${id}`;
    const one = (id: string, over: Partial<IStoredChat>) =>
      chat({ id, sessionKey: key(id), externalUserId: id, ...over });
    // Read four hours ago, and written to an hour after that: the message
    // took the stamp away, which is all that makes it due.
    const writtenInSince = one('written-in-since', {
      lastMessageAt: new Date(NOW - 5 * HOUR),
      activityRebuiltAt: new Date(NOW - 4 * HOUR),
    });
    liveMessage(writtenInSince, NOW - 3 * HOUR);
    const store = makeStore([
      one('still-talking', { lastMessageAt: new Date(NOW - 59 * MINUTE) }),
      one('quiet', { lastMessageAt: new Date(NOW - 61 * MINUTE) }),
      one('too-old', { lastMessageAt: new Date(NOW - 181 * DAY) }),
      one('old-enough', { lastMessageAt: new Date(NOW - 179 * DAY) }),
      one('settled', {
        lastMessageAt: new Date(NOW - 5 * HOUR),
        activityRebuiltAt: new Date(NOW - 4 * HOUR),
      }),
      writtenInSince,
    ]);
    const { reader, read } = makeReader({
      'data/sessions/bridle:quiet.jsonl': [],
      'data/sessions/bridle:old-enough.jsonl': [],
      'data/sessions/bridle:written-in-since.jsonl': [],
    });
    const service = new ChatActivityService(store.gateway, reader);

    const result = await service.settle(NOW);

    expect(result).toEqual({ picked: 3, raised: 0, failed: 0 });
    expect(read.mock.calls.map((c) => c[1])).toEqual([
      'data/sessions/bridle:quiet.jsonl',
      'data/sessions/bridle:written-in-since.jsonl',
      'data/sessions/bridle:old-enough.jsonl',
    ]);
  });

  it('reads the transcript by stored event, as the live write counts it', async () => {
    const store = makeStore([chat({ agentId: 'agent-7' })]);
    const { reader, read } = makeReader({ [PATH]: FULL });
    const service = new ChatActivityService(store.gateway, reader);

    await service.settle(NOW);

    // One message per event: an answer streamed as three bubbles was reported
    // live as one activity, and must not come back from the transcript as three.
    expect(read).toHaveBeenCalledWith('agent-7', PATH, {
      types: ['user', 'assistant'],
      filterTransient: true,
      bubbles: false,
    });
  });
});

describe('ChatActivityService.settle, what it writes', () => {
  it('raises an hour that is lower, leaves an equal or higher one, creates a missing one', async () => {
    const store = makeStore(
      [chat()],
      [
        hourRow('2026-11-20T09:00:00Z', 1, 0), // an event was lost: lower
        hourRow('2026-11-20T10:00:00Z', 4, 4), // compacted since: higher
        hourRow('2026-11-19T08:00:00Z', 2, 2), // not in the transcript at all
      ],
    );
    const service = new ChatActivityService(
      store.gateway,
      makeReader({ [PATH]: FULL }).reader,
    );

    const result = await service.settle(NOW);

    expect(result).toEqual({ picked: 1, raised: 2, failed: 0 });
    expect(counts(store.hours)).toEqual([
      ['2026-11-19T08:00:00.000Z', 2, 2],
      ['2026-11-20T09:00:00.000Z', 2, 2],
      ['2026-11-20T10:00:00.000Z', 4, 4],
      ['2026-11-20T12:00:00.000Z', 1, 0],
    ]);
    expect(store.hours[3]).toEqual(hourRow('2026-11-20T12:00:00Z', 1, 0));
    expect(store.chats[0].activityRebuiltAt).toEqual(new Date(NOW));
  });

  it('changes nothing on a second run', async () => {
    const store = makeStore([chat()]);
    const { reader, read } = makeReader({ [PATH]: FULL });
    const service = new ChatActivityService(store.gateway, reader);

    const first = await service.settle(NOW);
    const after = structuredClone(store.hours);
    // Settled, so the next run does not even read it.
    const second = await service.settle(NOW + 5 * MINUTE);
    // And were it read again, the same transcript gives the same rows.
    store.chats[0].activityRebuiltAt = null;
    const third = await service.settle(NOW + 10 * MINUTE);

    expect(first).toEqual({ picked: 1, raised: 3, failed: 0 });
    expect(second).toEqual({ picked: 0, raised: 0, failed: 0 });
    expect(third).toEqual({ picked: 1, raised: 0, failed: 0 });
    expect(read).toHaveBeenCalledTimes(2);
    expect(store.hours).toEqual(after);
  });

  it('lowers nothing and removes nothing when the transcript has become shorter', async () => {
    const transcripts = { [PATH]: FULL };
    const store = makeStore([chat()]);
    const service = new ChatActivityService(
      store.gateway,
      makeReader(transcripts).reader,
    );
    await service.settle(NOW);
    const after = structuredClone(store.hours);

    // Compaction folded the first two hours into a summary.
    transcripts[PATH] = FULL.slice(6);
    store.chats[0].activityRebuiltAt = null;
    const result = await service.settle(NOW + 5 * MINUTE);

    expect(result).toEqual({ picked: 1, raised: 0, failed: 0 });
    expect(store.hours).toEqual(after);
    expect(store.pruneBefore).not.toHaveBeenCalled();
  });

  it('settles a conversation whose transcript has no messages, with no rows', async () => {
    const store = makeStore([chat()]);
    const service = new ChatActivityService(
      store.gateway,
      makeReader({ [PATH]: [] }).reader,
    );

    await service.settle(NOW);

    expect(store.hours).toEqual([]);
    expect(store.chats[0].activityRebuiltAt).toEqual(new Date(NOW));
  });

  // A conversation that began more than the retention ago: the prune deletes
  // those hours daily, and settling it must not put them back each time.
  it('leaves out the part of a transcript that is past the retention', async () => {
    const store = makeStore([chat()]);
    const service = new ChatActivityService(
      store.gateway,
      makeReader({
        [PATH]: [
          { role: 'user', ts: NOW - 401 * DAY },
          { role: 'assistant', ts: NOW - DAY },
        ],
      }).reader,
    );

    const result = await service.settle(NOW);

    expect(result).toEqual({ picked: 1, raised: 1, failed: 0 });
    expect(counts(store.hours)).toEqual([['2026-11-26T12:00:00.000Z', 0, 1]]);
    expect(store.chats[0].activityRebuiltAt).toEqual(new Date(NOW));
  });

  // The cut is by the start of the hour, as the prune's is: a message still
  // inside the 400 days whose hour began before them belongs to a row the
  // prune removes.
  it('creates no hour that a prune at the same moment would remove', async () => {
    const now = NOW + 30 * MINUTE;
    const store = makeStore([chat()]);
    const service = new ChatActivityService(
      store.gateway,
      makeReader({
        [PATH]: [
          // 12:40 of the day the retention ends at 12:30: the 12:00 hour.
          { role: 'user', ts: now - 400 * DAY + 10 * MINUTE },
          // The first hour that is kept whole.
          { role: 'assistant', ts: now - 400 * DAY + 30 * MINUTE },
          { role: 'user', ts: NOW - DAY },
        ],
      }).reader,
    );

    await service.settle(now);

    expect(store.hours.map((h) => h.hour)).toEqual([
      new Date(NOW - 400 * DAY + HOUR),
      new Date(NOW - DAY),
    ]);
    expect(await service.prune(now)).toBe(0);
  });
});

describe('ChatActivityService.settle, a conversation that moves on', () => {
  it('reads it again after a message that came once it was settled', async () => {
    const store = makeStore([chat()]);
    const transcripts = { [PATH]: FULL.slice(0, 4) };
    const { reader, read } = makeReader(transcripts);
    const service = new ChatActivityService(store.gateway, reader);
    await service.settle(NOW);
    expect(store.chats[0].activityRebuiltAt).toEqual(new Date(NOW));

    // An hour and a half later somebody writes, and the event is lost on
    // its way: the row moved (the reconcile does the same to it), the hour
    // did not.
    const written = NOW + 90 * MINUTE;
    transcripts[PATH] = [...FULL.slice(0, 4), { role: 'user', ts: written }];
    liveMessage(store.chats[0], written);

    // Not while it is still going.
    const early = await service.settle(written + 30 * MINUTE);
    const late = await service.settle(written + 61 * MINUTE);

    expect(early).toEqual({ picked: 0, raised: 0, failed: 0 });
    expect(late).toEqual({ picked: 1, raised: 1, failed: 0 });
    expect(read).toHaveBeenCalledTimes(2);
    expect(counts(store.hours)).toEqual([
      ['2026-11-20T09:00:00.000Z', 2, 2],
      ['2026-11-27T13:00:00.000Z', 1, 0],
    ]);
  });

  // The stamp is the start of the run. A message that arrives while the
  // transcript is being read is later than that and has cleared the column;
  // were the stamp written over it, nothing would make the conversation due
  // until the message after.
  it('does not mark as settled a conversation written to while its transcript was being read', async () => {
    const store = makeStore([chat()]);
    const arrived = NOW + 2_000;
    const lines = FULL.map((l, i) => ({ id: `m${i}`, text: 'x', ...l }));
    const read = jest
      .fn(async () => lines)
      .mockImplementationOnce(async () => {
        // The first read began before the message was stored, and does not
        // have it.
        liveMessage(store.chats[0], arrived);
        return lines;
      });
    const service = new ChatActivityService(store.gateway, {
      read,
    } as unknown as TranscriptReaderService);

    const during = await service.settle(NOW);

    expect(during).toEqual({ picked: 1, raised: 3, failed: 0 });
    expect(store.markSettled).toHaveBeenCalledWith('c1', new Date(NOW));
    expect(store.chats[0].activityRebuiltAt).toBeNull();

    // So it is taken again once it has been quiet for an hour.
    const next = await service.settle(arrived + 61 * MINUTE);
    expect(next.picked).toBe(1);
    expect(store.chats[0].activityRebuiltAt).toEqual(
      new Date(arrived + 61 * MINUTE),
    );
  });
});

describe('ChatActivityService.settle, when a conversation cannot be settled', () => {
  const RUN = 5 * MINUTE;

  it('leaves it unsettled, goes on with the others, and reports it once at the third failure in a row', async () => {
    const store = makeStore([
      chat({ id: 'gone', sessionKey: 'bridle:gone' }),
      chat({ id: 'c1', lastMessageAt: new Date(NOW - 3 * HOUR) }),
    ]);
    const { reader } = makeReader({ [PATH]: FULL });
    const service = new ChatActivityService(store.gateway, reader);

    const first = await service.settle(NOW);
    expect(first).toEqual({ picked: 2, raised: 3, failed: 1 });
    expect(store.chats[0].activityRebuiltAt).toBeNull();
    expect(store.chats[1].activityRebuiltAt).toEqual(new Date(NOW));

    await service.settle(NOW + RUN);
    expect(reported).not.toHaveBeenCalled();

    await service.settle(NOW + 2 * RUN);
    expect(reported).toHaveBeenCalledTimes(1);
    expect(reported).toHaveBeenCalledWith(expect.any(Error), 'chat.activity');
    expect((reported.mock.calls[0][0] as Error).message).toContain('gone');

    // A fourth and a fifth failure, an hour and two later, are not news.
    await service.settle(NOW + 2 * RUN + QUIET_MS);
    await service.settle(NOW + 2 * RUN + 2 * QUIET_MS);
    expect(reported).toHaveBeenCalledTimes(1);
    expect(store.chats[0].activityRebuiltAt).toBeNull();
  });

  it('settles a conversation whose transcript does not exist, quietly, and keeps what was counted live', async () => {
    const store = makeStore([chat({ id: 'no-file' })]);
    store.hours.push({
      sessionId: 'no-file',
      agentId: store.chats[0].agentId,
      channel: store.chats[0].channel,
      externalUserId: store.chats[0].externalUserId,
      hour: new Date(at('2026-11-20T09:00:00Z')),
      userMessages: 2,
      agentMessages: 1,
    });
    const before = structuredClone(store.hours);
    const read = jest.fn(async () => {
      throw new NotFoundException('File not found');
    });
    const service = new ChatActivityService(store.gateway, {
      read,
    } as unknown as TranscriptReaderService);

    for (const run of [0, 1, 2, 3]) {
      expect(await service.settle(NOW + run * RUN)).toEqual(
        // Picked once: after that it is settled and not due.
        run === 0
          ? { picked: 1, raised: 0, failed: 0 }
          : { picked: 0, raised: 0, failed: 0 },
      );
    }

    expect(read).toHaveBeenCalledTimes(1);
    expect(store.chats[0].activityRebuiltAt).toEqual(new Date(NOW));
    expect(store.hours).toEqual(before);
    expect(reported).not.toHaveBeenCalled();
  });

  it('starts counting again after a run that worked', async () => {
    const transcripts: Record<string, Line[]> = {};
    const store = makeStore([chat()]);
    const service = new ChatActivityService(
      store.gateway,
      makeReader(transcripts).reader,
    );

    await service.settle(NOW);
    await service.settle(NOW + RUN);
    transcripts[PATH] = FULL;
    await service.settle(NOW + 2 * RUN);
    delete transcripts[PATH];
    store.chats[0].activityRebuiltAt = null;
    await service.settle(NOW + 3 * RUN);
    await service.settle(NOW + 4 * RUN);

    expect(reported).not.toHaveBeenCalled();

    // A second streak of three is a second report.
    await service.settle(NOW + 5 * RUN);
    expect(reported).toHaveBeenCalledTimes(1);
  });

  it('counts a failed write like a failed read, and does not mark the conversation', async () => {
    const store = makeStore([chat()]);
    store.raise.mockRejectedValue(new Error('connection lost'));
    const service = new ChatActivityService(
      store.gateway,
      makeReader({ [PATH]: FULL }).reader,
    );

    const result = await service.settle(NOW);

    expect(result).toEqual({ picked: 1, raised: 0, failed: 1 });
    expect(store.markSettled).not.toHaveBeenCalled();
  });

  // Newest first with a batch: conversations that fail every time would
  // otherwise be the whole batch of every run, and nothing behind them would
  // ever be read.
  it('sets a conversation aside for an hour after three failures, so the ones behind it are reached', async () => {
    process.env.STATS_SETTLE_INTERVAL_SEC = '0';
    process.env.STATS_SETTLE_BATCH = '2';
    const store = makeStore([
      chat({ id: 'gone-1', sessionKey: 'bridle:gone-1' }),
      chat({ id: 'gone-2', sessionKey: 'bridle:gone-2' }),
      chat({ id: 'c1', lastMessageAt: new Date(NOW - 3 * HOUR) }),
    ]);
    const { reader, read } = makeReader({ [PATH]: FULL });
    const service = new ChatActivityService(store.gateway, reader);
    service.onModuleInit();
    try {
      for (let run = 0; run < 3; run++) {
        const result = await service.settle(NOW + run * RUN);
        expect(result).toEqual({ picked: 2, raised: 0, failed: 2 });
      }
      read.mockClear();

      const fourth = await service.settle(NOW + 3 * RUN);

      expect(fourth).toEqual({ picked: 1, raised: 3, failed: 0 });
      expect(read.mock.calls.map((c) => c[1])).toEqual([PATH]);

      // An hour after its last failure each is tried again.
      read.mockClear();
      const later = await service.settle(NOW + 2 * RUN + QUIET_MS);
      expect(later).toEqual({ picked: 2, raised: 0, failed: 2 });
      expect(read).toHaveBeenCalledTimes(2);
    } finally {
      service.onModuleDestroy();
      delete process.env.STATS_SETTLE_INTERVAL_SEC;
      delete process.env.STATS_SETTLE_BATCH;
    }
  });
});

describe('ChatActivityService.settle, one run at a time', () => {
  it('skips a run that finds the previous one still going', async () => {
    const store = makeStore([chat()]);
    let release: (lines: Line[]) => void = () => {};
    const read = jest.fn(
      () =>
        new Promise<Line[]>((resolve) => {
          release = resolve;
        }),
    );
    const service = new ChatActivityService(store.gateway, {
      read,
    } as unknown as TranscriptReaderService);

    const first = service.settle(NOW);
    // Let the first run reach its transcript read.
    await new Promise((resolve) => setImmediate(resolve));
    const second = await service.settle(NOW);

    expect(second).toEqual({ picked: 0, raised: 0, failed: 0 });
    expect(store.findUnsettled).toHaveBeenCalledTimes(1);

    release([]);
    expect(await first).toEqual({ picked: 1, raised: 0, failed: 0 });

    // And the run after it is not skipped.
    await service.settle(NOW + 5 * MINUTE);
    expect(store.findUnsettled).toHaveBeenCalledTimes(2);
  });

  it('is ready for the next run after one that failed', async () => {
    const store = makeStore();
    store.findUnsettled.mockRejectedValueOnce(new Error('connection lost'));
    const service = new ChatActivityService(
      store.gateway,
      makeReader({}).reader,
    );

    await expect(service.settle(NOW)).rejects.toThrow('connection lost');

    expect(await service.settle(NOW)).toEqual({
      picked: 0,
      raised: 0,
      failed: 0,
    });
  });
});

describe('ChatActivityService timers', () => {
  let service: ChatActivityService | undefined;

  const start = (env: { interval?: string; batch?: string } = {}) => {
    if (env.interval !== undefined) {
      process.env.STATS_SETTLE_INTERVAL_SEC = env.interval;
    }
    if (env.batch !== undefined) process.env.STATS_SETTLE_BATCH = env.batch;
    const store = makeStore();
    service = new ChatActivityService(store.gateway, makeReader({}).reader);
    service.onModuleInit();
    return store;
  };

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    delete process.env.STATS_SETTLE_INTERVAL_SEC;
    delete process.env.STATS_SETTLE_BATCH;
  });

  afterEach(() => {
    service?.onModuleDestroy();
    service = undefined;
    jest.useRealTimers();
    delete process.env.STATS_SETTLE_INTERVAL_SEC;
    delete process.env.STATS_SETTLE_BATCH;
  });

  // An empty value is what a manifest with the variable left blank gives.
  it.each([
    ['nothing is set', {}],
    ['both are empty', { interval: '', batch: '' }],
  ])(
    'settles every five minutes, a hundred at most, when %s',
    async (_, env) => {
      const store = start(env);

      await jest.advanceTimersByTimeAsync(299_000);
      expect(store.findUnsettled).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(1_000);
      expect(store.findUnsettled).toHaveBeenCalledTimes(1);
      expect(store.findUnsettled.mock.calls[0][0].limit).toBe(100);

      await jest.advanceTimersByTimeAsync(300_000);
      expect(store.findUnsettled).toHaveBeenCalledTimes(2);
    },
  );

  it('takes its interval and its batch from the environment, once, at init', async () => {
    const store = start({ interval: '60', batch: '7' });
    process.env.STATS_SETTLE_INTERVAL_SEC = '1';
    process.env.STATS_SETTLE_BATCH = '1';

    await jest.advanceTimersByTimeAsync(60_000);

    expect(store.findUnsettled).toHaveBeenCalledTimes(1);
    expect(store.findUnsettled.mock.calls[0][0].limit).toBe(7);
  });

  it.each(['0', '-5', 'often'])(
    'starts no settle timer with STATS_SETTLE_INTERVAL_SEC=%s',
    async (interval) => {
      const store = start({ interval });

      await jest.advanceTimersByTimeAsync(6 * HOUR);

      expect(store.findUnsettled).not.toHaveBeenCalled();
    },
  );

  it.each(['0', '-1', 'many', ''])(
    'falls back to a hundred for STATS_SETTLE_BATCH=%s',
    async (batch) => {
      const store = start({ batch });

      await jest.advanceTimersByTimeAsync(300_000);

      expect(store.findUnsettled.mock.calls[0][0].limit).toBe(100);
    },
  );

  it('stops both timers when the module is destroyed', async () => {
    const store = start();
    store.pruneBefore.mockClear();

    service?.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(2 * DAY);

    expect(store.findUnsettled).not.toHaveBeenCalled();
    expect(store.pruneBefore).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('reports a run that failed as a whole, and runs again at the next tick', async () => {
    const store = start();
    store.findUnsettled.mockRejectedValueOnce(new Error('connection lost'));

    await jest.advanceTimersByTimeAsync(300_000);

    expect(reported).toHaveBeenCalledTimes(1);
    expect(reported).toHaveBeenCalledWith(expect.any(Error), 'chat.activity');

    await jest.advanceTimersByTimeAsync(300_000);
    expect(store.findUnsettled).toHaveBeenCalledTimes(2);
    expect(reported).toHaveBeenCalledTimes(1);
  });

  // Retention is not part of the pass: an operator who turns the pass off
  // still has rows written live, and they still have to go after 400 days.
  it('prunes at boot and once a day, also with the settle pass turned off', async () => {
    const store = start({ interval: '0' });

    expect(store.pruneBefore).toHaveBeenCalledTimes(1);
    expect(store.pruneBefore).toHaveBeenLastCalledWith(
      new Date(NOW - 400 * DAY),
    );

    await jest.advanceTimersByTimeAsync(DAY);

    expect(store.pruneBefore).toHaveBeenCalledTimes(2);
    expect(store.pruneBefore).toHaveBeenLastCalledWith(
      new Date(NOW + DAY - 400 * DAY),
    );
  });

  it('reports a prune that failed and keeps the timer', async () => {
    const store = start();
    store.pruneBefore.mockRejectedValueOnce(new Error('connection lost'));

    await jest.advanceTimersByTimeAsync(DAY);

    expect(reported).toHaveBeenCalledWith(expect.any(Error), 'chat.activity');

    await jest.advanceTimersByTimeAsync(DAY);
    expect(store.pruneBefore).toHaveBeenCalledTimes(3);
  });
});

describe('ChatActivityService.prune', () => {
  it('removes rows older than 400 days and no others', async () => {
    const old = new Date(NOW - 400 * DAY - HOUR);
    const edge = new Date(NOW - 400 * DAY);
    const recent = new Date(NOW - 399 * DAY);
    const store = makeStore(
      [],
      [
        hourRow(old.toISOString(), 1, 1),
        hourRow(edge.toISOString(), 1, 1),
        hourRow(recent.toISOString(), 1, 1),
      ],
    );
    const service = new ChatActivityService(
      store.gateway,
      makeReader({}).reader,
    );

    const removed = await service.prune(NOW);

    expect(RETENTION_MS).toBe(400 * DAY);
    expect(removed).toBe(1);
    expect(store.hours.map((h) => h.hour)).toEqual([edge, recent]);
  });
});
