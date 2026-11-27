import {
  TRANSCRIPT_CAP,
  VOCABULARY_CAP,
} from '#/chat/domain/chatInsight.prompt';
import {
  IGivenListScores,
  IOutcomeScores,
  IRatio,
  ITopicScores,
  coinedPer100,
  formatRatio,
  ratio,
} from './metrics';

// What a calibration prints (CLEAN-270). Counts, shares with their counts,
// and the numbers of the conversations the two disagree on. The report
// (`reportLines`, `dryLines`) is never given a conversation's text, a
// subject the labeller wrote or a topic the model chose, so it cannot print
// one.
//
// The two exceptions are asked for by name. With `--topics`, `topicLines`
// prints the topics of the run after the report: it is given their keys and
// English labels and the numbers of the conversations, and nothing else.
// With `--vocabulary`, the report is given the keys of the conversations it
// lists as misses, the model's and the seeded one of the reference, and
// prints those: keys are vocabulary, and the reference's own words for a
// subject are not among what it is given.

/**
 * How many conversations the contract's calibration asks for
 * (contracts/summary-judgments.md, T-CAL). A smaller sample still gives
 * numbers; the report says that they are of a smaller one.
 */
const CONTRACT_SAMPLE = 100;

/**
 * How many numbers of a list are printed before "(+N more)". Forty pairs is
 * a screen of them, enough to go and read some; a sample of 100 has 4 950
 * pairs, and the count is given either way.
 */
const LISTED = 40;

/**
 * The two targets of the contract (contracts/summary-judgments.md): 90% of
 * same-subject pairs get the same topic (SC-008), and 80% of what the model
 * calls open the person calls open too. The report says of each headline
 * number whether it meets its target, so the numbers live here and are the
 * ones printed in the lines.
 */
const SAME_TOPIC_TARGET = 0.9;
const OPEN_PRECISION_TARGET = 0.8;

/**
 * The largest share of the sample the model may fail on for a number to be
 * said to meet its target: a tenth (CLEAN-270, review).
 *
 * A conversation the model failed on is in no share: nothing was stored for
 * it, so there is nothing to compare. And it is not a random conversation.
 * An answer cut at the token limit, or talked out of its format, comes from
 * the long and the odd ones, which are the ones a judgment is likeliest to
 * get wrong. So the shares over the rest flatter the prompt, more the more
 * conversations failed. Up to a tenth, the rest is still nearly the sample
 * that was labelled, and the failures are printed beside the number for the
 * reader to weigh. Past a tenth it is another sample, picked by what the
 * model could do, and "meets the target" would be a statement about that
 * one: the report prints the share and declines the verdict.
 */
export const FAILED_SHARE_MAX = 0.1;

/** What the person labelled, in counts. */
export interface IPersonCounts {
  resolved: number;
  open: number;
  unknown: number;
  /** Different subjects written. */
  subjects: number;
  /** Conversations labelled "no subject". */
  noSubject: number;
}

/**
 * The topic numbers of the second half of the sample, in file order.
 *
 * A run starts with no topic at all: the sample is summarised over an empty
 * vocabulary, as an installation's first day would be. The first
 * conversations have nothing to choose among and can only propose, so the
 * numbers over the whole sample are partly numbers about that start, which
 * an installation goes through once. By the second half the vocabulary is
 * what the first half left, which is how a batch finds it on any later day.
 */
export interface ICalibrationHalf {
  /** Conversations in the half: the last ones of the sample. */
  conversations: number;
  /** Of them, those the model's answer was stored for. */
  summarised: number;
  /** Labelled and summarised: what its scores are over. */
  scored: number;
  /** Topics coined while the half was summarised. */
  coined: number;
  topics: ITopicScores;
}

export interface ICalibrationReport {
  promptVersion: number;
  model: string;
  /** Conversations in the sample. */
  transcripts: number;
  /** Of them, those the model's answer was stored for. */
  summarised: number;
  failed: Array<{ n: number; why: string }>;
  /** Conversations with no text to summarise. */
  noText: number[];
  unlabelled: number[];
  invalid: number[];
  /** Labelled and summarised: what every score is over. */
  scored: number;
  /** Topics coined over the whole run. */
  coined: number;
  person: IPersonCounts;
  topics: ITopicScores;
  open: IOutcomeScores;
  resolved: IOutcomeScores;
  secondHalf: ICalibrationHalf;
  /** Only of a run that was given its topics (`--vocabulary`). */
  given?: IGivenListReport;
}

/**
 * What a run that was given its topics adds to the report (`--vocabulary`):
 * how the model chose from the list, conversation by conversation
 * (metrics.ts, `givenListScores`).
 */
export interface IGivenListReport {
  /** Topics the run started with: those of the vocabulary file. */
  seeded: number;
  /** Over every scored conversation. */
  scores: IGivenListScores;
  /** Over the scored conversations of the second half of the sample. */
  secondHalf: IGivenListScores;
  /**
   * Conversations whose prompt did not list every seeded topic. A prompt
   * lists the `VOCABULARY_CAP` most used: once the seeded topics and the
   * ones coined on the way are more than that, the least used drop out.
   */
  notOfferedAll: number[];
}

const numbers = (list: readonly (number | string)[]) => {
  const shown = list.slice(0, LISTED).join(', ');
  return list.length > LISTED
    ? `${shown} (+${list.length - LISTED} more)`
    : shown;
};

/** "3 (n: 4, 9)", or "0". */
const counted = (list: readonly number[]) =>
  list.length ? `${list.length} (n: ${numbers(list)})` : '0';

const listed = (list: readonly (number | string)[]) =>
  list.length ? numbers(list) : 'none';

const personLine = (person: IPersonCounts) =>
  `the person's labels: resolved ${person.resolved}, open ${person.open}, ` +
  `cannot tell ${person.unknown}; ${person.subjects} subjects, ` +
  `${person.noSubject} with no subject`;

const percent = (share: number) => `${Math.round(share * 100)}%`;

/** "42.9 per 100", or "n/a per 100" when nothing was summarised. */
const per100 = (coined: number, conversations: number) => {
  const value = coinedPer100(coined, conversations);
  return `${value === null ? 'n/a' : value.toFixed(1)} per 100`;
};

/**
 * A headline number as it is printed: the share with its counts, the
 * conversations the model failed on beside it, and where the number stands
 * against its target. No verdict when there is no share, and none when more
 * than `FAILED_SHARE_MAX` of the sample failed.
 */
function headline(score: IRatio, target: number, failed: IRatio): string {
  const verdict =
    score.share === null
      ? 'no verdict: nothing to take a share of'
      : failed.share !== null && failed.share > FAILED_SHARE_MAX
        ? `no verdict: more than ${percent(FAILED_SHARE_MAX)} of the sample failed`
        : score.share >= target
          ? 'meets the target'
          : 'under the target';
  return `${formatRatio(score)}; failed, in no share: ${formatRatio(failed)}; ${verdict}`;
}

/**
 * The section of a run that was given its topics. Printed before the pairs:
 * with a list given, it is the judgment as the contract states it, "is it
 * one of the topics in this list, and which".
 *
 * Every miss is printed, with no "(+N more)": the list is read to find what
 * a conversation was taken for. Of a conversation it prints the number and
 * keys: the model's are vocabulary, cut by the parser to lower-case words,
 * and the reference's is the seeded key its subject stands for, never the
 * words of the subject.
 */
function givenListLines(
  r: ICalibrationReport,
  given: IGivenListReport,
  failed: IRatio,
): string[] {
  const all = given.scores;
  const lines = [
    '',
    'Topics, chosen from a given list (judgment 1 as the contract states it)',
    `How it is computed: the run started with the ${given.seeded} topics of the vocabulary`,
    'file, each standing for one subject of the reference. A conversation',
    'whose reference subject is one of those is chosen right when it was',
    'stored with the topic of that subject as a clear fit. A conversation',
    'with a subject outside the file, with no subject, or that the model',
    'failed on is in no share.',
    `  [9] chosen as the reference chose (target ${percent(SAME_TOPIC_TARGET)}): ${headline(all.chosen, SAME_TOPIC_TARGET, failed)}`,
    `      of the ${all.chosen.hits} chosen so, stored with a second topic besides: ${all.chosenWithSecond}`,
    `      of the ${all.chosen.of - all.chosen.hits} not chosen so: another seeded topic ${all.otherSeeded}, ` +
      `no topic ${all.noTopic}, a topic coined in the run ${all.coined}`,
    `  [10] topics coined although a list was given: ${r.coined} in ${r.summarised} conversations, ` +
      per100(r.coined, r.summarised),
    `      reference subject not in the list, in no share: ${counted(all.notInList)}`,
    `      no subject by the reference: left without a topic by the model too ${all.noSubjectNoTopic}, ` +
      `given a topic ${counted(all.noSubjectGivenTopic)}`,
    `  [9] second half (${r.secondHalf.scored} scored): chosen as the reference chose: ${formatRatio(given.secondHalf.chosen)}`,
  ];
  if (given.notOfferedAll.length) {
    lines.push(
      `  note: ${given.notOfferedAll.length} conversations were not offered the whole list ` +
        `(n: ${numbers(given.notOfferedAll)}): a prompt lists the ${VOCABULARY_CAP} most used topics, ` +
        'and with the ones coined on the way more than that stood.',
    );
  }
  lines.push(
    '  not chosen as the reference chose, as "conversation -> the model\'s ' +
      `keys (the reference's key)": ${all.misses.length ? all.misses.length : 'none'}`,
  );
  for (const miss of all.misses) {
    lines.push(
      `    ${miss.n} -> ${miss.model.length ? miss.model.join(', ') : 'no topic'} (${miss.reference})`,
    );
  }
  return lines;
}

export function reportLines(r: ICalibrationReport): string[] {
  const pairsOf = (person: 'same' | 'different') =>
    r.topics.disagreements
      .filter((pair) => pair.person === person)
      .map((pair) => `${pair.a}-${pair.b}`);
  const failed = ratio(r.failed.length, r.transcripts);
  const leftOut = r.topics.leftOut
    ? ` (${r.topics.leftOut} more left out: neither the person nor the ` +
      'model named a subject for either conversation)'
    : '';
  const half = r.secondHalf;
  const ofHalf = `second half (${half.scored} scored)`;

  const lines = [
    `summary calibration: prompt version ${r.promptVersion}, model ${r.model}`,
    `conversations in the sample: ${r.transcripts}; summarised: ${r.summarised}; ` +
      `failed: ${counted(r.failed.map((f) => f.n))}; ` +
      `no text: ${counted(r.noText)}`,
    `unlabelled, skipped: ${counted(r.unlabelled)}; ` +
      `outcome not one of the three, skipped: ${counted(r.invalid)}`,
    `scored: ${r.scored} conversations, ${r.topics.pairs} pairs${leftOut}`,
    personLine(r.person),
  ];
  if (r.transcripts < CONTRACT_SAMPLE) {
    lines.push(
      `note: ${r.transcripts} conversations is under the ${CONTRACT_SAMPLE} the contract asks for; ` +
        'read the counts, not only the shares.',
    );
  }
  for (const failure of r.failed) {
    lines.push(`  failed ${failure.n}: ${failure.why}`);
  }
  if (r.given) lines.push(...givenListLines(r, r.given, failed));

  lines.push(
    '',
    'Topics (judgment 1)',
    'How it is computed: the person wrote subjects in their own words and the',
    'model chose keys, so nothing is compared word to word. The scored',
    'conversations are compared pair by pair. The person calls two of them',
    'the same subject when the same words are written for both; the model,',
    'when both would be stored with a topic in common. No subject, or no',
    'topic, is the same as nothing; a pair neither of them named a subject',
    'for is left out. A fit is judged the same way: of the pairs a topic',
    'joins, how many the person joined. A conversation the model failed on',
    'is in no share: the count of them is beside each headline number.',
    `  [1] same-subject pairs that got the same topic (target ${percent(SAME_TOPIC_TARGET)}): ${headline(r.topics.sameRecall, SAME_TOPIC_TARGET, failed)}`,
    `      pairs with the same topic that are one subject (precision of "same"): ${formatRatio(r.topics.samePrecision)}`,
    `      pairs the two agree on, same or different: ${formatRatio(r.topics.agreement)}`,
    `  [2] clear fits the person agrees with: ${formatRatio(r.topics.clearAgreed)}`,
    '      (pairs joined by a topic both got as a clear fit; by this method',
    '      it is the precision of "same")',
    `  [3] loose fits the person agrees with: ${formatRatio(r.topics.looseAgreed)}`,
    '      (pairs joined by a topic at least one of the two got only loosely)',
    `  [4] topics coined: ${r.coined} in ${r.summarised} conversations, ` +
      per100(r.coined, r.summarised),
    '',
    `Topics again, for the second half of the sample only: the last ${half.conversations} of ` +
      `${r.transcripts} conversations in file order; ${half.summarised} summarised, ` +
      `${half.scored} scored, ${half.topics.pairs} pairs`,
    ...(r.given
      ? [
          `This run started with the ${r.given.seeded} topics of the vocabulary file, not with`,
          'none: its second half differs from the first by the topics coined on',
          'the way.',
        ]
      : [
          'The run starts with no topic at all, which pushes the first conversations',
          'towards proposing one. By the second half the vocabulary is what the',
          'first half left, as a batch finds it on any day but its first.',
        ]),
    `  [1] ${ofHalf}: same-subject pairs that got the same topic: ${formatRatio(half.topics.sameRecall)}`,
    `      ${ofHalf}: pairs with the same topic that are one subject: ${formatRatio(half.topics.samePrecision)}`,
    `      ${ofHalf}: pairs the two agree on, same or different: ${formatRatio(half.topics.agreement)}`,
    `  [2] ${ofHalf}: clear fits the person agrees with: ${formatRatio(half.topics.clearAgreed)}`,
    `  [3] ${ofHalf}: loose fits the person agrees with: ${formatRatio(half.topics.looseAgreed)}`,
    `  [4] second half: topics coined: ${half.coined} in ${half.summarised} conversations, ` +
      per100(half.coined, half.summarised),
    '',
    `Outcomes (judgment 2), over ${r.scored} conversations`,
    `  [5] open, precision (target ${percent(OPEN_PRECISION_TARGET)}): ${headline(r.open.precision, OPEN_PRECISION_TARGET, failed)}`,
    `  [6] open, recall: ${formatRatio(r.open.recall)}`,
    `  [7] resolved, precision: ${formatRatio(r.resolved.precision)}`,
    `  [8] resolved, recall: ${formatRatio(r.resolved.recall)}`,
    '',
    'Disagreements, by the number of the conversation',
    `  open by the model, not by the person: ${listed(r.open.wronglyCalled)}`,
    `  open by the person, not by the model: ${listed(r.open.missed)}`,
    `  resolved by the model, not by the person: ${listed(r.resolved.wronglyCalled)}`,
    `  resolved by the person, not by the model: ${listed(r.resolved.missed)}`,
    `  one subject by the person, no common topic: ${listed(pairsOf('same'))}`,
    `  a common topic, two subjects by the person: ${listed(pairsOf('different'))}`,
  );
  return lines;
}

/** One topic of a run, and the conversations stored with it. */
export interface ITopicUse {
  key: string;
  /** Its English label: the one the prompt lists it by. */
  label: string;
  /** The numbers of the conversations stored with it as a clear fit. */
  conversations: number[];
}

/**
 * The topics of a run, for `--topics`: one line per standing topic, the
 * most used first, then the conversations stored with no topic.
 *
 * The report says that a pair was joined or split and not by what: reading
 * a miss needs the topics the model made. A key and a label are vocabulary
 * the product shows to everybody who opens the statistics page, each cut by
 * the parser to 40 characters, and the label to three words. Nothing else
 * of a conversation is given to this function: not the question, not the
 * summary, not what the labeller wrote. A loose fit is not listed, since it
 * is not stored.
 *
 * Every number is printed, with no "(+N more)": the list is read to find
 * one conversation in it. Equally used topics stay in the order given, the
 * order they were coined in.
 */
export function topicLines(
  topics: readonly ITopicUse[],
  noTopic: readonly number[],
): string[] {
  const all = (list: readonly number[]) =>
    list.length ? `${list.length} (n: ${list.join(', ')})` : '0';
  const byUse = topics
    .map((topic, coined) => ({ topic, coined }))
    .sort(
      (a, b) =>
        b.topic.conversations.length - a.topic.conversations.length ||
        a.coined - b.coined,
    );
  return [
    '',
    `Topics of the run (--topics): ${topics.length} standing, most used first, ` +
      'as "key (label): conversations stored with it as a clear fit"',
    ...byUse.map(
      ({ topic }) =>
        `  ${topic.key} (${topic.label}): ${all(topic.conversations)}`,
    ),
    `  no topic: ${all(noTopic)}`,
  ];
}

export interface IDryReport {
  promptVersion: number;
  transcripts: number;
  labelled: number;
  unlabelled: number[];
  invalid: number[];
  /** Rows of labels.csv whose conversation has no transcript file. */
  labelsWithoutTranscript: number[];
  person: IPersonCounts;
  /** Pairs of labelled conversations the person put under one subject. */
  personSamePairs: number;
  pairs: number;
  /**
   * Pairs left out of `pairs`: the person wrote no subject for either
   * conversation, and in a dry run the model named none.
   */
  pairsLeftOut: number;
  /** The length of each prompt, in characters. */
  promptSizes: number[];
  /** Conversations longer than the prompt reads. */
  truncated: number;
  /**
   * Topics the prompts were built with, of a run given its topics
   * (`--vocabulary`); absent when the vocabulary is empty.
   */
  seeded?: number;
}

function median(sorted: readonly number[]): number {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

export function dryLines(r: IDryReport): string[] {
  const sizes = [...r.promptSizes].sort((a, b) => a - b);
  const size = sizes.length
    ? `; characters: least ${sizes[0]}, median ${median(sizes)}, most ${sizes[sizes.length - 1]}`
    : '';
  const leftOut = r.pairsLeftOut
    ? ` (${r.pairsLeftOut} more left out: no subject for either conversation)`
    : '';
  const vocabulary =
    r.seeded === undefined
      ? 'with an empty vocabulary'
      : `with the ${r.seeded} seeded topics listed`;
  return [
    `summary calibration: prompt version ${r.promptVersion}`,
    'dry run: the model was not called, no credential was read and no database was opened.',
    `conversations in the sample: ${r.transcripts}`,
    `labelled: ${r.labelled}; unlabelled, skipped: ${counted(r.unlabelled)}; ` +
      `outcome not one of the three, skipped: ${counted(r.invalid)}; ` +
      `labels with no transcript: ${counted(r.labelsWithoutTranscript)}`,
    personLine(r.person),
    `pairs the person put under one subject: ${r.personSamePairs} of ${r.pairs}${leftOut}`,
    `prompts built: ${r.promptSizes.length}, ${vocabulary}${size}`,
    `longer than ${TRANSCRIPT_CAP} characters, cut at the start: ${r.truncated}`,
  ];
}

/** What a dry run says of a vocabulary file, having checked it. */
export interface IDryVocabulary {
  /** Topics the file seeds. */
  seeded: number;
  /** Labelled conversations with a transcript: what a run would score. */
  labelled: number;
  /** Of them, those whose reference subject is a seeded one. */
  inList: number;
  /** Of them, those the reference gave no subject. */
  noSubject: number;
  /** Of them, those whose reference subject the file does not have. */
  notInList: number[];
  /** The keys of the seeded topics whose subject no labelled conversation has. */
  unused: string[];
}

/**
 * The lines `--dry --vocabulary` adds: how many topics the file seeds, and
 * how many of the conversations a run would score have a reference subject
 * among them, which is what [9] would be a share of. A subject the file does
 * not have, and a seeded topic nobody was labelled with, are how a subject
 * written one way in the file and another way in `labels.csv` shows: by the
 * numbers of the conversations and by the keys, never by the words.
 */
export function dryVocabularyLines(v: IDryVocabulary): string[] {
  return [
    `--vocabulary: ${v.seeded} topics seeded, listed in the first prompt in the order of the file`,
    `  labelled conversations with a reference subject in the list: ${v.inList} of ${v.labelled}; ` +
      `with no subject: ${v.noSubject}; ` +
      `with a subject not in the list, in no share: ${counted(v.notInList)}`,
    '  seeded topics whose subject no labelled conversation has: ' +
      (v.unused.length ? `${v.unused.length} (${v.unused.join(', ')})` : '0'),
  ];
}
