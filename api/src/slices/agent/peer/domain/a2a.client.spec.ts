import {
  A2aClient,
  assertPublicPeerAddress,
  assertResolvesPublic,
} from './a2a.client';
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
        // Redirects are an SSRF-guard bypass; the client refuses them.
        redirect: 'error',
      }),
    );
  });

  it('reports an unreachable host in words an operator can act on', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(
      new A2aClient().fetchCard(CARD_URL, TOKEN),
    ).rejects.toBeInstanceOf(PeerCardUnreachableError);
  });

  it('sends no Authorization header at all without a credential (CLEAN-95)', async () => {
    fetchMock.mockResolvedValue(respond({ json: card }));

    await new A2aClient().fetchCard(CARD_URL);

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers).not.toHaveProperty('Authorization');
  });

  it('marks not-a-card answers as invalid, not unreachable (CLEAN-95)', async () => {
    fetchMock.mockResolvedValue(respond({ json: { hello: 'world' } }));

    await expect(new A2aClient().fetchCard(CARD_URL, TOKEN)).rejects.toMatchObject(
      { kind: 'invalid' },
    );
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
    expect(init.redirect).toBe('error');
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

describe('SSRF guard (CLEAN-95)', () => {
  const bad = (url: string) =>
    expect(() => assertPublicPeerAddress(url)).toThrow(
      PeerCardUnreachableError,
    );
  const good = (url: string) =>
    expect(() => assertPublicPeerAddress(url)).not.toThrow();

  it('refuses private and local literals in every spelling', () => {
    bad('http://127.0.0.1/x');
    bad('http://10.1.2.3/x');
    bad('http://172.20.0.1/x');
    bad('http://192.168.1.1/x');
    bad('http://169.254.169.254/latest/meta-data');
    bad('http://0.0.0.0/x');
    bad('http://localhost/x');
    bad('http://foo.internal/x');
    bad('http://[::1]/x');
    bad('http://[0:0:0:0:0:0:0:1]/x');
    bad('http://[::ffff:127.0.0.1]/x');
    bad('http://[fe80::1]/x');
    bad('http://[fd00::1]/x');
  });

  it('refuses curl-style numeric shorthand instead of normalising it', () => {
    bad('http://2130706433/x');
    bad('http://0x7f000001/x');
    bad('http://017700000001/x');
    bad('http://127.1/x');
  });

  it('lets public addresses and names through', () => {
    good('https://other.example/a2a/agents/x');
    good('http://8.8.8.8/x');
    good('http://[2001:db8::1]/x');
  });

  it('the pre-flight resolver refuses a name that points at a private address', async () => {
    // localhost is the one name every environment resolves privately —
    // bypass the literal layer by calling the resolver directly.
    await expect(
      assertResolvesPublic('http://localhost/x'),
    ).rejects.toBeInstanceOf(PeerCardUnreachableError);
  });

  it('resolution failure passes — the fetch itself will name the problem', async () => {
    await expect(
      assertResolvesPublic('http://definitely-not-a-real-host.invalid/x'),
    ).resolves.toBeUndefined();
  });

  it('never blocks anything when the dev override is on', () => {
    process.env.A2A_ALLOW_PRIVATE_PEERS = 'true';
    try {
      good('http://127.0.0.1/x');
      good('http://localhost:4444/a2a/agents/mock-1');
    } finally {
      delete process.env.A2A_ALLOW_PRIVATE_PEERS;
    }
  });
});
