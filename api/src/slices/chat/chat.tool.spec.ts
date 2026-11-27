import { permissionOver } from '#/agent/agent/domain/__fixtures__/agentPermission';
import type { IAgentGateway } from '#/agent/agent/domain/agent.gateway';
import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ChatTool } from './chat.tool';
import type {
  IChatGateway,
  IChatSessionData,
  IChatTopicData,
  IChatTopicGateway,
  IChatTopicUsage,
} from './domain';
import type { ChatSyncService, ChatInsightService } from './domain';
import { ChatTopicMergeRefused } from './domain';
import type {
  TranscriptReaderService,
  TranscriptMessage,
} from '#/agent/file/domain';
import { UserRoleTypes } from '#/user/user/domain';
import { asPerson, asTrustedAgent } from '#/mcp/testing';
import {
  MCP_TOOL_METADATA_KEY,
  toolAudienceOf,
  type ToolMetadata,
} from '#/mcp/decorators';
import { toolMetadataProblems } from '#/mcp/services/mcp-registry.service';
import { CONFIRM_SENTENCE } from '#/mcp/tooling';
import type { AgentAccessService } from '#/user/agentAccess/domain/agentAccess.service';
import {
  accessHarness,
  openAccess,
} from '#/user/agentAccess/domain/__fixtures__/agentAccess';

/**
 * A chat is somebody's conversation with an agent. Worth more than the happy
 * path: that a plain agent cannot see or call these, that a transcript reply
 * carries attachment metadata and never file contents, and that a summary
 * that cannot be produced comes back as a sentence naming the next move.
 */
const session = (
  overrides: Partial<IChatSessionData> = {},
): IChatSessionData => ({
  id: 'chat-1',
  agentId: 'agent-a',
  channel: 'bridle',
  externalUserId: 'user-7',
  sessionKey: 'bridle_user-7_2026-09-17',
  title: 'Refund for order 42',
  preview: 'Thanks, that solved it.',
  lastRole: 'user',
  lastMessageAt: new Date('2026-09-17T10:00:00.000Z'),
  messageCount: 6,
  userMessageCount: 3,
  lastIndexedEventId: 'evt-6',
  lastIndexedSize: 4096,
  summary: null,
  summaryAt: null,
  insights: null,
  outcome: null,
  question: null,
  topicIds: [],
  insightVersion: 0,
  archived: false,
  createdAt: new Date('2026-09-17T09:00:00.000Z'),
  updatedAt: new Date('2026-09-17T10:00:00.000Z'),
  ...overrides,
});

const turns = (n: number): TranscriptMessage[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `evt-${i + 1}`,
    role: i % 2 === 0 ? 'user' : 'assistant',
    text: `turn ${i + 1}`,
    ts: 1_700_000_000_000 + i,
  }));

const request = (roles: UserRoleTypes[]): Request =>
  ({
    user: { sub: 'agent:agent-ops', email: '', roles },
  }) as unknown as Request;

const operator = () => asTrustedAgent(request([UserRoleTypes.Owner]));
const plainAgent = () => asTrustedAgent(request([UserRoleTypes.Agent]));

interface Harness {
  tool: ChatTool;
  chats: jest.Mocked<Pick<IChatGateway, 'list' | 'findById'>>;
  reader: jest.Mocked<Pick<TranscriptReaderService, 'read'>>;
  sync: jest.Mocked<Pick<ChatSyncService, 'syncAll'>>;
  insight: jest.Mocked<Pick<ChatInsightService, 'summarize' | 'isEnabled'>>;
  topics: jest.Mocked<
    Pick<
      IChatTopicGateway,
      'findByIds' | 'findByKey' | 'listWithCounts' | 'merge'
    >
  >;
}

const topicRow = (
  key: string,
  over: Partial<IChatTopicData> = {},
): IChatTopicData => ({
  id: `topic-${key}`,
  key,
  labels: { en: key[0].toUpperCase() + key.slice(1), ru: `${key}-ru` },
  mergedIntoId: null,
  createdAt: new Date('2026-11-01T00:00:00.000Z'),
  ...over,
});
const BILLING = topicRow('billing');
const REFUNDS = topicRow('refunds');
const VACATION = topicRow('vacation');
/** Folded into billing earlier. */
const INVOICES = topicRow('invoices', { mergedIntoId: BILLING.id });
const TOPICS = [BILLING, REFUNDS, VACATION, INVOICES];
/** What the conversations of every agent add up to. */
const USAGE: IChatTopicUsage[] = [
  { topic: BILLING, conversations: 12, merged: ['invoices'] },
  { topic: REFUNDS, conversations: 3, merged: [] },
  { topic: VACATION, conversations: 0, merged: [] },
];

/** `agent-ranch` is the Ranch admin agent; nothing else is. */
const RANCH_AGENT = 'agent-ranch';
const agentRows = {
  findAdmin: () => Promise.resolve({ id: RANCH_AGENT, isAdmin: true }),
  findById: (id: string) =>
    Promise.resolve({
      id,
      name: `name-of-${id}`,
      isAdmin: id === RANCH_AGENT,
      createdById: null,
    }),
};

function harness(access: AgentAccessService = openAccess()): Harness {
  const chats = {
    list: jest.fn().mockResolvedValue({ items: [session()], total: 1 }),
    findById: jest.fn().mockResolvedValue(session()),
  } as unknown as Harness['chats'];
  const reader = {
    read: jest.fn().mockResolvedValue(turns(6)),
  } as unknown as Harness['reader'];
  const sync = {
    syncAll: jest.fn().mockResolvedValue({
      scannedAgents: 1,
      scannedFiles: 3,
      upserted: 2,
      skipped: 1,
    }),
  } as unknown as Harness['sync'];
  const insight = {
    summarize: jest.fn().mockResolvedValue(
      session({
        summary: 'The user asked for a refund and got it.',
        summaryAt: new Date('2026-09-17T11:00:00.000Z'),
        insights: {
          topics: ['Refunds'],
          sentiment: 'positive',
          resolved: true,
          language: 'en',
        },
        outcome: 'resolved',
        question: 'Can I get my money back for order 42?',
        topicIds: [REFUNDS.id],
        insightVersion: 2,
      }),
    ),
    isEnabled: jest.fn().mockResolvedValue(true),
  } as unknown as Harness['insight'];
  const topics = {
    findByIds: jest.fn((ids: readonly string[]) =>
      Promise.resolve(
        new Map(
          TOPICS.filter((t) => ids.includes(t.id)).map((t) => [
            t.id,
            // A merged topic is answered as the one it was folded into.
            TOPICS.find((o) => o.id === t.mergedIntoId) ?? t,
          ]),
        ),
      ),
    ),
    findByKey: jest.fn((key: string) =>
      Promise.resolve(TOPICS.find((t) => t.key === key) ?? null),
    ),
    listWithCounts: jest.fn().mockResolvedValue(USAGE),
    merge: jest.fn().mockResolvedValue(undefined),
  } as unknown as Harness['topics'];

  const tool = new ChatTool(
    chats as unknown as IChatGateway,
    reader as unknown as TranscriptReaderService,
    sync as unknown as ChatSyncService,
    insight as unknown as ChatInsightService,
    access,
    permissionOver(agentRows),
    agentRows as unknown as IAgentGateway,
    topics as unknown as IChatTopicGateway,
  );
  return { tool, chats, reader, sync, insight, topics };
}

const textOf = (result: { content: { text: string }[] }) =>
  result.content[0].text;
/** Loose view of a JSON reply: the tests reach into whichever fields they check. */
interface Body {
  [key: string]: any;
  messages: any[];
  items: any[];
}
const parse = (result: { content: { text: string }[] }) =>
  JSON.parse(textOf(result)) as Body;

describe('ChatTool — who may use it', () => {
  it('hides the tools from an agent that is not a Ranch operator', async () => {
    const { tool } = harness();
    await expect(tool.isListedForRequest(plainAgent())).resolves.toBe(false);
  });

  it('lists them for an operator agent', async () => {
    const { tool } = harness();
    await expect(tool.isListedForRequest(operator())).resolves.toBe(true);
  });

  it('refuses a call from a plain agent even by name', async () => {
    const { tool, chats, reader, sync, insight } = harness();
    await expect(tool.listChats({}, null, plainAgent())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      tool.getChat({ id: 'chat-1' }, null, plainAgent()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      tool.getChatMessages({ id: 'chat-1' }, null, plainAgent()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(tool.syncChats({}, null, plainAgent())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      tool.summarizeChat({ id: 'chat-1' }, null, plainAgent()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      tool.exportChat({ id: 'chat-1' }, null, plainAgent()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(chats.list).not.toHaveBeenCalled();
    expect(chats.findById).not.toHaveBeenCalled();
    expect(reader.read).not.toHaveBeenCalled();
    expect(sync.syncAll).not.toHaveBeenCalled();
    expect(insight.summarize).not.toHaveBeenCalled();
  });
});

describe('list_chats', () => {
  it('lists with the console defaults and passes the filters through', async () => {
    const { tool, chats } = harness();
    const result = await tool.listChats(
      { agentId: 'agent-a', search: 'refund' },
      null,
      operator(),
    );
    expect(chats.list).toHaveBeenCalledWith({
      agentId: 'agent-a',
      search: 'refund',
      // A caller with no access lists: no agent is filtered out.
      agentScope: undefined,
      page: 1,
      perPage: 50,
    });
    const body = parse(result);
    expect(body.total).toBe(1);
    expect(body.page).toBe(1);
    expect(body.perPage).toBe(50);
    expect(body.items[0].id).toBe('chat-1');
    expect(body.items[0].title).toBe('Refund for order 42');
    // Index bookkeeping is not something to show the person.
    expect(body.items[0].lastIndexedEventId).toBeUndefined();
  });

  it('honours an explicit page and size', async () => {
    const { tool, chats } = harness();
    await tool.listChats({ page: 3, perPage: 10 }, null, operator());
    expect(chats.list).toHaveBeenCalledWith(
      expect.objectContaining({ page: 3, perPage: 10 }),
    );
  });
});

describe('get_chat', () => {
  it('returns the session metadata', async () => {
    const { tool, chats } = harness();
    const result = await tool.getChat({ id: 'chat-1' }, null, operator());
    expect(chats.findById).toHaveBeenCalledWith('chat-1');
    const body = parse(result);
    expect(body.id).toBe('chat-1');
    expect(body.agentId).toBe('agent-a');
    // The agent by name too, so the chat is not read as another agent's.
    expect(body.agentName).toBe('name-of-agent-a');
    expect(body.userMessageCount).toBe(3);
  });

  it('names the next move when the chat does not exist', async () => {
    const { tool, chats } = harness();
    chats.findById.mockResolvedValue(null);
    const result = await tool.getChat({ id: 'nope' }, null, operator());
    expect(textOf(result)).toContain('Chat nope not found');
    expect(textOf(result)).toContain('list_chats');
  });

  it('answers a chat of an agent the person does not reach as a chat that does not exist', async () => {
    const { service, gateway } = accessHarness(['agent-a', 'agent-b']);
    gateway.seed('user-1', false, [{ agentId: 'agent-a', list: 'denied' }]);
    const { tool, chats, reader } = harness(service);
    const admin = () =>
      asPerson(request([UserRoleTypes.Owner]), UserRoleTypes.Admin, 'user-1');

    const hidden = await tool.getChat({ id: 'chat-1' }, null, admin());
    chats.findById.mockResolvedValueOnce(null);
    const unknown = await tool.getChat({ id: 'chat-1' }, null, admin());

    expect(textOf(hidden)).toBe(textOf(unknown));
    expect(textOf(hidden)).toContain('Chat chat-1 not found');
    expect(textOf(hidden)).not.toContain('Refund for order 42');
    // Nor its turns, and the list is asked for the reached agents only.
    expect(
      textOf(await tool.getChatMessages({ id: 'chat-1' }, null, admin())),
    ).toBe(textOf(unknown));
    expect(reader.read).not.toHaveBeenCalled();
    await tool.listChats({}, null, admin());
    // … less the Ranch admin agent, whose conversations are the Owner's.
    expect(chats.list).toHaveBeenCalledWith(
      expect.objectContaining({
        agentScope: { notIn: ['agent-a', RANCH_AGENT] },
      }),
    );
  });
});

/**
 * CLEAN-236. These tools read what other people said to an agent. An Admin
 * may talk to the Ranch admin agent and manages nothing of it, so the
 * Owner's conversation with it is not theirs to read from here, now that it
 * is no longer a conversation they are part of.
 */
describe('the conversations of the Ranch admin agent are the Owner’s to read', () => {
  const asAdmin = () =>
    asPerson(request([UserRoleTypes.Owner]), UserRoleTypes.Admin, 'user-1');
  const asOwner = () =>
    asPerson(request([UserRoleTypes.Owner]), UserRoleTypes.Owner, 'user-o');
  const ranchChat = () =>
    session({ agentId: RANCH_AGENT, externalUserId: 'admin' });

  it('an Admin is answered as for a chat that does not exist, and reads none of its turns', async () => {
    const { tool, chats, reader } = harness();
    chats.findById.mockResolvedValue(ranchChat());

    const hidden = textOf(
      await tool.getChat({ id: 'chat-1' }, null, asAdmin()),
    );
    expect(hidden).toContain('Chat chat-1 not found');
    expect(
      textOf(await tool.getChatMessages({ id: 'chat-1' }, null, asAdmin())),
    ).toBe(hidden);
    expect(reader.read).not.toHaveBeenCalled();
  });

  it('an Admin’s list leaves that agent out, and naming it finds nothing', async () => {
    const { tool, chats } = harness();

    await tool.listChats({}, null, asAdmin());
    expect(chats.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ agentScope: { notIn: [RANCH_AGENT] } }),
    );

    chats.list.mockClear();
    const named = await tool.listChats(
      { agentId: RANCH_AGENT },
      null,
      asAdmin(),
    );
    expect(textOf(named)).toContain('not found');
    expect(chats.list).not.toHaveBeenCalled();
  });

  it('the Owner reads them as any other', async () => {
    const { tool, chats } = harness();
    chats.findById.mockResolvedValue(ranchChat());

    expect(
      textOf(await tool.getChat({ id: 'chat-1' }, null, asOwner())),
    ).toContain('Refund for order 42');
    await tool.listChats({}, null, asOwner());
    expect(chats.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ agentScope: undefined }),
    );
  });
});

describe('get_chat_messages', () => {
  it('reads the transcript the way the controller does and tails 20 by default', async () => {
    const { tool, reader } = harness();
    reader.read.mockResolvedValue(turns(25));
    const result = await tool.getChatMessages(
      { id: 'chat-1' },
      null,
      operator(),
    );
    expect(reader.read).toHaveBeenCalledWith(
      'agent-a',
      'data/sessions/bridle_user-7_2026-09-17.jsonl',
      { types: ['user', 'assistant', 'summary'], filterTransient: true },
    );
    const body = parse(result);
    expect(body.chatId).toBe('chat-1');
    expect(body.messages).toHaveLength(20);
    expect(body.messages[0].text).toBe('turn 6');
    expect(body.messages[19].text).toBe('turn 25');
    expect(body.hasMore).toBe(true);
    expect(body.nextCursor).toBe('5');
  });

  it('returns role, text and ts per message, with attachment metadata and no model-facing text', async () => {
    const { tool, reader } = harness();
    reader.read.mockResolvedValue([
      {
        id: 'evt-1',
        role: 'user',
        text: 'Here is the invoice',
        ts: 1_700_000_000_000,
        agentText: 'Here is the invoice\n\n<file>THE WHOLE SPREADSHEET</file>',
        attachments: [
          {
            id: 'att-1',
            name: 'invoice.csv',
            mimeType: 'text/csv',
            size: 1234,
            kind: 'text',
          },
        ],
      },
      {
        id: 'evt-2',
        role: 'assistant',
        text: 'Got it.',
        ts: 1_700_000_000_001,
      },
    ]);
    const result = await tool.getChatMessages(
      { id: 'chat-1', limit: 5 },
      null,
      operator(),
    );
    const body = parse(result);
    expect(body.agentId).toBe('agent-a');
    expect(body.agentName).toBe('name-of-agent-a');
    expect(body.messages[0]).toEqual({
      id: 'evt-1',
      role: 'user',
      text: 'Here is the invoice',
      ts: 1_700_000_000_000,
      attachments: [
        {
          id: 'att-1',
          name: 'invoice.csv',
          mimeType: 'text/csv',
          size: 1234,
          kind: 'text',
        },
      ],
    });
    expect(body.messages[1]).toEqual({
      id: 'evt-2',
      role: 'assistant',
      text: 'Got it.',
      ts: 1_700_000_000_001,
    });
    expect(textOf(result)).not.toContain('THE WHOLE SPREADSHEET');
  });

  it('passes an explicit limit, cursor and types through', async () => {
    const { tool, reader } = harness();
    reader.read.mockResolvedValue(turns(6));
    const result = await tool.getChatMessages(
      { id: 'chat-1', limit: 2, cursor: '4', types: ['user', 'tool_call'] },
      null,
      operator(),
    );
    expect(reader.read).toHaveBeenCalledWith(
      'agent-a',
      expect.any(String),
      expect.objectContaining({ types: ['user', 'tool_call'] }),
    );
    const body = parse(result);
    expect(body.messages.map((m: { text: string }) => m.text)).toEqual([
      'turn 3',
      'turn 4',
    ]);
    expect(body.nextCursor).toBe('2');
  });

  it('treats an unreadable transcript as empty, like the console', async () => {
    const { tool, reader } = harness();
    reader.read.mockRejectedValue(new Error('NoSuchKey'));
    const result = await tool.getChatMessages(
      { id: 'chat-1' },
      null,
      operator(),
    );
    const body = parse(result);
    expect(body.messages).toEqual([]);
    expect(body.hasMore).toBe(false);
    expect(body.note).toContain('missing or unreadable');
  });

  it('names the next move when the chat does not exist', async () => {
    const { tool, chats, reader } = harness();
    chats.findById.mockResolvedValue(null);
    const result = await tool.getChatMessages({ id: 'nope' }, null, operator());
    expect(textOf(result)).toContain('Chat nope not found');
    expect(reader.read).not.toHaveBeenCalled();
  });
});

describe('sync_chats', () => {
  it('reconciles one agent when given an id', async () => {
    const { tool, sync } = harness();
    const result = await tool.syncChats(
      { agentId: 'agent-a' },
      null,
      operator(),
    );
    // The second argument is the caller's reach (CLEAN-231).
    expect(sync.syncAll).toHaveBeenCalledWith(
      'agent-a',
      expect.objectContaining({ unrestricted: true }),
    );
    expect(parse(result)).toEqual({
      scannedAgents: 1,
      scannedFiles: 3,
      upserted: 2,
      skipped: 1,
    });
  });

  it('reconciles every agent when no id is given', async () => {
    const { tool, sync } = harness();
    await tool.syncChats({}, null, operator());
    expect(sync.syncAll).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ unrestricted: true }),
    );
  });
});

describe('summarize_chat', () => {
  it('returns the session with its new summary and insights', async () => {
    const { tool, insight } = harness();
    const result = await tool.summarizeChat({ id: 'chat-1' }, null, operator());
    expect(insight.summarize).toHaveBeenCalledWith('chat-1');
    const body = parse(result);
    expect(body.summary).toBe('The user asked for a refund and got it.');
    expect(body.insights.sentiment).toBe('positive');
    expect(body.note).toContain('stored');
  });

  it('names the next move when the chat does not exist', async () => {
    const { tool, insight } = harness();
    insight.summarize.mockRejectedValue(
      new NotFoundException('Chat nope not found'),
    );
    const result = await tool.summarizeChat({ id: 'nope' }, null, operator());
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toContain('Chat nope not found');
    expect(textOf(result)).toContain('list_chats');
  });

  it('turns a missing or rejected credential into an error naming the fix', async () => {
    const { tool, insight } = harness();
    insight.summarize.mockRejectedValue(
      new BadRequestException(
        'No active Anthropic LLM credential — add one in Settings → LLM credentials.',
      ),
    );
    const result = await tool.summarizeChat({ id: 'chat-1' }, null, operator());
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('No active Anthropic LLM credential');
    expect(textOf(result)).toContain('list_llms');
  });

  it('turns a provider failure into an error that says to retry', async () => {
    const { tool, insight } = harness();
    insight.summarize.mockRejectedValue(
      new BadGatewayException('Anthropic API 529: overloaded'),
    );
    const result = await tool.summarizeChat({ id: 'chat-1' }, null, operator());
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Anthropic API 529');
    expect(textOf(result)).toContain('call summarize_chat again');
  });

  it('lets an unexpected failure surface', async () => {
    const { tool, insight } = harness();
    insight.summarize.mockRejectedValue(new Error('boom'));
    await expect(
      tool.summarizeChat({ id: 'chat-1' }, null, operator()),
    ).rejects.toThrow('boom');
  });
});

describe('export_chat', () => {
  it('points at the console download once the chat is known to exist', async () => {
    const { tool, chats } = harness();
    const result = await tool.exportChat({ id: 'chat-1' }, null, operator());
    expect(chats.findById).toHaveBeenCalledWith('chat-1');
    const body = parse(result);
    expect(body.downloadPath).toBe('/chats/chat-1/export');
    expect(body.formats).toEqual(['json', 'markdown', 'csv']);
    expect(body.note).toContain('needs your login');
  });

  it('names the next move when the chat does not exist', async () => {
    const { tool, chats } = harness();
    chats.findById.mockResolvedValue(null);
    const result = await tool.exportChat({ id: 'nope' }, null, operator());
    expect(textOf(result)).toContain('Chat nope not found');
    expect(textOf(result)).not.toContain('downloadPath');
  });
});

// ── Summaries, version 2 (CLEAN-270) ─────────────────────────

/** The same agent, answering a User: its token carries Owner, the person does not. */
const answeringUser = () =>
  asPerson(request([UserRoleTypes.Owner]), UserRoleTypes.User, 'user-9');
/** An Admin behind it: reads every conversation but the assistant's. */
const answeringAdmin = () =>
  asPerson(request([UserRoleTypes.Owner]), UserRoleTypes.Admin, 'user-1');

describe('what a summary says about a chat', () => {
  const summarised = () =>
    session({
      summary: 'Asked about an invoice; it was resent.',
      outcome: 'open',
      question: 'Where is my invoice for October?',
      // The second was folded into the first: one subject, named once.
      topicIds: [BILLING.id, INVOICES.id, REFUNDS.id],
      insightVersion: 2,
    });

  it('get_chat carries the outcome, the main question and the topics by their English labels', async () => {
    const { tool, chats, topics } = harness();
    chats.findById.mockResolvedValue(summarised());

    const body = parse(await tool.getChat({ id: 'chat-1' }, null, operator()));

    expect(body.outcome).toBe('open');
    expect(body.question).toBe('Where is my invoice for October?');
    expect(body.topics).toEqual(['Billing', 'Refunds']);
    expect(topics.findByIds).toHaveBeenCalledWith([
      BILLING.id,
      INVOICES.id,
      REFUNDS.id,
    ]);
    // Ids and the prompt's version are bookkeeping.
    expect(body.topicIds).toBeUndefined();
    expect(body.insightVersion).toBeUndefined();
  });

  it('list_chats carries them on every row, with one read of the topics', async () => {
    const { tool, chats, topics } = harness();
    chats.list.mockResolvedValue({
      items: [summarised(), session({ id: 'chat-2' })],
      total: 2,
    });

    const body = parse(await tool.listChats({}, null, operator()));

    expect(body.items[0].topics).toEqual(['Billing', 'Refunds']);
    expect(body.items[0].outcome).toBe('open');
    // No summary: no outcome, which is not "open" and not "unknown".
    expect(body.items[1]).toMatchObject({
      outcome: null,
      question: null,
      topics: [],
    });
    expect(topics.findByIds).toHaveBeenCalledTimes(1);
  });

  it('summarize_chat returns what the new summary says', async () => {
    const { tool } = harness();
    const body = parse(
      await tool.summarizeChat({ id: 'chat-1' }, null, operator()),
    );
    expect(body.outcome).toBe('resolved');
    expect(body.question).toBe('Can I get my money back for order 42?');
    expect(body.topics).toEqual(['Refunds']);
  });
});

describe('list_chat_topics and merge_chat_topics: what the API boots them with', () => {
  const proto = ChatTool.prototype as unknown as Record<string, unknown>;
  const declared = (method: string) => {
    const ref = Object.getOwnPropertyDescriptor(proto, method)?.value as object;
    return {
      metadata: Reflect.getMetadata(MCP_TOOL_METADATA_KEY, ref) as ToolMetadata,
      audience: toolAudienceOf(ChatTool, ref),
    };
  };

  it('list_chat_topics is a read for an operator, filed under chats', () => {
    const { metadata, audience } = declared('listChatTopics');
    expect(metadata.name).toBe('list_chat_topics');
    expect(toolMetadataProblems(metadata)).toEqual([]);
    expect(metadata.topic).toBe('chats_usage');
    expect(metadata.effect).toBe('read');
    expect(metadata.destructive).toBeFalsy();
    expect(audience).toBe('admin');
  });

  // It cannot be taken back from the chat, and it changes what every person
  // of the installation sees on their statistics page.
  it('merge_chat_topics is a destructive write for an operator, with `confirm`', () => {
    const { metadata, audience } = declared('mergeChatTopics');
    expect(metadata.name).toBe('merge_chat_topics');
    expect(toolMetadataProblems(metadata)).toEqual([]);
    expect(metadata.topic).toBe('chats_usage');
    expect(metadata.effect).toBe('write');
    expect(metadata.destructive).toBe(true);
    expect(metadata.description.endsWith(CONFIRM_SENTENCE)).toBe(true);
    expect(audience).toBe('admin');
  });
});

describe('the topic tools: who may use them', () => {
  it.each([
    ['a User behind the Ranch admin agent', answeringUser],
    ['a plain agent', plainAgent],
  ])('refuses %s, and reads and changes nothing', async (_who, caller) => {
    const { tool, topics } = harness();

    await expect(
      tool.listChatTopics({}, null, caller()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      tool.mergeChatTopics(
        { from: 'refunds', into: 'billing', confirm: true },
        null,
        caller(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(topics.listWithCounts).not.toHaveBeenCalled();
    expect(topics.findByKey).not.toHaveBeenCalled();
    expect(topics.merge).not.toHaveBeenCalled();
  });
});

describe('list_chat_topics', () => {
  it('lists every topic with its labels, its conversations and what was folded into it', async () => {
    const { tool, topics } = harness();

    const body = parse(await tool.listChatTopics({}, null, operator()));

    // Whoever reads every conversation gets the count over every agent.
    expect(topics.listWithCounts).toHaveBeenCalledWith(undefined);
    expect(body.topics).toEqual([
      {
        key: 'billing',
        labels: { en: 'Billing', ru: 'billing-ru' },
        conversations: 12,
        merged: ['invoices'],
      },
      {
        key: 'refunds',
        labels: { en: 'Refunds', ru: 'refunds-ru' },
        conversations: 3,
        merged: [],
      },
      {
        key: 'vacation',
        labels: { en: 'Vacation', ru: 'vacation-ru' },
        conversations: 0,
        merged: [],
      },
    ]);
    expect(body.total).toBe(3);
    expect(body.summariesEnabled).toBe(true);
    // Ids are the table's, the key is what the merge takes.
    expect(
      textOf(await tool.listChatTopics({}, null, operator())),
    ).not.toContain('topic-billing');
  });

  // CLEAN-236: the Owner's conversations with the assistant are not an
  // Admin's to read, and a count over them is a reading of them.
  it('counts for an Admin only the conversations that Admin may read, and lists no topic that has none of them', async () => {
    const { tool, topics } = harness();
    topics.listWithCounts.mockResolvedValue([
      { topic: BILLING, conversations: 4, merged: ['invoices'] },
      { topic: REFUNDS, conversations: 0, merged: [] },
      { topic: VACATION, conversations: 0, merged: [] },
    ]);

    const body = parse(await tool.listChatTopics({}, null, answeringAdmin()));

    expect(topics.listWithCounts).toHaveBeenCalledWith({
      notIn: [RANCH_AGENT],
    });
    expect(body.topics.map((t: { key: string }) => t.key)).toEqual(['billing']);
    expect(body.total).toBe(1);
  });

  /**
   * The keys folded into a topic (CLEAN-270, review). A folded key is the
   * name of a subject, coined from conversations; the counts are folded in
   * the statement, so nothing here knows whether any conversation that
   * carried `invoices` is one this Admin may read. A topic with none of
   * their conversations is not shown to them; a folded key with none would
   * have been, in `merged`. So the list of folded keys goes only to a caller
   * who reads every conversation, and is left out, not sent empty, for
   * anybody else: empty would say that nothing was folded.
   */
  it('names the folded keys only to a caller who reads every conversation', async () => {
    const { tool, topics } = harness();
    topics.listWithCounts.mockResolvedValue([
      { topic: BILLING, conversations: 4, merged: ['invoices'] },
      { topic: REFUNDS, conversations: 2, merged: [] },
    ]);

    const scoped = await tool.listChatTopics({}, null, answeringAdmin());

    expect(parse(scoped).topics).toEqual([
      {
        key: 'billing',
        labels: { en: 'Billing', ru: 'billing-ru' },
        conversations: 4,
      },
      {
        key: 'refunds',
        labels: { en: 'Refunds', ru: 'refunds-ru' },
        conversations: 2,
      },
    ]);
    expect(textOf(scoped)).not.toContain('invoices');
    expect(textOf(scoped)).not.toContain('merged');

    // The Owner's own call still has them.
    const whole = parse(await tool.listChatTopics({}, null, operator()));
    expect(whole.topics[0].merged).toEqual(['invoices']);
  });

  it('counts for an Admin with a list of agents only the conversations of those', async () => {
    const { service, gateway } = accessHarness(['agent-a', 'agent-b']);
    gateway.seed('user-1', false, [{ agentId: 'agent-a', list: 'denied' }]);
    const { tool, topics } = harness(service);

    await tool.listChatTopics({}, null, answeringAdmin());

    expect(topics.listWithCounts).toHaveBeenCalledWith({
      notIn: ['agent-a', RANCH_AGENT],
    });
  });

  // An empty list on an installation that writes no summaries is not
  // "people talk about nothing".
  it('says when the installation produces no summaries', async () => {
    const { tool, topics, insight } = harness();
    topics.listWithCounts.mockResolvedValue([]);
    insight.isEnabled.mockResolvedValue(false);

    const body = parse(await tool.listChatTopics({}, null, operator()));

    expect(body.topics).toEqual([]);
    expect(body.summariesEnabled).toBe(false);
  });
});

describe('merge_chat_topics', () => {
  it('refuses without `confirm`, says what it would do, and changes nothing', async () => {
    const { tool, topics } = harness();

    const result = await tool.mergeChatTopics(
      { from: 'refunds', into: 'billing' },
      null,
      operator(),
    );

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('«refunds»');
    expect(textOf(result)).toContain('«billing»');
    expect(textOf(result)).toContain('cannot be undone');
    expect(textOf(result)).toContain('confirm: true');
    expect(topics.merge).not.toHaveBeenCalled();
  });

  it('folds one topic into the other once confirmed', async () => {
    const { tool, topics } = harness();

    const result = await tool.mergeChatTopics(
      { from: ' Refunds ', into: 'billing', confirm: true },
      null,
      operator(),
    );

    expect(topics.merge).toHaveBeenCalledWith(REFUNDS.id, BILLING.id);
    expect(result.isError).toBeUndefined();
    expect(parse(result)).toMatchObject({
      merged: { from: 'refunds', into: 'billing' },
    });
  });

  it.each([
    ['from', { from: 'nope', into: 'billing' }, 'nope'],
    ['into', { from: 'refunds', into: 'nope' }, 'nope'],
  ])(
    'names the next move when `%s` is no topic',
    async (_which, keys, missing) => {
      const { tool, topics } = harness();

      const result = await tool.mergeChatTopics(
        { ...keys, confirm: true },
        null,
        operator(),
      );

      expect(textOf(result)).toContain(`Topic ${missing} not found`);
      expect(textOf(result)).toContain('list_chat_topics');
      expect(topics.merge).not.toHaveBeenCalled();
    },
  );

  it('refuses a topic merged into itself', async () => {
    const { tool, topics } = harness();

    const result = await tool.mergeChatTopics(
      { from: 'billing', into: 'billing', confirm: true },
      null,
      operator(),
    );

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('into itself');
    expect(topics.merge).not.toHaveBeenCalled();
  });

  // A reader follows a merge once: the conversations would be counted under
  // a topic no list shows.
  it('refuses a target that was merged itself, and names where to merge instead', async () => {
    const { tool, topics } = harness();

    const result = await tool.mergeChatTopics(
      { from: 'refunds', into: 'invoices', confirm: true },
      null,
      operator(),
    );

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('«invoices» was merged');
    expect(textOf(result)).toContain('«billing»');
    expect(topics.merge).not.toHaveBeenCalled();
  });

  it('refuses a topic that is merged already', async () => {
    const { tool, topics } = harness();

    const result = await tool.mergeChatTopics(
      { from: 'invoices', into: 'refunds', confirm: true },
      null,
      operator(),
    );

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('«invoices» is already merged');
    expect(topics.merge).not.toHaveBeenCalled();
  });

  // The rules are asked again inside the merge's transaction, because
  // another merge can land between the look above and the write (CLEAN-270,
  // review). What that finds is a refusal like any other, not a fault.
  it('answers a merge that another merge got ahead of with the refusal it met', async () => {
    const { tool, topics } = harness();
    topics.merge.mockRejectedValue(
      new ChatTopicMergeRefused(
        'Topic «billing» was merged into another topic itself: merge into that one.',
      ),
    );

    const result = await tool.mergeChatTopics(
      { from: 'refunds', into: 'billing', confirm: true },
      null,
      operator(),
    );

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('«billing» was merged into another topic');
    expect(textOf(result)).toContain('list_chat_topics');
  });

  it('lets any other failure of the merge through', async () => {
    const { tool, topics } = harness();
    topics.merge.mockRejectedValue(new Error('connection lost'));

    await expect(
      tool.mergeChatTopics(
        { from: 'refunds', into: 'billing', confirm: true },
        null,
        operator(),
      ),
    ).rejects.toThrow('connection lost');
  });

  it('answers the refusals before it asks for confirmation', async () => {
    const { tool } = harness();
    const result = await tool.mergeChatTopics(
      { from: 'billing', into: 'billing' },
      null,
      operator(),
    );
    expect(textOf(result)).toContain('into itself');
    expect(textOf(result)).not.toContain('confirm: true');
  });

  // The same rule as the list: a topic with no conversation this Admin may
  // read is, for them, a topic that does not exist.
  it('answers a topic the caller is not shown as one that does not exist', async () => {
    const { tool, topics } = harness();
    topics.listWithCounts.mockResolvedValue([
      { topic: BILLING, conversations: 4, merged: ['invoices'] },
      { topic: REFUNDS, conversations: 0, merged: [] },
    ]);

    const hidden = await tool.mergeChatTopics(
      { from: 'refunds', into: 'billing', confirm: true },
      null,
      answeringAdmin(),
    );
    const unknown = await tool.mergeChatTopics(
      { from: 'nothing', into: 'billing', confirm: true },
      null,
      answeringAdmin(),
    );

    expect(textOf(hidden).split('refunds').join('<key>')).toBe(
      textOf(unknown).split('nothing').join('<key>'),
    );
    expect(textOf(hidden)).not.toContain('Refunds');
    expect(topics.merge).not.toHaveBeenCalled();
  });

  it('lets an Admin merge two topics both of which they are shown', async () => {
    const { tool, topics } = harness();
    topics.listWithCounts.mockResolvedValue([
      { topic: BILLING, conversations: 4, merged: ['invoices'] },
      { topic: REFUNDS, conversations: 2, merged: [] },
    ]);

    await tool.mergeChatTopics(
      { from: 'refunds', into: 'billing', confirm: true },
      null,
      answeringAdmin(),
    );

    expect(topics.merge).toHaveBeenCalledWith(REFUNDS.id, BILLING.id);
  });
});
