import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { Tool, ToolTopics } from '#mcp';
import {
  callerIsOperator,
  err,
  ok,
  requireOperator,
  type ToolResult,
} from '#/mcp/tooling';
import type { IConditionallyListedTool } from '#/mcp/interfaces/conditional-listing.interface';
import { IAuthTokenPayload } from '#/user/auth/domain';
import {
  TranscriptReaderService,
  TranscriptMessage,
} from '#/agent/file/domain';
import {
  IChatGateway,
  ChatSyncService,
  ChatInsightService,
  type IChatSessionData,
} from './domain';

type AuthedRequest = Request & { user?: IAuthTokenPayload };

const NOT_FOUND = (id: string) =>
  ok({ error: `Chat ${id} not found — call list_chats to find the id` });

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
 */
function toToolChat(s: IChatSessionData) {
  return {
    id: s.id,
    agentId: s.agentId,
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
 */
@Injectable()
export class ChatTool implements IConditionallyListedTool {
  private readonly logger = new Logger(ChatTool.name);

  constructor(
    private readonly chats: IChatGateway,
    private readonly reader: TranscriptReaderService,
    private readonly sync: ChatSyncService,
    private readonly insight: ChatInsightService,
  ) {}

  async isListedForRequest(httpRequest: Request): Promise<boolean> {
    return Promise.resolve(callerIsOperator(httpRequest));
  }

  // ─── Reading ─────────────────────────────────────────────────────────

  @Tool({
    name: 'list_chats',
    topic: ToolTopics.ChatsUsage,
    title: 'List chats',
    template: 'List the recent chats «of agent name»',
    description:
      'Chat sessions from the index, most recently active first, with the ' +
      'title, preview, counts and any stored summary of each. Filter by ' +
      'agent id (list_agents resolves a name), channel or a search over ' +
      'title / preview / end-user id; archived and internal (cron, ' +
      'heartbeat) sessions are hidden unless asked for. Paged: `total` says ' +
      'how many match. Use the `id` of a row with get_chat, ' +
      'get_chat_messages, summarize_chat or export_chat.',
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
    const { items, total } = await this.chats.list({
      ...args,
      page,
      perPage,
    });
    return ok({ items: items.map(toToolChat), total, page, perPage });
  }

  @Tool({
    name: 'get_chat',
    topic: ToolTopics.ChatsUsage,
    title: 'Show a chat',
    template: 'Show the chat «id»',
    description:
      'One chat session from the index: agent, channel, end user, title, ' +
      'preview, message counts, when it was last active, and the stored ' +
      'summary and insights if summarize_chat (or the nightly batch) has ' +
      'run. Metadata only — read the turns with get_chat_messages.',
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
    const session = await this.chats.findById(id);
    if (!session) return NOT_FOUND(id);
    return ok(toToolChat(session));
  }

  @Tool({
    name: 'get_chat_messages',
    topic: ToolTopics.ChatsUsage,
    title: 'Read chat messages',
    template: 'Show the last «20» messages of chat «id»',
    description:
      'Replay the transcript of a chat, tail first: the last `limit` turns ' +
      '(default 20) with role, text and timestamp, plus the name, type and ' +
      'size of any files the person attached (never their contents). ' +
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
    const session = await this.chats.findById(args.id);
    if (!session) return NOT_FOUND(args.id);

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
    title: 'Sync chats from runtimes',
    template: 'Sync chats «of agent name» from their runtimes',
    description:
      'Reconcile the chat index against the session files the agent ' +
      'runtimes keep in storage — for one agent, or every agent when no id ' +
      'is given. Use it when a chat the person knows happened is missing ' +
      'from list_chats. Returns how many agents and files were scanned and ' +
      'how many rows were updated; all zeros with nothing scanned means a ' +
      'sync was already running — try again in a minute.',
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
    return ok(await this.sync.syncAll(agentId));
  }

  @Tool({
    name: 'summarize_chat',
    topic: ToolTopics.ChatsUsage,
    title: 'Summarize a chat',
    template: 'Summarize the chat «id»',
    description:
      'Generate (or refresh) an LLM summary and structured insights — ' +
      'topics, sentiment, resolved, language — for one chat, and store them ' +
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
    try {
      const session = await this.insight.summarize(id);
      return ok({
        ...toToolChat(session),
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

  @Tool({
    name: 'export_chat',
    topic: ToolTopics.ChatsUsage,
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
    const session = await this.chats.findById(id);
    if (!session) return NOT_FOUND(id);
    return ok({
      chatId: session.id,
      title: session.title,
      downloadPath: `/chats/${session.id}/export`,
      formats: ['json', 'markdown', 'csv'],
      note: 'Open this path in the console (it needs your login) to download.',
    });
  }
}
