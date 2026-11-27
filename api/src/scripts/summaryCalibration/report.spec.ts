import { givenListScores, outcomeScores, topicScores } from './metrics';
import {
  FAILED_SHARE_MAX,
  ICalibrationReport,
  dryLines,
  dryVocabularyLines,
  reportLines,
  topicLines,
} from './report';

const judged = (
  n: number,
  subject: string | null,
  topics: string[],
  loose: string[] = [],
) => ({ n, subject, topics, loose });

/** Six conversations: see metrics.spec.ts for the same sample, counted. */
const TOPICS = topicScores([
  judged(1, 'billing', ['billing']),
  judged(2, 'billing', ['billing']),
  judged(3, 'billing', ['invoices']),
  judged(4, 'refunds', ['refunds']),
  judged(5, 'refunds', ['refunds'], ['billing']),
  judged(6, null, ['billing']),
]);
const OUTCOMES = [
  { n: 1, person: 'open', model: 'open' },
  { n: 2, person: 'open', model: 'resolved' },
  { n: 3, person: 'resolved', model: 'open' },
  { n: 4, person: 'resolved', model: 'resolved' },
  { n: 5, person: 'resolved', model: 'resolved' },
  { n: 6, person: 'unknown', model: 'open' },
];

const report = (
  over: Partial<ICalibrationReport> = {},
): ICalibrationReport => ({
  promptVersion: 2,
  model: 'claude-x',
  transcripts: 8,
  summarised: 7,
  failed: [{ n: 8, why: 'the answer was not usable JSON' }],
  noText: [],
  unlabelled: [7],
  invalid: [],
  scored: 6,
  coined: 3,
  person: { resolved: 3, open: 2, unknown: 1, subjects: 2, noSubject: 1 },
  topics: TOPICS,
  open: outcomeScores(OUTCOMES, 'open'),
  resolved: outcomeScores(OUTCOMES, 'resolved'),
  // The last four of the eight: conversations 4, 5 and 6 are scored.
  secondHalf: {
    conversations: 4,
    summarised: 3,
    scored: 3,
    coined: 1,
    topics: topicScores([
      judged(4, 'refunds', ['refunds']),
      judged(5, 'refunds', ['refunds'], ['billing']),
      judged(6, null, ['billing']),
    ]),
  },
  ...over,
});

const text = (lines: string[]) => lines.join('\n');

describe('reportLines', () => {
  it('says which prompt and which model were measured', () => {
    expect(reportLines(report())[0]).toBe(
      'summary calibration: prompt version 2, model claude-x',
    );
  });

  it('says how large the sample is, and what of it was not scored', () => {
    const out = text(reportLines(report()));
    expect(out).toContain('conversations in the sample: 8');
    expect(out).toContain('summarised: 7');
    expect(out).toContain('failed: 1 (n: 8)');
    expect(out).toContain('unlabelled, skipped: 1 (n: 7)');
    expect(out).toContain('scored: 6 conversations, 15 pairs');
  });

  it('prints the eight numbers of the contract, each with its counts', () => {
    const out = text(reportLines(report()));
    expect(out).toContain(
      '[1] same-subject pairs that got the same topic (target 90%): 50.0% (2 of 4)',
    );
    expect(out).toContain(
      '[2] clear fits the person agrees with: 50.0% (2 of 4)',
    );
    expect(out).toContain(
      '[3] loose fits the person agrees with: 0.0% (0 of 3)',
    );
    expect(out).toContain(
      '[4] topics coined: 3 in 7 conversations, 42.9 per 100',
    );
    expect(out).toContain('[5] open, precision (target 80%): 33.3% (1 of 3)');
    expect(out).toContain('[6] open, recall: 50.0% (1 of 2)');
    expect(out).toContain('[7] resolved, precision: 66.7% (2 of 3)');
    expect(out).toContain('[8] resolved, recall: 66.7% (2 of 3)');
  });

  // A percentage of a sample of 25 means little without the counts: every
  // one is printed with the two numbers it was made of.
  it('never prints a percentage without the counts beside it', () => {
    for (const line of reportLines(report())) {
      const shares = line.match(/\d+\.\d%/g) ?? [];
      const counted = line.match(/\d+\.\d% \(\d+ of \d+\)/g) ?? [];
      expect([line, counted.length]).toEqual([line, shares.length]);
    }
  });

  it('says how the comparison of topics was made', () => {
    const out = text(reportLines(report()));
    expect(out).toMatch(/How it is computed/);
    expect(out).toMatch(/pair by pair/);
    expect(out).toContain(
      'pairs the two agree on, same or different: 73.3% (11 of 15)',
    );
    expect(out).toContain(
      'pairs with the same topic that are one subject (precision of "same"): 50.0% (2 of 4)',
    );
  });

  // Nobody labelled a conversation open: the sample is small. No division,
  // and not a 0% or a 100% that nobody measured.
  it('prints n/a for a class that is empty', () => {
    const none = [
      { n: 1, person: 'resolved', model: 'resolved' },
      { n: 2, person: 'unknown', model: 'unknown' },
    ];
    const out = text(
      reportLines(
        report({
          scored: 2,
          topics: topicScores([judged(1, 'a', []), judged(2, 'b', [])]),
          open: outcomeScores(none, 'open'),
          resolved: outcomeScores(none, 'resolved'),
        }),
      ),
    );
    expect(out).toContain('[5] open, precision (target 80%): n/a (0 of 0)');
    expect(out).toContain('[6] open, recall: n/a (0 of 0)');
    expect(out).toContain(
      '[1] same-subject pairs that got the same topic (target 90%): n/a (0 of 0)',
    );
    expect(out).not.toContain('NaN');
    expect(out).not.toContain('Infinity');
  });

  it('prints n/a for the topics coined when nothing was summarised', () => {
    expect(text(reportLines(report({ summarised: 0, coined: 0 })))).toContain(
      '[4] topics coined: 0 in 0 conversations, n/a per 100',
    );
  });

  it('names disagreements by the number of the conversation, and nothing else of it', () => {
    const out = text(reportLines(report()));
    expect(out).toContain('open by the model, not by the person: 3, 6');
    expect(out).toContain('open by the person, not by the model: 2');
    expect(out).toContain(
      'one subject by the person, no common topic: 1-3, 2-3',
    );
    expect(out).toContain(
      'a common topic, two subjects by the person: 1-6, 2-6',
    );
    // The words of the labeller and of the model are not in the report.
    expect(out).not.toMatch(/billing|refunds|invoices/);
  });

  it('cuts a long list of pairs at 40 and says how many more there are', () => {
    const many = topicScores(
      Array.from({ length: 12 }, (_, i) => judged(i + 1, 'one subject', [])),
    );
    const out = text(reportLines(report({ scored: 12, topics: many })));
    const line = out
      .split('\n')
      .find((l) => l.includes('one subject by the person, no common topic'))!;
    expect(line.match(/\d+-\d+/g)).toHaveLength(40);
    expect(line).toContain('(+26 more)');
  });

  it('warns that a sample under 100 conversations is smaller than the contract’s', () => {
    expect(text(reportLines(report()))).toMatch(
      /8 conversations is under the 100 the contract asks for/,
    );
    expect(text(reportLines(report({ transcripts: 100 })))).not.toMatch(
      /under the 100/,
    );
  });
});

describe('dryLines', () => {
  const dry = () =>
    dryLines({
      promptVersion: 2,
      transcripts: 2,
      unlabelled: [2],
      invalid: [],
      labelled: 1,
      labelsWithoutTranscript: [],
      person: { resolved: 1, open: 0, unknown: 0, subjects: 1, noSubject: 0 },
      personSamePairs: 0,
      pairs: 0,
      pairsLeftOut: 0,
      promptSizes: [900, 13_500],
      truncated: 1,
    });

  it('says that nothing was called, and gives the counts and the size of the prompt', () => {
    const out = text(dry());
    expect(out).toContain('dry run: the model was not called');
    expect(out).toContain('conversations in the sample: 2');
    expect(out).toContain('labelled: 1');
    expect(out).toContain('unlabelled, skipped: 1 (n: 2)');
    expect(out).toContain(
      'prompts built: 2, with an empty vocabulary; characters: least 900, median 7200, most 13500',
    );
    expect(out).toContain('longer than 12000 characters, cut at the start: 1');
    expect(out).toContain('resolved 1, open 0, cannot tell 0');
  });

  // A run given its topics lists them in every prompt: the sizes are of
  // those prompts, and the line says so.
  it('says that the prompts list the seeded topics, for a run that is given them', () => {
    const lines = dryLines({
      promptVersion: 2,
      transcripts: 2,
      unlabelled: [],
      invalid: [],
      labelled: 2,
      labelsWithoutTranscript: [],
      person: { resolved: 2, open: 0, unknown: 0, subjects: 1, noSubject: 0 },
      personSamePairs: 1,
      pairs: 1,
      pairsLeftOut: 0,
      promptSizes: [900, 1100],
      truncated: 0,
      seeded: 12,
    });
    expect(text(lines)).toContain(
      'prompts built: 2, with the 12 seeded topics listed; characters: least 900, median 1000, most 1100',
    );
    expect(text(lines)).not.toContain('empty vocabulary');
  });

  it('has no size to give for an empty sample', () => {
    const out = text(
      dryLines({
        promptVersion: 2,
        transcripts: 0,
        unlabelled: [],
        invalid: [],
        labelled: 0,
        labelsWithoutTranscript: [],
        person: { resolved: 0, open: 0, unknown: 0, subjects: 0, noSubject: 0 },
        personSamePairs: 0,
        pairs: 0,
        pairsLeftOut: 0,
        promptSizes: [],
        truncated: 0,
      }),
    );
    expect(out).toContain('prompts built: 0');
    expect(out).not.toContain('NaN');
  });

  it('says how many pairs nobody named a subject for were left out', () => {
    const out = text(
      dryLines({
        promptVersion: 2,
        transcripts: 3,
        unlabelled: [],
        invalid: [],
        labelled: 3,
        labelsWithoutTranscript: [],
        person: { resolved: 3, open: 0, unknown: 0, subjects: 1, noSubject: 2 },
        personSamePairs: 0,
        pairs: 2,
        pairsLeftOut: 1,
        promptSizes: [900, 900, 900],
        truncated: 0,
      }),
    );
    expect(out).toContain(
      'pairs the person put under one subject: 0 of 2 (1 more left out: no subject for either conversation)',
    );
  });
});

/**
 * The conversations the model failed on (CLEAN-270, review). They are in no
 * share: nothing was stored for them, so there is nothing to compare. A
 * conversation the model fails on is not a random one, it is likelier a
 * hard one, so the shares over the rest flatter the prompt, and a report
 * that printed "90%" with the failures three lines above it let the number
 * be read without them. Each headline number carries the failures on its
 * own line, and says whether it meets its target only when few enough
 * failed for the rest to still be the sample.
 */
describe('reportLines: the failures, beside each headline number', () => {
  const lineOf = (lines: string[], mark: string) =>
    lines.find((line) => line.includes(mark))!;
  const failures = (count: number) =>
    Array.from({ length: count }, (_, i) => ({ n: 100 + i, why: 'x' }));
  /** A sample of four the model sorted as the person did. */
  const AGREED = topicScores([
    judged(1, 'billing', ['billing']),
    judged(2, 'billing', ['billing']),
    judged(3, 'refunds', ['refunds']),
    judged(4, 'refunds', ['refunds']),
  ]);
  const ALL_OPEN = outcomeScores(
    [
      { n: 1, person: 'open', model: 'open' },
      { n: 2, person: 'open', model: 'open' },
    ],
    'open',
  );

  it('is 10%: more than that, and no number is said to meet its target', () => {
    expect(FAILED_SHARE_MAX).toBe(0.1);
  });

  it('prints how many failed, and of how many, on the line of each headline number', () => {
    const lines = reportLines(report());
    expect(lineOf(lines, '[1]')).toContain(
      '(target 90%): 50.0% (2 of 4); failed, in no share: 12.5% (1 of 8)',
    );
    expect(lineOf(lines, '[5]')).toContain(
      '(target 80%): 33.3% (1 of 3); failed, in no share: 12.5% (1 of 8)',
    );
  });

  it('says whether the number meets its target when no more than a tenth failed', () => {
    const met = reportLines(
      report({
        transcripts: 10,
        failed: failures(1),
        topics: AGREED,
        open: ALL_OPEN,
      }),
    );
    expect(lineOf(met, '[1]')).toMatch(
      /100\.0% \(2 of 2\); failed, in no share: 10\.0% \(1 of 10\); meets the target$/,
    );
    expect(lineOf(met, '[5]')).toMatch(
      /100\.0% \(2 of 2\); failed, in no share: 10\.0% \(1 of 10\); meets the target$/,
    );

    const under = reportLines(report({ transcripts: 100, failed: [] }));
    expect(lineOf(under, '[1]')).toMatch(
      /50\.0% \(2 of 4\); failed, in no share: 0\.0% \(0 of 100\); under the target$/,
    );
    expect(lineOf(under, '[5]')).toMatch(/under the target$/);
  });

  // Every share at 100%, and two of ten conversations with no answer at
  // all: "meets the target" would be a statement about eight conversations
  // chosen by which ones the model could do.
  it('gives no verdict, whatever the share, when more than a tenth failed', () => {
    const lines = reportLines(
      report({
        transcripts: 10,
        failed: failures(2),
        topics: AGREED,
        open: ALL_OPEN,
      }),
    );
    for (const mark of ['[1]', '[5]']) {
      expect(lineOf(lines, mark)).toMatch(
        /failed, in no share: 20\.0% \(2 of 10\); no verdict: more than 10% of the sample failed$/,
      );
    }
    expect(text(lines)).not.toContain('meets the target');
    expect(text(lines)).not.toContain('under the target');
  });

  it('gives no verdict on a number there is nothing to take a share of', () => {
    const lines = reportLines(
      report({
        transcripts: 100,
        failed: [],
        topics: topicScores([judged(1, 'a', []), judged(2, 'b', [])]),
      }),
    );
    expect(lineOf(lines, '[1]')).toMatch(
      /n\/a \(0 of 0\); failed, in no share: 0\.0% \(0 of 100\); no verdict: nothing to take a share of$/,
    );
  });

  it('says how many pairs nobody named a subject for were left out of the pairs', () => {
    const small = topicScores([
      judged(1, 'billing', ['billing']),
      judged(2, null, []),
      judged(3, null, []),
    ]);
    const out = text(reportLines(report({ scored: 3, topics: small })));
    expect(out).toContain(
      'scored: 3 conversations, 2 pairs (1 more left out: neither the person nor the model named a subject for either conversation)',
    );
    // And nothing is said of it when there was none.
    expect(text(reportLines(report()))).toContain(
      'scored: 6 conversations, 15 pairs\n',
    );
  });
});

/**
 * A run that was given its topics (`--vocabulary`): the judgment as the
 * contract states it, a choice from a list, printed before the pairs. Three
 * seeded topics, each standing for one subject of the reference; the
 * subjects are written SUBJECT here so that one in the output would show.
 */
describe('reportLines: the choice from a given list', () => {
  const HEADING =
    'Topics, chosen from a given list (judgment 1 as the contract states it)';
  const SEED = [
    { key: 'billing', subject: 'SUBJECT one' },
    { key: 'refunds', subject: 'SUBJECT two' },
    { key: 'agent-setup', subject: 'SUBJECT three' },
  ];
  const JUDGED = [
    judged(1, 'SUBJECT one', ['billing']),
    judged(2, 'SUBJECT one', ['refunds']),
    judged(3, 'SUBJECT two', []),
    judged(4, 'SUBJECT three', ['onboarding']),
    judged(5, 'SUBJECT two', ['refunds', 'billing']),
    judged(6, null, ['billing']),
    judged(7, 'SUBJECT elsewhere', ['billing']),
    judged(9, null, []),
  ];
  const given = (
    items = JUDGED,
    notOfferedAll: number[] = [],
  ): ICalibrationReport['given'] => ({
    seeded: SEED.length,
    scores: givenListScores(items, SEED),
    // The second half of the fixture's eight: 4, 5 and 6 are scored.
    secondHalf: givenListScores(
      items.filter((item) => item.n >= 4 && item.n <= 6),
      SEED,
    ),
    notOfferedAll,
  });
  const section = (lines: string[]) =>
    lines.slice(lines.indexOf(HEADING), lines.indexOf('Topics (judgment 1)'));

  it('prints the section before the pairs, with every number and its counts', () => {
    expect(section(reportLines(report({ given: given() })))).toEqual([
      HEADING,
      'How it is computed: the run started with the 3 topics of the vocabulary',
      'file, each standing for one subject of the reference. A conversation',
      'whose reference subject is one of those is chosen right when it was',
      'stored with the topic of that subject as a clear fit. A conversation',
      'with a subject outside the file, with no subject, or that the model',
      'failed on is in no share.',
      '  [9] chosen as the reference chose (target 90%): 40.0% (2 of 5); failed, in no share: 12.5% (1 of 8); no verdict: more than 10% of the sample failed',
      '      of the 2 chosen so, stored with a second topic besides: 1',
      '      of the 3 not chosen so: another seeded topic 1, no topic 1, a topic coined in the run 1',
      '  [10] topics coined although a list was given: 3 in 7 conversations, 42.9 per 100',
      '      reference subject not in the list, in no share: 1 (n: 7)',
      '      no subject by the reference: left without a topic by the model too 1, given a topic 1 (n: 6)',
      '  [9] second half (3 scored): chosen as the reference chose: 50.0% (1 of 2)',
      '  not chosen as the reference chose, as "conversation -> the model\'s keys (the reference\'s key)": 3',
      '    2 -> refunds (billing)',
      '    3 -> no topic (refunds)',
      '    4 -> onboarding (agent-setup)',
      '',
    ]);
  });

  // The same wording and the same rule as [1] and [5]: the failures beside
  // the number, and a verdict only when no more than a tenth failed.
  it('says where [9] stands against the 90% of the contract, by the rule of the other headline numbers', () => {
    const line = (over: Partial<ICalibrationReport>, items = JUDGED) =>
      reportLines(report({ given: given(items), ...over })).find((l) =>
        l.startsWith('  [9] chosen'),
      )!;
    const right = JUDGED.filter((item) => [1, 5].includes(item.n));

    expect(line({ transcripts: 100, failed: [] })).toMatch(
      /40\.0% \(2 of 5\); failed, in no share: 0\.0% \(0 of 100\); under the target$/,
    );
    expect(line({ transcripts: 100, failed: [] }, right)).toMatch(
      /100\.0% \(2 of 2\); failed, in no share: 0\.0% \(0 of 100\); meets the target$/,
    );
    expect(line({ transcripts: 10 }, right)).toMatch(
      /100\.0% \(2 of 2\); failed, in no share: 10\.0% \(1 of 10\); meets the target$/,
    );
    expect(line({ transcripts: 5 }, right)).toMatch(
      /failed, in no share: 20\.0% \(1 of 5\); no verdict: more than 10% of the sample failed$/,
    );
  });

  it('prints n/a, and no verdict, when no scored conversation has a seeded subject', () => {
    const out = text(
      reportLines(
        report({
          transcripts: 100,
          failed: [],
          summarised: 0,
          coined: 0,
          given: given([
            judged(1, null, []),
            judged(2, 'SUBJECT elsewhere', []),
          ]),
        }),
      ),
    );
    expect(out).toContain(
      '[9] chosen as the reference chose (target 90%): n/a (0 of 0); failed, in no share: 0.0% (0 of 100); no verdict: nothing to take a share of',
    );
    expect(out).toContain(
      'of the 0 not chosen so: another seeded topic 0, no topic 0, a topic coined in the run 0',
    );
    expect(out).toContain(
      '[10] topics coined although a list was given: 0 in 0 conversations, n/a per 100',
    );
    expect(out).toContain(
      'chosen as the reference chose: n/a (0 of 0)\n  not chosen as the reference chose, as "conversation -> the model\'s keys (the reference\'s key)": none\n',
    );
    expect(out).not.toContain('NaN');
    expect(out).not.toContain('Infinity');
  });

  it('prints keys and numbers, and nothing the reference wrote', () => {
    const out = text(reportLines(report({ given: given() })));
    expect(out).not.toMatch(/SUBJECT|elsewhere/);
    // Every miss, however many: the list is read to find one conversation.
    const fifty = Array.from({ length: 50 }, (_, i) =>
      judged(i + 1, 'SUBJECT one', []),
    );
    const misses = reportLines(report({ given: given(fifty) })).filter((l) =>
      / -> no topic \(billing\)$/.test(l),
    );
    expect(misses).toHaveLength(50);
  });

  // A prompt lists the sixty most used topics: with the ones coined on the
  // way a seeded topic nobody chose yet can drop out of it.
  it('says which conversations were not offered the whole list, when there were any', () => {
    const none = text(reportLines(report({ given: given() })));
    expect(none).not.toContain('not offered the whole list');

    const some = text(reportLines(report({ given: given(JUDGED, [7, 9]) })));
    expect(some).toContain(
      '  note: 2 conversations were not offered the whole list (n: 7, 9): a prompt lists the 60 most used topics, and with the ones coined on the way more than that stood.',
    );
  });

  it('says of the second half that this run did not start with no topic', () => {
    const out = text(reportLines(report({ given: given() })));
    expect(out).not.toMatch(/starts with no topic at all/);
    expect(out).toContain(
      'This run started with the 3 topics of the vocabulary file, not with\nnone: its second half differs from the first by the topics coined on\nthe way.',
    );
  });

  // Without the flag the report is given no `given`, and prints what it did.
  it('changes no other line, and is not printed for a run that was given no list', () => {
    const plain = reportLines(report());
    const withList = reportLines(report({ given: given() }));

    expect(text(plain)).not.toMatch(/given list|\[9\]|\[10\]|vocabulary file/);
    const added = section(withList).length;
    const at = withList.indexOf(HEADING);
    // The blank line before the heading is the section's own.
    const rest = [
      ...withList.slice(0, at - 1),
      ...withList.slice(at - 1 + added),
    ];
    const differing = rest.filter((line, i) => line !== plain[i]);
    expect(rest).toHaveLength(plain.length);
    // The three lines of why the second half is printed apart.
    expect(differing).toEqual([
      'This run started with the 3 topics of the vocabulary file, not with',
      'none: its second half differs from the first by the topics coined on',
      'the way.',
    ]);
  });
});

/**
 * What `--dry --vocabulary` adds: the file was checked, this is how many
 * topics it seeds and how many conversations a run would score against it.
 */
describe('dryVocabularyLines', () => {
  it('says how many topics are seeded and how many labelled conversations have a subject among them', () => {
    expect(
      dryVocabularyLines({
        seeded: 3,
        labelled: 8,
        inList: 5,
        noSubject: 2,
        notInList: [7],
        unused: ['agent-setup'],
      }),
    ).toEqual([
      '--vocabulary: 3 topics seeded, listed in the first prompt in the order of the file',
      '  labelled conversations with a reference subject in the list: 5 of 8; with no subject: 2; with a subject not in the list, in no share: 1 (n: 7)',
      '  seeded topics whose subject no labelled conversation has: 1 (agent-setup)',
    ]);
  });

  it('prints zeros for a file every label fits, and for a sample with no label', () => {
    const lines = dryVocabularyLines({
      seeded: 2,
      labelled: 0,
      inList: 0,
      noSubject: 0,
      notInList: [],
      unused: [],
    });
    expect(lines[1]).toBe(
      '  labelled conversations with a reference subject in the list: 0 of 0; with no subject: 0; with a subject not in the list, in no share: 0',
    );
    expect(lines[2]).toBe(
      '  seeded topics whose subject no labelled conversation has: 0',
    );
  });
});

/**
 * What `--topics` adds after the report: the topics the run made, so that a
 * pair the report calls joined or split can be read. Keys and labels are
 * vocabulary the product shows to everybody; the function is given nothing
 * else of a conversation but its number.
 */
describe('topicLines', () => {
  const USES = [
    { key: 'invoices', label: 'Invoices', conversations: [3] },
    { key: 'agent-setup', label: 'Agent setup', conversations: [1, 4, 7] },
    { key: 'refunds', label: 'Refunds', conversations: [6] },
  ];

  it('prints one line per topic: key, English label, the count and the numbers', () => {
    expect(topicLines(USES, [2, 5])).toEqual([
      '',
      'Topics of the run (--topics): 3 standing, most used first, as "key (label): conversations stored with it as a clear fit"',
      '  agent-setup (Agent setup): 3 (n: 1, 4, 7)',
      '  invoices (Invoices): 1 (n: 3)',
      '  refunds (Refunds): 1 (n: 6)',
      '  no topic: 2 (n: 2, 5)',
    ]);
  });

  it('puts the most used first, and equally used ones in the order they were coined', () => {
    const keys = topicLines(
      [
        { key: 'first', label: 'First', conversations: [1] },
        { key: 'second', label: 'Second', conversations: [2, 5] },
        { key: 'third', label: 'Third', conversations: [3] },
        { key: 'fourth', label: 'Fourth', conversations: [4, 6] },
      ],
      [],
    )
      .slice(2, -1)
      .map((line) => line.trim().split(' ')[0]);
    expect(keys).toEqual(['second', 'fourth', 'first', 'third']);
  });

  it('leaves the list it was given in its order', () => {
    const given = USES.map((use) => ({ ...use }));
    topicLines(given, []);
    expect(given).toEqual(USES);
  });

  it('ends with the conversations stored with no topic, and says so when there is none', () => {
    const none = topicLines(USES, []);
    expect(none[none.length - 1]).toBe('  no topic: 0');
    const some = topicLines(USES, [9]);
    expect(some[some.length - 1]).toBe('  no topic: 1 (n: 9)');
  });

  it('says so for a run that made no topic', () => {
    expect(topicLines([], [1, 2])).toEqual([
      '',
      'Topics of the run (--topics): 0 standing, most used first, as "key (label): conversations stored with it as a clear fit"',
      '  no topic: 2 (n: 1, 2)',
    ]);
  });

  // The list is read to find one conversation in it: the report's "(+N
  // more)" after forty numbers would hide the one looked for.
  it('prints every number of a topic, however many', () => {
    const fifty = Array.from({ length: 50 }, (_, i) => i + 1);
    const line = topicLines(
      [{ key: 'billing', label: 'Billing', conversations: fifty }],
      [],
    )[2];
    expect(line).toBe(`  billing (Billing): 50 (n: ${fifty.join(', ')})`);
    expect(line).not.toContain('more');
  });
});

/**
 * The run starts with no topic at all (the sample is summarised over an
 * empty vocabulary), which pushes the first conversations towards proposing
 * one: the numbers over the whole sample are partly numbers about that
 * start. Every topic number is printed again for the second half alone, in
 * file order, where the vocabulary is what the first half left.
 */
describe('reportLines: the topic numbers of the second half', () => {
  it('prints each of them again, labelled, with the size of that half beside it', () => {
    const out = text(reportLines(report()));
    expect(out).toContain(
      'second half of the sample only: the last 4 of 8 conversations in file order; 3 summarised, 3 scored, 3 pairs',
    );
    // 4-5: one subject and one topic. 5-6 touch billing loosely, 4-6 not.
    expect(out).toContain(
      '[1] second half (3 scored): same-subject pairs that got the same topic: 100.0% (1 of 1)',
    );
    expect(out).toContain(
      'second half (3 scored): pairs with the same topic that are one subject: 100.0% (1 of 1)',
    );
    expect(out).toContain(
      'second half (3 scored): pairs the two agree on, same or different: 100.0% (3 of 3)',
    );
    expect(out).toContain(
      '[2] second half (3 scored): clear fits the person agrees with: 100.0% (1 of 1)',
    );
    expect(out).toContain(
      '[3] second half (3 scored): loose fits the person agrees with: 0.0% (0 of 1)',
    );
    expect(out).toContain(
      '[4] second half: topics coined: 1 in 3 conversations, 33.3 per 100',
    );
  });

  it('says why they are printed apart', () => {
    expect(text(reportLines(report()))).toMatch(/starts with no topic at all/);
  });

  it('has no share to give for a half with nothing in it', () => {
    const out = text(
      reportLines(
        report({
          transcripts: 1,
          secondHalf: {
            conversations: 1,
            summarised: 0,
            scored: 0,
            coined: 0,
            topics: topicScores([]),
          },
        }),
      ),
    );
    expect(out).toContain(
      '[1] second half (0 scored): same-subject pairs that got the same topic: n/a (0 of 0)',
    );
    expect(out).toContain(
      '[4] second half: topics coined: 0 in 0 conversations, n/a per 100',
    );
    expect(out).not.toContain('NaN');
  });
});
