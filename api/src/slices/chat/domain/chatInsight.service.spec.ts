import { ChatInsightService, parseInsights } from './chatInsight.service';
import { IChatGateway } from './chat.gateway';
import { ILlmGateway } from '#/llm/domain';
import { TranscriptReaderService } from '#/agent/file/domain';
import { IChatSessionData } from './chat.types';

const SESSION: IChatSessionData = {
  id: 'c1',
  agentId: 'a1',
  channel: 'bridle',
  externalUserId: 'admin',
  sessionKey: 'bridle:admin',
  title: null,
  preview: 'hi',
  lastRole: 'assistant',
  lastMessageAt: new Date(2000),
  messageCount: 6,
  userMessageCount: 3,
  lastIndexedEventId: null,
  lastIndexedSize: 100,
  summary: null,
  summaryAt: null,
  insights: null,
  archived: false,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

const VALID =
  '{"summary":"User asked about billing. Assistant explained plans.","topics":["billing","plans"],"sentiment":"positive","resolved":true,"language":"en"}';

function readerStub() {
  return {
    read: jest.fn(async () => [
      { id: 'm1', role: 'user', text: 'hi', ts: 1 },
      { id: 'm2', role: 'assistant', text: 'hello', ts: 2 },
    ]),
  } as unknown as TranscriptReaderService;
}

function llmsStub(
  active: Array<{ provider: string; model: string; apiKey: string }> = [
    { provider: 'anthropic', model: 'claude-x', apiKey: 'sk' },
  ],
) {
  return { findActive: jest.fn(async () => active) } as unknown as ILlmGateway;
}

// Returns the mock fns alongside the gateway so assertions target the jest.fn
// locals (not interface-typed method refs, which trip unbound-method).
function makeChats(
  opts: { findById?: jest.Mock; eligible?: IChatSessionData[] } = {},
) {
  const findById = opts.findById ?? jest.fn(async () => SESSION);
  const saveInsights = jest.fn(async () => {});
  const findEligibleForInsight = jest.fn(async () => opts.eligible ?? []);
  const chats = {
    findById,
    saveInsights,
    findEligibleForInsight,
  } as unknown as IChatGateway;
  return { chats, findById, saveInsights, findEligibleForInsight };
}

function mockFetch(text: string, ok = true) {
  global.fetch = jest.fn(async () => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => ({ content: [{ type: 'text', text }] }),
    text: async () => text,
  })) as unknown as typeof fetch;
}

describe('parseInsights', () => {
  it('parses a clean JSON object', () => {
    const p = parseInsights(VALID)!;
    expect(p.summary).toContain('billing');
    expect(p.topics).toEqual(['billing', 'plans']);
    expect(p.sentiment).toBe('positive');
    expect(p.resolved).toBe(true);
    expect(p.language).toBe('en');
  });

  it('strips markdown fences and surrounding prose', () => {
    expect(parseInsights('```json\n' + VALID + '\n```')?.summary).toContain(
      'billing',
    );
  });

  it('returns null without a summary', () => {
    expect(parseInsights('{"topics":[]}')).toBeNull();
    expect(parseInsights('not json at all')).toBeNull();
  });

  it('defaults an invalid sentiment to neutral and non-boolean resolved to false', () => {
    const p = parseInsights(
      '{"summary":"x","sentiment":"angry","resolved":"yes"}',
    )!;
    expect(p.sentiment).toBe('neutral');
    expect(p.resolved).toBe(false);
    expect(p.topics).toEqual([]);
    expect(p.language).toBe('en');
  });
});

describe('ChatInsightService.summarize', () => {
  const orig = global.fetch;
  afterEach(() => {
    global.fetch = orig;
  });

  it('reads transcript → LLM → saveInsights', async () => {
    mockFetch(VALID);
    const { chats, saveInsights } = makeChats();
    const svc = new ChatInsightService(chats, readerStub(), llmsStub());
    await svc.summarize('c1');
    expect(saveInsights).toHaveBeenCalledWith(
      'c1',
      'User asked about billing. Assistant explained plans.',
      {
        topics: ['billing', 'plans'],
        sentiment: 'positive',
        resolved: true,
        language: 'en',
      },
    );
  });

  it('throws when no Anthropic credential exists', async () => {
    const { chats } = makeChats();
    const svc = new ChatInsightService(chats, readerStub(), llmsStub([]));
    await expect(svc.summarize('c1')).rejects.toThrow(/credential/i);
  });

  it('throws NotFound for a missing chat', async () => {
    const { chats } = makeChats({ findById: jest.fn(async () => null) });
    const svc = new ChatInsightService(chats, readerStub(), llmsStub());
    await expect(svc.summarize('nope')).rejects.toThrow(/not found/i);
  });
});

describe('ChatInsightService.runBatch', () => {
  const orig = global.fetch;
  afterEach(() => {
    global.fetch = orig;
  });

  it('summarizes every eligible session', async () => {
    mockFetch(VALID);
    const { chats, saveInsights } = makeChats({
      eligible: [SESSION, { ...SESSION, id: 'c2' }],
    });
    const svc = new ChatInsightService(chats, readerStub(), llmsStub());
    const r = await svc.runBatch();
    expect(r.eligible).toBe(2);
    expect(r.summarized).toBe(2);
    expect(saveInsights.mock.calls.length).toBe(2);
  });

  it('skips entirely (no gate query) when no credential', async () => {
    const { chats, findEligibleForInsight } = makeChats({
      eligible: [SESSION],
    });
    const svc = new ChatInsightService(chats, readerStub(), llmsStub([]));
    const r = await svc.runBatch();
    expect(r.summarized).toBe(0);
    expect(findEligibleForInsight).not.toHaveBeenCalled();
  });

  it('aborts after the first rejected credential (does not hammer every session)', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
      text: async () => 'invalid x-api-key',
    })) as unknown as typeof fetch;
    const { chats, saveInsights } = makeChats({
      eligible: [SESSION, { ...SESSION, id: 'c2' }, { ...SESSION, id: 'c3' }],
    });
    const svc = new ChatInsightService(chats, readerStub(), llmsStub());
    const r = await svc.runBatch();
    expect(r.summarized).toBe(0);
    expect(r.failed).toBe(1); // stopped after the first, not 3
    expect(saveInsights).not.toHaveBeenCalled();
  });
});
