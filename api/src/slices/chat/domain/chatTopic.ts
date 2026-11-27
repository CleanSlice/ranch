import {
  IChatSessionData,
  IChatTopicData,
  IChatTopicUsage,
} from './chat.types';
import { TOPIC_LABEL_LANGUAGES } from './chatInsight.prompt';
import { IChatTopicGateway } from './chatTopic.gateway';

// What is decided about a topic without the database (CLEAN-270): which
// label a reader gets, which language a request asks for, whether one topic
// may be folded into another, and the order "most used first".

/** The language every topic has a label in, and readers fall back to. */
const FALLBACK_LANGUAGE = TOPIC_LABEL_LANGUAGES[0];

/**
 * The topic's label in `language`; the English one when the topic has none
 * in that language (it was coined before the console had it); the key when
 * it has neither, so that a topic is never shown as nothing.
 */
export function topicLabel(topic: IChatTopicData, language: string): string {
  return topic.labels[language] || topic.labels[FALLBACK_LANGUAGE] || topic.key;
}

/**
 * The console language a request asks for, from its `Accept-Language`
 * header: the one with the highest weight among the languages topics have
 * labels in, English when it names none of them or is absent. Only the
 * language is read, not the region: `ru-RU` is `ru`.
 */
export function topicLanguageOf(acceptLanguage: string | undefined): string {
  const wanted = (acceptLanguage ?? '')
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params
        .map((p) => p.trim())
        .find((p) => p.toLowerCase().startsWith('q='));
      const weight = q === undefined ? 1 : Number(q.slice(2));
      return {
        language: tag.trim().toLowerCase().split('-')[0],
        weight: Number.isFinite(weight) ? weight : 0,
      };
    })
    .filter(
      (entry) =>
        entry.weight > 0 &&
        (TOPIC_LABEL_LANGUAGES as readonly string[]).includes(entry.language),
    )
    // Stable: of two equal weights the one written first stays first.
    .sort((a, b) => b.weight - a.weight);
  return wanted[0]?.language ?? FALLBACK_LANGUAGE;
}

/**
 * Why `from` may not be folded into `into`, or null when it may.
 *
 * A reader follows `mergedIntoId` once. So the target has to be a topic
 * that stands, or the conversations of `from` would be counted under one
 * that no list shows; and a topic already merged has been decided, and
 * nothing here moves it a second time.
 */
export function topicMergeRefusal(
  from: IChatTopicData,
  into: IChatTopicData,
): string | null {
  if (from.id === into.id) {
    return `Topic «${from.key}» cannot be merged into itself.`;
  }
  if (from.mergedIntoId !== null) {
    return `Topic «${from.key}» is already merged into another topic.`;
  }
  if (into.mergedIntoId !== null) {
    return `Topic «${into.key}» was merged into another topic itself: merge into that one.`;
  }
  return null;
}

/**
 * The topics that stand, most used first, each with the keys folded into
 * it. `counts` is conversations by topic id, already folded: a conversation
 * of a merged topic is counted under its target.
 *
 * Among equally used topics the older comes first, then the key: the list
 * the model is offered must not change order between two reads with nothing
 * in between, or which sixty are offered would depend on the order the rows
 * happened to come back in.
 */
export function topicUsage(
  topics: readonly IChatTopicData[],
  counts: ReadonlyMap<string, number>,
): IChatTopicUsage[] {
  const mergedKeys = new Map<string, string[]>();
  for (const topic of topics) {
    if (topic.mergedIntoId === null) continue;
    const keys = mergedKeys.get(topic.mergedIntoId) ?? [];
    keys.push(topic.key);
    mergedKeys.set(topic.mergedIntoId, keys);
  }
  return topics
    .filter((topic) => topic.mergedIntoId === null)
    .map((topic) => ({
      topic,
      conversations: counts.get(topic.id) ?? 0,
      merged: (mergedKeys.get(topic.id) ?? []).sort(),
    }))
    .sort(
      (a, b) =>
        b.conversations - a.conversations ||
        a.topic.createdAt.getTime() - b.topic.createdAt.getTime() ||
        a.topic.key.localeCompare(b.topic.key),
    );
}

/**
 * How many topics may stand at once (CLEAN-270, review). A topic is coined
 * whenever a conversation has no clear fit in the list, and what a person
 * writes can steer the model to coin one, so without a bound the table
 * grows with the conversations.
 *
 * 100: the prompt offers 60 (`VOCABULARY_CAP`), and the 40 above that are
 * room for subjects that are new and not yet much used. Past it a new key is
 * more likely a rewording of a subject that already has one than a subject
 * nobody has named. At the bound a proposal is dropped and its conversation
 * is stored with no topic; an operator who folds two topics into one
 * (`merge_chat_topics`) makes room for the next.
 *
 * It bounds growth and is not an invariant of the table: a summary asked for
 * by hand beside the batch can coin the hundred-and-first.
 */
export const TOPICS_STANDING_MAX = 100;

/**
 * The topics a prompt lists: the most used, at most `cap`, and among them
 * always the ones in `always`, the topics the run that is asking coined
 * itself. Those take their places from the least used; the list stays in
 * the order of `usage`, most used first.
 *
 * Why the run's own topics are not left to their count (CLEAN-270, review):
 * once `cap` topics are in use, one coined a conversation ago has a single
 * use and the newest date, so it stands past the cap. The next conversation
 * on the same subject was then not shown it and coined a second key for it.
 */
export function offeredTopics(
  usage: readonly IChatTopicUsage[],
  cap: number,
  always: ReadonlySet<string>,
): IChatTopicData[] {
  const pinned = usage
    .filter((entry) => always.has(entry.topic.id))
    .slice(0, cap);
  const places = cap - pinned.length;
  let given = 0;
  return usage
    .filter((entry) => always.has(entry.topic.id) || given++ < places)
    .slice(0, cap)
    .map((entry) => entry.topic);
}

/**
 * A merge that the state of the two topics does not allow
 * (`topicMergeRefusal`), found inside the transaction that would have made
 * it: another merge got there between the caller's look and this write. The
 * message is the refusal, in words for the person.
 */
export class ChatTopicMergeRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChatTopicMergeRefused';
  }
}

/**
 * The labels of the topics each of these conversations carries, in
 * `language`: one read for all of them. A merged topic is named by the one
 * it was folded into, which is then named once; an id that names no topic
 * is left out.
 */
export async function topicLabelsFor(
  topics: IChatTopicGateway,
  sessions: ReadonlyArray<Pick<IChatSessionData, 'topicIds'>>,
  language: string,
): Promise<(session: Pick<IChatSessionData, 'topicIds'>) => string[]> {
  const ids = [...new Set(sessions.flatMap((session) => session.topicIds))];
  const found = ids.length
    ? await topics.findByIds(ids)
    : new Map<string, IChatTopicData>();
  return (session) => {
    const standing = new Map<string, IChatTopicData>();
    for (const id of session.topicIds) {
      const topic = found.get(id);
      if (topic) standing.set(topic.id, topic);
    }
    return [...standing.values()].map((topic) => topicLabel(topic, language));
  };
}
