import { BadRequestException } from '@nestjs/common';
import { EPHEMERAL_BUNDLE_TTL_MS, McpOauthService, allowedReturnTo } from './mcpOauth.service';
import {
  isEphemeralSubject,
  mcpOauthSecretKey,
  parseMcpOauthSecretKey,
  type IMcpOauthBundle,
} from './mcpOauth.types';

/**
 * Per-user tokens (CLEAN-80): where a bundle lands, which one `status`
 * answers with, what `mcp_connected` names, and which bundles the sweep is
 * allowed to drop. Discovery, registration and the code exchange are the
 * client's job and are stubbed to their happy answers here.
 */

const META = {
  issuer: 'https://mcp.silpo.test',
  authorization_endpoint: 'https://auth.silpo.test/authorize',
  token_endpoint: 'https://auth.silpo.test/token',
  registration_endpoint: 'https://auth.silpo.test/register',
  revocation_endpoint: 'https://auth.silpo.test/revoke',
  scopes_supported: ['catalog'],
};

const SERVER = {
  id: 'srv-1',
  name: 'Silpo',
  url: 'https://mcp.silpo.test/mcp',
  authType: 'oauth',
  oauthClientId: 'client-1',
};

const DAY = 24 * 60 * 60 * 1000;

const bundle = (overrides: Partial<IMcpOauthBundle> = {}): string =>
  JSON.stringify({
    clientId: 'client-1',
    issuer: META.issuer,
    authorizationEndpoint: META.authorization_endpoint,
    tokenEndpoint: META.token_endpoint,
    revocationEndpoint: META.revocation_endpoint,
    accessToken: 'at',
    refreshToken: 'rt',
    expiresAt: null,
    scope: null,
    ...overrides,
  } satisfies IMcpOauthBundle);

function harness() {
  const states = new Map<string, Record<string, unknown>>();
  const prisma = {
    mcpOauthState: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        states.set(data.state as string, { ...data, createdAt: new Date() });
        return data;
      }),
      findUnique: jest.fn(async ({ where }: { where: { state: string } }) =>
        states.get(where.state) ?? null,
      ),
      delete: jest.fn(async ({ where }: { where: { state: string } }) => {
        states.delete(where.state);
      }),
    },
  };
  const stores = new Map<string, Map<string, string>>();
  const secrets = {
    list: jest.fn(async (agentId: string) => ({
      secrets: [...(stores.get(agentId) ?? new Map<string, string>())].map(
        ([name, value]) => ({ name, value }),
      ),
    })),
    set: jest.fn(async (agentId: string, key: string, value: string) => {
      if (!stores.has(agentId)) stores.set(agentId, new Map());
      stores.get(agentId)!.set(key, value);
    }),
    delete: jest.fn(async (agentId: string, key: string) => {
      stores.get(agentId)?.delete(key);
    }),
  };
  const client = {
    discover: jest
      .fn()
      .mockResolvedValue({ metadata: META, resource: SERVER.url, via: 'origin' }),
    register: jest.fn().mockResolvedValue('client-1'),
    exchangeCode: jest
      .fn()
      .mockResolvedValue({ access_token: 'at-new', refresh_token: 'rt-new', expires_in: 3600 }),
    revoke: jest.fn().mockResolvedValue(undefined),
  };
  const servers = {
    findById: jest.fn().mockResolvedValue(SERVER),
    update: jest.fn(),
    setOauthClientId: jest.fn().mockResolvedValue(undefined),
  };
  const bridle = { notifyMcpConnected: jest.fn() };
  const agents = { findAll: jest.fn().mockResolvedValue([{ id: 'agent-1' }]) };
  // Stands in for IInfraConfigGateway — the explicitly configured public
  // origin (setting or env), already stripped of a trailing slash.
  const infra = {
    getConfiguredApiPublicUrl: jest.fn().mockResolvedValue('https://ranch.test'),
  };

  const service = new McpOauthService(
    servers as never,
    client as never,
    prisma as never,
    secrets as never,
    bridle as never,
    agents as never,
    infra as never,
  );
  return { service, prisma, secrets, client, servers, bridle, agents, infra, stores };
}

/** Runs start + callback and returns what the callback stored. */
async function connect(
  h: ReturnType<typeof harness>,
  input: { subject?: string; email?: string },
) {
  const { authorizeUrl } = await h.service.start({
    serverId: 'srv-1',
    agentId: 'agent-1',
    ...input,
  });
  const state = new URL(authorizeUrl).searchParams.get('state') as string;
  return h.service.handleCallback('srv-1', state, 'code-1');
}

describe('McpOauthService — where a token lands', () => {
  it('stores a personal bundle under server + subject and names the subject to the agent', async () => {
    const h = harness();

    const result = await connect(h, { subject: 'user-a', email: 'a@example.test' });

    expect(result).toEqual({ agentId: 'agent-1', serverName: 'Silpo', subject: 'user-a', redirectBack: null });
    const stored = JSON.parse(
      h.stores.get('agent-1')!.get('mcpOauth:srv-1:user-a') as string,
    ) as IMcpOauthBundle;
    expect(stored).toMatchObject({
      subject: 'user-a',
      email: 'a@example.test',
      refreshToken: 'rt-new',
      revocationEndpoint: META.revocation_endpoint,
    });
    expect(stored.connectedAt).toEqual(expect.any(Number));
    expect(stored.lastUsedAt).toBe(stored.connectedAt);
    expect(h.bridle.notifyMcpConnected).toHaveBeenCalledWith('agent-1', {
      server: 'Silpo',
      serverId: 'srv-1',
      subject: 'user-a',
    });
  });

  it('stores an agent-wide bundle under the bare key when no subject was given', async () => {
    const h = harness();

    const result = await connect(h, {});

    expect(result.subject).toBe('agent-1');
    expect(h.stores.get('agent-1')!.has('mcpOauth:srv-1')).toBe(true);
    expect(h.bridle.notifyMcpConnected).toHaveBeenCalledWith('agent-1', {
      server: 'Silpo',
      serverId: 'srv-1',
      subject: 'agent-1',
    });
  });

  it('keeps two people on one agent apart', async () => {
    const h = harness();

    await connect(h, { subject: 'user-a' });
    await connect(h, { subject: 'user-b' });

    expect([...h.stores.get('agent-1')!.keys()].sort()).toEqual([
      'mcpOauth:srv-1:user-a',
      'mcpOauth:srv-1:user-b',
    ]);
  });

  it('refuses a state it never minted', async () => {
    const h = harness();
    await expect(h.service.handleCallback('srv-1', 'nope', 'code')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('McpOauthService — status', () => {
  it('answers with the subject bundle first, then the agent-wide one, then nothing', async () => {
    const h = harness();
    await h.secrets.set('agent-1', mcpOauthSecretKey('srv-1'), bundle());
    await h.secrets.set(
      'agent-1',
      mcpOauthSecretKey('srv-1', 'user-a'),
      bundle({ subject: 'user-a', email: 'a@example.test', connectedAt: 5 }),
    );

    await expect(h.service.status('srv-1', 'agent-1', 'user-a')).resolves.toEqual({
      connected: true,
      scope: 'subject',
      email: 'a@example.test',
      connectedAt: 5,
    });
    await expect(h.service.status('srv-1', 'agent-1', 'user-b')).resolves.toEqual({
      connected: true,
      scope: 'agent',
    });
    await h.secrets.delete('agent-1', mcpOauthSecretKey('srv-1'));
    await expect(h.service.status('srv-1', 'agent-1', 'user-b')).resolves.toEqual({
      connected: false,
      scope: null,
    });
  });

  it('does not count a bundle without a refresh token as connected', async () => {
    const h = harness();
    await h.secrets.set('agent-1', mcpOauthSecretKey('srv-1'), bundle({ refreshToken: null }));
    await expect(h.service.status('srv-1', 'agent-1')).resolves.toMatchObject({
      connected: false,
    });
  });
});

describe('McpOauthService — sweeping per-browser subjects', () => {
  it('drops stale anon/share bundles, revokes first, and leaves users and fresh ones alone', async () => {
    const h = harness();
    const now = Date.now();
    const stale = now - EPHEMERAL_BUNDLE_TTL_MS - DAY;
    const fresh = now - DAY;
    await h.secrets.set('agent-1', mcpOauthSecretKey('srv-1', 'anon-old'), bundle({ lastUsedAt: stale }));
    await h.secrets.set('agent-1', mcpOauthSecretKey('srv-1', 'share-old'), bundle({ connectedAt: stale }));
    await h.secrets.set('agent-1', mcpOauthSecretKey('srv-1', 'anon-new'), bundle({ lastUsedAt: fresh }));
    await h.secrets.set('agent-1', mcpOauthSecretKey('srv-1', 'user-old'), bundle({ lastUsedAt: stale }));
    await h.secrets.set('agent-1', mcpOauthSecretKey('srv-1'), bundle({ lastUsedAt: stale }));
    await h.secrets.set('agent-1', 'OTHER_SECRET', 'keep');

    const dropped = await h.service.sweepEphemeral(now);

    expect(dropped).toBe(2);
    expect([...h.stores.get('agent-1')!.keys()].sort()).toEqual([
      'OTHER_SECRET',
      'mcpOauth:srv-1',
      'mcpOauth:srv-1:anon-new',
      'mcpOauth:srv-1:user-old',
    ]);
    expect(h.client.revoke).toHaveBeenCalledTimes(2);
    expect(h.client.revoke).toHaveBeenCalledWith(META.revocation_endpoint, 'rt', 'client-1');
  });

  it('still deletes when the provider refuses the revocation', async () => {
    const h = harness();
    h.client.revoke.mockRejectedValueOnce(new Error('503'));
    await h.secrets.set(
      'agent-1',
      mcpOauthSecretKey('srv-1', 'anon-old'),
      bundle({ lastUsedAt: Date.now() - EPHEMERAL_BUNDLE_TTL_MS - DAY }),
    );

    await expect(h.service.sweepEphemeral()).resolves.toBe(1);
    expect(h.stores.get('agent-1')!.size).toBe(0);
  });

  it('treats a bundle with no timestamps as stale — nothing ever used it', async () => {
    const h = harness();
    await h.secrets.set('agent-1', mcpOauthSecretKey('srv-1', 'anon-x'), bundle());
    await expect(h.service.sweepEphemeral()).resolves.toBe(1);
  });
});

describe('secret key helpers', () => {
  it('builds and parses both key shapes', () => {
    expect(mcpOauthSecretKey('srv-1')).toBe('mcpOauth:srv-1');
    expect(mcpOauthSecretKey('srv-1', 'user-a')).toBe('mcpOauth:srv-1:user-a');
    expect(parseMcpOauthSecretKey('mcpOauth:srv-1')).toEqual({ serverId: 'srv-1', subject: null });
    expect(parseMcpOauthSecretKey('mcpOauth:srv-1:share-v7')).toEqual({
      serverId: 'srv-1',
      subject: 'share-v7',
    });
    expect(parseMcpOauthSecretKey('GITHUB_TOKEN')).toBeNull();
    expect(parseMcpOauthSecretKey('mcpOauth:')).toBeNull();
  });

  it('knows which subjects are per browser', () => {
    expect(isEphemeralSubject('anon-abc')).toBe(true);
    expect(isEphemeralSubject('share-v7')).toBe(true);
    expect(isEphemeralSubject('user-1')).toBe(false);
    expect(isEphemeralSubject('agent-1')).toBe(false);
  });
});

/**
 * The S3-backed secret gateway lists entries as `<agentId>/<key>`; the AWS
 * one as the bare key. Found live: a bundle stored a minute earlier read as
 * "not connected" because the comparison only knew the bare form.
 */
describe('McpOauthService — scoped secret names from the file gateway', () => {
  it('finds a bundle listed under the agent scope prefix', async () => {
    const h = harness();
    h.secrets.list.mockResolvedValueOnce({
      secrets: [
        {
          name: `agent-1/${mcpOauthSecretKey('srv-1', 'user-a')}`,
          value: bundle({ subject: 'user-a', email: 'a@example.test' }),
        },
      ],
    });

    await expect(h.service.status('srv-1', 'agent-1', 'user-a')).resolves.toMatchObject({
      connected: true,
      scope: 'subject',
      email: 'a@example.test',
    });
  });

  it('sweeps a stale per-browser bundle listed under the scope prefix, deleting by the listed name', async () => {
    const h = harness();
    const stale = Date.now() - EPHEMERAL_BUNDLE_TTL_MS - DAY;
    const listed = `agent-1/${mcpOauthSecretKey('srv-1', 'share-old')}`;
    h.secrets.list.mockResolvedValueOnce({
      secrets: [{ name: listed, value: bundle({ lastUsedAt: stale }) }],
    });

    await expect(h.service.sweepEphemeral()).resolves.toBe(1);
    expect(h.secrets.delete).toHaveBeenCalledWith('agent-1', listed);
  });
});

/**
 * Where the redirect points. The platform resolves its public address in one
 * place (setting → env → integration); a connect that read only the env var
 * answered "not configured" on a cluster where the operator had set the
 * setting from the console (seen on ranch.cleanslice.org).
 */
describe('McpOauthService — public API URL', () => {
  it('builds the redirect from the resolved public URL', async () => {
    const h = harness();
    const { authorizeUrl } = await h.service.start({ serverId: 'srv-1', agentId: 'agent-1' });
    expect(new URL(authorizeUrl).searchParams.get('redirect_uri')).toBe(
      'https://ranch.test/mcp-servers/srv-1/oauth/callback',
    );
  });

  it('refuses to start when no public URL is configured, naming the setting', async () => {
    const h = harness();
    h.infra.getConfiguredApiPublicUrl.mockResolvedValueOnce(null);
    await expect(
      h.service.start({ serverId: 'srv-1', agentId: 'agent-1' }),
    ).rejects.toThrow(/api_public_url/);
    expect(h.client.register).not.toHaveBeenCalled();
  });
});

/**
 * The first connect registers ranch as an OAuth client and remembers the id
 * on the server row. Seen on ranch.cleanslice.org: doing that through the
 * ordinary update bumped updatedAt, and the drift check then told every
 * console the agent needed a restart it did not need (CLEAN-118).
 */
describe('McpOauthService — remembering the registered client id', () => {
  it('stores the client id through the timestamp-preserving write, not update', async () => {
    const h = harness();
    h.servers.findById.mockResolvedValue({ ...SERVER, oauthClientId: null });

    await h.service.start({ serverId: 'srv-1', agentId: 'agent-1' });

    expect(h.client.register).toHaveBeenCalledTimes(1);
    expect(h.servers.setOauthClientId).toHaveBeenCalledWith('srv-1', 'client-1');
    expect(h.servers.update).not.toHaveBeenCalled();
  });

  it('does not register again once the id is known', async () => {
    const h = harness();
    await h.service.start({ serverId: 'srv-1', agentId: 'agent-1' });
    expect(h.client.register).not.toHaveBeenCalled();
    expect(h.servers.setOauthClientId).not.toHaveBeenCalled();
  });
});

/**
 * The return address (CLEAN-120): kept only on our own origins, dropped
 * without failing the connect otherwise, and handed back by the callback.
 */
describe('McpOauthService — where the callback page returns to', () => {
  const originalAdmin = process.env.ADMIN_URL;
  beforeEach(() => {
    process.env.ADMIN_URL = 'https://admin.ranch.test';
  });
  afterEach(() => {
    if (originalAdmin === undefined) delete process.env.ADMIN_URL;
    else process.env.ADMIN_URL = originalAdmin;
  });

  it('keeps a console address and returns it from the callback', async () => {
    const h = harness();
    const { authorizeUrl } = await h.service.start({
      serverId: 'srv-1',
      agentId: 'agent-1',
      subject: 'user-a',
      returnTo: 'https://admin.ranch.test/agents/agent-1',
    });
    const state = new URL(authorizeUrl).searchParams.get('state') as string;
    const result = await h.service.handleCallback('srv-1', state, 'code-1');
    expect(result.redirectBack).toBe('https://admin.ranch.test/agents/agent-1');
  });

  it('drops an address on a foreign origin but still connects', async () => {
    const h = harness();
    const { authorizeUrl } = await h.service.start({
      serverId: 'srv-1',
      agentId: 'agent-1',
      returnTo: 'https://evil.test/agents/agent-1',
    });
    const state = new URL(authorizeUrl).searchParams.get('state') as string;
    const result = await h.service.handleCallback('srv-1', state, 'code-1');
    expect(result.redirectBack).toBeNull();
  });

  it('accepts localhost for development and refuses non-http schemes', () => {
    const own = ['https://admin.ranch.test'];
    expect(allowedReturnTo('http://localhost:3002/agents/a', own)).toBe('http://localhost:3002/agents/a');
    expect(allowedReturnTo('javascript:alert(1)', own)).toBeNull();
    expect(allowedReturnTo('not a url', own)).toBeNull();
    expect(allowedReturnTo(undefined, own)).toBeNull();
  });
});
