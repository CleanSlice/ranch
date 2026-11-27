import { IChatTopicData } from './chat.types';
import { IChatTopicGateway } from './chatTopic.gateway';
import {
  TOPICS_STANDING_MAX,
  offeredTopics,
  topicLabel,
  topicLabelsFor,
  topicLanguageOf,
  topicMergeRefusal,
  topicUsage,
} from './chatTopic';

const topic = (
  key: string,
  over: Partial<IChatTopicData> = {},
): IChatTopicData => ({
  id: `topic-${key}`,
  key,
  labels: { en: key, ru: `${key}-ru` },
  mergedIntoId: null,
  createdAt: new Date('2026-11-01T00:00:00Z'),
  ...over,
});

describe('topicLabel', () => {
  const billing = topic('billing', { labels: { en: 'Billing', ru: 'Оплата' } });

  it('is the label of the language asked for', () => {
    expect(topicLabel(billing, 'ru')).toBe('Оплата');
    expect(topicLabel(billing, 'en')).toBe('Billing');
  });

  // A topic coined before a language was added to the console has no label
  // in it (data-model.md, ChatTopic).
  it('falls back to English for a language the topic has no label in', () => {
    expect(topicLabel(billing, 'de')).toBe('Billing');
    expect(
      topicLabel(topic('billing', { labels: { en: 'Billing', ru: '' } }), 'ru'),
    ).toBe('Billing');
  });

  it('falls back to the key when there is no English label either', () => {
    expect(topicLabel(topic('billing', { labels: {} }), 'ru')).toBe('billing');
  });
});

describe('topicLanguageOf', () => {
  it('is the first console language the header names', () => {
    expect(topicLanguageOf('ru')).toBe('ru');
    expect(topicLanguageOf('ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7')).toBe('ru');
    expect(topicLanguageOf('en-GB,en;q=0.9,ru;q=0.8')).toBe('en');
    expect(topicLanguageOf('RU-ru')).toBe('ru');
  });

  it('follows the weights, not the order they are written in', () => {
    expect(topicLanguageOf('en;q=0.2, ru;q=0.9')).toBe('ru');
    expect(topicLanguageOf('ru;q=0, en;q=0.5')).toBe('en');
  });

  it('passes over a language the console does not have', () => {
    expect(topicLanguageOf('de-DE,de;q=0.9,ru;q=0.5')).toBe('ru');
  });

  it.each([
    ['absent', undefined],
    ['empty', ''],
    ['a wildcard', '*'],
    ['only languages the console does not have', 'de, fr;q=0.8'],
    ['not a header at all', ';;;,q=,'],
  ])('is English when the header is %s', (_name, header) => {
    expect(topicLanguageOf(header)).toBe('en');
  });
});

describe('topicMergeRefusal', () => {
  const billing = topic('billing');
  const invoices = topic('invoices');

  it('lets one standing topic be folded into another', () => {
    expect(topicMergeRefusal(invoices, billing)).toBeNull();
  });

  it('refuses a topic merged into itself', () => {
    expect(topicMergeRefusal(billing, billing)).toMatch(/into itself/);
  });

  // Following `mergedIntoId` once would stop at a topic that is not shown.
  it('refuses a target that was merged itself, and names it', () => {
    const merged = topic('payments', { mergedIntoId: billing.id });
    expect(topicMergeRefusal(invoices, merged)).toMatch(
      /«payments» was merged/,
    );
  });

  it('refuses a topic that is merged already', () => {
    const merged = topic('invoices', { mergedIntoId: 'topic-payments' });
    expect(topicMergeRefusal(merged, billing)).toMatch(
      /«invoices» is already merged/,
    );
  });
});

describe('topicUsage', () => {
  const at = (day: number) => new Date(Date.UTC(2026, 10, day));
  const billing = topic('billing', { createdAt: at(1) });
  const refunds = topic('refunds', { createdAt: at(2) });
  const vacation = topic('vacation', { createdAt: at(3) });
  const invoices = topic('invoices', {
    createdAt: at(4),
    mergedIntoId: billing.id,
  });
  const payments = topic('payments', {
    createdAt: at(5),
    mergedIntoId: billing.id,
  });

  it('lists the topics that stand, most used first, each with the keys folded into it', () => {
    const counts = new Map([
      [billing.id, 3],
      [refunds.id, 7],
    ]);

    expect(
      topicUsage([billing, refunds, vacation, invoices, payments], counts),
    ).toEqual([
      { topic: refunds, conversations: 7, merged: [] },
      { topic: billing, conversations: 3, merged: ['invoices', 'payments'] },
      { topic: vacation, conversations: 0, merged: [] },
    ]);
  });

  it('puts the older of two equally used topics first, then by key', () => {
    const twin = topic('absences', { createdAt: at(3) });
    const order = topicUsage(
      [vacation, twin, refunds, billing],
      new Map([
        [vacation.id, 2],
        [twin.id, 2],
        [refunds.id, 2],
        [billing.id, 2],
      ]),
    ).map((u) => u.topic.key);

    expect(order).toEqual(['billing', 'refunds', 'absences', 'vacation']);
  });

  // The counts come already folded: a count under a merged topic's own id
  // would be a conversation counted twice.
  it('never lists a merged topic, whatever was counted under its id', () => {
    const rows = topicUsage([billing, invoices], new Map([[invoices.id, 9]]));
    expect(rows).toEqual([
      { topic: billing, conversations: 0, merged: ['invoices'] },
    ]);
  });
});

describe('topicLabelsFor', () => {
  const billing = topic('billing', { labels: { en: 'Billing', ru: 'Оплата' } });
  const refunds = topic('refunds', {
    labels: { en: 'Refunds', ru: 'Возврат' },
  });

  const gateway = (found: Array<[string, IChatTopicData]>) => {
    const findByIds = jest.fn(async () => new Map(found));
    return {
      topics: { findByIds } as unknown as IChatTopicGateway,
      findByIds,
    };
  };

  it('reads the topics of all the conversations at once, each id once', async () => {
    const { topics, findByIds } = gateway([
      [billing.id, billing],
      [refunds.id, refunds],
    ]);

    const labelsOf = await topicLabelsFor(
      topics,
      [
        { topicIds: [billing.id, refunds.id] },
        { topicIds: [billing.id] },
        { topicIds: [] },
      ],
      'ru',
    );

    expect(findByIds).toHaveBeenCalledTimes(1);
    expect(findByIds).toHaveBeenCalledWith([billing.id, refunds.id]);
    expect(labelsOf({ topicIds: [billing.id, refunds.id] })).toEqual([
      'Оплата',
      'Возврат',
    ]);
    expect(labelsOf({ topicIds: [] })).toEqual([]);
  });

  it('names a merged topic by the one it was folded into, and that one once', async () => {
    // What the gateway answers for a merged id: the topic that stands.
    const { topics } = gateway([
      ['topic-invoices', billing],
      [billing.id, billing],
    ]);

    const labelsOf = await topicLabelsFor(
      topics,
      [{ topicIds: ['topic-invoices', billing.id] }],
      'en',
    );

    expect(labelsOf({ topicIds: ['topic-invoices', billing.id] })).toEqual([
      'Billing',
    ]);
  });

  it('leaves out an id that names no topic', async () => {
    const { topics } = gateway([[billing.id, billing]]);
    const labelsOf = await topicLabelsFor(
      topics,
      [{ topicIds: ['topic-gone', billing.id] }],
      'en',
    );
    expect(labelsOf({ topicIds: ['topic-gone', billing.id] })).toEqual([
      'Billing',
    ]);
  });

  it('asks nothing when no conversation carries a topic', async () => {
    const { topics, findByIds } = gateway([]);
    const labelsOf = await topicLabelsFor(topics, [{ topicIds: [] }], 'en');
    expect(findByIds).not.toHaveBeenCalled();
    expect(labelsOf({ topicIds: [] })).toEqual([]);
  });
});

/**
 * Which topics a prompt lists (CLEAN-270, review). The most used, up to the
 * cap, with one exception: a topic the run itself coined is listed whatever
 * its count. Once sixty topics are in use, a topic coined a moment ago has
 * one conversation and the newest date, so by count alone it stood
 * sixty-first, the next conversation about the same subject was not shown
 * it, and coined the subject a second key.
 */
describe('offeredTopics', () => {
  const at = (n: number) => new Date(Date.UTC(2026, 10, 1, 0, 0, n));
  const used = Array.from({ length: 6 }, (_, i) =>
    topic(`used-${'abcdef'[i]}`, { createdAt: at(i) }),
  );
  const coined = topic('coined', { createdAt: at(50) });
  const counts = new Map<string, number>([
    ...used.map((t, i): [string, number] => [t.id, 10 - i]),
    [coined.id, 1],
  ]);
  const usage = topicUsage([...used, coined], counts);
  const keys = (list: IChatTopicData[]) => list.map((t) => t.key);

  it('is the most used, up to the cap, when the run coined nothing', () => {
    expect(keys(offeredTopics(usage, 4, new Set()))).toEqual([
      'used-a',
      'used-b',
      'used-c',
      'used-d',
    ]);
  });

  it('always lists what the run coined, in the place of the least used', () => {
    expect(keys(offeredTopics(usage, 4, new Set([coined.id])))).toEqual([
      'used-a',
      'used-b',
      'used-c',
      // `used-d` gave its place; the list is still most used first.
      'coined',
    ]);
  });

  it('changes nothing when what the run coined is among the most used anyway', () => {
    expect(keys(offeredTopics(usage, 7, new Set([coined.id])))).toEqual(
      keys(offeredTopics(usage, 7, new Set())),
    );
  });

  it('never lists more than the cap, however many the run coined', () => {
    const all = new Set(usage.map((entry) => entry.topic.id));
    expect(offeredTopics(usage, 3, all)).toHaveLength(3);
  });

  it('does not list an id that names no standing topic', () => {
    expect(keys(offeredTopics(usage, 2, new Set(['topic-gone'])))).toEqual([
      'used-a',
      'used-b',
    ]);
  });
});

describe('the bound on the vocabulary', () => {
  // The prompt offers 60; the margin above is room for new subjects.
  it('is 100 topics that stand', () => {
    expect(TOPICS_STANDING_MAX).toBe(100);
  });
});
