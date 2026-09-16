import { A2aClient } from './a2a.client';
import { DelegationErrorCodes, PeerCardUnreachableError } from './peer.types';
import { A2aTaskStates, type IA2aSendMessageParams } from './a2a.types';

/**
 * The outbound edge. Its whole job is to turn somebody else's failure into a
 * code this product can put in front of a person, so each case pins one
 * translation: a dead host, a revoked credential, a peer that answered
 * something other than a task.
 */
const card = {
  name: 'Support Bot',
  description: 'Answers order questions.',
  version: '1',
  supportedInterfaces: [
    {
      url: 'https://api.test/a2a/agents/b',
      protocolBinding: 'JSONRPC',
      protocolVersion: '1.0',
    },
  ],
  capabilities: {},
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills: [],
};

const task = {
  id: 't1',
  contextId: 'ctx-1',
  status: { state: A2aTaskStates.Completed, timestamp: '2026-09-14T10:00:00Z' },
  artifacts: [{ artifactId: 'reply', parts: [{ text: 'the answer' }] }],
  history: [],
};

function respond(options: {
  ok?: boolean;
  status?: number;
  json?: unknown;
  text?: string;
  jsonThrows?: boolean;
}) {
  const status = options.status ?? 200;
  return {
    ok: options.ok ?? (status >= 200 && status < 300),
    status,
    json: async () => {
      if (options.jsonThrows) throw new Error('not json');
      return options.json;
    },
    text: async () => options.text ?? '',
  } as unknown as Response;
}

const params: IA2aSendMessageParams = {
  message: {
    messageId: 'm1',
    role: 'ROLE_USER',
    parts: [{ text: 'What is the return window?' }],
  },
};

const CARD_URL = 'https://api.test/a2a/agents/b/.well-known/agent-card.json';
const RPC_URL = 'https://api.test/a2a/agents/b';
const TOKEN = 'ap_' + 'x'.repeat(43);

describe('A2aClient.fetchCard', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('reads a card with the credential issued for that connection', async () => {
    fetchMock.mockResolvedValue(respond({ json: card }));

    await expect(new A2aClient().fetchCard(CARD_URL, TOKEN)).resolves.toEqual(
      card,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      CARD_URL,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: `Bearer ${TOKEN}` }),
      }),
    );
  });

  it('reports an unreachable host in words an operator can act on', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(
      new A2aClient().fetchCard(CARD_URL, TOKEN),
    ).rejects.toBeInstanceOf(PeerCardUnreachableError);
  });

  it('names a timeout as a timeout rather than an abort', async () => {
    const timeout = Object.assign(new Error('aborted'), {
      name: 'TimeoutError',
    });
    fetchMock.mockRejectedValue(timeout);

    await expect(new A2aClient().fetchCard(CARD_URL, TOKEN)).rejects.toThrow(
      /did not answer in time/,
    );
  });

  it('carries the status through when the card route refuses', async () => {
    fetchMock.mockResolvedValue(
      respond({ status: 401, text: 'A2A_UNAUTHORIZED' }),
    );

    await expect(
      new A2aClient().fetchCard(CARD_URL, TOKEN),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('refuses a body that is not JSON', async () => {
    fetchMock.mockResolvedValue(respond({ jsonThrows: true }));

    await expect(new A2aClient().fetchCard(CARD_URL, TOKEN)).rejects.toThrow(
      /not valid JSON/,
    );
  });

  it('refuses a document that parses but is not an agent card', async () => {
    fetchMock.mockResolvedValue(respond({ json: { hello: 'world' } }));

    await expect(new A2aClient().fetchCard(CARD_URL, TOKEN)).rejects.toThrow(
      /not an agent card/,
    );
  });

  it('refuses a card with no way to reach the agent', async () => {
    fetchMock.mockResolvedValue(
      respond({ json: { ...card, supportedInterfaces: [] } }),
    );

    await expect(new A2aClient().fetchCard(CARD_URL, TOKEN)).rejects.toThrow(
      /not an agent card/,
    );
  });
});

describe('A2aClient.sendMessage', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('sends a JSON-RPC SendMessage with the version header and the credential', async () => {
    fetchMock.mockResolvedValue(respond({ json: { result: { task } } }));

    await new A2aClient().sendMessage(RPC_URL, TOKEN, params, 1000);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(RPC_URL);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'A2A-Version': '1.0',
    });
    expect(JSON.parse(init.body as string)).toMatchObject({
      jsonrpc: '2.0',
      method: 'SendMessage',
      params,
    });
  });

  it('returns the finished task', async () => {
    fetchMock.mockResolvedValue(respond({ json: { result: { task } } }));

    await expect(
      new A2aClient().sendMessage(RPC_URL, TOKEN, params, 1000),
    ).resolves.toEqual(task);
  });

  it('calls a revoked credential what it is', async () => {
    fetchMock.mockResolvedValue(respond({ status: 401 }));

    await expect(
      new A2aClient().sendMessage(RPC_URL, TOKEN, params, 1000),
    ).rejects.toMatchObject({ code: DelegationErrorCodes.Unauthorized });
  });

  it('treats a forbidden answer the same way', async () => {
    fetchMock.mockResolvedValue(respond({ status: 403 }));

    await expect(
      new A2aClient().sendMessage(RPC_URL, TOKEN, params, 1000),
    ).rejects.toMatchObject({ code: DelegationErrorCodes.Unauthorized });
  });

  it('reports a server error as unreachable, with what it said', async () => {
    fetchMock.mockResolvedValue(
      respond({ status: 500, text: 'Internal Server Error' }),
    );

    await expect(
      new A2aClient().sendMessage(RPC_URL, TOKEN, params, 1000),
    ).rejects.toMatchObject({
      code: DelegationErrorCodes.Unreachable,
      message: expect.stringContaining('500'),
    });
  });

  it('reports a network failure as unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('socket hang up'));

    await expect(
      new A2aClient().sendMessage(RPC_URL, TOKEN, params, 1000),
    ).rejects.toMatchObject({ code: DelegationErrorCodes.Unreachable });
  });

  it('passes a protocol error through with its own message', async () => {
    fetchMock.mockResolvedValue(
      respond({
        json: {
          error: { code: -32004, message: 'This agent does not support X' },
        },
      }),
    );

    await expect(
      new A2aClient().sendMessage(RPC_URL, TOKEN, params, 1000),
    ).rejects.toMatchObject({
      code: DelegationErrorCodes.Error,
      message: 'This agent does not support X',
    });
  });

  it('refuses an answer that is not a task, having nothing to poll with', async () => {
    fetchMock.mockResolvedValue(
      respond({ json: { result: { message: { parts: [] } } } }),
    );

    await expect(
      new A2aClient().sendMessage(RPC_URL, TOKEN, params, 1000),
    ).rejects.toMatchObject({
      code: DelegationErrorCodes.Error,
      message: 'answered without a task',
    });
  });

  it('waits longer than the peer own limit, so its stated timeout wins', async () => {
    fetchMock.mockResolvedValue(respond({ json: { result: { task } } }));
    const spy = jest.spyOn(AbortSignal, 'timeout');

    await new A2aClient().sendMessage(RPC_URL, TOKEN, params, 120_000);

    expect(spy).toHaveBeenCalledWith(125_000);
    spy.mockRestore();
  });
});
