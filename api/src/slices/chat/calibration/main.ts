/**
 * The calibration of the conversation summary's two judgments (CLEAN-270,
 * spec 038 contracts/summary-judgments.md, task T-CAL).
 *
 * Run from the repository root, through its entry point, which runs the
 * built API and refuses a build older than the source:
 *
 *   (cd api && bun run build)
 *   bun api/scripts/summary-calibration.ts --sample <dir> --dry
 *   DATABASE_URL=<the local database> bun api/scripts/summary-calibration.ts --sample <dir> [--topics] [--vocabulary <file>]
 *
 * The calibration is in two folders, by what each part depends on. This
 * one, in the chat slice, holds what constructs the slice's services:
 * main.ts and memory.ts. The pure parts, text and numbers in and out, are
 * in api/src/scripts/summaryCalibration/: sample.ts, metrics.ts, report.ts
 * and build.ts. `bun run test:scripts` runs every spec under a `scripts`
 * folder with bun, which cannot load the slices' services; the specs here
 * are jest's alone.
 *
 * `<dir>` is a sample kept OUTSIDE the repository:
 *
 *   <dir>/transcripts/NNN.json  { n, chatId, agent, lastMessageAt,
 *                                  messages: [{ role, ts, text }] }
 *   <dir>/labels.csv             n,chatId,agent,lastMessageAt,messages,
 *                                subject,outcome,note
 *
 * A real run summarises the sample in file order with `ChatInsightService`,
 * the class the batch runs, over gateways held in memory (memory.ts): the
 * vocabulary is empty, unless the run is given one (`--vocabulary`,
 * below), and stays as it started. The one thing it
 * reads from the database is the credential, picked the way the batch picks
 * it; the one thing it sends anywhere is the prompt, to the model. It
 * writes nothing: not to the database, not into the repository, not into
 * the sample.
 *
 * `--dry` does everything but the model call. It opens no database and
 * loads none of the code that would.
 *
 * What a run measures depends on the vocabulary, because it runs the service
 * that ships (CLEAN-270, the owner's decision of 2026-11-28; the numbers
 * behind it are in contracts/summary-judgments.md). That service asks no
 * conversation about topics while no topic stands, and never makes a topic
 * of one the model proposes:
 *
 *  - without `--vocabulary` the run measures outcomes only (judgment 2).
 *    Its report says that topics are not asked while the vocabulary is
 *    empty, and prints no topic number;
 *  - with `--vocabulary` it measures the choice from that list (judgment 1)
 *    and the outcomes. A new topic the model proposes is counted and printed
 *    as proposed, "not coined in this release", where the recorded runs of
 *    2026-11-28 say "coined": the conversation is stored with no topic, and
 *    no later conversation is offered the proposal.
 *
 * What is printed is counts, shares with their counts, and the numbers of
 * the conversations the person and the model disagree on. Never a
 * conversation's text, a subject the labeller wrote, or a topic.
 *
 * `--topics` adds, after the report of a real run that was given a list,
 * the topics of the run: one line per topic with its key, its English label
 * and the numbers of the conversations stored with it as a clear fit, the
 * most used first, then the conversations stored with no topic, then the
 * keys the model proposed as new topics, which were not coined, with the
 * conversations that proposed each. A miss cannot be read without them: the
 * report says that two conversations were joined or split, not by which
 * topic. Keys and labels are vocabulary the product shows to everybody; no
 * question, no summary and no subject of the labeller is printed with them.
 * Off by default; a dry run has none to list, and neither has a run with an
 * empty vocabulary, which says so.
 *
 * `--vocabulary <file>` gives the run its topics, where it otherwise has
 * none and asks about none:
 *
 *   [{ "key": "billing", "labels": { "en": "Billing", "ru": "Оплата" },
 *      "subject": "настройка оплаты" }, …]
 *
 * The contract's judgment is a choice from a list: "Is it one of the topics
 * in this list? Which one?" With the
 * file, every `key` stands before the first conversation, with its `labels`
 * and no use, and each stands for the `subject` the reference labels write
 * in `labels.csv` for it. The report then says of each conversation with
 * such a subject whether it was stored with that topic (sample.ts,
 * `parseVocabulary`; metrics.ts, `givenListScores`), in a section before
 * the pairs. `subject` ties a label to a key and is in no prompt. A miss is
 * printed as the conversation's number and keys, the model's and the seeded
 * one of the reference: keys are vocabulary, and the words of a subject are
 * printed nowhere. With `--dry` the file is checked and counted against the
 * labels, and nothing is called.
 *
 * A conversation the model failed on is in no share. How many failed is
 * printed beside each headline number, and no number is said to meet its
 * target when more than a tenth of the sample failed (report.ts). The topic
 * numbers of a run that was given a list are printed a second time for the
 * second half of the sample alone, as the recorded runs printed them.
 *
 * Deliberately does NOT boot the Nest AppModule, as purgeRussianChats does
 * not: its onModuleInit hooks start timers and touch agents. The service is
 * constructed by hand and its own `onModuleInit` is never called, so no
 * batch is scheduled.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  INSIGHT_VERSION,
  TRANSCRIPT_CAP,
  UNUSABLE_ANSWER_REASONS,
  buildInsightPrompt,
  transcriptText,
} from '../domain/chatInsight.prompt';
import { ChatOutcomeTypes } from '../domain/chat.types';
import { createCalibrationStore } from './memory';
import {
  IJudgedOutcome,
  IJudgedTopics,
  givenListScores,
  outcomeScores,
  topicScores,
} from '../../../scripts/summaryCalibration/metrics';
import {
  IPersonCounts,
  IProposedKey,
  dryLines,
  dryVocabularyLines,
  proposedLines,
  reportLines,
  topicLines,
} from '../../../scripts/summaryCalibration/report';
import {
  ICalibrationArgs,
  ILabel,
  ILabels,
  ISeedTopic,
  ITranscript,
  parseCalibrationArgs,
  parseCsv,
  parseTranscript,
  parseVocabulary,
  readLabels,
  sameSubject,
  seedKeyOf,
} from '../../../scripts/summaryCalibration/sample';

const USAGE =
  'usage: (cd api && bun run build) && ' +
  'bun api/scripts/summary-calibration.ts --sample <dir> [--dry] [--topics] [--vocabulary <file>]\n' +
  '  --dry     check the sample without calling the model\n' +
  '  --topics  after the report, list the topics of the run (key, English\n' +
  '            label) with the numbers of the conversations stored with\n' +
  '            each, and the keys the model proposed, which are not coined\n' +
  '  --vocabulary <file>\n' +
  '            start the run with the topics of this JSON file, a list of\n' +
  '            { "key", "labels": { "en", "ru" }, "subject" }, and report how\n' +
  '            the model chose among them; "subject" is the text the labels\n' +
  '            have in the subject column for that topic\n' +
  '  Without --vocabulary no conversation is asked about topics, as on an\n' +
  '  installation with no topic yet: the run measures outcomes only.';

type Print = (line: string) => void;

interface ISample {
  transcripts: ITranscript[];
  labels: ILabels;
}

/** The sample, transcripts in the order of their file names. */
function loadSample(dir: string): ISample {
  const folder = join(dir, 'transcripts');
  const files = readdirSync(folder)
    .filter((name) => name.toLowerCase().endsWith('.json'))
    .sort();
  const transcripts: ITranscript[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < files.length; i++) {
    const transcript = parseTranscript(
      readFileSync(join(folder, files[i]), 'utf-8'),
      files[i],
    );
    if (seen.has(transcript.n)) {
      throw new Error(
        `transcripts/${files[i]} repeats conversation ${transcript.n}`,
      );
    }
    seen.add(transcript.n);
    transcripts.push(transcript);
  }
  const labels = readLabels(
    parseCsv(readFileSync(join(dir, 'labels.csv'), 'utf-8')),
  );
  return { transcripts, labels };
}

function personCounts(labels: readonly ILabel[]): IPersonCounts {
  const subjects: string[] = [];
  for (let i = 0; i < labels.length; i++) {
    const subject = labels[i].subject;
    if (subject !== null && !subjects.some((s) => sameSubject(s, subject))) {
      subjects.push(subject);
    }
  }
  const count = (outcome: string) =>
    labels.filter((label) => label.outcome === outcome).length;
  return {
    resolved: count(ChatOutcomeTypes.Resolved),
    open: count(ChatOutcomeTypes.Open),
    unknown: count(ChatOutcomeTypes.Unknown),
    subjects: subjects.length,
    noSubject: labels.filter((label) => label.subject === null).length,
  };
}

function runDry(
  sample: ISample,
  args: ICalibrationArgs,
  vocabulary: readonly ISeedTopic[] | null,
  print: Print,
): number {
  const numbers = new Set(sample.transcripts.map((t) => t.n));
  const labelled = sample.labels.labels.filter((l) => numbers.has(l.n));
  const texts = sample.transcripts.map((t) => transcriptText(t.messages));
  // The person's side alone: no topic for anybody.
  const judged: IJudgedTopics[] = labelled.map((l) => ({
    n: l.n,
    subject: l.subject,
    topics: [],
    loose: [],
  }));
  const scores = topicScores(judged);
  // What the first prompt of a run lists: nothing, or the topics given, by
  // key and labels alone.
  const offered = (vocabulary ?? []).map(({ key, labels }) => ({
    key,
    labels,
  }));
  const lines = dryLines({
    promptVersion: INSIGHT_VERSION,
    transcripts: sample.transcripts.length,
    labelled: labelled.length,
    unlabelled: sample.labels.unlabelled,
    invalid: sample.labels.invalid,
    labelsWithoutTranscript: sample.labels.labels
      .filter((l) => !numbers.has(l.n))
      .map((l) => l.n),
    person: personCounts(labelled),
    personSamePairs: scores.sameRecall.of,
    pairs: scores.pairs,
    pairsLeftOut: scores.leftOut,
    // The prompt the service would build: with the list and the topics
    // question for a run that was given topics, and with neither while the
    // vocabulary is empty (CLEAN-270, the owner's decision of 2026-11-28).
    promptSizes: texts.map(
      (text) =>
        buildInsightPrompt(text, offered, { topics: offered.length > 0 })
          .length,
    ),
    truncated: texts.filter((text) => text.length > TRANSCRIPT_CAP).length,
    ...(vocabulary ? { seeded: vocabulary.length } : {}),
  });
  if (vocabulary) {
    // With no topic for anybody, what is left of the scores is the
    // reference's side: whose subject is in the file, and whose is not.
    const given = givenListScores(judged, vocabulary);
    const used = new Set(labelled.map((l) => seedKeyOf(l.subject, vocabulary)));
    lines.push(
      ...dryVocabularyLines({
        seeded: vocabulary.length,
        labelled: labelled.length,
        inList: given.chosen.of,
        noSubject: given.noSubjectNoTopic,
        notInList: given.notInList,
        unused: vocabulary
          .map((topic) => topic.key)
          .filter((key) => !used.has(key)),
      }),
    );
  }
  // One argument each: `forEach` would hand `print` the index and the whole
  // list as well, and `console.log` prints every argument it is given.
  for (let i = 0; i < lines.length; i++) print(lines[i]);
  if (args.topics) {
    print('--topics: nothing to list, a dry run makes no topics.');
  }
  return 0;
}

/** How the message of the service's `UnusableInsightAnswerError` begins. */
const UNUSABLE_ANSWER = 'insight generator returned an unusable answer: ';

/**
 * Why a conversation was not summarised, in words that carry nothing of
 * it. Only what is known to carry nothing is passed on: the provider's
 * status without its body, and of an unusable answer what was wrong with
 * it (the service's own message says that and the answer's length, and
 * quotes none of it since the review of CLEAN-270). Any other failure is
 * named by its kind alone.
 */
function failureOf(err: unknown): string {
  const message = err instanceof Error ? err.message : '';
  const provider = /^Anthropic API \d+/.exec(message);
  if (provider) return `${provider[0]}: the provider did not answer`;
  if (message.startsWith('Anthropic rejected the API key')) {
    return 'the provider rejected the credential';
  }
  if (message.startsWith(UNUSABLE_ANSWER)) {
    // One of the service's own reasons, by its list: an answer cut at the
    // token limit and one the model declined are among them (CLEAN-270).
    // Text after the prefix that is none of them is not passed on.
    const reason = UNUSABLE_ANSWER_REASONS.find((known) =>
      message.startsWith(known, UNUSABLE_ANSWER.length),
    );
    if (reason) return `the answer could not be used (${reason})`;
  }
  return err instanceof Error ? err.name : 'unknown failure';
}

async function runForReal(
  sample: ISample,
  args: ICalibrationArgs,
  vocabulary: readonly ISeedTopic[] | null,
  print: Print,
): Promise<number> {
  // Loaded here and not at the top: a dry run needs no database client and
  // none of the application's services.
  const { BadRequestException } = await import('@nestjs/common');
  const { PrismaService } = await import('#/setup/prisma/prisma.service');
  const { LlmGateway } = await import('#/llm/data/llm.gateway');
  const { LlmMapper } = await import('#/llm/data/llm.mapper');
  const { ChatInsightService } = await import('../domain/chatInsight.service');

  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    // The topics the run was given stand before its first conversation, by
    // key and labels alone: the reference's words for a subject are for
    // reading the result, and are handed to nothing that builds a prompt.
    const store = createCalibrationStore(
      sample.transcripts,
      (vocabulary ?? []).map(({ key, labels }) => ({ key, labels })),
    );
    const service = new ChatInsightService(
      store.chats,
      store.reader,
      new LlmGateway(prisma, new LlmMapper()),
      store.topics,
      store.permission,
    );
    const credential = await service.credential();
    if (!credential) {
      print(
        'no active Anthropic credential in the database this run is pointed at ' +
          '(DATABASE_URL): add one in Settings → LLM credentials, or run with --dry.',
      );
      return 1;
    }

    // What the model marked `loose` is not stored, so the summary does not
    // carry it. It is taken where the service receives the model's answer.
    const loose = new Map<number, string[]>();
    // Nor is what it proposed: a proposal is not coined in this release
    // (CLEAN-270, the owner's decision of 2026-11-28), so the conversation
    // is stored with no topic and the key is taken here, to be reported as
    // proposed. Only a key no topic of the run has: one that names a topic
    // of the list is that topic not chosen, which the service stores as
    // none, and not a new topic proposed.
    const listedKeys = new Set(store.standing().map((topic) => topic.key));
    const proposedBy = new Map<number, string>();
    // The conversations whose prompt did not list every topic the run was
    // given, taken at the same place: the list the service hands the model.
    const notOfferedAll: number[] = [];
    let current = 0;
    const analyze = service.analyze.bind(service);
    service.analyze = async (...args) => {
      if (vocabulary) {
        const listed = new Set(args[1].map((topic) => topic.key));
        if (vocabulary.some((topic) => !listed.has(topic.key))) {
          notOfferedAll.push(current);
        }
      }
      const parsed = await analyze(...args);
      loose.set(current, parsed.looseTopicKeys);
      if (parsed.proposal && !listedKeys.has(parsed.proposal.key)) {
        proposedBy.set(current, parsed.proposal.key);
      }
      return parsed;
    };

    const failed: Array<{ n: number; why: string }> = [];
    const noText: number[] = [];
    // The second half of the sample, in file order; of an odd number, the
    // larger half. Its topic numbers are printed apart, as the recorded
    // runs printed them (report.ts, `ICalibrationHalf`).
    const halfAt = Math.floor(sample.transcripts.length / 2);
    const secondHalf = new Set(
      sample.transcripts.slice(halfAt).map((transcript) => transcript.n),
    );
    // In file order and one at a time, as the batch goes through a run.
    for (let i = 0; i < sample.transcripts.length; i++) {
      current = sample.transcripts[i].n;
      try {
        await service.summarize(store.sessionId(current));
        // Nothing thrown and nothing stored: there was no text to read.
        if (!store.saved.has(current)) noText.push(current);
      } catch (err) {
        failed.push({ n: current, why: failureOf(err) });
        // A rejected credential fails every conversation the same way.
        if (err instanceof BadRequestException) break;
      }
    }

    // The keys proposed, each once, in the order first proposed, with the
    // conversations that proposed it; and how many of them were first
    // proposed in the second half. A conversation whose summary was not
    // stored proposed nothing that is counted: it is in no number at all.
    const proposedKeys: IProposedKey[] = [];
    let proposedInHalf = 0;
    for (let i = 0; i < sample.transcripts.length; i++) {
      const n = sample.transcripts[i].n;
      const key = proposedBy.get(n);
      if (key === undefined || !store.saved.has(n)) continue;
      const known = proposedKeys.find((proposed) => proposed.key === key);
      if (known) {
        known.conversations.push(n);
        continue;
      }
      proposedKeys.push({ key, conversations: [n] });
      if (secondHalf.has(n)) proposedInHalf++;
    }

    const topics: IJudgedTopics[] = [];
    const outcomes: IJudgedOutcome[] = [];
    const scoredLabels: ILabel[] = [];
    for (let i = 0; i < sample.labels.labels.length; i++) {
      const label = sample.labels.labels[i];
      const summary = store.saved.get(label.n);
      if (!summary) continue;
      scoredLabels.push(label);
      topics.push({
        n: label.n,
        subject: label.subject,
        topics: store.keysOf(summary.topicIds),
        loose: loose.get(label.n) ?? [],
        proposed: proposedBy.get(label.n) ?? null,
      });
      outcomes.push({
        n: label.n,
        person: label.outcome,
        model: summary.outcome,
      });
    }

    const topicsOfHalf = topics.filter((item) => secondHalf.has(item.n));
    let summarisedInHalf = 0;
    for (const n of secondHalf) if (store.saved.has(n)) summarisedInHalf++;

    const lines = reportLines({
      promptVersion: INSIGHT_VERSION,
      model: credential.model,
      transcripts: sample.transcripts.length,
      summarised: store.saved.size,
      failed,
      noText,
      unlabelled: sample.labels.unlabelled,
      invalid: sample.labels.invalid,
      scored: scoredLabels.length,
      proposed: proposedKeys.length,
      person: personCounts(scoredLabels),
      topics: topicScores(topics),
      open: outcomeScores(outcomes, ChatOutcomeTypes.Open),
      resolved: outcomeScores(outcomes, ChatOutcomeTypes.Resolved),
      secondHalf: {
        conversations: secondHalf.size,
        summarised: summarisedInHalf,
        scored: topicsOfHalf.length,
        proposed: proposedInHalf,
        topics: topicScores(topicsOfHalf),
      },
      ...(vocabulary
        ? {
            given: {
              seeded: vocabulary.length,
              scores: givenListScores(topics, vocabulary),
              secondHalf: givenListScores(topicsOfHalf, vocabulary),
              notOfferedAll,
            },
          }
        : {}),
    });
    for (let i = 0; i < lines.length; i++) print(lines[i]);

    if (args.topics && !vocabulary) {
      // An empty list would read as "the model chose nothing": it was not
      // asked. Said in a line, as a dry run says it.
      print(
        '--topics: nothing to list, no conversation is asked about topics ' +
          'while the vocabulary is empty.',
      );
    } else if (args.topics) {
      // Every conversation a summary was stored for, labelled or not, in
      // file order: what was stored is what the list is of. Only the keys
      // of a summary are read here, never its text.
      const uses = store.standing().map((topic) => ({
        ...topic,
        conversations: [] as number[],
      }));
      const noTopic: number[] = [];
      for (let i = 0; i < sample.transcripts.length; i++) {
        const n = sample.transcripts[i].n;
        const summary = store.saved.get(n);
        if (!summary) continue;
        const keys = store.keysOf(summary.topicIds);
        if (keys.length === 0) noTopic.push(n);
        for (let u = 0; u < uses.length; u++) {
          if (keys.includes(uses[u].key)) uses[u].conversations.push(n);
        }
      }
      const listed = [
        ...topicLines(uses, noTopic),
        ...proposedLines(proposedKeys),
      ];
      for (let i = 0; i < listed.length; i++) print(listed[i]);
    }
    return failed.length ? 1 : 0;
  } finally {
    await prisma.$disconnect();
  }
}

/** Runs the calibration; answers the process's exit code. */
export async function main(
  argv: string[],
  print: Print = console.log,
): Promise<number> {
  let args;
  try {
    args = parseCalibrationArgs(argv);
  } catch (err) {
    print((err as Error).message);
    print(USAGE);
    return 2;
  }
  let sample: ISample;
  try {
    sample = loadSample(args.sample);
  } catch (err) {
    // The messages of this module's own failures name a file, a column or
    // a number. One from the file system names a path.
    print(`cannot read the sample: ${(err as Error).message}`);
    return 2;
  }
  let vocabulary: ISeedTopic[] | null = null;
  if (args.vocabulary !== undefined) {
    try {
      vocabulary = parseVocabulary(readFileSync(args.vocabulary, 'utf-8'));
    } catch (err) {
      // As above: an entry's number and at most its key, or a path.
      print(`cannot read the vocabulary: ${(err as Error).message}`);
      return 2;
    }
  }
  return args.dry
    ? runDry(sample, args, vocabulary, print)
    : runForReal(sample, args, vocabulary, print);
}
