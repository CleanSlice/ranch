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
  IWorldSummary,
  IWorldTopic,
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
        resolved: 0,
        summarised: 0,
        model: HAIKU,
        lastMessageAt: new Date('2026-11-26T10:59:00.000Z'),
      },
      // Three messages each: equal ones by name.
      {
        agentId: 'a1',
        name: 'Atlas',
        messages: 3,
        conversations: 2,
        resolved: 0,
        summarised: 0,
        model: SONNET,
        // The later of its two conversations.
        lastMessageAt: new Date('2026-11-26T09:12:30.000Z'),
      },
      {
        agentId: 'a3',
        name: 'Cipher',
        messages: 3,
        conversations: 1,
        resolved: 0,
        summarised: 0,
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
      resolved: { resolved: 0, summarised: 0 },
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
      resolved: { resolved: 0, summarised: 0 },
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
    // And of the blocks that are read from summaries, when there are none
    // to read: the same shapes, empty.
    expect(stats.summaries).toEqual({
      enabled: false,
      summarised: 0,
      waiting: 0,
      tooShort: 0,
    });
    expect(stats.topics).toEqual([]);
    expect(stats.outcome).toEqual({
      resolved: 0,
      open: 0,
      unknown: 0,
      notSummarised: 0,
      sentiment: { positive: 0, neutral: 0, mixed: 0, negative: 0 },
      languages: [],
    });
    expect(stats.openQuestions).toEqual({ items: [], more: 0 });
  });

  it('answers exactly the blocks of the contract, and no other', async () => {
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
      'openQuestions',
      'outcome',
      'period',
      'range',
      'summaries',
      'timeZone',
      'topics',
    ]);
    expect(Object.keys(stats.board).sort()).toEqual([
      'agents',
      'conversations',
      'messages',
      'resolved',
    ]);
  });
});

/**
 * Story 3 (CLEAN-270): what the person asks about and how it ends, read
 * from the summaries of their conversations of the period. The world below
 * is one person's week with three agents: six conversations, four of them
 * summarised.
 */
describe('PersonalStatsService: what the summaries say', () => {
  const BILLING: IWorldTopic = {
    id: 't-billing',
    key: 'billing',
    labels: { en: 'Billing', ru: 'Оплата' },
  };
  const VACATION: IWorldTopic = {
    id: 't-vacation',
    key: 'vacation',
    // Coined before the console had Russian.
    labels: { en: 'Vacation' },
  };
  // Folded into Billing by an operator.
  const INVOICES: IWorldTopic = {
    id: 't-invoices',
    key: 'invoices',
    labels: { en: 'Invoices', ru: 'Счета' },
    mergedIntoId: 't-billing',
  };

  const done = (
    at: string,
    over: Partial<IWorldSummary> = {},
  ): IWorldSummary => ({
    summaryAt: at,
    outcome: 'resolved',
    question: null,
    topicIds: [],
    sentiment: 'neutral',
    language: 'en',
    ...over,
  });

  const WEEK: Partial<IStatsWorld> = {
    summaries: true,
    topics: [BILLING, VACATION, INVOICES],
    hours: [
      hour('c1', 'a1', '2026-11-25T09:00:00Z', 4),
      hour('c2', 'a1', '2026-11-26T09:00:00Z', 3),
      hour('c3', 'a2', '2026-11-26T14:00:00Z', 5),
      hour('c4', 'a2', '2026-11-24T10:00:00Z', 3),
      // Three messages, quiet since: its summary is still to come.
      hour('c5', 'a1', '2026-11-23T10:00:00Z', 3),
      // Two messages: under the three a summary is made with.
      hour('c6', 'a3', '2026-11-22T10:00:00Z', 2),
    ],
    lastMessageAt: {
      c1: '2026-11-25T09:40:00.000Z',
      c2: '2026-11-26T09:30:00.000Z',
      c3: '2026-11-26T14:20:00.000Z',
      c4: '2026-11-24T10:10:00.000Z',
    },
    summarised: {
      c1: done('2026-11-25T11:00:00Z', {
        question: 'How do I change my plan?',
        topicIds: ['t-billing'],
        sentiment: 'positive',
      }),
      c2: done('2026-11-26T11:00:00Z', {
        outcome: 'open',
        question: 'Почему счёт выставлен дважды?',
        topicIds: ['t-invoices'],
        sentiment: 'negative',
        language: 'ru',
      }),
      c3: done('2026-11-26T16:00:00Z', {
        outcome: 'unknown',
        question: 'How many vacation days are left?',
        topicIds: ['t-vacation'],
        sentiment: 'mixed',
      }),
      // Summarised with no topic and no question.
      c4: done('2026-11-24T12:00:00Z'),
    },
  };

  it('says whether summaries are produced, and of the period’s conversations how many have one, wait for one or are too short for one', async () => {
    const stats = await view(WEEK);

    expect(stats.board.conversations.value).toBe(6);
    expect(stats.summaries).toEqual({
      enabled: true,
      summarised: 4,
      waiting: 1,
      tooShort: 1,
    });
    // The three are the period's conversations, each in one of them.
    const { summarised, waiting, tooShort } = stats.summaries;
    expect(summarised + waiting + tooShort).toBe(
      stats.board.conversations.value,
    );
  });

  it('calls a conversation too short by the person’s messages in all of it: under three', async () => {
    const stats = await view({
      summaries: true,
      hours: [
        hour('two', 'a1', '2026-11-25T09:00:00Z', 2),
        hour('three', 'a1', '2026-11-25T10:00:00Z', 3),
        // One message this week, five before it: long enough.
        hour('long', 'a1', '2026-11-25T11:00:00Z', 1),
        hour('long', 'a1', '2026-11-10T11:00:00Z', 5),
        // One message in it, and many answers.
        hour('one', 'a1', '2026-11-25T12:00:00Z', 1, 9),
      ],
    });

    expect(stats.summaries).toEqual({
      enabled: true,
      summarised: 0,
      waiting: 2,
      tooShort: 2,
    });
  });

  it('puts the resolved share on the board: resolved, out of the summarised', async () => {
    const stats = await view(WEEK);

    expect(stats.board.resolved).toEqual({ resolved: 2, summarised: 4 });
  });

  it('gives each agent its resolved and summarised conversations', async () => {
    const stats = await view(WEEK);

    expect(
      stats.agents.map((a) => [
        a.agentId,
        a.conversations,
        a.resolved,
        a.summarised,
      ]),
    ).toEqual([
      ['a1', 3, 1, 2],
      ['a2', 2, 1, 2],
      ['a3', 1, 0, 0],
    ]);
  });

  it('counts how the period’s conversations ended, in parts that add up to them', async () => {
    const stats = await view(WEEK);

    expect(stats.outcome).toEqual({
      resolved: 2,
      open: 1,
      unknown: 1,
      notSummarised: 2,
      sentiment: { positive: 1, neutral: 1, mixed: 1, negative: 1 },
      languages: [
        { code: 'en', conversations: 3 },
        { code: 'ru', conversations: 1 },
      ],
    });
    const { resolved, open, unknown, notSummarised } = stats.outcome;
    expect(resolved + open + unknown + notSummarised).toBe(
      stats.board.conversations.value,
    );
  });

  it('keeps `unknown` out of the resolved and out of the open questions', async () => {
    const stats = await view(WEEK);

    // c3 could not be told: one of the four summarised, in neither part.
    expect(stats.outcome.unknown).toBe(1);
    expect(stats.board.resolved.resolved).toBe(2);
    expect(stats.openQuestions.items.map((q) => q.chatId)).toEqual(['c2']);
    const vacation = stats.topics.find((t) => t.id === 't-vacation');
    expect(vacation).toMatchObject({ conversations: 1, resolved: 0, open: 0 });
    // Its question is still listed under its topic, marked as it is.
    expect(vacation?.questions.map((q) => q.outcome)).toEqual(['unknown']);
  });

  it('reads a summary that carries no outcome as one that could not tell', async () => {
    const stats = await view({
      summaries: true,
      hours: [hour('c1', 'a1', '2026-11-25T09:00:00Z', 4)],
      // Written by the release before the outcome was a column.
      summarised: { c1: { summaryAt: '2026-11-25T11:00:00Z' } },
    });

    expect(stats.outcome).toMatchObject({
      resolved: 0,
      open: 0,
      unknown: 1,
      notSummarised: 0,
    });
    // No tone and no language were stored: counted under none.
    expect(stats.outcome.sentiment).toEqual({
      positive: 0,
      neutral: 0,
      mixed: 0,
      negative: 0,
    });
    expect(stats.outcome.languages).toEqual([]);
  });

  it('lists topics by conversations, a merged one under the topic it was folded into, each with its resolved and open parts', async () => {
    const stats = await view(WEEK);

    expect(
      stats.topics.map((t) => [
        t.id,
        t.label,
        t.conversations,
        t.resolved,
        t.open,
      ]),
    ).toEqual([
      // c1, and c2 through `invoices`.
      ['t-billing', 'Billing', 2, 1, 1],
      ['t-vacation', 'Vacation', 1, 0, 0],
    ]);
    expect(JSON.stringify(stats.topics)).not.toContain('Invoices');
  });

  it('counts a conversation once under a topic it carries twice over: by itself and by one folded into it', async () => {
    const stats = await view({
      ...WEEK,
      summarised: {
        ...WEEK.summarised,
        c1: done('2026-11-25T11:00:00Z', {
          topicIds: ['t-invoices', 't-billing'],
        }),
      },
    });

    expect(stats.topics.find((t) => t.id === 't-billing')?.conversations).toBe(
      2,
    );
  });

  it('names a topic in the language asked for, in English when it has no label in it, and by its key when it has neither', async () => {
    const labels = async (language?: string) =>
      (
        await statsHarness({
          agents: AGENTS,
          ...WEEK,
          topics: [
            BILLING,
            VACATION,
            INVOICES,
            { id: 't-bare', key: 'bare-key', labels: {} },
          ],
          summarised: {
            ...WEEK.summarised,
            c4: done('2026-11-24T12:00:00Z', { topicIds: ['t-bare'] }),
          },
        }).service.forPerson(me(), { period: 7, language }, NOW)
      ).topics.map((t) => t.label);

    expect(await labels('ru')).toEqual(['Оплата', 'bare-key', 'Vacation']);
    expect(await labels('en')).toEqual(['Billing', 'bare-key', 'Vacation']);
    // No language given: a tool call, which has no `Accept-Language`.
    expect(await labels()).toEqual(['Billing', 'bare-key', 'Vacation']);
  });

  it('lists at most eight topics, the most used, equal ones by label', async () => {
    const topics = Array.from({ length: 10 }, (_, i) => ({
      id: `t${i}`,
      key: `key-${i}`,
      labels: { en: `Topic ${String.fromCharCode(74 - i)}` },
    }));
    // Conversation i carries topic i; the first two topics have one more.
    const sessions = [...topics.map((t) => t.id), 't0', 't1'];
    const stats = await view({
      summaries: true,
      topics,
      hours: sessions.map((_, i) =>
        hour(`c${i}`, 'a1', '2026-11-25T09:00:00Z', 3),
      ),
      summarised: Object.fromEntries(
        sessions.map((topicId, i) => [
          `c${i}`,
          done('2026-11-25T11:00:00Z', { topicIds: [topicId] }),
        ]),
      ),
    });

    expect(stats.topics).toHaveLength(8);
    expect(stats.topics.map((t) => [t.label, t.conversations])).toEqual([
      // Two conversations each, by label: I before J.
      ['Topic I', 2],
      ['Topic J', 2],
      // Then the ones with one, by label; G and H are the two left out.
      ['Topic A', 1],
      ['Topic B', 1],
      ['Topic C', 1],
      ['Topic D', 1],
      ['Topic E', 1],
      ['Topic F', 1],
    ]);
  });

  it('gives a topic its main questions: up to four, each once, newest first, with the agent, the time and how it ended', async () => {
    const asked = (
      n: number,
      question: string | null,
      over: Partial<IWorldSummary> = {},
    ) =>
      [
        `q${n}`,
        done('2026-11-27T08:00:00Z', {
          question,
          topicIds: ['t-billing'],
          ...over,
        }),
      ] as const;
    const stats = await view({
      summaries: true,
      topics: [BILLING],
      // q1 is the oldest, q7 the newest.
      hours: [1, 2, 3, 4, 5, 6, 7].map((n) =>
        hour(`q${n}`, n === 7 ? 'a2' : 'a1', `2026-11-2${n}T09:00:00Z`, 3),
      ),
      lastMessageAt: Object.fromEntries(
        [1, 2, 3, 4, 5, 6, 7].map((n) => [`q${n}`, `2026-11-2${n}T09:30:00Z`]),
      ),
      summarised: Object.fromEntries([
        asked(1, 'The oldest question'),
        asked(2, 'How do I get a refund?'),
        asked(3, 'Where is my invoice?', { outcome: 'open' }),
        // The same words as a newer conversation: shown once, the newer.
        asked(4, 'how do I change my plan? '),
        // No question: nothing to list, and it does not take a place.
        asked(5, null),
        asked(6, 'How do I change my plan?', { outcome: 'unknown' }),
        asked(7, 'Is VAT included?'),
      ]),
    });

    const [billing] = stats.topics;
    expect(billing.conversations).toBe(7);
    expect(billing.questions).toEqual([
      {
        chatId: 'q7',
        agentId: 'a2',
        agentName: 'Beacon',
        question: 'Is VAT included?',
        at: new Date('2026-11-27T09:30:00Z'),
        outcome: 'resolved',
      },
      {
        chatId: 'q6',
        agentId: 'a1',
        agentName: 'Atlas',
        question: 'How do I change my plan?',
        at: new Date('2026-11-26T09:30:00Z'),
        outcome: 'unknown',
      },
      {
        chatId: 'q3',
        agentId: 'a1',
        agentName: 'Atlas',
        question: 'Where is my invoice?',
        at: new Date('2026-11-23T09:30:00Z'),
        outcome: 'open',
      },
      {
        chatId: 'q2',
        agentId: 'a1',
        agentName: 'Atlas',
        question: 'How do I get a refund?',
        at: new Date('2026-11-22T09:30:00Z'),
        outcome: 'resolved',
      },
    ]);
  });

  it('lists the open questions newest first, four of them, and says how many more there are', async () => {
    const open = (n: number, over: Partial<IWorldSummary> = {}) =>
      [
        `o${n}`,
        done('2026-11-27T08:00:00Z', {
          outcome: 'open',
          question: `Question ${n}`,
          ...over,
        }),
      ] as const;
    const stats = await view({
      summaries: true,
      topics: [BILLING, INVOICES],
      hours: [1, 2, 3, 4, 5, 6].map((n) =>
        hour(`o${n}`, n === 6 ? 'a2' : 'a1', `2026-11-2${n}T09:00:00Z`, 3),
      ),
      lastMessageAt: Object.fromEntries(
        [1, 2, 3, 4, 5, 6].map((n) => [`o${n}`, `2026-11-2${n}T09:30:00Z`]),
      ),
      summarised: Object.fromEntries([
        open(1),
        open(2),
        open(3, { topicIds: ['t-invoices'] }),
        // Left open, and the summary found no question to quote.
        open(4, { question: null }),
        open(5),
        open(6, { topicIds: ['t-billing'] }),
      ]),
    });

    expect(stats.openQuestions).toEqual({
      items: [
        {
          chatId: 'o6',
          agentId: 'a2',
          agentName: 'Beacon',
          question: 'Question 6',
          topic: 'Billing',
          at: new Date('2026-11-26T09:30:00Z'),
        },
        {
          chatId: 'o5',
          agentId: 'a1',
          agentName: 'Atlas',
          question: 'Question 5',
          topic: null,
          at: new Date('2026-11-25T09:30:00Z'),
        },
        {
          chatId: 'o4',
          agentId: 'a1',
          agentName: 'Atlas',
          question: null,
          topic: null,
          at: new Date('2026-11-24T09:30:00Z'),
        },
        {
          chatId: 'o3',
          agentId: 'a1',
          agentName: 'Atlas',
          question: 'Question 3',
          // Under the topic its own was folded into.
          topic: 'Billing',
          at: new Date('2026-11-23T09:30:00Z'),
        },
      ],
      more: 2,
    });
    // The list and its remainder are the open part of the outcome.
    expect(stats.openQuestions.items.length + stats.openQuestions.more).toBe(
      stats.outcome.open,
    );
  });

  it('says there are none when nothing was left open', async () => {
    const stats = await view({
      summaries: true,
      hours: [hour('c1', 'a1', '2026-11-25T09:00:00Z', 4)],
      summarised: { c1: done('2026-11-25T11:00:00Z') },
    });

    expect(stats.openQuestions).toEqual({ items: [], more: 0 });
  });

  it('counts the period’s conversations only: one written in before it is in no part', async () => {
    const stats = await view({
      summaries: true,
      topics: [BILLING],
      hours: [
        hour('now', 'a1', '2026-11-25T09:00:00Z', 4),
        hour('before', 'a1', '2026-11-18T09:00:00Z', 4),
      ],
      summarised: {
        now: done('2026-11-25T11:00:00Z'),
        before: done('2026-11-18T11:00:00Z', {
          outcome: 'open',
          question: 'An older question',
          topicIds: ['t-billing'],
        }),
      },
    });

    expect(stats.summaries.summarised).toBe(1);
    expect(stats.outcome).toMatchObject({ resolved: 1, open: 0 });
    expect(stats.topics).toEqual([]);
    expect(JSON.stringify(stats)).not.toContain('An older question');
  });

  // docs/statistics.md: a page view never looks through `ChatSession` for
  // conversations. The summaries are read by id, the ids the person's own
  // hour rows of the period named, and the topics by the ids those
  // conversations carry.
  it('reads the summaries of the period’s conversations by id, once, and the topics those carry', async () => {
    const { service, reads } = statsHarness({ agents: AGENTS, ...WEEK });

    await service.forPerson(me(), { period: 7 }, NOW);

    expect(reads.chats.findOutcomesForSessions.calls).toHaveLength(1);
    const [ids, scope] = reads.chats.findOutcomesForSessions.calls[0];
    expect([...ids].sort()).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6']);
    expect(scope).toBeUndefined();
    // One read of the conversations, not two: it also says which agent each
    // is with and when it last moved.
    expect(reads.chats.findSessionsByIds.calls).toHaveLength(0);
    expect(reads.topics.findByIds.calls).toHaveLength(1);
    expect([...reads.topics.findByIds.calls[0][0]].sort()).toEqual([
      't-billing',
      't-invoices',
      't-vacation',
    ]);
  });

  it('asks for no topic when no conversation carries one', async () => {
    const { service, reads } = statsHarness({
      agents: AGENTS,
      summaries: true,
      hours: [hour('c1', 'a1', '2026-11-25T09:00:00Z', 4)],
      summarised: { c1: done('2026-11-25T11:00:00Z') },
    });

    await service.forPerson(me(), { period: 7 }, NOW);

    expect(reads.topics.findByIds.calls).toHaveLength(0);
  });

  // FR-033: the main question is the person's own words, shown to its
  // owner and to nobody else. Whose conversations are read is decided by
  // the hours, which are read under the person's identity.
  it('shows a person their own questions and nobody else’s', async () => {
    const stats = await view({
      ...WEEK,
      hours: [
        ...(WEEK.hours ?? []),
        hour('theirs', 'a1', '2026-11-25T09:00:00Z', 4, 4, 'user-2'),
        hour('owners', 'a1', '2026-11-25T09:00:00Z', 4, 4, 'admin'),
      ],
      summarised: {
        ...WEEK.summarised,
        theirs: done('2026-11-25T11:00:00Z', {
          outcome: 'open',
          question: 'What somebody else asked',
          topicIds: ['t-billing'],
        }),
        owners: done('2026-11-25T11:00:00Z', {
          outcome: 'open',
          question: 'What the Owner asked',
          topicIds: ['t-vacation'],
        }),
      },
    });

    const text = JSON.stringify(stats);
    expect(text).toContain('How do I change my plan?');
    expect(text).not.toContain('What somebody else asked');
    expect(text).not.toContain('What the Owner asked');
    expect(text).not.toContain('theirs');
    expect(stats.summaries.summarised).toBe(4);
    expect(stats.outcome.open).toBe(1);
  });

  it('leaves the summaries of an agent the person no longer reaches out of every part', async () => {
    const { service: access, gateway: lists } = accessHarness([
      'a1',
      'a2',
      'a3',
    ]);
    lists.seed(USER.id, false, [{ agentId: 'a2', list: 'denied' }]);
    const mine = (h: IWorldHour): IWorldHour => ({
      ...h,
      externalUserId: USER.id,
    });
    const { service, reads } = statsHarness(
      { agents: AGENTS, ...WEEK, hours: (WEEK.hours ?? []).map(mine) },
      access,
    );

    const stats = await service.forPerson(
      { userId: USER.id, clientId: USER.id, caller: person(USER) },
      { period: 7 },
      NOW,
    );

    // c3 and c4 were with Beacon.
    expect(stats.summaries).toEqual({
      enabled: true,
      summarised: 2,
      waiting: 1,
      tooShort: 1,
    });
    expect(stats.topics.map((t) => t.id)).toEqual(['t-billing']);
    const text = JSON.stringify(stats);
    expect(text).not.toContain('vacation days');
    expect(text).not.toContain('Beacon');
    expect(reads.chats.findOutcomesForSessions.calls[0][1]).toEqual({
      notIn: ['a2'],
    });
  });
});

/**
 * The ordinary installation produces no summaries: no interval, or no
 * credential (our own production had one summarised conversation of 204
 * when this was written). The page then shows one card where three blocks
 * would be, and nothing about summaries is computed, whatever rows a summary
 * made by hand has left behind.
 */
describe('PersonalStatsService: an installation that produces no summaries', () => {
  const OFF: Partial<IStatsWorld> = {
    summaries: false,
    topics: [{ id: 't-billing', key: 'billing', labels: { en: 'Billing' } }],
    hours: [
      hour('c1', 'a1', '2026-11-25T09:00:00Z', 4),
      hour('c2', 'a1', '2026-11-26T09:00:00Z', 4),
    ],
    // One summary, made with the button in the admin console.
    summarised: {
      c1: {
        summaryAt: '2026-11-25T11:00:00Z',
        outcome: 'open',
        question: 'A question from a summary made by hand',
        topicIds: ['t-billing'],
        sentiment: 'negative',
        language: 'en',
      },
    },
  };

  it('says so, and answers the four parts empty', async () => {
    const stats = await view(OFF);

    expect(stats.summaries).toEqual({
      enabled: false,
      summarised: 0,
      waiting: 0,
      tooShort: 0,
    });
    expect(stats.board.resolved).toEqual({ resolved: 0, summarised: 0 });
    expect(stats.topics).toEqual([]);
    expect(stats.outcome).toEqual({
      resolved: 0,
      open: 0,
      unknown: 0,
      notSummarised: 0,
      sentiment: { positive: 0, neutral: 0, mixed: 0, negative: 0 },
      languages: [],
    });
    expect(stats.openQuestions).toEqual({ items: [], more: 0 });
    expect(stats.agents.map((a) => [a.resolved, a.summarised])).toEqual([
      [0, 0],
    ]);
    expect(JSON.stringify(stats)).not.toContain('made by hand');
  });

  it('keeps every other block as it is', async () => {
    const stats = await view(OFF);

    expect(stats.board.conversations.value).toBe(2);
    expect(stats.board.messages.value).toBe(8);
    expect(stats.agents.map((a) => a.agentId)).toEqual(['a1']);
    expect(stats.agents[0].lastMessageAt).toEqual(
      new Date('2026-11-26T09:59:59.999Z'),
    );
  });

  it('computes nothing for them: no summary and no topic is read', async () => {
    const { service, reads } = statsHarness({ agents: AGENTS, ...OFF });

    await service.forPerson(me(), { period: 7 }, NOW);

    expect(reads.insight.isEnabled.calls).toHaveLength(1);
    expect(reads.chats.findOutcomesForSessions.calls).toHaveLength(0);
    expect(reads.topics.findByIds.calls).toHaveLength(0);
    // The conversations are read as before, for the last contact alone.
    expect(reads.chats.findSessionsByIds.calls).toHaveLength(1);
  });
});

describe('PersonalStatsService: notes', () => {
  it('carries a note for activity recorded only from inside the stretch it is shown for', async () => {
    const stats = await view({
      completeSince: {
        // Recorded since three days ago: a 7-day period reaches before it.
        activity: '2026-11-24T08:00:00.000Z',
      },
    });

    expect(stats.notes).toEqual([
      {
        figure: 'activity',
        completeSince: new Date('2026-11-24T08:00:00.000Z'),
      },
    ]);
  });

  it('has none for activity recorded since before everything that is shown', async () => {
    // Before the 91 days of the calendar, which reach furthest back.
    const stats = await view({
      completeSince: { activity: '2026-08-01T00:00:00.000Z' },
    });

    expect(stats.notes).toEqual([]);
  });

  // CLEAN-262. Ratings, citations and hand-overs are read in place: their
  // rows are the source, so no rating before some day means nobody rated
  // before it, and there is nothing to warn of. The release before the fix
  // wrote a row for each of them, and one of those may still be there.
  it('carries none for a help figure, even when a stale row for it exists', async () => {
    const stats = await view({
      completeSince: {
        activity: '2026-11-24T08:00:00.000Z',
        // Each inside the period itself, where a note would be given if
        // these rows were read.
        citations: '2026-11-25T00:00:00.000Z',
        ratings: '2026-11-26T09:00:00.000Z',
        handovers: '2026-11-27T10:00:00.000Z',
      },
    });

    expect(stats.notes).toEqual([
      {
        figure: 'activity',
        completeSince: new Date('2026-11-24T08:00:00.000Z'),
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
