import { IAgentGateway } from '#/agent/agent/domain/agent.gateway';
import { AgentPermissionService } from '#/agent/agent/domain/agentPermission.service';
import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { Tool, ToolAudience, ToolTopics } from '#mcp';
import {
  callerIsOperator,
  err,
  ok,
  requireOperator,
  type ToolResult,
  agentNotFound,
  callerParty,
  ownerOnlyConversationsLeftOut,
  ownerOnlyRefusal,
  OWNER_ONLY_LEFT_OUT_FIELD,
  confirmed,
  CONFIRM_SENTENCE,
} from '#/mcp/tooling';
import { AgentAccessService } from '#/user/agentAccess/domain/agentAccess.service';
import type { IConditionallyListedTool } from '#/mcp/interfaces/conditional-listing.interface';
import { IAuthTokenPayload } from '#/user/auth/domain';
import {
  TranscriptReaderService,
  TranscriptMessage,
} from '#/agent/file/domain';
import {
  IChatGateway,
  IChatTopicGateway,
  ChatSyncService,
  ChatInsightService,
  ChatTopicMergeRefused,
  topicLabelsFor,
  topicMergeRefusal,
  type IChatSessionData,
  type IChatTopicData,
  type IChatTopicUsage,
} from './domain';

type AuthedRequest = Request & { user?: IAuthTokenPayload };

const NOT_FOUND = (id: string) =>
  ok({ error: `Chat ${id} not found — call list_chats to find the id` });

const TOPIC_NOT_FOUND = (key: string) =>
  ok({
    error: `Topic ${key} not found — call list_chat_topics to find the key`,
  });

/**
 * The language a tool names topics in: the one `insights.topics` is written
 * in, and the one the operator's agent reads. `list_chat_topics` gives every
 * label for an answer in another language.
 */
const TOOL_TOPIC_LANGUAGE = 'en';

/** A topic key as it is stored, whatever case and blanks it was typed with. */
const topicKeyOf = (value: string) => value.trim().toLowerCase();

/** Same defaults as `FilterChatsDto` / `ChatMessagesQueryDto`. */
const DEFAULT_PAGE = 1;
const DEFAULT_PER_PAGE = 50;
const MAX_PER_PAGE = 100;
/** The tool tails a chat: 20 last turns is a screenful, the console's 50 is not. */
const DEFAULT_MESSAGE_LIMIT = 20;
const MAX_MESSAGE_LIMIT = 200;

const MESSAGE_TYPES = [
  'user',
  'assistant',
  'summary',
  'tool_call',
  'tool_result',
  'system',
] as const;
const DEFAULT_TYPES: TranscriptMessage['role'][] = [
  'user',
  'assistant',
  'summary',
];

/**
 * The index row without its bookkeeping. `sessionKey` stays: it names the
 * transcript file and export filename, and the person may recognise it from
 * the console.
 *
 * `agentName` goes beside `agentId` (CLEAN-267): the same end user has a
 * chat with every agent they talked to, and a row that says whose it is by
 * an id alone was read as the chat of the agent the person had asked about.
 *
 * `outcome`, `question` and `topics` are what version 2 of the summary says
 * (CLEAN-270): null, null and none while there is no summary, which is not
 * the same as an outcome of `unknown`. Topics by label; their ids and the
 * prompt's version are bookkeeping and stay out.
 */
function toToolChat(
  s: IChatSessionData,
  agentName: string | null,
  topics: string[],
) {
  return {
    id: s.id,
    agentId: s.agentId,
    agentName,
    channel: s.channel,
    externalUserId: s.externalUserId,
    sessionKey: s.sessionKey,
    title: s.title,
    preview: s.preview,
    lastRole: s.lastRole,
    lastMessageAt: s.lastMessageAt,
    messageCount: s.messageCount,
    userMessageCount: s.userMessageCount,
    summary: s.summary,
    summaryAt: s.summaryAt,
    outcome: s.outcome,
    question: s.question,
    topics,
    insights: s.insights,
    archived: s.archived,
    createdAt: s.createdAt,
  };
}

/**
 * The chat history the console shows under Chats, for the operator agent
 * (CLEAN-109): list and read sessions, replay a transcript tail, reconcile
 * the index against the runtimes' files, ask for an LLM summary, and point
 * at the export download.
 *
 * Every call goes through the same four things `ChatController` injects —
 * `IChatGateway`, `TranscriptReaderService`, `ChatSyncService`,
 * `ChatInsightService` — and calls them the way the controller does: the
 * transcript path is built from the session's key, an unreadable file is an
 * empty transcript rather than a failure, and the model-facing text of a
 * user turn only rides along when tool events were asked for.
 *
 * Operator-only: a chat is somebody's conversation with an agent, and a plain
 * agent must not be able to read other people's sessions.
 *
 * Two tools have no console screen behind them (CLEAN-270, spec 038
 * contracts/api.md): `list_chat_topics` and `merge_chat_topics`, the remedy
 * when the summaries gave one subject two labels. They live here because
 * the fact they change, `ChatTopic`, is this slice's. They follow the same
 * rule as the rest of the class: a count over conversations is a reading of
 * them, so it is asked for the agents `supervised` answers.
 */
@ToolAudience('admin')
@Injectable()
export class ChatTool implements IConditionallyListedTool {
  private readonly logger = new Logger(ChatTool.name);

  constructor(
    private readonly chats: IChatGateway,
    private readonly reader: TranscriptReaderService,
    private readonly sync: ChatSyncService,
    private readonly insight: ChatInsightService,
    private readonly access: AgentAccessService,
    private readonly permission: AgentPermissionService,
    private readonly agents: IAgentGateway,
    private readonly topics: IChatTopicGateway,
  ) {}

  /**
   * The agents whose conversations the person this call is made for may
   * read: the ones they reach (CLEAN-231), less any that only the Owner
   * manages (CLEAN-236). The same rule as `ChatController.supervised`: the
   * Owner's conversation with the Ranch admin agent is not an Admin's to
   * read through the chat any more than through the console.
   *
   * What is taken out is not passed off as absent (CLEAN-267). An agent the
   * caller does not reach is an agent that does not exist, in the usual
   * words. The Ranch assistant is one they are talking to, so every tool
   * here says whose its conversations are, in one sentence with
   * `reason: "owner_only"`: asked for by agent id (`agentNotFound` with the
   * kind `conversations`), by the id of one of its chats (`chatFor`), and
   * beside a list or a sync over every agent, which says they were left out
   * (`leftOut`). "Not found" for it made the model look for the same
   * conversations another way and present another agent's chat as the
   * assistant's; a silent list made it say there were none.
   */
  private async supervised(httpRequest: Request) {
    const caller = callerParty(httpRequest);
    const [reach, ownerOnly] = await Promise.all([
      this.access.reachableIds(caller),
      this.permission.ownerOnlyIds(caller),
    ]);
    return reach.without(ownerOnly);
  }

  /**
   * The session, when it exists and the caller may read the conversations
   * of its agent; otherwise the answer to hand back. A chat of an agent out
   * of reach is a chat that does not exist. A chat of the Ranch assistant,
   * asked for by a person who has the assistant and is not the Owner, is the
   * Owner's to read, and is said to be.
   *
   * That confirms that the id is one of the assistant's chats. It tells
   * such a person nothing they may not know: they talk to the assistant,
   * are shown it by `list_agents`, and are told by `list_chats` that its
   * conversations are left out. A chat id is not something they can list
   * or guess, and the answer carries no title, participant, count or date.
   */
  private async chatFor(
    httpRequest: Request,
    id: string,
  ): Promise<
    | { session: IChatSessionData; refusal?: undefined }
    | { session?: undefined; refusal: ToolResult }
  > {
    const session = await this.chats.findById(id);
    if (!session) return { refusal: NOT_FOUND(id) };
    if ((await this.supervised(httpRequest)).has(session.agentId)) {
      return { session };
    }
    return {
      refusal:
        ownerOnlyRefusal(httpRequest, session.agentId, 'conversations') ??
        NOT_FOUND(id),
    };
  }

  /**
   * The field a result over every agent carries when the assistant's
   * conversations were left out of it; nothing when an agent was named, and
   * nothing for a caller who reads them or cannot know of them.
   */
  private leftOut(
    httpRequest: Request,
    agentId: string | undefined,
  ): Record<string, string> {
    const note = agentId ? null : ownerOnlyConversationsLeftOut(httpRequest);
    return note ? { [OWNER_ONLY_LEFT_OUT_FIELD]: note } : {};
  }

  /**
   * The names of the agents these chats belong to, read once per call. Every
   * chat that gets here passed `supervised`, so every name is one of an
   * agent the caller reaches. Null for an agent that no longer exists.
   */
  private async agentNames(
    sessions: IChatSessionData[],
  ): Promise<(agentId: string) => string | null> {
    const ids = [...new Set(sessions.map((s) => s.agentId))];
    const names = new Map<string, string | null>(
      await Promise.all(
        ids.map(
          async (id) =>
            [id, (await this.agents.findById(id))?.name ?? null] as const,
        ),
      ),
    );
    return (agentId) => names.get(agentId) ?? null;
  }

  /** These chats as the tools hand them back: each with its agent's name and its topics by label. */
  private async toToolChats(sessions: IChatSessionData[]) {
    const [nameOf, labelsOf] = await Promise.all([
      this.agentNames(sessions),
      topicLabelsFor(this.topics, sessions, TOOL_TOPIC_LANGUAGE),
    ]);
    return sessions.map((s) => toToolChat(s, nameOf(s.agentId), labelsOf(s)));
  }

  /**
   * The topics this caller is shown, each with the conversations they may
   * read: the ones `supervised` answers, as for every chat tool.
   *
   * Whoever reads every conversation is shown the whole vocabulary, a topic
   * nobody uses any more included. For anybody else a topic with none of
   * their conversations is one that does not exist: its name was coined from
   * what people said to an agent they do not read, the Owner's conversations
   * with the Ranch assistant among them (CLEAN-236), and a list of subjects
   * is a reading of those conversations too.
   *
   * `whole` says which of the two the caller is: true for the one who reads
   * every conversation.
   */
  private async shownTopics(
    httpRequest: Request,
  ): Promise<{ shown: IChatTopicUsage[]; whole: boolean }> {
    const scope = (await this.supervised(httpRequest)).where();
    const usage = await this.topics.listWithCounts(scope);
    return {
      shown: scope ? usage.filter((entry) => entry.conversations > 0) : usage,
      whole: !scope,
    };
  }

  async isListedForRequest(httpRequest: Request): Promise<boolean> {
    return Promise.resolve(callerIsOperator(httpRequest));
  }

  // ─── Reading ─────────────────────────────────────────────────────────

  @Tool({
    name: 'list_chats',
    topic: ToolTopics.ChatsUsage,
    effect: 'read',
    title: 'List chats',
    template: 'List the recent chats «of agent name»',
    description:
      'Chat sessions from the index, most recently active first, with the ' +
      'title, preview, counts and any stored summary of each: with it the ' +
      'person’s main `question`, the `outcome` (resolved, open, or unknown ' +
      'when the summary could not tell; null while there is no summary) ' +
      'and the `topics`. Filter by ' +
      'agent id (list_agents resolves a name), channel or a search over ' +
      'title / preview / end-user id; archived and internal (cron, ' +
      'heartbeat) sessions are hidden unless asked for. Without an agent ' +
      'id the channel and search filters match across every agent: the ' +
      'same end-user id (`admin`, an account id) has a chat with each ' +
      'agent that person talked to, so read `agentId` / `agentName` on ' +
      'each row before saying whose chat it is. Paged: `total` says how ' +
      'many match. When the result carries `notIncluded`, conversations ' +
      'exist that this person may not read: say so, never that there are ' +
      'none. Use the `id` of a row with get_chat, get_chat_messages, ' +
      'summarize_chat or export_chat.',
    parameters: z.object({
      agentId: z.string().optional().describe('Restrict to one agent'),
      channel: z
        .enum(['bridle', 'telegram', 'slack', 'internal'])
        .optional()
        .describe('Restrict to one channel'),
      search: z
        .string()
        .optional()
        .describe('Matches title / preview / externalUserId'),
      archived: z
        .boolean()
        .optional()
        .describe('Show archived sessions instead (default false)'),
      includeInternal: z
        .boolean()
        .optional()
        .describe('Include internal cron/heartbeat sessions (default false)'),
      page: z.number().int().min(1).optional().describe('Page, from 1'),
      perPage: z
        .number()
        .int()
        .min(1)
        .max(MAX_PER_PAGE)
        .optional()
        .describe(`Rows per page (default ${DEFAULT_PER_PAGE})`),
    }),
  })
  async listChats(
    args: {
      agentId?: string;
      channel?: string;
      search?: string;
      archived?: boolean;
      includeInternal?: boolean;
      page?: number;
      perPage?: number;
    },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const page = args.page ?? DEFAULT_PAGE;
    const perPage = args.perPage ?? DEFAULT_PER_PAGE;
    const reach = await this.supervised(httpRequest);
    if (args.agentId && !reach.has(args.agentId)) {
      return agentNotFound(httpRequest, args.agentId, 'conversations');
    }
    const { items, total } = await this.chats.list({
      ...args,
      agentScope: reach.where(),
      page,
      perPage,
    });
    return ok({
      items: await this.toToolChats(items),
      total,
      page,
      perPage,
      ...this.leftOut(httpRequest, args.agentId),
    });
  }

  @Tool({
    name: 'get_chat',
    topic: ToolTopics.ChatsUsage,
    effect: 'read',
    title: 'Show a chat',
    template: 'Show the chat «id»',
    description:
      'One chat session from the index: the agent it is with (`agentId`, ' +
      '`agentName`), channel, end user, title, preview, message counts, ' +
      'when it was last active, and the stored ' +
      'summary and insights if summarize_chat (or the nightly batch) has ' +
      'run: the main `question`, the `outcome` (resolved, open, or unknown ' +
      'when the summary could not tell) and the `topics`. All null or ' +
      'empty while there is no summary. Metadata only — read the turns ' +
      'with get_chat_messages.',
    parameters: z.object({
      id: z.string().describe('Chat session id (list_chats has them)'),
    }),
  })
  async getChat(
    { id }: { id: string },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const { session, refusal } = await this.chatFor(httpRequest, id);
    if (!session) return refusal;
    const [chat] = await this.toToolChats([session]);
    return ok(chat);
  }

  @Tool({
    name: 'get_chat_messages',
    topic: ToolTopics.ChatsUsage,
    effect: 'read',
    title: 'Read chat messages',
    template: 'Show the last «20» messages of chat «id»',
    description:
      'Replay the transcript of a chat, tail first: the last `limit` turns ' +
      '(default 20) with role, text and timestamp, plus the name, type and ' +
      'size of any files the person attached (never their contents). ' +
      '`agentId` / `agentName` say which agent the conversation is with. ' +
      '`summary` turns are compaction markers for older history. When ' +
      '`hasMore` is true, pass `nextCursor` back to read the older page. ' +
      'Add tool_call / tool_result to `types` only to debug what the agent ' +
      'did — it makes the reply much larger.',
    parameters: z.object({
      id: z.string().describe('Chat session id (list_chats has them)'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_MESSAGE_LIMIT)
        .optional()
        .describe(
          `How many of the latest messages to return (default ${DEFAULT_MESSAGE_LIMIT})`,
        ),
      cursor: z
        .string()
        .optional()
        .describe('`nextCursor` from a previous page, to read older turns'),
      types: z
        .array(z.enum(MESSAGE_TYPES))
        .optional()
        .describe('Event types to include (default user, assistant, summary)'),
    }),
  })
  async getChatMessages(
    args: {
      id: string;
      limit?: number;
      cursor?: string;
      types?: TranscriptMessage['role'][];
    },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const { session, refusal } = await this.chatFor(httpRequest, args.id);
    if (!session) return refusal;
    const agentName = (await this.agentNames([session]))(session.agentId);

    const types = args.types?.length ? args.types : DEFAULT_TYPES;
    const path = `data/sessions/${session.sessionKey}.jsonl`;
    let all: TranscriptMessage[];
    try {
      all = await this.reader.read(session.agentId, path, {
        types,
        filterTransient: true,
      });
    } catch (e) {
      // Same call as the controller: a row may predate its file, or the file
      // was archived or reset. An empty transcript, not a failure.
      this.logger.warn(
        `transcript read failed for ${session.agentId}/${session.sessionKey}: ${(e as Error).message}`,
      );
      return ok({
        chatId: session.id,
        agentId: session.agentId,
        agentName,
        messages: [],
        nextCursor: null,
        hasMore: false,
        note: 'The transcript file is missing or unreadable — the index row exists but there is nothing to replay.',
      });
    }

    const page = TranscriptReaderService.page(
      all,
      args.cursor,
      args.limit ?? DEFAULT_MESSAGE_LIMIT,
    );
    // The full model-facing text of a user turn is a debug artefact; it
    // rides along only when tool events were asked for (the controller's
    // debug signal).
    const debug = types.includes('tool_call') || types.includes('tool_result');
    const messages = debug
      ? page.messages
      : TranscriptReaderService.withoutAgentText(page.messages);
    return ok({
      chatId: session.id,
      agentId: session.agentId,
      agentName,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        text: m.text,
        ts: m.ts,
        ...(m.attachments?.length ? { attachments: m.attachments } : {}),
        ...(m.agentText !== undefined ? { agentText: m.agentText } : {}),
      })),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    });
  }

  // ─── Acting ──────────────────────────────────────────────────────────

  @Tool({
    name: 'sync_chats',
    topic: ToolTopics.ChatsUsage,
    effect: 'write',
    title: 'Sync chats from runtimes',
    template: 'Sync chats «of agent name» from their runtimes',
    description:
      'Reconcile the chat index against the session files the agent ' +
      'runtimes keep in storage — for one agent, or every agent when no id ' +
      'is given. Use it when a chat the person knows happened is missing ' +
      'from list_chats. Returns how many agents and files were scanned and ' +
      'how many rows were updated; all zeros with nothing scanned means a ' +
      'sync was already running — try again in a minute. When the result ' +
      'carries `notIncluded`, an agent this person may not read was left ' +
      'out of the walk and of the counts.',
    parameters: z.object({
      agentId: z
        .string()
        .optional()
        .describe('Reconcile only this agent; omit for all agents'),
    }),
  })
  async syncChats(
    { agentId }: { agentId?: string },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const reach = await this.supervised(httpRequest);
    if (agentId && !reach.has(agentId)) {
      return agentNotFound(httpRequest, agentId, 'conversations');
    }
    return ok({
      ...(await this.sync.syncAll(agentId, reach)),
      ...this.leftOut(httpRequest, agentId),
    });
  }

  @Tool({
    name: 'summarize_chat',
    topic: ToolTopics.ChatsUsage,
    effect: 'write',
    title: 'Summarize a chat',
    template: 'Summarize the chat «id»',
    description:
      'Generate (or refresh) an LLM summary and structured insights — ' +
      'the main question, the outcome (resolved, open or unknown), topics ' +
      'from the installation’s list, sentiment, language — for one chat, ' +
      'and store them ' +
      'on the session. Needs an active Anthropic credential in Settings → ' +
      'LLM credentials; the call reports it when one is missing or ' +
      'rejected. Returns the session with its new summary. A chat whose ' +
      'transcript is empty comes back unchanged.',
    parameters: z.object({
      id: z.string().describe('Chat session id (list_chats has them)'),
    }),
  })
  async summarizeChat(
    { id }: { id: string },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const found = await this.chatFor(httpRequest, id);
    if (!found.session) return found.refusal;
    try {
      const session = await this.insight.summarize(id);
      const [chat] = await this.toToolChats([session]);
      return ok({
        ...chat,
        note: session.summary
          ? 'Summary stored on the session.'
          : 'No summary produced — the transcript is empty or unreadable.',
      });
    } catch (e) {
      // The service speaks in HTTP exceptions for the console; turn the ones
      // a person can act on into a sentence naming the next move, and let
      // anything unexpected surface as an error.
      if (e instanceof NotFoundException) return NOT_FOUND(id);
      if (e instanceof BadRequestException) {
        return err(
          `${e.message} Add or fix the Anthropic credential (list_llms shows them), then call summarize_chat again.`,
        );
      }
      if (e instanceof BadGatewayException) {
        return err(
          `${e.message} The provider did not answer — wait a moment and call summarize_chat again.`,
        );
      }
      throw e;
    }
  }

  // ─── Topics (CLEAN-270) ──────────────────────────────────────

  @Tool({
    name: 'list_chat_topics',
    topic: ToolTopics.ChatsUsage,
    effect: 'read',
    title: 'List chat topics',
    template: 'List the topics people talk to the agents about',
    description:
      'The subjects the conversation summaries sort chats under, most used ' +
      'first: for each its `key`, its labels by language, how many ' +
      'conversations carry it (`conversations`, among the conversations ' +
      'this person may read) and the keys of topics already folded into ' +
      'it (`merged`, given only to a person who may read every ' +
      'conversation; when a topic has no `merged` field, say nothing ' +
      'about what was folded into it). Use it to see whether two topics ' +
      'mean one subject ' +
      'before merge_chat_topics, which takes the keys. Topics are coined ' +
      'by the summaries, never by hand: when `summariesEnabled` is false ' +
      'this installation produces no summaries, so say that no new topics ' +
      'appear, never that people talk about nothing. When the result ' +
      'carries `notIncluded`, conversations exist that this person may not ' +
      'read and they are not in the counts.',
    parameters: z.object({}),
  })
  async listChatTopics(
    _args: Record<string, never>,
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const [{ shown, whole }, summariesEnabled] = await Promise.all([
      this.shownTopics(httpRequest),
      this.insight.isEnabled(),
    ]);
    return ok({
      topics: shown.map((entry) => ({
        key: entry.topic.key,
        labels: entry.topic.labels,
        conversations: entry.conversations,
        // The keys folded into a topic, for the caller who reads every
        // conversation and for nobody else (CLEAN-270, review). A folded
        // key is a subject's name, coined from conversations, and the
        // counts arrive folded: nothing here knows whether one of the
        // conversations that carried it is this caller's to read. A topic
        // with none of their conversations is not shown to them, so a
        // folded key with none must not be either. Scoping it key by key
        // would take a second pass over every conversation, per call, for
        // a list that only helps to decide a merge; it is left out. Left
        // out, and not sent as `[]`, which would say nothing was folded.
        ...(whole ? { merged: entry.merged } : {}),
      })),
      total: shown.length,
      summariesEnabled,
      ...this.leftOut(httpRequest, undefined),
    });
  }

  @Tool({
    name: 'merge_chat_topics',
    topic: ToolTopics.ChatsUsage,
    effect: 'write',
    destructive: true,
    title: 'Merge two chat topics',
    template: 'Merge the chat topic «from» into «into»',
    description:
      'Fold one topic into another when two labels turned out to mean one ' +
      'subject: every conversation under `from` is counted under `into` ' +
      'from then on, for every person and on every statistics page, and ' +
      '`from` is no longer offered to new summaries. Takes the two keys ' +
      '(list_chat_topics has them). There is no tool that takes a merge ' +
      'back, so name both topics and their conversation counts to the ' +
      'person first. Refused for a topic merged into itself, for a topic ' +
      'that is merged already, and for a target that was merged itself. ' +
      CONFIRM_SENTENCE,
    parameters: z.object({
      from: z.string().describe('Key of the topic that goes away'),
      into: z.string().describe('Key of the topic that stays'),
      confirm: z
        .boolean()
        .describe('Set true only after the person confirmed in the chat.'),
    }),
  })
  async mergeChatTopics(
    args: { from: string; into: string; confirm?: boolean },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const { shown } = await this.shownTopics(httpRequest);
    const fromKey = topicKeyOf(args.from);
    const intoKey = topicKeyOf(args.into);
    const from = await this.shownTopic(shown, fromKey);
    if (!from) return TOPIC_NOT_FOUND(fromKey);
    const into = await this.shownTopic(shown, intoKey);
    if (!into) return TOPIC_NOT_FOUND(intoKey);

    const refusal = topicMergeRefusal(from, into);
    if (refusal) {
      // Where the target went, so that the next call can name it.
      const standing =
        into.mergedIntoId !== null && from.id !== into.id
          ? shown.find((entry) => entry.topic.id === into.mergedIntoId)
          : undefined;
      return err(
        standing ? `${refusal} That one is «${standing.topic.key}».` : refusal,
      );
    }

    const unconfirmed = confirmed(
      args,
      `merge topic «${from.key}» into «${into.key}»: every conversation ` +
        `under «${from.key}» is counted under «${into.key}» from then on, ` +
        'for everyone, and it cannot be undone from the chat',
    );
    if (unconfirmed) return unconfirmed;

    try {
      await this.topics.merge(from.id, into.id);
    } catch (e) {
      // Another merge landed between the look above and this write, and the
      // two topics no longer allow this one (the gateway asks the same
      // rules again inside its transaction). A refusal like the ones
      // above, with the list as the next move: it shows how they stand now.
      if (e instanceof ChatTopicMergeRefused) {
        return err(
          `${e.message} The topics changed while this was being confirmed: call list_chat_topics to see how they stand now.`,
        );
      }
      throw e;
    }
    this.logger.log(
      `Chat topics merged through MCP: ${from.key} into ${into.key}`,
    );
    return ok({
      merged: { from: from.key, into: into.key },
      note:
        `Conversations under «${from.key}» are now counted under ` +
        `«${into.key}», and «${from.key}» is no longer offered to new ` +
        'summaries. list_chat_topics shows the new counts.',
    });
  }

  /**
   * The topic with this key, when the caller is shown it or the topic it
   * was folded into; null otherwise, and for a key that names nothing. One
   * answer for both.
   */
  private async shownTopic(
    shown: IChatTopicUsage[],
    key: string,
  ): Promise<IChatTopicData | null> {
    const topic = await this.topics.findByKey(key);
    if (!topic) return null;
    const standingId = topic.mergedIntoId ?? topic.id;
    return shown.some((entry) => entry.topic.id === standingId) ? topic : null;
  }

  @Tool({
    name: 'export_chat',
    topic: ToolTopics.ChatsUsage,
    effect: 'read',
    title: 'Export a chat',
    template: 'Export the chat «id»',
    description:
      'Where to download a chat transcript as a file. The download itself ' +
      'needs the person’s console login, so this returns the path to open ' +
      'in the console (append ?format=markdown or ?format=csv for a ' +
      'readable transcript; the default is json with every event) rather ' +
      'than the file. Confirms the chat exists first.',
    parameters: z.object({
      id: z.string().describe('Chat session id (list_chats has them)'),
    }),
  })
  async exportChat(
    { id }: { id: string },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const { session, refusal } = await this.chatFor(httpRequest, id);
    if (!session) return refusal;
    const nameOf = await this.agentNames([session]);
    return ok({
      chatId: session.id,
      agentId: session.agentId,
      agentName: nameOf(session.agentId),
      title: session.title,
      downloadPath: `/chats/${session.id}/export`,
      formats: ['json', 'markdown', 'csv'],
      note: 'Open this path in the console (it needs your login) to download.',
    });
  }
}
