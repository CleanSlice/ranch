// The statistics mapper (CLEAN-258): the one place an instant is parsed. What
// is tested here is what the page relies on: instants become dates, a
// calendar day stays the string it was, and a date that cannot be read
// removes its line instead of inventing one.

import { describe, expect, test } from 'bun:test';

import type {
  InstallationStatsDto,
  MyStatsDto,
} from '#api/data/repositories/api/types.gen';
import { StatsMapper } from './stats.mapper';

function dto(): MyStatsDto {
  return {
    period: 30,
    timeZone: 'Europe/Kyiv',
    range: {
      from: '2026-10-28T22:00:00.000Z',
      to: '2026-11-27T10:00:00.000Z',
      previousFrom: '2026-09-28T21:00:00.000Z',
    },
    notes: [
      { figure: 'activity', completeSince: '2026-11-10T22:00:00.000Z' },
      { figure: 'ratings', completeSince: 'not a date' },
    ],
    summaries: { enabled: true, summarised: 8, waiting: 3, tooShort: 1 },
    board: {
      conversations: { value: 12, previous: 8 },
      messages: { value: 96, previous: 40 },
      agents: { value: 2, reachable: 5 },
      resolved: { resolved: 5, summarised: 8 },
    },
    activity: {
      days: [
        { date: '2026-11-26', conversations: 1 },
        { date: '2026-11-27', conversations: 3 },
      ],
      weekdays: [1, 0, 0, 0, 3, 0, 0],
      activeDays: 2,
    },
    agents: [
      {
        agentId: 'a1',
        name: 'Support Desk',
        messages: 70,
        conversations: 9,
        resolved: 4,
        summarised: 6,
        model: 'claude-sonnet-4-6',
        lastMessageAt: '2026-11-27T09:30:00.000Z',
      },
      {
        agentId: 'a2',
        name: 'Night Watch',
        messages: 26,
        conversations: 3,
        resolved: 1,
        summarised: 2,
        model: null,
        lastMessageAt: null,
      },
    ],
    topics: [
      {
        id: 't1',
        label: 'Billing & invoices',
        conversations: 5,
        resolved: 3,
        open: 1,
        questions: [
          {
            chatId: 'c1',
            agentId: 'a1',
            agentName: 'Support Desk',
            question: 'why was I charged twice in November?',
            at: '2026-11-27T09:30:00.000Z',
            outcome: 'open',
          },
          {
            chatId: 'c2',
            agentId: 'a2',
            agentName: 'Night Watch',
            question: 'Где скачать счёт?',
            at: '2026-11-20T12:00:00.000Z',
            outcome: 'resolved',
          },
        ],
      },
      { id: 't2', label: 'api keys', conversations: 3, resolved: 2, open: 1, questions: [] },
    ],
    outcome: {
      resolved: 5,
      open: 2,
      unknown: 1,
      notSummarised: 4,
      sentiment: { positive: 3, neutral: 3, mixed: 1, negative: 1 },
      languages: [
        { code: 'en', conversations: 6 },
        { code: 'ru', conversations: 2 },
      ],
    },
    openQuestions: {
      items: [
        {
          chatId: 'c1',
          agentId: 'a1',
          agentName: 'Support Desk',
          question: 'why was I charged twice in November?',
          topic: 'Billing & invoices',
          at: '2026-11-27T09:30:00.000Z',
        },
        {
          chatId: 'c9',
          agentId: 'a2',
          agentName: 'Night Watch',
          question: null,
          topic: null,
          at: '2026-11-21T08:00:00.000Z',
        },
      ],
      more: 0,
    },
    help: {
      cited: { conversations: 4, sources: [{ name: 'web', citations: 6 }] },
      handovers: { total: 2, answered: 1, topPeer: { name: 'Research', count: 2 } },
      ratings: { up: 3, down: 1 },
    },
    models: { items: [{ model: 'claude-sonnet-4-6', messages: 96 }], fallback: true },
  };
}

describe('StatsMapper.toPersonal', () => {
  const view = new StatsMapper().toPersonal(dto());

  test('instants become dates, once', () => {
    expect(view.range.from.toISOString()).toBe('2026-10-28T22:00:00.000Z');
    expect(view.range.to.toISOString()).toBe('2026-11-27T10:00:00.000Z');
    expect(view.range.previousFrom.toISOString()).toBe('2026-09-28T21:00:00.000Z');
    expect(view.agents[0]!.lastMessageAt!.toISOString()).toBe('2026-11-27T09:30:00.000Z');
  });

  test('a calendar day stays the string the API sent', () => {
    expect(view.activity.days).toEqual([
      { date: '2026-11-26', conversations: 1 },
      { date: '2026-11-27', conversations: 3 },
    ]);
  });

  test('a note whose date cannot be read is left out', () => {
    expect(view.notes.map((note) => note.figure)).toEqual(['activity']);
    expect(view.notes[0]!.completeSince.toISOString()).toBe('2026-11-10T22:00:00.000Z');
  });

  test('a missing model and a missing last message stay missing', () => {
    expect(view.agents[1]!.model).toBe(null);
    expect(view.agents[1]!.lastMessageAt).toBe(null);
  });

  test('counts and names pass through as received', () => {
    expect(view.board).toEqual(dto().board);
    expect(view.activity.weekdays).toEqual([1, 0, 0, 0, 3, 0, 0]);
    expect(view.help).toEqual(dto().help);
    expect(view.models).toEqual(dto().models);
    expect(view.agents[0]!.name).toBe('Support Desk');
    expect(view.period).toBe(30);
    expect(view.timeZone).toBe('Europe/Kyiv');
  });
});

// Conversation summaries (CLEAN-270): topics, outcomes and open questions.
// Two rules of their own. What a summary worded (a topic's label, a
// question) passes through untouched. And an answer without these blocks, as
// an older API gives, is the "summaries off" view and never a crash: the
// page branches on `summaries.enabled`, so that is what a missing block has
// to say.

/** The answer with something the type forbids put in or taken out. */
function bent(change: (answer: Record<string, any>) => void): MyStatsDto {
  const answer = dto();
  change(answer as unknown as Record<string, any>);
  return answer;
}

describe('StatsMapper.toPersonal: summaries', () => {
  const view = new StatsMapper().toPersonal(dto());

  test('the counts of the period pass through, and the resolved share with its whole', () => {
    expect(view.summaries).toEqual({ enabled: true, summarised: 8, waiting: 3, tooShort: 1 });
    expect(view.board.resolved).toEqual({ resolved: 5, summarised: 8 });
    expect(view.agents.map((agent) => [agent.resolved, agent.summarised])).toEqual([
      [4, 6],
      [1, 2],
    ]);
  });

  test('a topic and a question are shown as received: not trimmed, not re-cased', () => {
    expect(view.topics.map((topic) => topic.label)).toEqual(['Billing & invoices', 'api keys']);
    expect(view.topics[0]!.questions.map((q) => q.question)).toEqual([
      'why was I charged twice in November?',
      'Где скачать счёт?',
    ]);
    expect(view.topics[0]).toMatchObject({ id: 't1', conversations: 5, resolved: 3, open: 1 });
    expect(view.topics[1]!.questions).toEqual([]);
  });

  test('a question carries its conversation, its agent, its outcome and an instant', () => {
    const question = view.topics[0]!.questions[0]!;
    expect(question.chatId).toBe('c1');
    expect(question.agentId).toBe('a1');
    expect(question.agentName).toBe('Support Desk');
    expect(question.outcome).toBe('open');
    expect(question.at!.toISOString()).toBe('2026-11-27T09:30:00.000Z');
  });

  test('the outcomes, the tones and the languages pass through', () => {
    expect(view.outcome).toEqual(dto().outcome);
  });

  test('an open question may have no question and no topic, and is still listed', () => {
    expect(view.openQuestions.more).toBe(0);
    expect(view.openQuestions.items.length).toBe(2);
    const quoted = view.openQuestions.items[0]!;
    expect(quoted.question).toBe('why was I charged twice in November?');
    expect(quoted.topic).toBe('Billing & invoices');
    expect(quoted.at!.toISOString()).toBe('2026-11-27T09:30:00.000Z');
    const silent = view.openQuestions.items[1]!;
    expect(silent.question).toBe(null);
    expect(silent.topic).toBe(null);
    expect(silent.chatId).toBe('c9');
    expect(silent.agentId).toBe('a2');
  });

  test('the view shares nothing with the answer it was made from', () => {
    const answer = dto();
    const mapped = new StatsMapper().toPersonal(answer);
    answer.topics[0]!.questions.pop();
    answer.topics.pop();
    answer.outcome.languages.pop();
    answer.outcome.sentiment.positive = 99;
    answer.openQuestions.items.pop();
    expect(mapped.topics.length).toBe(2);
    expect(mapped.topics[0]!.questions.length).toBe(2);
    expect(mapped.outcome.languages.length).toBe(2);
    expect(mapped.outcome.sentiment.positive).toBe(3);
    expect(mapped.openQuestions.items.length).toBe(2);
  });
});

describe('StatsMapper.toPersonal: summaries off, and an older API', () => {
  const OFF = {
    summaries: { enabled: false, summarised: 0, waiting: 0, tooShort: 0 },
    resolved: { resolved: 0, summarised: 0 },
    outcome: {
      resolved: 0,
      open: 0,
      unknown: 0,
      notSummarised: 0,
      sentiment: { positive: 0, neutral: 0, mixed: 0, negative: 0 },
      languages: [],
    },
    openQuestions: { items: [], more: 0 },
  };

  test('summaries off: every field is there, zero or empty, and `enabled` says why', () => {
    const mapped = new StatsMapper().toPersonal(
      bent((answer) => {
        answer.summaries = { ...OFF.summaries };
        answer.board.resolved = { ...OFF.resolved };
        for (const agent of answer.agents) Object.assign(agent, OFF.resolved);
        answer.topics = [];
        answer.outcome = structuredClone(OFF.outcome);
        answer.openQuestions = structuredClone(OFF.openQuestions);
      }),
    );
    expect(mapped.summaries).toEqual(OFF.summaries);
    expect(mapped.board.resolved).toEqual(OFF.resolved);
    expect(mapped.topics).toEqual([]);
    expect(mapped.outcome).toEqual(OFF.outcome);
    expect(mapped.openQuestions).toEqual(OFF.openQuestions);
    // The rest of the page is counted without summaries.
    expect(mapped.board.conversations).toEqual({ value: 12, previous: 8 });
  });

  test('an answer without the blocks maps to the same "off" view, not to a crash', () => {
    const mapped = new StatsMapper().toPersonal(
      bent((answer) => {
        delete answer.summaries;
        delete answer.board.resolved;
        for (const agent of answer.agents) {
          delete agent.resolved;
          delete agent.summarised;
        }
        delete answer.topics;
        delete answer.outcome;
        delete answer.openQuestions;
      }),
    );
    expect(mapped.summaries).toEqual(OFF.summaries);
    expect(mapped.board.resolved).toEqual(OFF.resolved);
    expect(mapped.agents.map((agent) => [agent.resolved, agent.summarised])).toEqual([
      [0, 0],
      [0, 0],
    ]);
    expect(mapped.topics).toEqual([]);
    expect(mapped.outcome).toEqual(OFF.outcome);
    expect(mapped.openQuestions).toEqual(OFF.openQuestions);
    expect(mapped.agents[0]!.name).toBe('Support Desk');
  });

  test('only an explicit `true` switches summaries on', () => {
    for (const odd of [undefined, null, 'true', 1, {}]) {
      const mapped = new StatsMapper().toPersonal(
        bent((answer) => {
          answer.summaries.enabled = odd;
        }),
      );
      expect(mapped.summaries.enabled).toBe(false);
    }
    for (const odd of [null, 'on', 7, []]) {
      const mapped = new StatsMapper().toPersonal(
        bent((answer) => {
          answer.summaries = odd;
        }),
      );
      expect(mapped.summaries).toEqual(OFF.summaries);
    }
  });

  test('a count that is not a count is zero', () => {
    const mapped = new StatsMapper().toPersonal(
      bent((answer) => {
        answer.summaries.waiting = null;
        answer.summaries.tooShort = '4';
        answer.board.resolved = { resolved: Number.NaN, summarised: -3 };
        answer.outcome.unknown = undefined;
        answer.outcome.sentiment = { positive: 2, neutral: 'many' };
        answer.openQuestions.more = null;
        answer.topics[0].open = undefined;
      }),
    );
    expect(mapped.summaries).toEqual({ enabled: true, summarised: 8, waiting: 0, tooShort: 0 });
    expect(mapped.board.resolved).toEqual({ resolved: 0, summarised: 0 });
    expect(mapped.outcome.unknown).toBe(0);
    expect(mapped.outcome.sentiment).toEqual({ positive: 2, neutral: 0, mixed: 0, negative: 0 });
    expect(mapped.openQuestions.more).toBe(0);
    expect(mapped.topics[0]!.open).toBe(0);
  });

  test('a part that came larger than its whole is the whole: no "9 of 6", no 150%', () => {
    const mapped = new StatsMapper().toPersonal(
      bent((answer) => {
        answer.board.resolved = { resolved: 12, summarised: 8 };
        answer.agents[0].resolved = 9;
        answer.agents[0].summarised = 6;
      }),
    );
    expect(mapped.board.resolved).toEqual({ resolved: 8, summarised: 8 });
    expect([mapped.agents[0]!.resolved, mapped.agents[0]!.summarised]).toEqual([6, 6]);
    // The agent beside it, which agrees with itself, is left as it came.
    expect([mapped.agents[1]!.resolved, mapped.agents[1]!.summarised]).toEqual([1, 2]);
  });

  test('lists that are not lists are empty, and an entry that is not one is left out', () => {
    const mapped = new StatsMapper().toPersonal(
      bent((answer) => {
        answer.topics = [null, 'billing', { id: 't9', label: 'Onboarding', conversations: 2 }];
        answer.outcome.languages = { en: 6 };
        answer.openQuestions.items = 'none';
      }),
    );
    expect(mapped.topics).toEqual([
      { id: 't9', label: 'Onboarding', conversations: 2, resolved: 0, open: 0, questions: [] },
    ]);
    expect(mapped.outcome.languages).toEqual([]);
    expect(mapped.openQuestions.items).toEqual([]);
  });

  test('a topic without an id or a label is not a topic', () => {
    const mapped = new StatsMapper().toPersonal(
      bent((answer) => {
        answer.topics[0].label = '';
        delete answer.topics[1].id;
      }),
    );
    expect(mapped.topics).toEqual([]);
  });

  test('a topic question without words is left out; an outcome it does not know is unknown', () => {
    const mapped = new StatsMapper().toPersonal(
      bent((answer) => {
        answer.topics[0].questions[0].question = null;
        answer.topics[0].questions[1].outcome = 'answered';
        answer.topics[0].questions[1].at = 'yesterday';
      }),
    );
    const questions = mapped.topics[0]!.questions;
    expect(questions.length).toBe(1);
    expect(questions[0]!.question).toBe('Где скачать счёт?');
    expect(questions[0]!.outcome).toBe('unknown');
    expect(questions[0]!.at).toBe(null);
  });

  test('an open question that names no conversation cannot be continued: it is counted under "more"', () => {
    const mapped = new StatsMapper().toPersonal(
      bent((answer) => {
        delete answer.openQuestions.items[0].chatId;
        answer.openQuestions.more = 3;
      }),
    );
    expect(mapped.openQuestions.items.map((item) => item.chatId)).toEqual(['c9']);
    // Still as many open conversations as the outcomes count.
    expect(mapped.openQuestions.more).toBe(4);
  });

  test('a language without a code is left out', () => {
    const mapped = new StatsMapper().toPersonal(
      bent((answer) => {
        answer.outcome.languages = [{ code: '', conversations: 3 }, { code: 'uk', conversations: 2 }];
      }),
    );
    expect(mapped.outcome.languages).toEqual([{ code: 'uk', conversations: 2 }]);
  });
});

// The installation view (CLEAN-265). The same rules, and two of its own: a
// cost nobody could compute stays "no cost" and never becomes a zero, and
// what the server worded (a reason, a name) passes through untouched.

function installationDto(): InstallationStatsDto {
  return {
    period: 30,
    range: {
      from: '2026-10-29T00:00:00.000Z',
      to: '2026-11-27T10:30:00.000Z',
      previousFrom: '2026-09-29T00:00:00.000Z',
    },
    reach: { limited: true, agents: 2, ownerOnly: [] },
    notes: [
      { figure: 'activity', completeSince: '2026-11-24T08:00:00.000Z' },
      { figure: 'refusals', completeSince: 'not a date' },
    ],
    board: {
      tokens: { input: 48_200_000, output: 3_100_000 },
      calls: { value: 812, previous: 640 },
      cost: { value: 212.4, previous: 187.9, unpriced: ['house-model-1'] },
      people: { value: 17, previous: 12 },
    },
    daily: [
      { date: '2026-11-26', cost: 7.35, byModel: [{ model: 'claude-sonnet-4-6', tokens: 1_650_000 }] },
      { date: '2026-11-27', cost: 0, byModel: [] },
    ],
    models: [
      { model: 'claude-sonnet-4-6', priced: true },
      { model: 'house-model-1', priced: false },
    ],
    agents: [
      {
        agentId: 'a1',
        name: 'Support Bot',
        removed: false,
        model: 'claude-sonnet-4-6',
        tokens: 9_400_000,
        calls: 700,
        cost: 61.2,
        partial: false,
      },
      {
        agentId: 'a2',
        name: 'Night Watch',
        removed: true,
        model: 'house-model-1',
        tokens: 120_000,
        calls: 112,
        cost: null,
        partial: false,
      },
    ],
    projection30d: 212.4,
    health: {
      incidents: [
        {
          number: 12,
          agentName: 'Support Bot',
          open: false,
          reason: 'OOMKilled',
          openedAt: '2026-11-25T08:02:11.000Z',
          closedAt: '2026-11-25T08:40:00.000Z',
        },
        {
          number: 13,
          agentName: 'Night Watch',
          open: true,
          reason: null,
          openedAt: '2026-11-27T09:00:00.000Z',
          closedAt: null,
        },
      ],
      incidentsTotal: 3,
      refusals: [{ agentId: 'a1', name: 'Support Bot', refused: 37 }],
    },
    summaries: { enabled: true },
    quality: [
      {
        agentId: 'a1',
        name: 'Support Bot',
        conversations: 240,
        down: 4,
        rated: 31,
        open: 9,
        summarised: 60,
      },
    ],
    channels: [
      { channel: 'console', conversations: 512 },
      { channel: 'telegram', conversations: 40 },
    ],
  };
}

describe('StatsMapper.toInstallation', () => {
  const view = new StatsMapper().toInstallation(installationDto());

  test('instants become dates, once', () => {
    expect(view.range.from.toISOString()).toBe('2026-10-29T00:00:00.000Z');
    expect(view.range.to.toISOString()).toBe('2026-11-27T10:30:00.000Z');
    expect(view.range.previousFrom.toISOString()).toBe('2026-09-29T00:00:00.000Z');
    expect(view.health.incidents[0]!.openedAt!.toISOString()).toBe('2026-11-25T08:02:11.000Z');
    expect(view.health.incidents[0]!.closedAt!.toISOString()).toBe('2026-11-25T08:40:00.000Z');
  });

  test('a UTC day stays the string the API sent', () => {
    expect(view.daily).toEqual(installationDto().daily);
  });

  test('a note whose date cannot be read is left out', () => {
    expect(view.notes.map((note) => note.figure)).toEqual(['activity']);
    expect(view.notes[0]!.completeSince.toISOString()).toBe('2026-11-24T08:00:00.000Z');
  });

  test('an agent without a price has no cost, not a cost of zero', () => {
    expect(view.agents[0]!.cost).toBe(61.2);
    expect(view.agents[1]!.cost).toBe(null);
    expect(view.agents[1]!.removed).toBe(true);
  });

  test('a cost that did not arrive as a number is no cost either', () => {
    const dto = installationDto();
    (dto.agents[0] as { cost: unknown }).cost = undefined;
    (dto.agents[1] as { cost: unknown }).cost = '0';
    const mapped = new StatsMapper().toInstallation(dto);
    expect(mapped.agents[0]!.cost).toBe(null);
    expect(mapped.agents[1]!.cost).toBe(null);
  });

  // `agents[].partial` and a nullable `projection30d` are read off the
  // answer as it arrives, whatever its type promises: an older API sends
  // neither.
  test('a cost that covers only the priced models of an agent is marked partial', () => {
    const dto = installationDto();
    dto.agents[0]!.partial = true;
    const mapped = new StatsMapper().toInstallation(dto);
    expect(mapped.agents[0]!.partial).toBe(true);
    expect(mapped.agents[0]!.cost).toBe(61.2);
    expect(mapped.agents[1]!.partial).toBe(false);
  });

  test('an answer of an older API, without the mark, is not partial', () => {
    const older = installationDto();
    for (const agent of older.agents) delete (agent as { partial?: unknown }).partial;
    const mapped = new StatsMapper().toInstallation(older);
    expect(mapped.agents[0]!.partial).toBe(false);
    expect(mapped.agents[1]!.partial).toBe(false);
    const dto = installationDto();
    (dto.agents[0] as { partial?: unknown }).partial = 'true';
    expect(new StatsMapper().toInstallation(dto).agents[0]!.partial).toBe(false);
  });

  test('a projection that is missing or null is no projection, not zero', () => {
    for (const absent of [null, undefined, 'soon', Number.NaN]) {
      const dto = installationDto();
      (dto as { projection30d: unknown }).projection30d = absent;
      expect(new StatsMapper().toInstallation(dto).projection30d).toBe(null);
    }
    const none = installationDto();
    delete (none as { projection30d?: unknown }).projection30d;
    expect(new StatsMapper().toInstallation(none).projection30d).toBe(null);
    // A projection of nothing spent is a number and stays one.
    const zero = installationDto();
    zero.projection30d = 0;
    expect(new StatsMapper().toInstallation(zero).projection30d).toBe(0);
  });

  // `reach.ownerOnly` (CLEAN-265): the agents whose conversations are the
  // Owner's alone to read. Read off the answer as it arrives, like `partial`:
  // the cast lets a case put in what the type forbids.
  const withOwnerOnly = (value: unknown) => {
    const dto = installationDto();
    (dto.reach as { ownerOnly?: unknown }).ownerOnly = value;
    return dto;
  };

  test('the agents whose conversations are the Owner’s are named as received', () => {
    const dto = withOwnerOnly(['Ranch', 'Night Watch']);
    const mapped = new StatsMapper().toInstallation(dto);
    expect(mapped.reach).toEqual({ limited: true, agents: 2, ownerOnly: ['Ranch', 'Night Watch'] });
    // A copy: the view shares nothing with the answer.
    (dto.reach as unknown as { ownerOnly: string[] }).ownerOnly.push('another');
    expect(mapped.reach.ownerOnly).toEqual(['Ranch', 'Night Watch']);
  });

  test('anything that is not a list of names is no names', () => {
    // An older API sends no field at all.
    const older = installationDto();
    delete (older.reach as { ownerOnly?: unknown }).ownerOnly;
    expect(new StatsMapper().toInstallation(older).reach.ownerOnly).toEqual([]);
    for (const odd of [null, undefined, 'Ranch', 3, { 0: 'Ranch' }, ['Ranch', 7], [null]]) {
      expect(new StatsMapper().toInstallation(withOwnerOnly(odd)).reach.ownerOnly).toEqual([]);
    }
    expect(new StatsMapper().toInstallation(withOwnerOnly([])).reach.ownerOnly).toEqual([]);
  });

  // The share left open (CLEAN-270): `open` out of `summarised` per agent,
  // and whether summaries are produced at all. Read off the answer as it
  // arrives: an older API sends neither, and that is "summaries off".
  test('the open and the summarised conversations of an agent pass through', () => {
    expect(view.summaries).toEqual({ enabled: true });
    expect(view.quality[0]!.open).toBe(9);
    expect(view.quality[0]!.summarised).toBe(60);
  });

  test('an answer of an older API has summaries off and no open share to show', () => {
    const older = installationDto();
    delete (older as { summaries?: unknown }).summaries;
    for (const row of older.quality) {
      delete (row as { open?: unknown }).open;
      delete (row as { summarised?: unknown }).summarised;
    }
    const mapped = new StatsMapper().toInstallation(older);
    expect(mapped.summaries).toEqual({ enabled: false });
    expect(mapped.quality).toEqual([
      {
        agentId: 'a1',
        name: 'Support Bot',
        conversations: 240,
        down: 4,
        rated: 31,
        open: 0,
        summarised: 0,
      },
    ]);
  });

  test('only an explicit `true` says summaries are produced', () => {
    for (const odd of [undefined, null, 'true', 1]) {
      const dto = installationDto();
      (dto.summaries as { enabled: unknown }).enabled = odd;
      expect(new StatsMapper().toInstallation(dto).summaries).toEqual({ enabled: false });
    }
    const off = installationDto();
    off.summaries.enabled = false;
    expect(new StatsMapper().toInstallation(off).summaries).toEqual({ enabled: false });
  });

  test('an open or a summarised count that is not a count is zero', () => {
    const dto = installationDto();
    (dto.quality[0] as { open: unknown }).open = null;
    (dto.quality[0] as { summarised: unknown }).summarised = '60';
    const mapped = new StatsMapper().toInstallation(dto);
    expect(mapped.quality[0]!.open).toBe(0);
    expect(mapped.quality[0]!.summarised).toBe(0);
  });

  test('more left open than summarised is all of the summarised: no "90 of 60"', () => {
    const dto = installationDto();
    dto.quality[0]!.open = 90;
    const mapped = new StatsMapper().toInstallation(dto);
    expect(mapped.quality[0]!.open).toBe(60);
    expect(mapped.quality[0]!.summarised).toBe(60);
  });

  test('an open incident has no end, and a missing reason stays missing', () => {
    const open = view.health.incidents[1]!;
    expect(open.open).toBe(true);
    expect(open.closedAt).toBe(null);
    expect(open.reason).toBe(null);
    expect(view.health.incidents[0]!.reason).toBe('OOMKilled');
  });

  test('counts, names and the reach pass through as received', () => {
    const dto = installationDto();
    expect(view.period).toBe(30);
    expect(view.reach).toEqual({ limited: true, agents: 2, ownerOnly: [] });
    expect(view.board).toEqual(dto.board);
    expect(view.models).toEqual(dto.models);
    expect(view.projection30d).toBe(212.4);
    expect(view.health.incidentsTotal).toBe(3);
    expect(view.health.refusals).toEqual(dto.health.refusals);
    expect(view.quality).toEqual(dto.quality);
    expect(view.channels).toEqual(dto.channels);
    expect(view.agents[0]!.name).toBe('Support Bot');
  });

  test('the view shares nothing with the answer it was made from', () => {
    const dto = installationDto();
    const mapped = new StatsMapper().toInstallation(dto);
    dto.board.cost.unpriced.push('another');
    dto.daily[0]!.byModel[0]!.tokens = 1;
    expect(mapped.board.cost.unpriced).toEqual(['house-model-1']);
    expect(mapped.daily[0]!.byModel[0]!.tokens).toBe(1_650_000);
  });
});
