import {
  IChatAgentScope,
  IChatTopicData,
  IChatTopicLabels,
  IChatTopicUsage,
} from './chat.types';

/**
 * Persistence port of the installation's topics (`ChatTopic`, CLEAN-270,
 * spec 038 research R7): the vocabulary the conversation summary chooses
 * from. Abstract class so that it doubles as a Nest DI token.
 *
 * How much a topic is used is not stored. Every method that says "most
 * used" or gives a count reads it from the conversations that carry the
 * topic (`ChatSession.topicIds`), a conversation of a merged topic counted
 * under the topic it was folded into, and once.
 */
export abstract class IChatTopicGateway {
  /**
   * How many conversations carry each topic that stands, by its id; a topic
   * no conversation carries is absent. With `agentScope`, only conversations
   * with those agents, and a scope that admits no agent answers empty
   * without a query.
   *
   * This is the one read here that passes over the conversations, and it
   * costs what the table is large (`topicUsageQuery` has the measurement).
   * Whoever needs the counts more than once in one piece of work reads them
   * once and keeps them: the summary batch does, for its run.
   */
  abstract usageCounts(
    agentScope?: IChatAgentScope,
  ): Promise<Map<string, number>>;

  /**
   * The topics the model is offered: the ones not merged into another, most
   * used first, at most `cap`. Among equally used ones the older first, so
   * the order does not change between two reads with nothing in between.
   *
   * "Most used" is by `counts`, conversations by standing topic id, which
   * the caller hands in: what `usageCounts` answered, kept and brought up to
   * date by whoever is calling. Only `ChatTopic` is read here, a row per
   * subject, so this is the call to make for every conversation. It takes no
   * counts of its own on purpose: it did once, and the summary batch then
   * passed over every conversation for each conversation it summarised.
   *
   * `always` is ids of topics that are offered whatever their count, in the
   * place of the least used (`offeredTopics`): the ones the calling run
   * coined itself. At most `TOPICS_STANDING_MAX` topics are read, the number
   * that may stand.
   */
  abstract vocabulary(
    cap: number,
    counts: ReadonlyMap<string, number>,
    always?: ReadonlySet<string>,
  ): Promise<IChatTopicData[]>;

  /**
   * The topic this key stands for now: the one that has it, or the one that
   * one was merged into; null when no topic has the key. A look, nothing is
   * created: the summary asks it before it decides whether a proposed key
   * is a topic it may assign (`ChatInsightService`).
   */
  abstract standingByKey(key: string): Promise<IChatTopicData | null>;

  /** How many topics stand: the ones not merged into another. */
  abstract countStanding(): Promise<number>;

  /**
   * Whether the installation has a vocabulary: at least one topic stands
   * (CLEAN-270, the owner's decision of 2026-11-28). While it has none, the
   * summary asks no conversation about topics and the statistics page shows
   * no topics block; how a vocabulary comes to exist is CLEAN-278.
   *
   * Asked by the summary batch once per run and by every view of the
   * statistics page, so it is bounded to one row: the first topic that
   * stands, by its id alone, from a table that holds a row per subject
   * (`TOPICS_STANDING_MAX` standing, and what was merged). Not a count, and
   * no conversation is read.
   */
  abstract hasStanding(): Promise<boolean>;

  /**
   * The topic with this key, created with `labels` when there is none. An
   * existing topic keeps the labels it has. When the key is one that was
   * merged, the answer is the topic it was folded into: the subject already
   * has a name.
   *
   * Whether a new topic may be coined at all (`TOPICS_STANDING_MAX`) is the
   * caller's to ask first; this creates.
   */
  abstract findOrCreateByKey(
    key: string,
    labels: IChatTopicLabels,
  ): Promise<IChatTopicData>;

  /** The topic with exactly this key, merged or not; null when none. */
  abstract findByKey(key: string): Promise<IChatTopicData | null>;

  /**
   * Fold `fromId` into `intoId`: every reader counts the conversations of
   * the first under the second from now on, and the first is no longer
   * offered to the model. Whatever was folded into the first earlier is
   * re-pointed to the second in the same transaction, so that following
   * `mergedIntoId` once always arrives at a topic that stands.
   *
   * The caller has checked that the two differ and that neither is merged
   * (`topicMergeRefusal`), to tell the person why before asking them to
   * confirm. The same rules are asked again here, inside the transaction
   * and of rows it has locked, because another merge can land between that
   * look and this write: two merges, each allowed when it was looked at,
   * would otherwise leave a chain A → B → C, and a reader follows
   * `mergedIntoId` once. A merge the rows no longer allow is thrown as
   * `ChatTopicMergeRefused` and writes nothing. Nothing here undoes a merge.
   */
  abstract merge(fromId: string, intoId: string): Promise<void>;

  /**
   * The topics that stand for these ids now, by the id asked: the topic
   * itself, or the one it was merged into (followed once). An id that names
   * nothing is absent.
   */
  abstract findByIds(
    ids: readonly string[],
  ): Promise<Map<string, IChatTopicData>>;

  /**
   * Every topic that is not merged, with how many conversations carry it
   * and the keys folded into it; most used first. With `agentScope`, only
   * conversations with those agents are counted. The topics are listed
   * whole either way: the caller decides what a count of zero means.
   */
  abstract listWithCounts(
    agentScope?: IChatAgentScope,
  ): Promise<IChatTopicUsage[]>;
}
