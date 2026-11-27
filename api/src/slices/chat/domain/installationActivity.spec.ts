import {
  activityChannelOf,
  agentScopeCondition,
  conversationsFromRows,
  outcomesFromRows,
  peopleFromRows,
} from './installationActivity';

describe('agentScopeCondition: a reach as the query must apply it', () => {
  it('has no condition when nothing is hidden from the caller', () => {
    expect(agentScopeCondition(undefined)).toEqual({
      matchesAny: true,
      in: null,
      notIn: null,
    });
  });

  it('keeps a caller limited to a list to that list', () => {
    expect(agentScopeCondition({ in: ['a1', 'a2'] })).toEqual({
      matchesAny: true,
      in: ['a1', 'a2'],
      notIn: null,
    });
  });

  // `IN ()` is not SQL, and "no agent" must never be read as "no filter".
  it('matches nothing for a caller whose list is empty, so no query is run', () => {
    expect(agentScopeCondition({ in: [] })).toEqual({
      matchesAny: false,
      in: null,
      notIn: null,
    });
    // An exclusion beside an empty list changes nothing: still no agent.
    expect(agentScopeCondition({ in: [], notIn: ['a1'] }).matchesAny).toBe(
      false,
    );
  });

  it('leaves out the denied agents of a caller who is not limited', () => {
    expect(agentScopeCondition({ notIn: ['a3'] })).toEqual({
      matchesAny: true,
      in: null,
      notIn: ['a3'],
    });
  });

  // What `AgentReach.where()` answers for a caller whose only hidden agent
  // went away: an empty exclusion. Prisma reads `notIn: []` as every agent.
  it('has no condition for an empty exclusion', () => {
    expect(agentScopeCondition({ notIn: [] })).toEqual({
      matchesAny: true,
      in: null,
      notIn: null,
    });
    expect(agentScopeCondition({})).toEqual({
      matchesAny: true,
      in: null,
      notIn: null,
    });
  });

  it('applies both when both are given, as Prisma does', () => {
    expect(agentScopeCondition({ in: ['a1', 'a2'], notIn: ['a2'] })).toEqual({
      matchesAny: true,
      in: ['a1', 'a2'],
      notIn: ['a2'],
    });
  });

  it('names each agent once', () => {
    expect(agentScopeCondition({ in: ['a1', 'a1', 'a2'] }).in).toEqual([
      'a1',
      'a2',
    ]);
    expect(agentScopeCondition({ notIn: ['a3', 'a3'] }).notIn).toEqual(['a3']);
  });
});

describe('activityChannelOf: where people write from', () => {
  it('reads the console chat as `console`', () => {
    expect(activityChannelOf('bridle', false)).toBe('console');
  });

  it('reads a share visitor on the console chat as `share`', () => {
    expect(activityChannelOf('bridle', true)).toBe('share');
  });

  it('keeps the messengers under their own names', () => {
    expect(activityChannelOf('telegram', false)).toBe('telegram');
    expect(activityChannelOf('slack', false)).toBe('slack');
  });

  // An identity that happens to start with `share-` on a messenger is not a
  // share link: the link only exists on the console chat.
  it('does not read a messenger identity as a share visitor', () => {
    expect(activityChannelOf('telegram', true)).toBe('telegram');
    expect(activityChannelOf('slack', true)).toBe('slack');
  });

  it('reads anything else as `other`', () => {
    expect(activityChannelOf('whatsapp', false)).toBe('other');
    expect(activityChannelOf('', false)).toBe('other');
    expect(activityChannelOf('Bridle', false)).toBe('other');
    expect(activityChannelOf('whatsapp', true)).toBe('other');
  });
});

describe('conversationsFromRows: what the query answered, as numbers by agent and channel', () => {
  // COUNT comes back from Postgres as a bigint.
  it('turns each count into a number', () => {
    expect(
      conversationsFromRows([
        { agentId: 'a1', channel: 'bridle', share: false, conversations: 12n },
        { agentId: 'a1', channel: 'telegram', share: false, conversations: 3n },
      ]),
    ).toEqual([
      { agentId: 'a1', channel: 'console', conversations: 12 },
      { agentId: 'a1', channel: 'telegram', conversations: 3 },
    ]);
  });

  it('keeps share visitors apart from the console for the same agent', () => {
    expect(
      conversationsFromRows([
        { agentId: 'a1', channel: 'bridle', share: false, conversations: 5n },
        { agentId: 'a1', channel: 'bridle', share: true, conversations: 2n },
      ]),
    ).toEqual([
      { agentId: 'a1', channel: 'console', conversations: 5 },
      { agentId: 'a1', channel: 'share', conversations: 2 },
    ]);
  });

  // A conversation is in exactly one row (it has one agent, one channel and
  // one identity), so rows that land in one bucket are added, never merged.
  it('adds the rows that fall into one bucket', () => {
    expect(
      conversationsFromRows([
        { agentId: 'a1', channel: 'whatsapp', share: false, conversations: 2n },
        { agentId: 'a1', channel: 'email', share: false, conversations: 1n },
        { agentId: 'a1', channel: 'email', share: true, conversations: 4n },
        { agentId: 'a2', channel: 'email', share: false, conversations: 7n },
      ]),
    ).toEqual([
      { agentId: 'a1', channel: 'other', conversations: 7 },
      { agentId: 'a2', channel: 'other', conversations: 7 },
    ]);
  });

  it('orders by agent and then by channel, so the same rows give the same answer', () => {
    expect(
      conversationsFromRows([
        { agentId: 'a2', channel: 'slack', share: false, conversations: 1 },
        { agentId: 'a1', channel: 'telegram', share: false, conversations: 1 },
        { agentId: 'a1', channel: 'bridle', share: false, conversations: 1 },
      ]).map((row) => `${row.agentId}:${row.channel}`),
    ).toEqual(['a1:console', 'a1:telegram', 'a2:slack']);
  });

  it('answers nothing for nothing', () => {
    expect(conversationsFromRows([])).toEqual([]);
  });
});

// The rows of the conversations statement carry two counts more when the
// outcomes were asked for (CLEAN-270): how many of the row's conversations
// have a summary, and how many of those were left open.
describe('outcomesFromRows: how the conversations of each agent ended, as numbers', () => {
  const row = (
    agentId: string,
    channel: string,
    conversations: bigint,
    summarised?: bigint,
    open?: bigint,
  ) => ({ agentId, channel, share: false, conversations, summarised, open });

  it('adds an agent’s channels together, as numbers, by agent id', () => {
    expect(
      outcomesFromRows([
        row('a2', 'telegram', 50n, 40n, 0n),
        row('a1', 'bridle', 400n, 280n, 20n),
        row('a1', 'slack', 30n, 20n, 1n),
        { ...row('a1', 'bridle', 9n, 0n, 0n), share: true },
      ]),
    ).toEqual([
      { agentId: 'a1', summarised: 300, open: 21 },
      { agentId: 'a2', summarised: 40, open: 0 },
    ]);
  });

  it('leaves out an agent none of whose conversations has a summary', () => {
    expect(
      outcomesFromRows([
        row('a1', 'bridle', 400n, 0n, 0n),
        row('a2', 'bridle', 5n, 1n, 1n),
      ]),
    ).toEqual([{ agentId: 'a2', summarised: 1, open: 1 }]);
  });

  // The statement as it runs where summaries are off has no such columns.
  it('answers nothing for rows that carry no outcome, and for no rows', () => {
    expect(outcomesFromRows([row('a1', 'bridle', 400n)])).toEqual([]);
    expect(outcomesFromRows([])).toEqual([]);
  });
});

describe('peopleFromRows: the two counts of distinct people', () => {
  it('turns the one row into two numbers', () => {
    expect(peopleFromRows([{ value: 41n, previous: 37n }])).toEqual({
      value: 41,
      previous: 37,
    });
  });

  // An aggregate without GROUP BY always answers one row, but nothing here
  // should depend on that.
  it('answers zeros when there is no row, or a count is missing', () => {
    expect(peopleFromRows([])).toEqual({ value: 0, previous: 0 });
    expect(peopleFromRows([{ value: null, previous: null }])).toEqual({
      value: 0,
      previous: 0,
    });
  });
});
