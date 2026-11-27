import { ChatOutcome, ChatOutcomeTypes } from '#/chat/domain/chat.types';
import {
  TOPIC_KEY_MAX,
  TOPIC_LABEL_LANGUAGES,
  VOCABULARY_CAP,
  parseInsights,
} from '#/chat/domain/chatInsight.prompt';

// Reading a calibration sample (CLEAN-270, spec 038 quickstart section 6):
// the arguments, the labels a person wrote, one transcript, and the list of
// topics a run may be given. Pure: text in, values out; the files are read
// by the runner, api/src/slices/chat/calibration/main.ts, which is in the
// chat slice because it constructs the slice's summary service.
//
// A sample is somebody's conversations. Nothing here puts their text, or
// what the labeller wrote about them, into an error message: a failure
// names the file, the column or the conversation's number.

export interface ICalibrationArgs {
  /** The directory with `transcripts/` and `labels.csv`. */
  sample: string;
  /** Everything but the model call: no credential, no database. */
  dry: boolean;
  /**
   * After the report, the topics the run made and which conversations were
   * stored with each (report.ts, `topicLines`). Off unless asked for.
   */
  topics: boolean;
  /**
   * A file of topics the run starts with (`parseVocabulary`). Absent unless
   * given: the vocabulary then starts empty, as it did before the flag.
   */
  vocabulary?: string;
}

export function parseCalibrationArgs(argv: string[]): ICalibrationArgs {
  let sample: string | null = null;
  let dry = false;
  let topics = false;
  let vocabulary: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--sample':
      case '--vocabulary': {
        const value = argv[i + 1];
        if (value === undefined || value.startsWith('--')) {
          throw new Error(`${argv[i]} requires a value`);
        }
        if (argv[i] === '--sample') sample = value;
        else vocabulary = value;
        i++;
        break;
      }
      case '--dry':
        dry = true;
        break;
      case '--topics':
        topics = true;
        break;
      default:
        throw new Error(`unknown flag ${argv[i]}`);
    }
  }
  if (sample === null) throw new Error('--sample <dir> is required');
  return vocabulary === null
    ? { sample, dry, topics }
    : { sample, dry, topics, vocabulary };
}

/**
 * A CSV file as rows keyed by its header. Reads what a spreadsheet saves:
 * a BOM, CRLF or LF, fields in quotes or not, and inside quotes a comma, a
 * line break and a quote written twice. A blank line is no row; a short row
 * has its missing fields empty.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  // Whether the record has anything in it: a blank line has not.
  let started = false;

  const endField = () => {
    record.push(field);
    field = '';
  };
  const endRecord = () => {
    if (started) {
      endField();
      records.push(record);
    }
    record = [];
    field = '';
    started = false;
  };

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char !== '"') {
        field += char;
      } else if (source[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = false;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      started = true;
    } else if (char === ',') {
      endField();
      started = true;
    } else if (char === '\n') {
      endRecord();
    } else if (char === '\r') {
      // The first half of a CRLF; the line ends at the LF.
      if (source[i + 1] !== '\n') field += char;
    } else {
      field += char;
      started = true;
    }
  }
  endRecord();

  if (records.length === 0) return [];
  const header = records[0].map((name) => name.trim());
  const rows: Record<string, string>[] = [];
  for (let r = 1; r < records.length; r++) {
    const row: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) {
      row[header[c]] = records[r][c] ?? '';
    }
    rows.push(row);
  }
  return rows;
}

/** What one person said about one conversation. */
export interface ILabel {
  n: number;
  chatId: string;
  /** The subject, in the person's words; null for "no subject". */
  subject: string | null;
  outcome: ChatOutcome;
}

export interface ILabels {
  labels: ILabel[];
  /** Conversations with no subject or no outcome written: skipped. */
  unlabelled: number[];
  /** Conversations whose outcome is none of the three: skipped. */
  invalid: number[];
}

const LABEL_COLUMNS = ['n', 'subject', 'outcome', 'note'];

/** What the labeller writes in `note` for a conversation about nothing. */
const NO_SUBJECT_NOTE = 'нет темы';

const OUTCOMES: string[] = Object.values(ChatOutcomeTypes);

/** Words as they are compared: case and spacing do not make a subject. */
const normalised = (text: string) =>
  text.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * The labels of a sample. A row counts when it has a subject and an outcome.
 * An empty subject with the note "нет темы" is a subject too: the person's
 * "this conversation is about nothing". Any other empty subject, and an
 * empty outcome, is a row the person did not get to: skipped, and counted.
 */
export function readLabels(rows: Record<string, string>[]): ILabels {
  const result: ILabels = { labels: [], unlabelled: [], invalid: [] };
  if (rows.length === 0) return result;
  const missing = LABEL_COLUMNS.filter((column) => !(column in rows[0]));
  if (missing.length) {
    throw new Error(`labels.csv has no column: ${missing.join(', ')}`);
  }

  const seen = new Set<number>();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const n = Number(row.n);
    if (!Number.isInteger(n) || row.n.trim() === '') {
      throw new Error(`labels.csv: row ${i + 1} has no conversation number`);
    }
    if (seen.has(n)) {
      throw new Error(`labels.csv: conversation ${n} is labelled twice`);
    }
    seen.add(n);

    const subject = row.subject.replace(/\s+/g, ' ').trim();
    const outcome = normalised(row.outcome);
    const noSubject =
      subject === '' && normalised(row.note) === NO_SUBJECT_NOTE;
    if ((subject === '' && !noSubject) || outcome === '') {
      result.unlabelled.push(n);
    } else if (!OUTCOMES.includes(outcome)) {
      result.invalid.push(n);
    } else {
      result.labels.push({
        n,
        chatId: row.chatId ?? '',
        subject: noSubject ? null : subject,
        outcome: outcome as ChatOutcome,
      });
    }
  }
  return result;
}

/**
 * Whether the person put two conversations under one subject: the same
 * words. "No subject" is the same as nothing, another "no subject"
 * included: two conversations about nothing are not about the same thing.
 */
export function sameSubject(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  return normalised(a) === normalised(b);
}

/**
 * One topic of a `--vocabulary` file: a topic the run starts with, and the
 * reference's words for it.
 */
export interface ISeedTopic {
  key: string;
  /** A label in every console language, each on one line. */
  labels: Record<string, string>;
  /**
   * What the reference labels write in the `subject` column of `labels.csv`
   * for a conversation of this topic. It ties a reference subject to a key
   * and goes nowhere else: never into the store, never into a prompt.
   */
  subject: string;
}

/**
 * Whether the summary would store this key exactly as it is written. Asked
 * of the summary's own parser, as a proposal of a new topic, so that no copy
 * of its rule is kept here to fall behind. A key the parser would tidy
 * ("Order Refunds") is refused as well: the prompt lists a seeded key as it
 * is written and the parser matches the model's answer to it letter by
 * letter.
 */
function isStoredKey(key: string): boolean {
  const labels: Record<string, string> = {};
  for (const language of TOPIC_LABEL_LANGUAGES) labels[language] = 'x';
  const parsed = parseInsights(
    JSON.stringify({ summary: 'x', newTopic: { key, labels } }),
    [],
    { topics: true },
  );
  return parsed?.proposal?.key === key;
}

/**
 * The topics of a `--vocabulary` file, in the order of the file:
 *
 *   [{ "key": "billing", "labels": { "en": "Billing", "ru": "Оплата" },
 *      "subject": "настройка оплаты" }, …]
 *
 * Refused, by the number of the entry (the first is 1): a key the parser
 * would not store as written, a key or a subject given twice, a console
 * language with no label, no subject. And a list longer than the prompt
 * offers: the run measures a choice from the whole list, and the topic that
 * is not listed cannot be chosen.
 *
 * A subject is the reference's wording of what conversations are about, so
 * no message quotes one, and none quotes a key that is not a key: what
 * stands in that field of a file written by hand can be anything.
 */
export function parseVocabulary(content: string): ISeedTopic[] {
  const file = 'the vocabulary file';
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      content.charCodeAt(0) === 0xfeff ? content.slice(1) : content,
    );
  } catch {
    throw new Error(`${file} is not JSON`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(
      `${file} is not a list of { "key", "labels", "subject" } entries`,
    );
  }
  if (parsed.length === 0) throw new Error(`${file} lists no topic`);
  if (parsed.length > VOCABULARY_CAP) {
    throw new Error(
      `${file} lists ${parsed.length} topics: a prompt offers ${VOCABULARY_CAP} at most ` +
        '(VOCABULARY_CAP), and a topic that is not offered cannot be chosen',
    );
  }

  const topics: ISeedTopic[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const entry = `${file}: entry ${i + 1}`;
    const item: unknown = parsed[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`${entry} is not an object`);
    }
    const { key, labels, subject } = item as {
      key?: unknown;
      labels?: unknown;
      subject?: unknown;
    };
    if (typeof key !== 'string' || !isStoredKey(key)) {
      throw new Error(
        `${entry} has no key the summary would store as written: lower-case ` +
          `words joined by single dashes, ${TOPIC_KEY_MAX} characters at most`,
      );
    }
    const named = `${entry} ("${key}")`;
    const sameKey = topics.findIndex((topic) => topic.key === key);
    if (sameKey !== -1) {
      throw new Error(`${named} repeats the key of entry ${sameKey + 1}`);
    }

    const given = (
      labels && typeof labels === 'object' ? labels : {}
    ) as Record<string, unknown>;
    const read: Record<string, string> = {};
    const missing: string[] = [];
    for (const language of TOPIC_LABEL_LANGUAGES) {
      const label = given[language];
      const text =
        typeof label === 'string' ? label.replace(/\s+/g, ' ').trim() : '';
      if (text) read[language] = text;
      else missing.push(language);
    }
    if (missing.length) {
      throw new Error(`${named} has no label in: ${missing.join(', ')}`);
    }

    const words =
      typeof subject === 'string' ? subject.replace(/\s+/g, ' ').trim() : '';
    if (!words) throw new Error(`${named} has no subject`);
    const sameWords = topics.findIndex((topic) =>
      sameSubject(topic.subject, words),
    );
    if (sameWords !== -1) {
      throw new Error(
        `${named} has the subject of entry ${sameWords + 1} ("${topics[sameWords].key}")`,
      );
    }
    topics.push({ key, labels: read, subject: words });
  }
  return topics;
}

/**
 * The seeded key a reference subject stands for: the topic whose `subject`
 * is the same words, as `sameSubject` compares them. Null for "no subject",
 * and for a subject the vocabulary file does not have.
 */
export function seedKeyOf(
  subject: string | null,
  seed: ReadonlyArray<Pick<ISeedTopic, 'key' | 'subject'>>,
): string | null {
  for (let i = 0; i < seed.length; i++) {
    if (sameSubject(seed[i].subject, subject)) return seed[i].key;
  }
  return null;
}

/** One conversation of the sample, as much of it as the prompt reads. */
export interface ITranscript {
  n: number;
  chatId: string;
  messages: Array<{ role: 'user' | 'assistant'; text: string }>;
}

/** One `transcripts/NNN.json`. `file` is its name, for the error. */
export function parseTranscript(content: string, file: string): ITranscript {
  const where = `transcripts/${file}`;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`${where} is not JSON`);
  }
  const { n, chatId, messages } = (parsed ?? {}) as {
    n?: unknown;
    chatId?: unknown;
    messages?: unknown;
  };
  if (typeof n !== 'number' || !Number.isInteger(n)) {
    throw new Error(`${where} has no conversation number`);
  }
  if (!Array.isArray(messages)) throw new Error(`${where} has no messages`);

  const read: ITranscript['messages'] = [];
  for (let i = 0; i < messages.length; i++) {
    const { role, text } = (messages[i] ?? {}) as {
      role?: unknown;
      text?: unknown;
    };
    if ((role !== 'user' && role !== 'assistant') || typeof text !== 'string') {
      throw new Error(
        `${where} message ${i + 1} is not a user or assistant message with a text`,
      );
    }
    read.push({ role, text });
  }
  return {
    n,
    chatId: typeof chatId === 'string' ? chatId : '',
    messages: read,
  };
}
