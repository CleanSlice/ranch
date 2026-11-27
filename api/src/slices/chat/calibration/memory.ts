import type { AgentPermissionService } from '#/agent/agent/domain/agentPermission.service';
import type { TranscriptReaderService } from '#/agent/file/domain';
import {
  IChatGateway,
  IChatSessionData,
  IChatSummaryData,
  IChatTopicData,
  IChatTopicGateway,
  IChatTopicLabels,
  offeredTopics,
  topicUsage,
} from '../domain';
import type { ITranscript } from '../../../scripts/summaryCalibration/sample';

// What the summary service reads and writes during a calibration, held in
// memory (CLEAN-270). The script runs `ChatInsightService` itself, the class
// the batch runs, so that the prompt, the call, the parser and the way a
// topic is assigned or coined are the ones that ship. These stand in for
// its two gateways, its transcript reader and the agent slice's answer to
// "which agents are the Owner's alone": the sample's conversations go
// in, what a summary would have written is kept here, and nothing reaches a
// database. The vocabulary starts empty, or with the topics the run was
// given.

const SESSION_PREFIX = 'calibration-';
const AGENT_ID = 'calibration';

/**
 * An object with the given methods and no other: a call to anything else
 * throws. The store is typed as the whole gateway, and the summary of one
 * conversation uses a few methods of it; a call past those is a change in
 * the service that the calibration has to be looked at for.
 */
function only<T extends object>(name: string, methods: Partial<T>): T {
  return new Proxy(methods, {
    get: (target, property) => {
      if (property in target) return target[property as keyof T];
      if (typeof property === 'symbol' || property === 'then') return undefined;
      return () => {
        throw new Error(`${name}.${property} is not part of a calibration`);
      };
    },
  }) as T;
}

export interface ICalibrationStore {
  chats: IChatGateway;
  topics: IChatTopicGateway;
  reader: TranscriptReaderService;
  /** Which agents only the Owner manages: none of a calibration's. */
  permission: AgentPermissionService;
  /** The id `ChatInsightService.summarize` is called with for conversation `n`. */
  sessionId: (n: number) => string;
  /** What the summary of each conversation would have written, by `n`. */
  saved: Map<number, IChatSummaryData>;
  /**
   * The keys of the topics coined so far, in the order they were coined. A
   * topic the run started with was not coined, and is not among them.
   */
  coined: () => string[];
  /** The keys of these topic ids; an id that names nothing is left out. */
  keysOf: (topicIds: readonly string[]) => string[];
  /**
   * The topics of the run by key and English label: the ones it started
   * with, in the order given, then the ones coined, in the order they were
   * coined. What `--topics` lists. Nothing is merged in a calibration, so
   * every topic stands. The label is the one the prompt lists a topic by,
   * with the same fallback to the key.
   */
  standing: () => Array<{ key: string; label: string }>;
}

/**
 * `seed` is the topics the run starts with (`--vocabulary`), none unless
 * given. They stand before the first conversation as topics no conversation
 * uses yet, the earlier in the list the older, which is the order
 * `topicUsage` offers unused topics in: so the first prompt lists all of
 * them, in the order given. Only a key and its labels are taken: what else
 * a caller's objects carry stays with the caller.
 */
export function createCalibrationStore(
  conversations: readonly ITranscript[],
  seed: ReadonlyArray<Pick<IChatTopicData, 'key' | 'labels'>> = [],
): ICalibrationStore {
  const byN = new Map(conversations.map((c) => [c.n, c]));
  const saved = new Map<number, IChatSummaryData>();
  const topics: IChatTopicData[] = [];
  /** A topic as the table would hold it; later ones sort later among equals. */
  const stand = (key: string, labels: IChatTopicLabels): IChatTopicData => {
    const topic: IChatTopicData = {
      id: `calibration-topic-${topics.length + 1}`,
      key,
      labels,
      mergedIntoId: null,
      createdAt: new Date(topics.length),
    };
    topics.push(topic);
    return topic;
  };
  for (let i = 0; i < seed.length; i++) {
    stand(seed[i].key, { ...seed[i].labels });
  }
  const seeded = topics.length;

  const sessionId = (n: number) => `${SESSION_PREFIX}${n}`;
  const numberOf = (id: string) =>
    id.startsWith(SESSION_PREFIX)
      ? Number(id.slice(SESSION_PREFIX.length))
      : NaN;

  const sessionOf = (conversation: ITranscript): IChatSessionData => ({
    id: sessionId(conversation.n),
    agentId: AGENT_ID,
    channel: 'bridle',
    externalUserId: 'calibration',
    sessionKey: sessionId(conversation.n),
    title: null,
    preview: null,
    lastRole: null,
    lastMessageAt: new Date(0),
    messageCount: conversation.messages.length,
    userMessageCount: conversation.messages.filter((m) => m.role === 'user')
      .length,
    lastIndexedEventId: null,
    lastIndexedSize: 0,
    summary: null,
    summaryAt: null,
    insights: null,
    outcome: null,
    question: null,
    topicIds: [],
    insightVersion: 0,
    archived: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  });

  /** Conversations by topic, read from what was saved, as the table is. */
  const counts = () => {
    const byTopic = new Map<string, number>();
    for (const summary of saved.values()) {
      for (const id of new Set(summary.topicIds)) {
        byTopic.set(id, (byTopic.get(id) ?? 0) + 1);
      }
    }
    return byTopic;
  };

  const chats = only<IChatGateway>('chats', {
    findById: (id: string) => {
      const conversation = byN.get(numberOf(id));
      return Promise.resolve(conversation ? sessionOf(conversation) : null);
    },
    saveInsights: (id: string, summary: IChatSummaryData) => {
      saved.set(numberOf(id), summary);
      return Promise.resolve();
    },
  });

  const topicGateway = only<IChatTopicGateway>('topics', {
    // What the summary service reads once per call and keeps a tally of
    // from then on. The script summarises one conversation per call, so
    // each call reads what the calls before it saved.
    usageCounts: () => Promise.resolve(counts()),
    // The order the batch offers them in: `topicUsage` and `offeredTopics`
    // are the functions the real gateway sorts and chooses with, by the
    // counts the service hands in and with the topics the run names always
    // among them, as the real gateway does.
    vocabulary: (
      cap: number,
      given: ReadonlyMap<string, number>,
      always: ReadonlySet<string> = new Set(),
    ) => Promise.resolve(offeredTopics(topicUsage(topics, given), cap, always)),
    // Nothing is merged in a calibration, so a key stands for its own
    // topic and every topic stands.
    standingByKey: (key: string) =>
      Promise.resolve(topics.find((t) => t.key === key) ?? null),
    countStanding: () => Promise.resolve(topics.length),
    findOrCreateByKey: (key: string, labels: IChatTopicLabels) =>
      // Coined later, sorted later among equally used ones.
      Promise.resolve(topics.find((t) => t.key === key) ?? stand(key, labels)),
  });

  const reader = only<TranscriptReaderService>('reader', {
    read: (_agentId: string, path: string) => {
      const match = /^data\/sessions\/calibration-(\d+)\.jsonl$/.exec(path);
      const conversation = match ? byN.get(Number(match[1])) : undefined;
      if (!conversation) {
        return Promise.reject(new Error('no such conversation in the sample'));
      }
      return Promise.resolve(
        conversation.messages.map((message, i) => ({
          id: `m${i + 1}`,
          role: message.role,
          text: message.text,
          ts: i,
        })),
      );
    },
  });

  // Every conversation of a sample is asked the topic judgment, which is
  // what the calibration measures: none is with an agent only the Owner
  // manages, the one case the service asks for no topic (CLEAN-270, review).
  const permission = only<AgentPermissionService>('permission', {
    ownerOnlyAgentIds: () => Promise.resolve([]),
  });

  return {
    chats,
    topics: topicGateway,
    reader,
    permission,
    sessionId,
    saved,
    coined: () => topics.slice(seeded).map((t) => t.key),
    keysOf: (topicIds) =>
      topicIds
        .map((id) => topics.find((t) => t.id === id)?.key)
        .filter((key): key is string => key !== undefined),
    standing: () =>
      topics.map((t) => ({ key: t.key, label: t.labels.en ?? t.key })),
  };
}
