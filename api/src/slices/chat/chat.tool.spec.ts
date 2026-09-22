import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ChatTool } from './chat.tool';
import type { IChatGateway, IChatSessionData } from './domain';
import type { ChatSyncService, ChatInsightService } from './domain';
import type {
  TranscriptReaderService,
  TranscriptMessage,
} from '#/agent/file/domain';
import { UserRoleTypes } from '#/user/user/domain';

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

const operator = () => request([UserRoleTypes.Owner]);
const plainAgent = () => request([UserRoleTypes.Agent]);

interface Harness {
  tool: ChatTool;
  chats: jest.Mocked<Pick<IChatGateway, 'list' | 'findById'>>;
  reader: jest.Mocked<Pick<TranscriptReaderService, 'read'>>;
  sync: jest.Mocked<Pick<ChatSyncService, 'syncAll'>>;
  insight: jest.Mocked<Pick<ChatInsightService, 'summarize'>>;
}

function harness(): Harness {
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
          topics: ['refund'],
          sentiment: 'positive',
          resolved: true,
          language: 'en',
        },
      }),
    ),
  } as unknown as Harness['insight'];

  const tool = new ChatTool(
    chats as unknown as IChatGateway,
    reader as unknown as TranscriptReaderService,
    sync as unknown as ChatSyncService,
    insight as unknown as ChatInsightService,
  );
  return { tool, chats, reader, sync, insight };
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
    expect(body.userMessageCount).toBe(3);
  });

  it('names the next move when the chat does not exist', async () => {
    const { tool, chats } = harness();
    chats.findById.mockResolvedValue(null);
    const result = await tool.getChat({ id: 'nope' }, null, operator());
    expect(textOf(result)).toContain('Chat nope not found');
    expect(textOf(result)).toContain('list_chats');
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
    expect(sync.syncAll).toHaveBeenCalledWith('agent-a');
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
    expect(sync.syncAll).toHaveBeenCalledWith(undefined);
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
