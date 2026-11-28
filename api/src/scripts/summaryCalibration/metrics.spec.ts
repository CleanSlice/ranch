import {
  IJudgedTopics,
  formatRatio,
  givenListScores,
  outcomeScores,
  proposedPer100,
  ratio,
  topicScores,
} from './metrics';

describe('ratio', () => {
  it('is hits out of a total, with the share', () => {
    expect(ratio(3, 4)).toEqual({ hits: 3, of: 4, share: 0.75 });
  });

  // A class nobody was labelled with has no precision and no recall: it is
  // not 0% and not 100%, and it must not divide.
  it('has no share when there is nothing to take a share of', () => {
    expect(ratio(0, 0)).toEqual({ hits: 0, of: 0, share: null });
  });
});

describe('formatRatio', () => {
  it('prints the count beside the percentage, so the sample size is never lost', () => {
    expect(formatRatio(ratio(3, 4))).toBe('75.0% (3 of 4)');
    expect(formatRatio(ratio(0, 7))).toBe('0.0% (0 of 7)');
    expect(formatRatio(ratio(2, 3))).toBe('66.7% (2 of 3)');
  });

  it('prints "n/a" when the total is zero', () => {
    expect(formatRatio(ratio(0, 0))).toBe('n/a (0 of 0)');
  });
});

/** A conversation as the person and the model each sorted it. */
const judged = (
  n: number,
  subject: string | null,
  topics: string[],
  loose: string[] = [],
  proposed: string | null = null,
): IJudgedTopics => ({ n, subject, topics, loose, proposed });

describe('topicScores: do the model and the person agree, pair by pair', () => {
  // Three about billing, two about refunds, one about nothing.
  // The model: put two of the billing ones together, gave the third a topic
  // of its own, put the refunds ones together, and put the small talk
  // under billing.
  const SAMPLE = [
    judged(1, 'billing', ['billing']),
    judged(2, 'Billing', ['billing']),
    judged(3, 'billing', ['invoices']),
    judged(4, 'refunds', ['refunds']),
    judged(5, 'refunds', ['refunds']),
    judged(6, null, ['billing']),
  ];

  it('counts every pair of conversations once', () => {
    expect(topicScores(SAMPLE).pairs).toBe(15);
  });

  it('agreement: the pairs both call the same, or both call different', () => {
    // Person "same": 1-2, 1-3, 2-3, 4-5. Model "same": 1-2, 1-6, 2-6, 4-5.
    // Agree on same: 1-2, 4-5. Disagree: 1-3, 2-3, 1-6, 2-6. The other 9
    // both call different.
    expect(topicScores(SAMPLE).agreement).toEqual(ratio(11, 15));
  });

  it('precision of "same": of the pairs the model put together, how many the person did', () => {
    expect(topicScores(SAMPLE).samePrecision).toEqual(ratio(2, 4));
  });

  it('recall of "same": of the pairs the person put together, how many got the same topic', () => {
    expect(topicScores(SAMPLE).sameRecall).toEqual(ratio(2, 4));
  });

  it('names the pairs they disagree on by their numbers, and which way', () => {
    expect(topicScores(SAMPLE).disagreements).toEqual([
      { a: 1, b: 3, person: 'same' },
      { a: 1, b: 6, person: 'different' },
      { a: 2, b: 3, person: 'same' },
      { a: 2, b: 6, person: 'different' },
    ]);
  });

  it('a conversation with no topic is in no pair the model calls the same', () => {
    const scores = topicScores([
      judged(1, 'billing', []),
      judged(2, 'billing', []),
      judged(3, 'billing', ['billing']),
    ]);
    expect(scores.samePrecision).toEqual(ratio(0, 0));
    expect(scores.sameRecall).toEqual(ratio(0, 3));
  });

  it('two conversations share a subject when any of their topics is the same', () => {
    const scores = topicScores([
      judged(1, 'billing', ['billing', 'refunds']),
      judged(2, 'billing', ['refunds', 'invoices']),
    ]);
    expect(scores.sameRecall).toEqual(ratio(1, 1));
  });

  it('has no share to give for one conversation, or none', () => {
    for (const sample of [[], [judged(1, 'billing', ['billing'])]]) {
      const scores = topicScores(sample);
      expect(scores.pairs).toBe(0);
      expect(scores.agreement.share).toBeNull();
      expect(scores.samePrecision.share).toBeNull();
      expect(scores.sameRecall.share).toBeNull();
      expect(scores.clearAgreed.share).toBeNull();
      expect(scores.looseAgreed.share).toBeNull();
    }
  });
});

/**
 * A pair nobody said anything about (CLEAN-270, review): the person wrote no
 * subject for either conversation, and the model gave neither a topic. It
 * was counted as a pair "both call different", and a sample with thirty
 * conversations of small talk has 435 such pairs, every one an agreement
 * that nobody made. It is left out of the pairs, and counted.
 */
describe('topicScores: a pair neither side named a subject for', () => {
  it('is left out of the pairs and of the agreement, and counted', () => {
    const scores = topicScores([
      judged(1, 'billing', ['billing']),
      judged(2, null, []),
      judged(3, null, []),
      judged(4, null, ['billing']),
    ]);
    // Six pairs; 2-3 is the one nobody named a subject for.
    expect(scores.leftOut).toBe(1);
    expect(scores.pairs).toBe(5);
    // 1-4: the model put small talk under billing. The other four agree.
    expect(scores.agreement).toEqual(ratio(4, 5));
    expect(scores.disagreements).toEqual([{ a: 1, b: 4, person: 'different' }]);
  });

  it('stays in when the person named a subject for one of the two, or the model a topic', () => {
    const byPerson = topicScores([
      judged(1, 'billing', []),
      judged(2, null, []),
    ]);
    expect([byPerson.pairs, byPerson.leftOut]).toEqual([1, 0]);
    const byModel = topicScores([
      judged(1, null, ['billing']),
      judged(2, null, []),
    ]);
    expect([byModel.pairs, byModel.leftOut]).toEqual([1, 0]);
  });

  // A loose fit is the model saying the conversation touches a subject:
  // not nothing, and the pair is what judges whether loose is worth storing.
  it('stays in when the model touched a topic loosely', () => {
    const scores = topicScores([
      judged(1, null, [], ['billing']),
      judged(2, null, [], ['billing']),
    ]);
    expect([scores.pairs, scores.leftOut]).toEqual([1, 0]);
    expect(scores.looseAgreed).toEqual(ratio(0, 1));
  });

  it('leaves a sample of nothing but small talk with no pair, and no share', () => {
    const scores = topicScores([
      judged(1, null, []),
      judged(2, null, []),
      judged(3, null, []),
    ]);
    expect(scores.pairs).toBe(0);
    expect(scores.leftOut).toBe(3);
    expect(scores.agreement).toEqual(ratio(0, 0));
  });
});

describe('topicScores: whether a clear fit and a loose fit are worth the same', () => {
  it('clear: of the pairs joined by a topic both got as a clear fit, how many the person put together', () => {
    const scores = topicScores([
      judged(1, 'billing', ['billing']),
      judged(2, 'billing', ['billing']),
      judged(3, 'refunds', ['billing']),
    ]);
    // 1-2 agreed; 1-3 and 2-3 not.
    expect(scores.clearAgreed).toEqual(ratio(1, 3));
  });

  it('loose: of the pairs joined by a topic at least one of them got only loosely, how many the person put together', () => {
    const scores = topicScores([
      judged(1, 'billing', ['billing']),
      judged(2, 'billing', [], ['billing']),
      judged(3, 'refunds', [], ['billing']),
      judged(4, 'refunds', ['refunds']),
    ]);
    // Joined through a loose `billing`: 1-2 (same), 1-3 (different), 2-3
    // (different). 4 is joined to nobody.
    expect(scores.looseAgreed).toEqual(ratio(1, 3));
    // No pair is joined by two clear fits.
    expect(scores.clearAgreed).toEqual(ratio(0, 0));
  });

  it('a loose fit never makes the model call a pair the same: it is not stored', () => {
    const scores = topicScores([
      judged(1, 'billing', [], ['billing']),
      judged(2, 'billing', [], ['billing']),
    ]);
    expect(scores.sameRecall).toEqual(ratio(0, 1));
    expect(scores.looseAgreed).toEqual(ratio(1, 1));
  });
});

/**
 * A run that was given its topics (`--vocabulary`). The pairs above compare
 * two ways of cutting a sample into groups. With one list on both sides a
 * conversation is right or wrong by itself: stored with the topic of its
 * reference subject, or not.
 */
describe('givenListScores: did the model choose the topic the reference chose', () => {
  const SEED = [
    { key: 'billing', subject: 'Оплата' },
    { key: 'refunds', subject: 'Возврат' },
    { key: 'agent-setup', subject: 'Настройка агента' },
  ];

  it('all chosen right: every conversation stored with the topic of its subject', () => {
    const scores = givenListScores(
      [
        judged(1, 'Оплата', ['billing']),
        judged(2, 'оплата', ['billing']),
        judged(3, 'Возврат', ['refunds']),
        judged(4, 'Настройка  агента', ['agent-setup']),
      ],
      SEED,
    );
    expect(scores).toEqual({
      chosen: ratio(4, 4),
      chosenWithSecond: 0,
      otherSeeded: 0,
      noTopic: 0,
      proposed: 0,
      misses: [],
      notInList: [],
      noSubjectNoTopic: 0,
      noSubjectGivenTopic: [],
    });
  });

  it('a miss to another seeded topic: counted, and named by the two keys', () => {
    const scores = givenListScores(
      [judged(1, 'Оплата', ['billing']), judged(2, 'Оплата', ['refunds'])],
      SEED,
    );
    expect(scores.chosen).toEqual(ratio(1, 2));
    expect([scores.otherSeeded, scores.noTopic, scores.proposed]).toEqual([
      1, 0, 0,
    ]);
    expect(scores.misses).toEqual([
      { n: 2, model: ['refunds'], proposed: null, reference: 'billing' },
    ]);
  });

  it('a miss to none: the conversation was stored with no topic', () => {
    const scores = givenListScores(
      [
        judged(1, 'Оплата', []),
        // A loose fit is not stored: it is no topic.
        judged(2, 'Оплата', [], ['billing']),
      ],
      SEED,
    );
    expect(scores.chosen).toEqual(ratio(0, 2));
    expect([scores.otherSeeded, scores.noTopic, scores.proposed]).toEqual([
      0, 2, 0,
    ]);
    expect(scores.misses).toEqual([
      { n: 1, model: [], proposed: null, reference: 'billing' },
      { n: 2, model: [], proposed: null, reference: 'billing' },
    ]);
  });

  // A proposal is not a topic in this release (CLEAN-270, the owner's
  // decision of 2026-11-28): the conversation is stored with none. It is
  // counted apart from "no topic", which is the model naming nothing, and
  // named by the key it proposed.
  it('a miss with a new topic proposed: stored with none, counted apart from the model naming nothing', () => {
    const scores = givenListScores(
      [
        judged(1, 'Оплата', [], [], 'invoices'),
        judged(2, 'Возврат', [], ['billing'], 'money-back'),
        judged(3, 'Возврат', ['refunds']),
        judged(4, 'Возврат', []),
      ],
      SEED,
    );
    expect(scores.chosen).toEqual(ratio(1, 4));
    expect([scores.otherSeeded, scores.noTopic, scores.proposed]).toEqual([
      0, 1, 2,
    ]);
    expect(scores.misses).toEqual([
      { n: 1, model: [], proposed: 'invoices', reference: 'billing' },
      { n: 2, model: [], proposed: 'money-back', reference: 'refunds' },
      { n: 4, model: [], proposed: null, reference: 'refunds' },
    ]);
  });

  // The three kinds of miss are every miss, each once.
  it('counts every miss once: another topic, a proposal, or nothing', () => {
    const scores = givenListScores(
      [
        judged(1, 'Оплата', ['refunds']),
        judged(2, 'Оплата', [], [], 'invoices'),
        judged(3, 'Оплата', []),
        judged(4, 'Оплата', ['billing']),
      ],
      SEED,
    );
    expect(scores.otherSeeded + scores.noTopic + scores.proposed).toBe(
      scores.chosen.of - scores.chosen.hits,
    );
    expect(scores.misses).toHaveLength(3);
  });

  // A conversation carries up to two topics. The reference's among them is
  // chosen right, and how many of those have a second is kept beside it.
  it('counts a conversation stored with two topics by whether the reference’s is one of them', () => {
    const scores = givenListScores(
      [
        judged(1, 'Оплата', ['refunds', 'billing']),
        judged(2, 'Оплата', ['billing']),
        // Wrong from the list, whatever else it carries.
        judged(3, 'Оплата', ['invoices', 'refunds']),
      ],
      SEED,
    );
    expect(scores.chosen).toEqual(ratio(2, 3));
    expect(scores.chosenWithSecond).toBe(1);
    expect([scores.otherSeeded, scores.noTopic, scores.proposed]).toEqual([
      1, 0, 0,
    ]);
    expect(scores.misses).toEqual([
      {
        n: 3,
        model: ['invoices', 'refunds'],
        proposed: null,
        reference: 'billing',
      },
    ]);
  });

  // There is no right answer in the list for it: in no share, and counted.
  it('leaves a reference subject that is not in the seed out of the denominator, and counts it apart', () => {
    const scores = givenListScores(
      [
        judged(1, 'Оплата', ['billing']),
        judged(2, 'Доставка', ['billing']),
        judged(3, 'Доставка', []),
        judged(4, 'Склад', ['warehouse']),
      ],
      SEED,
    );
    expect(scores.chosen).toEqual(ratio(1, 1));
    expect(scores.notInList).toEqual([2, 3, 4]);
    expect(scores.misses).toEqual([]);
    expect([scores.otherSeeded, scores.noTopic, scores.proposed]).toEqual([
      0, 0, 0,
    ]);
  });

  it('"no subject" rows: in no share, counted by whether the model left them without a topic too', () => {
    const scores = givenListScores(
      [
        judged(1, null, []),
        judged(2, null, [], ['billing']),
        judged(3, null, ['billing']),
        judged(4, null, ['small-talk']),
        judged(5, 'Оплата', ['billing']),
      ],
      SEED,
    );
    expect(scores.chosen).toEqual(ratio(1, 1));
    expect(scores.noSubjectNoTopic).toBe(2);
    expect(scores.noSubjectGivenTopic).toEqual([3, 4]);
    expect(scores.notInList).toEqual([]);
    expect(scores.misses).toEqual([]);
  });

  // Nothing was stored for a conversation the model failed on, so it is not
  // among the conversations scored: the share is over the ones that are.
  it('a failed conversation is in no share: it is not among what is scored', () => {
    const all = [
      judged(1, 'Оплата', ['billing']),
      judged(2, 'Оплата', ['refunds']),
      judged(3, 'Возврат', ['refunds']),
    ];
    expect(givenListScores(all, SEED).chosen).toEqual(ratio(2, 3));
    // Conversation 2 failed.
    const scores = givenListScores([all[0], all[2]], SEED);
    expect(scores.chosen).toEqual(ratio(2, 2));
    expect(scores.misses).toEqual([]);
  });

  it('has no share to give when no conversation has a seeded subject', () => {
    const samples = [
      [],
      [judged(1, null, []), judged(2, 'Доставка', ['billing'])],
    ];
    for (const sample of samples) {
      const scores = givenListScores(sample, SEED);
      expect(scores.chosen).toEqual(ratio(0, 0));
      expect(scores.chosen.share).toBeNull();
      expect(formatRatio(scores.chosen)).toBe('n/a (0 of 0)');
    }
    // And none with an empty list: every subject is then outside it.
    const none = givenListScores([judged(1, 'Оплата', ['billing'])], []);
    expect(none.chosen).toEqual(ratio(0, 0));
    expect(none.notInList).toEqual([1]);
  });

  it('leaves what it was given as it was', () => {
    const item = judged(1, 'Оплата', ['refunds']);
    const scores = givenListScores([item], SEED);
    scores.misses[0].model.push('changed');
    expect(item.topics).toEqual(['refunds']);
  });
});

describe('outcomeScores', () => {
  const pair = (n: number, person: string, model: string) => ({
    n,
    person,
    model,
  });

  const SAMPLE = [
    pair(1, 'open', 'open'),
    pair(2, 'open', 'resolved'),
    pair(3, 'resolved', 'open'),
    pair(4, 'resolved', 'resolved'),
    pair(5, 'resolved', 'resolved'),
    pair(6, 'unknown', 'open'),
    pair(7, 'resolved', 'unknown'),
  ];

  it('precision: of what the model called open, how much the person did', () => {
    expect(outcomeScores(SAMPLE, 'open').precision).toEqual(ratio(1, 3));
  });

  it('recall: of what the person called open, how much the model did', () => {
    expect(outcomeScores(SAMPLE, 'open').recall).toEqual(ratio(1, 2));
  });

  it('scores resolved the same way', () => {
    const scores = outcomeScores(SAMPLE, 'resolved');
    expect(scores.precision).toEqual(ratio(2, 3));
    expect(scores.recall).toEqual(ratio(2, 4));
  });

  it('names the conversations it got wrong by their numbers, each way', () => {
    expect(outcomeScores(SAMPLE, 'open')).toMatchObject({
      // The model said open, the person did not: what a person would be
      // shown under "open questions" and should not be.
      wronglyCalled: [3, 6],
      missed: [2],
    });
  });

  // Nobody in the sample left a conversation open: 25 conversations can do
  // that. No recall then, and no division.
  it('has no recall for a class nobody was labelled with, and no precision for one the model never used', () => {
    const scores = outcomeScores(
      [pair(1, 'resolved', 'resolved'), pair(2, 'resolved', 'unknown')],
      'open',
    );
    expect(scores.precision).toEqual(ratio(0, 0));
    expect(scores.recall).toEqual(ratio(0, 0));
    expect(scores.wronglyCalled).toEqual([]);
    expect(scores.missed).toEqual([]);
  });

  it('is empty for an empty sample', () => {
    expect(outcomeScores([], 'open').precision.share).toBeNull();
  });
});

describe('proposedPer100', () => {
  it('scales the topics proposed to a hundred conversations', () => {
    expect(proposedPer100(6, 25)).toBe(24);
    expect(proposedPer100(7, 23)).toBeCloseTo(30.43, 2);
  });

  it('is null for no conversations', () => {
    expect(proposedPer100(0, 0)).toBeNull();
  });
});
