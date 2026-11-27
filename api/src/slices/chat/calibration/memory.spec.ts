import { ChatInsightService } from '../domain';
import type { ILlmGateway } from '#/llm/domain';
import { createCalibrationStore } from './memory';
import type { ITranscript } from '../../../scripts/summaryCalibration/sample';

const conversation = (n: number, ...texts: string[]): ITranscript => ({
  n,
  chatId: `chat-${n}`,
  messages: texts.map((text, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    text,
  })),
});

const SAMPLE = [
  conversation(1, 'first question', 'first answer'),
  conversation(2, 'second question', 'second answer'),
];

const summary = (topicIds: string[]) => ({
  summary: 's',
  question: null,
  outcome: 'unknown' as const,
  topicIds,
  insights: {
    topics: [],
    sentiment: 'neutral' as const,
    resolved: false,
    language: 'en',
  },
});

describe('the conversations of a calibration run', () => {
  it('answers a sample conversation as the session the summary service asks for', async () => {
    const { chats, sessionId } = createCalibrationStore(SAMPLE);

    const session = await chats.findById(sessionId(2));

    expect(session).toMatchObject({
      id: sessionId(2),
      channel: 'bridle',
      topicIds: [],
      insightVersion: 0,
      summary: null,
    });
    expect(await chats.findById('chat-of-somebody')).toBeNull();
  });

  it('hands the reader the messages of that conversation, by the path the service builds', async () => {
    const { chats, reader, sessionId } = createCalibrationStore(SAMPLE);
    const session = (await chats.findById(sessionId(2)))!;

    const messages = await reader.read(
      session.agentId,
      `data/sessions/${session.sessionKey}.jsonl`,
    );

    expect(messages.map((m) => [m.role, m.text])).toEqual([
      ['user', 'second question'],
      ['assistant', 'second answer'],
    ]);
    await expect(
      reader.read(session.agentId, 'data/sessions/other.jsonl'),
    ).rejects.toThrow('no such conversation in the sample');
  });

  it('keeps what a summary would have written, and writes it nowhere', async () => {
    const { chats, saved, sessionId } = createCalibrationStore(SAMPLE);

    await chats.saveInsights(sessionId(1), summary(['topic-1']));

    expect(saved.get(1)).toEqual(summary(['topic-1']));
    expect(saved.has(2)).toBe(false);
  });

  // The store stands in for the two gateways of the summary and nothing
  // more. A call it does not know is a call the calibration did not expect.
  it('refuses anything else', () => {
    const { chats, topics } = createCalibrationStore(SAMPLE);
    expect(() => chats.list({})).toThrow(
      'chats.list is not part of a calibration',
    );
    expect(() => topics.merge('a', 'b')).toThrow(
      'topics.merge is not part of a calibration',
    );
  });
});

describe('the vocabulary of a calibration run', () => {
  const LABELS = { en: 'Refunds', ru: 'Возврат' };
  /**
   * The keys offered, as the summary service asks for them: the counts read
   * from what was saved, then the topics ordered by them.
   */
  const offered = async (
    topics: ReturnType<typeof createCalibrationStore>['topics'],
    cap = 60,
  ) =>
    (await topics.vocabulary(cap, await topics.usageCounts())).map(
      (t) => t.key,
    );

  it('starts empty: no topic stands, which is what the service asks before it asks about topics', async () => {
    const { topics } = createCalibrationStore(SAMPLE);
    expect(await offered(topics)).toEqual([]);
    expect(await topics.hasStanding()).toBe(false);
  });

  // The store can coin, as the gateway it stands in for can. The service
  // that ships does not ask it to (`COINS_PROPOSED_TOPICS`, CLEAN-270); the
  // follow-up, CLEAN-278, is where an approved proposal becomes a topic.
  it('coins a topic once, and reuses it by its key with the labels it has', async () => {
    const { topics, coined } = createCalibrationStore(SAMPLE);

    const first = await topics.findOrCreateByKey('refunds', LABELS);
    const again = await topics.findOrCreateByKey('refunds', {
      en: 'Money back',
      ru: 'Деньги',
    });

    expect(again).toBe(first);
    expect(first).toMatchObject({ key: 'refunds', labels: LABELS });
    expect(coined()).toEqual(['refunds']);
    expect(await offered(topics)).toEqual(['refunds']);
  });

  it('offers the most used first, as the batch does: by the conversations summarised so far', async () => {
    const { chats, topics, sessionId } = createCalibrationStore([
      ...SAMPLE,
      conversation(3, 'third question'),
    ]);
    const billing = await topics.findOrCreateByKey('billing', LABELS);
    const refunds = await topics.findOrCreateByKey('refunds', LABELS);
    const vacation = await topics.findOrCreateByKey('vacation', LABELS);

    // Nothing summarised yet: the older first.
    expect(await offered(topics)).toEqual(['billing', 'refunds', 'vacation']);

    await chats.saveInsights(sessionId(1), summary([refunds.id]));
    await chats.saveInsights(sessionId(2), summary([refunds.id, vacation.id]));
    await chats.saveInsights(sessionId(3), summary([vacation.id]));
    // A conversation summarised again counts once, with what it carries now.
    await chats.saveInsights(sessionId(3), summary([billing.id]));

    expect(await offered(topics)).toEqual(['refunds', 'billing', 'vacation']);
    expect(await offered(topics, 2)).toEqual(['refunds', 'billing']);
  });

  // What the service asks before it coins: is the key a topic already,
  // and how many topics stand (CLEAN-270, review).
  it('answers the topic a key stands for, and how many topics there are', async () => {
    const { topics } = createCalibrationStore(SAMPLE);

    expect(await topics.standingByKey('refunds')).toBeNull();
    expect(await topics.countStanding()).toBe(0);

    const refunds = await topics.findOrCreateByKey('refunds', {
      en: 'Refunds',
      ru: 'Возврат',
    });
    expect(await topics.standingByKey('refunds')).toBe(refunds);
    expect(await topics.countStanding()).toBe(1);
  });

  // The run's own topics are listed whatever their count, as in the batch.
  it('always offers the topics the run names, in the place of the least used', async () => {
    const { topics } = createCalibrationStore(SAMPLE);
    const labels = { en: 'x', ru: 'x' };
    const first = await topics.findOrCreateByKey('first', labels);
    const second = await topics.findOrCreateByKey('second', labels);
    const counts = new Map([[first.id, 3]]);

    expect((await topics.vocabulary(1, counts)).map((t) => t.key)).toEqual([
      'first',
    ]);
    expect(
      (await topics.vocabulary(1, counts, new Set([second.id]))).map(
        (t) => t.key,
      ),
    ).toEqual(['second']);
  });

  it('names the topics of a result by their keys', async () => {
    const { topics, keysOf } = createCalibrationStore(SAMPLE);
    const refunds = await topics.findOrCreateByKey('refunds', LABELS);
    expect(keysOf([refunds.id, 'topic-gone'])).toEqual(['refunds']);
  });

  // What `--topics` lists: the label the prompt lists a topic by.
  it('names the topics of the run by key and English label, in the order coined', async () => {
    const { topics, standing } = createCalibrationStore(SAMPLE);
    expect(standing()).toEqual([]);

    await topics.findOrCreateByKey('refunds', LABELS);
    await topics.findOrCreateByKey('billing', { ru: 'Оплата' });

    expect(standing()).toEqual([
      { key: 'refunds', label: 'Refunds' },
      // No English label: the key, as in the prompt.
      { key: 'billing', label: 'billing' },
    ]);
  });
});

/**
 * A run that is given its topics (`--vocabulary`): they stand before the
 * first conversation, as topics nobody has used yet.
 */
describe('the vocabulary of a calibration run that was given one', () => {
  const SEED = [
    { key: 'refunds', labels: { en: 'Refunds', ru: 'Возврат' } },
    { key: 'billing', labels: { en: 'Billing', ru: 'Оплата' } },
    { key: 'agent-setup', labels: { en: 'Agent setup', ru: 'Настройка' } },
  ];
  const offered = async (
    topics: ReturnType<typeof createCalibrationStore>['topics'],
    cap = 60,
  ) =>
    (await topics.vocabulary(cap, await topics.usageCounts())).map(
      (t) => t.key,
    );

  it('offers all of them before any conversation, in the order given, with no use', async () => {
    const { topics } = createCalibrationStore(SAMPLE, SEED);

    // Not by key: `billing` would come before `refunds`.
    expect(await offered(topics)).toEqual([
      'refunds',
      'billing',
      'agent-setup',
    ]);
    expect(await topics.usageCounts()).toEqual(new Map());
    expect(await topics.countStanding()).toBe(3);
    expect(await topics.hasStanding()).toBe(true);
    expect(await topics.standingByKey('billing')).toMatchObject({
      key: 'billing',
      labels: { en: 'Billing', ru: 'Оплата' },
      mergedIntoId: null,
    });
  });

  it('does not count them as coined, and lists them among the topics of the run', async () => {
    const { topics, coined, standing } = createCalibrationStore(SAMPLE, SEED);
    expect(coined()).toEqual([]);

    await topics.findOrCreateByKey('invoices', { en: 'Invoices', ru: 'Счета' });
    // A key the run was given is the topic it was given, not a new one.
    const billing = await topics.findOrCreateByKey('billing', { en: 'Other' });

    expect(billing.labels).toEqual({ en: 'Billing', ru: 'Оплата' });
    expect(coined()).toEqual(['invoices']);
    expect(standing()).toEqual([
      { key: 'refunds', label: 'Refunds' },
      { key: 'billing', label: 'Billing' },
      { key: 'agent-setup', label: 'Agent setup' },
      { key: 'invoices', label: 'Invoices' },
    ]);
  });

  it('puts a seeded topic that was used before the unused, and a coined one after the seeded among equals', async () => {
    const { chats, topics, sessionId, keysOf } = createCalibrationStore(
      SAMPLE,
      SEED,
    );
    const invoices = await topics.findOrCreateByKey('invoices', {
      en: 'Invoices',
      ru: 'Счета',
    });
    expect(await offered(topics)).toEqual([
      'refunds',
      'billing',
      'agent-setup',
      'invoices',
    ]);

    const setup = (await topics.standingByKey('agent-setup'))!;
    await chats.saveInsights(sessionId(1), summary([setup.id]));

    expect(keysOf([setup.id, invoices.id])).toEqual([
      'agent-setup',
      'invoices',
    ]);
    expect(await offered(topics)).toEqual([
      'agent-setup',
      'refunds',
      'billing',
      'invoices',
    ]);
  });

  // The reference's words for a topic are for reading the result. Whatever
  // the caller's objects carry besides a key and labels is not taken.
  it('takes a key and its labels, and nothing else of what it is handed', async () => {
    const handed = [{ ...SEED[0], subject: 'SUBJECT of the reference' }];
    const { topics } = createCalibrationStore(SAMPLE, handed);

    const topic = (await topics.standingByKey('refunds'))!;

    expect(JSON.stringify(topic)).not.toContain('SUBJECT');
    // And the labels are its own: changing them does not change the file's.
    topic.labels.en = 'Changed';
    expect(handed[0].labels.en).toBe('Refunds');
  });

  it('starts empty when it is given none', async () => {
    const { topics, coined } = createCalibrationStore(SAMPLE, []);
    expect(await offered(topics)).toEqual([]);
    expect(coined()).toEqual([]);
  });
});

/**
 * What the script does with it: the service that ships, over the store.
 * Only the model is replaced here; in a run it is the real one.
 */
/**
 * No agent of a calibration is one only the Owner manages: a conversation
 * with such an agent is asked about no topic whatever the vocabulary, and a
 * run that was given a list measures the choice from it.
 */
describe('the agents of a calibration run', () => {
  it('has none that only the Owner manages', async () => {
    const { permission } = createCalibrationStore(SAMPLE);
    expect(await permission.ownerOnlyAgentIds()).toEqual([]);
  });
});

describe('the summary service over a calibration store', () => {
  const orig = global.fetch;
  afterEach(() => {
    global.fetch = orig;
  });

  const answer = (over: Record<string, unknown>) =>
    JSON.stringify({
      summary: 's',
      question: 'q?',
      outcome: 'open',
      topics: [],
      newTopic: null,
      sentiment: 'neutral',
      language: 'en',
      ...over,
    });

  /** The model, answering each call with the next text; keeps the prompts. */
  const modelOf = (answers: string[]) => {
    const prompts: string[] = [];
    global.fetch = jest.fn(async (_url: unknown, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? '{}') as {
        messages: Array<{ content: string }>;
      };
      prompts.push(body.messages[0].content);
      const text = answers.shift() ?? '';
      return {
        ok: true,
        status: 200,
        json: async () => ({ content: [{ type: 'text', text }] }),
        text: async () => text,
      };
    }) as unknown as typeof fetch;
    return prompts;
  };
  const serviceOver = (store: ReturnType<typeof createCalibrationStore>) =>
    new ChatInsightService(
      store.chats,
      store.reader,
      {
        findActive: async () => [
          {
            id: 'llm-1',
            provider: 'anthropic',
            model: 'claude-x',
            apiKey: 'sk',
            updatedAt: new Date(0),
          },
        ],
      } as unknown as ILlmGateway,
      store.topics,
      store.permission,
    );
  const REFUNDS = { key: 'refunds', labels: { en: 'Refunds', ru: 'Возврат' } };

  // The service that ships (CLEAN-270, the owner's decision of 2026-11-28):
  // with no topic standing it asks no conversation about topics.
  it('summarises the sample in order and, over an empty store, asks about no topic and coins none', async () => {
    const prompts = modelOf([
      answer({ newTopic: REFUNDS }),
      answer({
        outcome: 'resolved',
        topics: [{ key: 'refunds', fit: 'clear' }],
      }),
    ]);
    const store = createCalibrationStore(SAMPLE);
    const service = serviceOver(store);

    await service.summarize(store.sessionId(1));
    await service.summarize(store.sessionId(2));

    expect(prompts[0]).toContain('user: first question');
    expect(prompts[1]).toContain('user: second question');
    for (const prompt of prompts) {
      expect(prompt).toContain('answer two questions about the conversation');
      expect(prompt).not.toMatch(/topic/i);
    }
    expect(store.coined()).toEqual([]);
    expect(store.standing()).toEqual([]);
    expect(store.saved.get(1)?.outcome).toBe('open');
    expect(store.saved.get(2)?.outcome).toBe('resolved');
    expect(store.saved.get(1)?.topicIds).toEqual([]);
    expect(store.saved.get(2)?.topicIds).toEqual([]);
  });

  it('over a store that was given topics, offers every conversation that list, stores what was chosen from it, and coins nothing a conversation proposes', async () => {
    const prompts = modelOf([
      answer({
        newTopic: { key: 'invoices', labels: { en: 'Invoices', ru: 'Счета' } },
      }),
      answer({
        outcome: 'resolved',
        topics: [{ key: 'refunds', fit: 'clear' }],
      }),
    ]);
    const store = createCalibrationStore(SAMPLE, [REFUNDS]);
    const service = serviceOver(store);

    await service.summarize(store.sessionId(1));
    await service.summarize(store.sessionId(2));

    for (const prompt of prompts) {
      expect(prompt).toContain('answer three questions about the conversation');
      expect(prompt).toContain('- refunds: Refunds');
      expect(prompt).not.toContain('invoices');
    }
    expect(store.coined()).toEqual([]);
    expect(store.standing()).toEqual([{ key: 'refunds', label: 'Refunds' }]);
    expect(store.saved.get(1)?.topicIds).toEqual([]);
    expect(store.keysOf(store.saved.get(2)!.topicIds)).toEqual(['refunds']);
  });
});
