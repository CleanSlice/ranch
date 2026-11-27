import {
  OWNER,
  USER,
  accessHarness,
  person,
} from '#/user/agentAccess/domain/__fixtures__/agentAccess';
import { UserRoleTypes } from '#/user/user/domain';
import {
  IStatsWorld,
  IWorldAgent,
  IWorldHour,
  statsHarness,
} from './__fixtures__/personalStats';
import { IStatsViewer } from './personalStats.types';

const KYIV = 'Europe/Kyiv';
const LA = 'America/Los_Angeles';

const SONNET = 'claude-sonnet-4-6';
const HAIKU = 'claude-haiku-4-5';

// A Friday. In UTC a 7-day period is 21 to 27 November, the one before it
// 14 to 20 November, and the 91 days of the calendar begin on 29 August.
const NOW = new Date('2026-11-27T10:30:00.000Z');

const ATLAS: IWorldAgent = { id: 'a1', name: 'Atlas', model: SONNET };
const BEACON: IWorldAgent = { id: 'a2', name: 'Beacon', model: HAIKU };
// No credential: an agent that has no current model.
const CIPHER: IWorldAgent = { id: 'a3', name: 'Cipher', model: null };
const AGENTS = [ATLAS, BEACON, CIPHER];

const ME = 'user-1';

/** An ordinary account: its chat identity is its own id. */
const me = (over: Partial<IStatsViewer> = {}): IStatsViewer => ({
  userId: ME,
  clientId: ME,
  caller: { kind: 'person', userId: ME, role: UserRoleTypes.User },
  ...over,
});

/** An hour in which the person wrote and the agent answered, unless said. */
const hour = (
  sessionId: string,
  agentId: string,
  iso: string,
  userMessages = 1,
  agentMessages = 1,
  externalUserId = ME,
): IWorldHour => ({
  sessionId,
  agentId,
  externalUserId,
  hour: iso,
  userMessages,
  agentMessages,
});

const view = (
  world: Partial<IStatsWorld>,
  period: 7 | 30 | 90 = 7,
  timeZone: unknown = 'UTC',
  viewer: IStatsViewer = me(),
) =>
  statsHarness({ agents: AGENTS, ...world }).service.forPerson(
    viewer,
    { period, timeZone },
    NOW,
  );

describe('PersonalStatsService: what was computed', () => {
  it('answers with the period, the zone it used and the three instants of the range', async () => {
    const stats = await view({}, 7, KYIV);

    expect(stats.period).toBe(7);
    expect(stats.timeZone).toBe(KYIV);
    // Kyiv is UTC+2 in November: its 21st begins at 22:00 UTC on the 20th.
    expect(stats.range).toEqual({
      from: new Date('2026-11-20T22:00:00.000Z'),
      to: NOW,
      previousFrom: new Date('2026-11-13T22:00:00.000Z'),
    });
  });

  it('falls back to UTC for a zone it does not know, and says so', async () => {
    for (const timeZone of ['Mars/Olympus', '', 42, undefined, ['UTC']]) {
      const stats = await view({}, 7, timeZone);
      expect(stats.timeZone).toBe('UTC');
      expect(stats.range.from).toEqual(new Date('2026-11-21T00:00:00.000Z'));
    }
  });
});

describe('PersonalStatsService: the board', () => {
  it('counts conversations and the person’s own messages for the period and for the one before', async () => {
    const stats = await view({
      hours: [
        hour('c1', 'a1', '2026-11-25T09:00:00Z', 2, 2),
        hour('c1', 'a1', '2026-11-25T10:00:00Z', 1, 1),
        hour('c2', 'a2', '2026-11-26T14:00:00Z', 3, 3),
        // The first hour of the period, and the last one before it.
        hour('c5', 'a1', '2026-11-21T00:00:00Z', 1, 1),
        hour('c4', 'a1', '2026-11-20T23:00:00Z', 1, 1),
        hour('c3', 'a1', '2026-11-17T08:00:00Z', 4, 4),
        // Before the previous period: in neither.
        hour('c0', 'a1', '2026-11-13T23:00:00Z', 5, 5),
      ],
    });

    expect(stats.board.conversations).toEqual({ value: 3, previous: 2 });
    expect(stats.board.messages).toEqual({ value: 7, previous: 5 });
  });

  it('counts a conversation written in on three days once in the period, and on each of the days', async () => {
    const stats = await view({
      hours: [
        hour('c1', 'a1', '2026-11-23T09:00:00Z'),
        hour('c1', 'a1', '2026-11-24T18:00:00Z'),
        hour('c1', 'a1', '2026-11-25T07:00:00Z'),
      ],
    });

    expect(stats.board.conversations.value).toBe(1);
    const byDate = new Map(
      stats.activity.days.map((d) => [d.date, d.conversations]),
    );
    expect(byDate.get('2026-11-23')).toBe(1);
    expect(byDate.get('2026-11-24')).toBe(1);
    expect(byDate.get('2026-11-25')).toBe(1);
    // So the days add up to more than the period: that is the definition.
    expect(
      stats.activity.days.reduce((sum, d) => sum + d.conversations, 0),
    ).toBe(3);
  });

  it('counts a conversation that went on from the previous period in both', async () => {
    const stats = await view({
      hours: [
        hour('c1', 'a1', '2026-11-19T09:00:00Z'),
        hour('c1', 'a1', '2026-11-22T09:00:00Z'),
      ],
    });

    expect(stats.board.conversations).toEqual({ value: 1, previous: 1 });
  });

  it('counts a conversation only where the person wrote: an hour of answers alone is no conversation of theirs', async () => {
    const stats = await view({
      hours: [
        // A scheduled message the agent sent into the conversation.
        hour('c1', 'a1', '2026-11-25T09:00:00Z', 0, 2),
      ],
    });

    expect(stats.board.conversations.value).toBe(0);
    expect(stats.board.messages.value).toBe(0);
    expect(stats.activity.activeDays).toBe(0);
    expect(stats.agents).toEqual([]);
    // The agent did answer in the period, and is counted as one that did.
    expect(stats.board.agents.value).toBe(1);
  });

  it('counts the agents that answered, and how many the person reaches now', async () => {
    const stats = await view({
      hours: [
        hour('c1', 'a1', '2026-11-25T09:00:00Z', 1, 1),
        hour('c2', 'a1', '2026-11-26T09:00:00Z', 1, 1),
        // Written to, never answered.
        hour('c3', 'a2', '2026-11-26T09:00:00Z', 2, 0),
        // Answered, but in the previous period.
        hour('c4', 'a3', '2026-11-18T09:00:00Z', 1, 1),
      ],
    });

    expect(stats.board.agents).toEqual({ value: 1, reachable: 3 });
  });
});

describe('PersonalStatsService: activity', () => {
  it('lists 91 days, oldest first, ending today, each with its date and its conversations and nothing else', async () => {
    const stats = await view({
      hours: [
        hour('c1', 'a1', '2026-11-27T09:00:00Z'),
        hour('c2', 'a2', '2026-11-27T10:00:00Z'),
        hour('c3', 'a1', '2026-08-29T00:00:00Z'),
        // The day before the calendar begins.
        hour('c4', 'a1', '2026-08-28T23:00:00Z'),
      ],
    });

    const { days } = stats.activity;
    expect(days).toHaveLength(91);
    expect(days[0]).toEqual({ date: '2026-08-29', conversations: 1 });
    expect(days[90]).toEqual({ date: '2026-11-27', conversations: 2 });
    expect(days.map((d) => d.date)).toEqual(
      [...days.map((d) => d.date)].sort(),
    );
    expect(days.reduce((sum, d) => sum + d.conversations, 0)).toBe(3);
  });

  it('shows the same 91 days whatever the period', async () => {
    const world = { hours: [hour('c1', 'a1', '2026-09-10T09:00:00Z')] };

    for (const period of [7, 30, 90] as const) {
      const { days } = (await view(world, period)).activity;
      expect(days).toHaveLength(91);
      expect(days[0].date).toBe('2026-08-29');
      expect(days.find((d) => d.date === '2026-09-10')?.conversations).toBe(1);
    }
  });

  it('cuts the days on the viewer’s clock, east and west of UTC', async () => {
    const world = {
      hours: [
        // 22:00 UTC on the 26th: midnight of the 27th in Kyiv, 14:00 on the
        // 26th in Los Angeles.
        hour('c1', 'a1', '2026-11-26T22:00:00Z'),
        // 07:00 UTC on the 27th: 09:00 on the 27th in Kyiv, 23:00 on the
        // 26th in Los Angeles.
        hour('c2', 'a1', '2026-11-27T07:00:00Z'),
      ],
    };
    const lastTwo = async (zone: string) =>
      (await view(world, 7, zone)).activity.days.slice(-2);

    expect(await lastTwo(KYIV)).toEqual([
      { date: '2026-11-26', conversations: 0 },
      { date: '2026-11-27', conversations: 2 },
    ]);
    expect(await lastTwo('UTC')).toEqual([
      { date: '2026-11-26', conversations: 1 },
      { date: '2026-11-27', conversations: 1 },
    ]);
    // 10:30 UTC is 02:30 on the 27th there: today is the 27th, still empty.
    expect(await lastTwo(LA)).toEqual([
      { date: '2026-11-26', conversations: 2 },
      { date: '2026-11-27', conversations: 0 },
    ]);
  });

  it('puts an hour on the period’s side of local midnight that its day is on', async () => {
    const stats = await view(
      {
        hours: [
          // 22:00 UTC on the 20th is the first hour of the 21st in Kyiv,
          // the first day of a 7-day period there. 21:00 is the day before.
          hour('c1', 'a1', '2026-11-20T22:00:00Z', 3),
          hour('c2', 'a1', '2026-11-20T21:00:00Z', 5),
        ],
      },
      7,
      KYIV,
    );

    expect(stats.board.messages).toEqual({ value: 3, previous: 5 });
    expect(stats.board.conversations).toEqual({ value: 1, previous: 1 });
  });

  it('counts conversations by weekday within the period, Monday first, and the days that had any', async () => {
    const stats = await view({
      hours: [
        // 23 November 2026 is a Monday.
        hour('c1', 'a1', '2026-11-23T09:00:00Z'),
        hour('c1', 'a1', '2026-11-24T09:00:00Z'),
        hour('c2', 'a2', '2026-11-24T11:00:00Z'),
        hour('c3', 'a1', '2026-11-27T08:00:00Z'),
        // The Friday before the period: on the calendar, not in the week.
        hour('c4', 'a1', '2026-11-20T09:00:00Z'),
      ],
    });

    expect(stats.activity.weekdays).toEqual([1, 2, 0, 0, 1, 0, 0]);
    expect(stats.activity.activeDays).toBe(3);
  });

  it('adds the same weekday up over the weeks of a longer period', async () => {
    const stats = await view(
      {
        hours: [
          hour('c1', 'a1', '2026-11-23T09:00:00Z'),
          hour('c2', 'a1', '2026-11-16T09:00:00Z'),
          hour('c3', 'a1', '2026-11-09T09:00:00Z'),
          // A Monday before the 30 days began (29 October is their first).
          hour('c4', 'a1', '2026-10-26T09:00:00Z'),
        ],
      },
      30,
    );

    expect(stats.activity.weekdays).toEqual([3, 0, 0, 0, 0, 0, 0]);
    expect(stats.activity.activeDays).toBe(3);
  });
});

describe('PersonalStatsService: who the person talked to', () => {
  it('lists the agents written to in the period by messages, with conversations, the current model and the last contact', async () => {
    const { service, reads } = statsHarness({
      agents: AGENTS,
      hours: [
        hour('c1', 'a1', '2026-11-25T09:00:00Z', 2),
        hour('c3', 'a1', '2026-11-26T09:00:00Z', 1),
        hour('c2', 'a2', '2026-11-26T10:00:00Z', 5),
        hour('c4', 'a3', '2026-11-24T10:00:00Z', 3),
      ],
      lastMessageAt: {
        c1: '2026-11-25T09:41:07.000Z',
        c3: '2026-11-26T09:12:30.000Z',
        c2: '2026-11-26T10:59:00.000Z',
        c4: '2026-11-24T10:05:00.000Z',
      },
    });

    const stats = await service.forPerson(me(), { period: 7 }, NOW);

    expect(stats.agents).toEqual([
      {
        agentId: 'a2',
        name: 'Beacon',
        messages: 5,
        conversations: 1,
        model: HAIKU,
        lastMessageAt: new Date('2026-11-26T10:59:00.000Z'),
      },
      // Three messages each: equal ones by name.
      {
        agentId: 'a1',
        name: 'Atlas',
        messages: 3,
        conversations: 2,
        model: SONNET,
        // The later of its two conversations.
        lastMessageAt: new Date('2026-11-26T09:12:30.000Z'),
      },
      {
        agentId: 'a3',
        name: 'Cipher',
        messages: 3,
        conversations: 1,
        model: null,
        lastMessageAt: new Date('2026-11-24T10:05:00.000Z'),
      },
    ]);
    // Asked for the conversations of the period, and no others.
    const [ids] = reads.chats.findSessionsByIds.calls[0];
    expect([...ids].sort()).toEqual(['c1', 'c2', 'c3', 'c4']);
  });

  it('leaves out an agent the person wrote to only before the period', async () => {
    const stats = await view({
      hours: [
        hour('c1', 'a1', '2026-11-25T09:00:00Z'),
        hour('c2', 'a2', '2026-11-18T09:00:00Z'),
      ],
    });

    expect(stats.agents.map((a) => a.agentId)).toEqual(['a1']);
  });

  it('never carries a credential: the model’s name is all that is read of one', async () => {
    const stats = await view({
      hours: [hour('c1', 'a1', '2026-11-25T09:00:00Z')],
    });

    const text = JSON.stringify(stats);
    expect(text).toContain(SONNET);
    expect(text).not.toContain('sk-secret');
    expect(text).not.toContain('credential-label');
    expect(text).not.toContain('llm-of-');
  });

  it('reads the credentials of the agents written to in the period, each once, and no other', async () => {
    const { service, reads } = statsHarness({
      agents: [
        ATLAS,
        BEACON,
        CIPHER,
        { id: 'a4', name: 'Delta', model: 'model-nobody-asked-for' },
      ],
      hours: [
        hour('c1', 'a1', '2026-11-25T09:00:00Z'),
        hour('c2', 'a1', '2026-11-26T09:00:00Z'),
        // No credential to read.
        hour('c3', 'a3', '2026-11-26T09:00:00Z'),
        // Written to before the period.
        hour('c4', 'a2', '2026-11-18T09:00:00Z'),
      ],
    });

    await service.forPerson(me(), { period: 7 }, NOW);

    expect(reads.llms.findById.calls).toEqual([['llm-of-a1']]);
  });
});

describe('PersonalStatsService: whose figures', () => {
  it('reads conversations, citations and hand-overs under the chat identity, and ratings under the account', async () => {
    // The Owner: one person with two names. Their conversations are kept
    // under `admin`, the ratings they give under their account id.
    const owner: IStatsViewer = {
      userId: OWNER.id,
      clientId: 'admin',
      caller: person(OWNER),
    };
    const stats = await view(
      {
        hours: [
          hour('c1', 'a1', '2026-11-25T09:00:00Z', 2, 2, 'admin'),
          // Somebody whose identity is the Owner's account id: not theirs.
          hour('c2', 'a1', '2026-11-25T09:00:00Z', 9, 9, OWNER.id),
          hour('c3', 'a1', '2026-11-25T09:00:00Z', 9, 9, ME),
        ],
        ratings: [
          {
            authorId: OWNER.id,
            sessionId: 'c1',
            rating: 1,
            at: '2026-11-25T09:10:00Z',
          },
          {
            authorId: OWNER.id,
            sessionId: 'c1',
            rating: -1,
            at: '2026-11-25T09:20:00Z',
          },
          // Nobody rates as `admin`; a row that says so is not the Owner's.
          {
            authorId: 'admin',
            sessionId: 'c1',
            rating: -1,
            at: '2026-11-25T09:30:00Z',
          },
          {
            authorId: null,
            sessionId: 'c1',
            rating: -1,
            at: '2026-11-25T09:30:00Z',
          },
        ],
        citations: [
          {
            clientId: 'admin',
            agentId: 'a1',
            messageId: 'm1',
            base: 'Legal',
            at: '2026-11-25T09:05:00Z',
          },
          {
            clientId: OWNER.id,
            agentId: 'a1',
            messageId: 'm2',
            base: 'Other',
            at: '2026-11-25T09:05:00Z',
          },
        ],
        handovers: [
          {
            clientId: 'admin',
            agentId: 'a1',
            peerAgentId: 'a2',
            peerName: 'Beacon',
            status: 'answered',
            at: '2026-11-25T09:06:00Z',
          },
          {
            clientId: OWNER.id,
            agentId: 'a1',
            peerAgentId: 'a2',
            peerName: 'Beacon',
            status: 'answered',
            at: '2026-11-25T09:06:00Z',
          },
          {
            clientId: null,
            agentId: 'a1',
            peerAgentId: 'a2',
            peerName: 'Beacon',
            status: 'answered',
            at: '2026-11-25T09:06:00Z',
          },
        ],
      },
      7,
      'UTC',
      owner,
    );

    expect(stats.board.messages.value).toBe(2);
    expect(stats.help.ratings).toEqual({ up: 1, down: 1 });
    expect(stats.help.cited.sources).toEqual([{ name: 'Legal', citations: 1 }]);
    expect(stats.help.handovers.total).toBe(1);
  });

  it('reads an ordinary account under its own id throughout, and only the `bridle` channel', async () => {
    const stats = await view({
      hours: [
        hour('c1', 'a1', '2026-11-25T09:00:00Z', 2),
        { ...hour('c2', 'a1', '2026-11-25T09:00:00Z', 7), channel: 'telegram' },
        hour('c3', 'a1', '2026-11-25T09:00:00Z', 9, 9, 'user-2'),
      ],
      ratings: [
        {
          authorId: ME,
          sessionId: 'c1',
          rating: 1,
          at: '2026-11-25T09:10:00Z',
        },
        {
          authorId: 'user-2',
          sessionId: 'c3',
          rating: -1,
          at: '2026-11-25T09:10:00Z',
        },
      ],
    });

    expect(stats.board.messages.value).toBe(2);
    expect(stats.board.conversations.value).toBe(1);
    expect(stats.help.ratings).toEqual({ up: 1, down: 0 });
  });

  it('gives an agent the person does not reach no part in anything', async () => {
    // Allowed Atlas and Beacon; Cipher exists and is not theirs.
    const { service: access, gateway: lists } = accessHarness([
      'a1',
      'a2',
      'a3',
    ]);
    lists.seed(USER.id, true, [
      { agentId: 'a1', list: 'allowed' },
      { agentId: 'a2', list: 'allowed' },
    ]);
    const limited: IStatsViewer = {
      userId: USER.id,
      clientId: USER.id,
      caller: person(USER),
    };
    const { service, reads } = statsHarness(
      {
        agents: [ATLAS, BEACON, { ...CIPHER, model: 'model-of-cipher' }],
        hours: [
          hour('c1', 'a1', '2026-11-25T09:00:00Z', 2, 2, USER.id),
          // History with an agent since taken away: this period, the one
          // before, and further back on the calendar.
          hour('c9', 'a3', '2026-11-25T11:00:00Z', 8, 8, USER.id),
          hour('c9', 'a3', '2026-11-17T11:00:00Z', 8, 8, USER.id),
          hour('c9', 'a3', '2026-10-01T11:00:00Z', 8, 8, USER.id),
        ],
        ratings: [
          {
            authorId: USER.id,
            sessionId: 'c1',
            rating: 1,
            at: '2026-11-25T09:10:00Z',
          },
          {
            authorId: USER.id,
            sessionId: 'c9',
            rating: -1,
            at: '2026-11-25T11:10:00Z',
          },
        ],
        citations: [
          {
            clientId: USER.id,
            agentId: 'a1',
            messageId: 'm1',
            base: 'Legal',
            at: '2026-11-25T09:05:00Z',
          },
          {
            clientId: USER.id,
            agentId: 'a3',
            messageId: 'm9',
            base: 'Vault',
            at: '2026-11-25T11:05:00Z',
          },
        ],
        handovers: [
          {
            clientId: USER.id,
            agentId: 'a1',
            peerAgentId: 'a2',
            peerName: 'Beacon',
            status: 'answered',
            at: '2026-11-25T09:06:00Z',
          },
          // Asked by the agent they do not reach.
          {
            clientId: USER.id,
            agentId: 'a3',
            peerAgentId: 'a2',
            peerName: 'Beacon',
            status: 'answered',
            at: '2026-11-25T11:06:00Z',
          },
        ],
        usage: [
          { agentId: 'a1', day: '2026-11-25', model: SONNET, calls: 4 },
          {
            agentId: 'a3',
            day: '2026-11-25',
            model: 'model-of-cipher',
            calls: 4,
          },
        ],
      },
      access,
    );

    const stats = await service.forPerson(limited, { period: 7 }, NOW);

    expect(stats.board).toEqual({
      conversations: { value: 1, previous: 0 },
      messages: { value: 2, previous: 0 },
      agents: { value: 1, reachable: 2 },
    });
    expect(stats.activity.days.reduce((s, d) => s + d.conversations, 0)).toBe(
      1,
    );
    expect(stats.agents.map((a) => a.agentId)).toEqual(['a1']);
    expect(stats.help).toEqual({
      cited: { conversations: 1, sources: [{ name: 'Legal', citations: 1 }] },
      handovers: {
        total: 1,
        answered: 1,
        topPeer: { name: 'Beacon', count: 1 },
      },
      ratings: { up: 1, down: 0 },
    });
    expect(stats.models).toEqual({
      items: [{ model: SONNET, messages: 2 }],
      fallback: false,
    });
    const text = JSON.stringify(stats);
    expect(text).not.toContain('a3');
    expect(text).not.toContain('Cipher');
    expect(text).not.toContain('Vault');
    expect(text).not.toContain('model-of-cipher');

    // Each read went out with the person's agents, so the database leaves
    // the others out and nothing here depends on filtering afterwards.
    const scope = { in: ['a1', 'a2'] };
    expect(reads.activity.findHoursForPerson.calls[0][4]).toEqual(scope);
    expect(reads.chats.countFeedbackByAuthor.calls[0][3]).toEqual(scope);
    expect(reads.sources.citedForClient.calls[0][3]).toEqual(scope);
    expect(reads.delegations.countForClient.calls[0][3]).toEqual(scope);
    expect(reads.chats.findSessionsByIds.calls[0][1]).toEqual(scope);
    // Usage is asked for the agents of the person's own period only.
    expect(reads.usage.findRange.calls[0][2]).toEqual(['a1']);
  });

  it('drops an hour of an agent outside reach even if a read hands one back', async () => {
    const { service: access, gateway: lists } = accessHarness(['a1', 'a3']);
    lists.seed(USER.id, false, [{ agentId: 'a3', list: 'denied' }]);
    const { service, reads } = statsHarness(
      {
        agents: [ATLAS, CIPHER],
        hours: [
          hour('c1', 'a1', '2026-11-25T09:00:00Z', 2, 2, USER.id),
          hour('c9', 'a3', '2026-11-25T11:00:00Z', 8, 8, USER.id),
        ],
      },
      access,
    );
    // A gateway that lost its filter: the second lock is in the service.
    const scoped = reads.activity.findHoursForPerson;
    (
      service as unknown as {
        activity: { findHoursForPerson: typeof scoped };
      }
    ).activity = {
      findHoursForPerson: Object.assign(
        (externalUserId: string, channel: string, from: Date, to: Date) =>
          scoped(externalUserId, channel, from, to),
        { calls: scoped.calls },
      ),
    };

    const stats = await service.forPerson(
      { userId: USER.id, clientId: USER.id, caller: person(USER) },
      { period: 7 },
      NOW,
    );

    expect(stats.board.messages.value).toBe(2);
    expect(stats.agents.map((a) => a.agentId)).toEqual(['a1']);
    expect(stats.board.agents).toEqual({ value: 1, reachable: 1 });
  });
});

describe('PersonalStatsService: what it reads', () => {
  it('reads the hours once, from the earlier of the previous period and the calendar, up to now', async () => {
    const readFrom = async (period: 7 | 30 | 90, zone: string) => {
      const { service, reads } = statsHarness({ agents: AGENTS });
      await service.forPerson(me(), { period, timeZone: zone }, NOW);
      expect(reads.activity.findHoursForPerson.calls).toHaveLength(1);
      const [who, channel, from, to] =
        reads.activity.findHoursForPerson.calls[0];
      expect([who, channel, to]).toEqual([ME, 'bridle', NOW]);
      return from.toISOString();
    };

    // 7 and 30 days: the calendar's 91 days reach further back than the
    // previous period does.
    expect(await readFrom(7, 'UTC')).toBe('2026-08-29T00:00:00.000Z');
    expect(await readFrom(30, 'UTC')).toBe('2026-08-29T00:00:00.000Z');
    // 90 days: the previous period begins 180 days back, on 1 June.
    expect(await readFrom(90, 'UTC')).toBe('2026-06-01T00:00:00.000Z');
    // Kyiv was on summer time (UTC+3) on 29 August.
    expect(await readFrom(7, KYIV)).toBe('2026-08-28T21:00:00.000Z');
  });

  it('reads ratings, citations and hand-overs for the period itself, not for the one before', async () => {
    const { service, reads } = statsHarness({ agents: AGENTS });

    await service.forPerson(me(), { period: 7 }, NOW);

    const from = new Date('2026-11-21T00:00:00.000Z');
    expect(reads.chats.countFeedbackByAuthor.calls).toEqual([
      [ME, from, NOW, undefined],
    ]);
    expect(reads.sources.citedForClient.calls).toEqual([
      [ME, from, NOW, undefined],
    ]);
    expect(reads.delegations.countForClient.calls).toEqual([
      [ME, from, NOW, undefined],
    ]);
  });
});

describe('PersonalStatsService: nothing to show', () => {
  it('answers zeros and empty lists, with the calendar whole', async () => {
    const stats = await view({ agents: [ATLAS, BEACON] });

    expect(stats.notes).toEqual([]);
    expect(stats.board).toEqual({
      conversations: { value: 0, previous: 0 },
      messages: { value: 0, previous: 0 },
      agents: { value: 0, reachable: 2 },
    });
    expect(stats.activity.days).toHaveLength(91);
    expect(stats.activity.days.every((d) => d.conversations === 0)).toBe(true);
    expect(stats.activity.weekdays).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(stats.activity.activeDays).toBe(0);
    expect(stats.agents).toEqual([]);
    expect(stats.help).toEqual({
      cited: { conversations: 0, sources: [] },
      handovers: { total: 0, answered: 0, topPeer: null },
      ratings: { up: 0, down: 0 },
    });
    expect(stats.models).toEqual({ items: [], fallback: false });
  });

  it('does not carry the blocks that wait for summaries', async () => {
    const stats = await view({
      hours: [hour('c1', 'a1', '2026-11-25T09:00:00Z')],
    });

    expect(Object.keys(stats).sort()).toEqual([
      'activity',
      'agents',
      'board',
      'help',
      'models',
      'notes',
      'period',
      'range',
      'timeZone',
    ]);
    expect(Object.keys(stats.board).sort()).toEqual([
      'agents',
      'conversations',
      'messages',
    ]);
  });
});

describe('PersonalStatsService: notes', () => {
  it('carries a note for a figure that is complete only from inside the stretch it is shown for', async () => {
    const stats = await view({
      completeSince: {
        // Recorded since three days ago: a 7-day period reaches before it.
        activity: '2026-11-24T08:00:00.000Z',
        // Inside the period itself.
        citations: '2026-11-25T00:00:00.000Z',
        // Long complete.
        ratings: '2026-01-01T00:00:00.000Z',
        // Inside the previous period only. Hand-overs are shown for the
        // period alone, with no comparison, so there is nothing to warn of.
        handovers: '2026-11-16T00:00:00.000Z',
      },
    });

    expect(stats.notes).toEqual([
      {
        figure: 'activity',
        completeSince: new Date('2026-11-24T08:00:00.000Z'),
      },
      {
        figure: 'citations',
        completeSince: new Date('2026-11-25T00:00:00.000Z'),
      },
    ]);
  });

  it('notes activity that the calendar reaches before, though the period and the one before it do not', async () => {
    // Seven days and the seven before them start after this date; the
    // calendar of 13 weeks starts before it.
    const stats = await view({
      completeSince: { activity: '2026-10-20T00:00:00.000Z' },
    });

    expect(stats.notes).toEqual([
      {
        figure: 'activity',
        completeSince: new Date('2026-10-20T00:00:00.000Z'),
      },
    ]);
  });

  it('has none for a figure whose row has not been written yet', async () => {
    expect((await view({ completeSince: {} })).notes).toEqual([]);
  });
});

describe('PersonalStatsService: how agents helped', () => {
  const cite = (
    agentId: string,
    messageId: string,
    base: string | null,
    at: string,
  ) => ({ clientId: ME, agentId, messageId, base, at });

  it('counts the conversations that got an answer with sources, out of the period’s, and names the two most cited sources', async () => {
    const stats = await view({
      hours: [
        hour('c1', 'a1', '2026-11-25T09:00:00Z'),
        // A second conversation with the same agent, after New chat.
        hour('c2', 'a1', '2026-11-26T14:00:00Z'),
        hour('c3', 'a2', '2026-11-26T15:00:00Z'),
      ],
      citations: [
        // One answer citing two documents of one base.
        cite('a1', 'm1', 'Legal', '2026-11-25T09:20:00Z'),
        cite('a1', 'm1', 'Legal', '2026-11-25T09:20:00Z'),
        cite('a1', 'm2', null, '2026-11-25T09:40:00Z'),
        cite('a1', 'm3', 'Handbook', '2026-11-26T14:05:00Z'),
        cite('a1', 'm4', 'Legal', '2026-11-26T14:10:00Z'),
        cite('a1', 'm5', null, '2026-11-26T14:20:00Z'),
      ],
    });

    expect(stats.board.conversations.value).toBe(3);
    expect(stats.help.cited).toEqual({
      conversations: 2,
      sources: [
        { name: 'Legal', citations: 3 },
        { name: 'web', citations: 2 },
      ],
    });
  });

  it('finds the conversation of an answer whose sources were recorded just across the hour from its message', async () => {
    const hours = [hour('c1', 'a1', '2026-11-25T09:00:00Z')];
    // The sources and the message are reported by two events a moment
    // apart; either can fall on the far side of the hour.
    const justAfter = await view({
      hours,
      citations: [cite('a1', 'm1', 'Legal', '2026-11-25T10:00:02Z')],
    });
    const justBefore = await view({
      hours,
      citations: [cite('a1', 'm1', 'Legal', '2026-11-25T08:59:58Z')],
    });

    expect(justAfter.help.cited.conversations).toBe(1);
    expect(justBefore.help.cited.conversations).toBe(1);
  });

  it('does not stretch further than the next hour: an answer two hours on belongs to no conversation it knows', async () => {
    const stats = await view({
      hours: [hour('c1', 'a1', '2026-11-25T09:00:00Z')],
      citations: [cite('a1', 'm1', 'Legal', '2026-11-25T11:30:00Z')],
    });

    expect(stats.help.cited.conversations).toBe(0);
    // The source was cited to this person in the period all the same.
    expect(stats.help.cited.sources).toEqual([{ name: 'Legal', citations: 1 }]);
  });

  it('counts an answer for one conversation when two with that agent share its hour', async () => {
    const stats = await view({
      hours: [
        // New chat pressed inside the hour: both wrote in it.
        hour('c1', 'a1', '2026-11-25T09:00:00Z'),
        hour('c2', 'a1', '2026-11-25T09:00:00Z'),
      ],
      citations: [cite('a1', 'm1', 'Legal', '2026-11-25T09:20:00Z')],
    });

    expect(stats.board.conversations.value).toBe(2);
    expect(stats.help.cited.conversations).toBe(1);
  });

  it('never counts more cited conversations than the period has: one the person did not write in is not theirs to count', async () => {
    const stats = await view({
      hours: [
        hour('c1', 'a1', '2026-11-25T09:00:00Z'),
        // An hour of answers alone, with another agent.
        hour('c2', 'a2', '2026-11-26T09:00:00Z', 0, 1),
      ],
      citations: [
        cite('a1', 'm1', 'Legal', '2026-11-25T09:20:00Z'),
        cite('a2', 'm2', 'Legal', '2026-11-26T09:20:00Z'),
      ],
    });

    expect(stats.board.conversations.value).toBe(1);
    expect(stats.help.cited.conversations).toBe(1);
  });

  it('counts hand-overs, the answered ones and the peer asked most', async () => {
    const handover = (
      peerAgentId: string | null,
      peerName: string,
      status: 'waiting' | 'answered' | 'failed' | 'rejected',
      at: string,
    ) => ({ clientId: ME, agentId: 'a1', peerAgentId, peerName, status, at });
    const stats = await view({
      hours: [hour('c1', 'a1', '2026-11-25T09:00:00Z')],
      handovers: [
        handover('a2', 'Beacon', 'answered', '2026-11-25T09:01:00Z'),
        handover('a2', 'Beacon', 'answered', '2026-11-25T09:02:00Z'),
        handover('a2', 'Beacon', 'failed', '2026-11-25T09:03:00Z'),
        // An agent outside this Ranch.
        handover(null, 'Acme Legal', 'answered', '2026-11-25T09:04:00Z'),
        // Before the period.
        handover('a2', 'Beacon', 'answered', '2026-11-19T09:00:00Z'),
      ],
    });

    expect(stats.help.handovers).toEqual({
      total: 4,
      answered: 3,
      topPeer: { name: 'Beacon', count: 3 },
    });
  });

  it('calls a peer the person does not reach "A colleague", as the chat did, and still counts what it was asked', async () => {
    const { service: access, gateway: lists } = accessHarness([
      'a1',
      'a2',
      'a3',
    ]);
    lists.seed(USER.id, false, [{ agentId: 'a3', list: 'denied' }]);
    const handover = (peerAgentId: string, peerName: string, at: string) => ({
      clientId: USER.id,
      agentId: 'a1',
      peerAgentId,
      peerName,
      status: 'answered' as const,
      at,
    });
    const { service } = statsHarness(
      {
        agents: AGENTS,
        hours: [hour('c1', 'a1', '2026-11-25T09:00:00Z', 1, 1, USER.id)],
        handovers: [
          // Atlas may ask Cipher for anybody; this person may not see it.
          handover('a3', 'Cipher', '2026-11-25T09:01:00Z'),
          handover('a3', 'Cipher', '2026-11-25T09:02:00Z'),
          handover('a2', 'Beacon', '2026-11-25T09:03:00Z'),
        ],
      },
      access,
    );

    const stats = await service.forPerson(
      { userId: USER.id, clientId: USER.id, caller: person(USER) },
      { period: 7 },
      NOW,
    );

    expect(stats.help.handovers).toEqual({
      total: 3,
      answered: 3,
      topPeer: { name: 'A colleague', count: 2 },
    });
    expect(JSON.stringify(stats)).not.toContain('Cipher');
  });

  it('counts the ratings the person gave in the period, up and down', async () => {
    const rate = (
      rating: 1 | -1,
      at: string,
      authorId: string | null = ME,
    ) => ({
      authorId,
      sessionId: 'c1',
      rating,
      at,
    });
    const stats = await view({
      hours: [hour('c1', 'a1', '2026-11-25T09:00:00Z')],
      ratings: [
        rate(1, '2026-11-25T09:10:00Z'),
        rate(1, '2026-11-26T09:10:00Z'),
        rate(-1, '2026-11-27T09:10:00Z'),
        // Before the period, and somebody else's.
        rate(-1, '2026-11-20T23:59:59Z'),
        rate(-1, '2026-11-25T09:10:00Z', 'user-2'),
      ],
    });

    expect(stats.help.ratings).toEqual({ up: 2, down: 1 });
  });
});

describe('PersonalStatsService: which model answered', () => {
  it('gives each day’s messages to the models the agent used that day, and falls back where no day was reported', async () => {
    const { service, reads } = statsHarness({
      agents: AGENTS,
      hours: [
        // Atlas on the 25th: four messages over two hours.
        hour('c1', 'a1', '2026-11-25T09:00:00Z', 3),
        hour('c1', 'a1', '2026-11-25T10:00:00Z', 1),
        // Atlas today: nothing reported yet.
        hour('c1', 'a1', '2026-11-27T09:00:00Z', 2),
        // Cipher has no model and reported nothing.
        hour('c2', 'a3', '2026-11-26T09:00:00Z', 1),
        // Answers alone attribute nothing: these are the person's messages.
        hour('c3', 'a2', '2026-11-26T09:00:00Z', 0, 6),
      ],
      usage: [
        // Calls 3 to 1: four messages split 3 and 1.
        { agentId: 'a1', day: '2026-11-25', model: SONNET, calls: 30 },
        { agentId: 'a1', day: '2026-11-25', model: HAIKU, calls: 10 },
        // Another agent's day says nothing about Atlas.
        { agentId: 'a2', day: '2026-11-27', model: HAIKU, calls: 99 },
      ],
    });

    const stats = await service.forPerson(me(), { period: 7 }, NOW);

    expect(stats.models).toEqual({
      items: [
        { model: SONNET, messages: 5 },
        { model: HAIKU, messages: 1 },
        { model: 'unknown', messages: 1 },
      ],
      fallback: true,
    });
    // The UTC days the period touches, for the agents written to.
    expect(reads.usage.findRange.calls).toEqual([
      [
        new Date('2026-11-21T00:00:00.000Z'),
        new Date('2026-11-28T00:00:00.000Z'),
        ['a1', 'a3'],
      ],
    ]);
  });

  it('matches a message with the usage of its UTC day, whatever the viewer’s day is', async () => {
    const { service, reads } = statsHarness({
      agents: AGENTS,
      hours: [
        // 22:00 UTC on the 20th: the 21st in Kyiv, inside a 7-day period
        // there, and the 20th for the agent's usage.
        hour('c1', 'a1', '2026-11-20T22:00:00Z', 2),
      ],
      usage: [{ agentId: 'a1', day: '2026-11-20', model: HAIKU, calls: 5 }],
    });

    const stats = await service.forPerson(
      me(),
      { period: 7, timeZone: KYIV },
      NOW,
    );

    expect(stats.models).toEqual({
      items: [{ model: HAIKU, messages: 2 }],
      fallback: false,
    });
    expect(reads.usage.findRange.calls[0][0]).toEqual(
      new Date('2026-11-20T00:00:00.000Z'),
    );
  });

  it('adds up to the person’s messages of the period', async () => {
    const stats = await view({
      hours: [
        hour('c1', 'a1', '2026-11-25T09:00:00Z', 7),
        hour('c2', 'a2', '2026-11-26T09:00:00Z', 5),
        hour('c3', 'a3', '2026-11-27T09:00:00Z', 3),
      ],
      usage: [
        { agentId: 'a1', day: '2026-11-25', model: SONNET, calls: 2 },
        { agentId: 'a1', day: '2026-11-25', model: HAIKU, calls: 5 },
      ],
    });

    expect(
      stats.models.items.reduce((sum, item) => sum + item.messages, 0),
    ).toBe(stats.board.messages.value);
  });
});
