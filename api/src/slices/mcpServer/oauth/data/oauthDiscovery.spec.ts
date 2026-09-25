import { discoverOauthServer } from './oauthDiscovery';

/**
 * Who issued the token has to be the same server the agent runtime's MCP
 * SDK will refresh it at (CLEAN-122). These model the two shapes seen live:
 * Atlassian, whose host document and resource document name different
 * authorization servers, and Silpo, which publishes only the host document.
 */
const MCP = 'https://mcp.example.test/v2/mcp';

const HOST_META = {
  issuer: 'https://mcp.example.test',
  authorization_endpoint: 'https://mcp.example.test/v1/authorize',
  token_endpoint: 'https://mcp.example.test/v1/token',
  registration_endpoint: 'https://mcp.example.test/v1/register',
};

const TENANT_META = {
  issuer: 'https://auth.example.test/tenant-1',
  authorization_endpoint: 'https://auth.example.test/authorize',
  token_endpoint: 'https://auth.example.test/oauth/token',
  registration_endpoint: 'https://auth.example.test/tenant-1/dcr/register',
  scopes_supported: ['everything'],
};

const RESOURCE_META = {
  resource: MCP,
  authorization_servers: ['https://auth.example.test/tenant-1'],
  scopes_supported: ['read:me', 'offline_access'],
};

type Answer = { status: number; body?: unknown; headers?: Record<string, string> };

/** A fetch that answers by URL; anything unlisted is a 404. */
function fakeFetch(routes: Record<string, Answer>) {
  const calls: string[] = [];
  const fn = jest.fn(async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    const a = routes[url] ?? { status: 404 };
    return {
      ok: a.status >= 200 && a.status < 300,
      status: a.status,
      headers: { get: (name: string) => a.headers?.[name.toLowerCase()] ?? null },
      json: async () => a.body ?? {},
    };
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const originalAllowPrivate = process.env.A2A_ALLOW_PRIVATE_PEERS;
beforeEach(() => {
  delete process.env.A2A_ALLOW_PRIVATE_PEERS;
});
afterEach(() => {
  if (originalAllowPrivate === undefined) delete process.env.A2A_ALLOW_PRIVATE_PEERS;
  else process.env.A2A_ALLOW_PRIVATE_PEERS = originalAllowPrivate;
});

describe('discoverOauthServer — the resource document wins', () => {
  it('follows the challenge header to the resource metadata and its authorization server', async () => {
    const { fn, calls } = fakeFetch({
      [MCP]: {
        status: 401,
        headers: {
          'www-authenticate':
            'Bearer resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/v2/mcp"',
        },
      },
      'https://mcp.example.test/.well-known/oauth-protected-resource/v2/mcp': {
        status: 200,
        body: RESOURCE_META,
      },
      'https://auth.example.test/.well-known/oauth-authorization-server/tenant-1': {
        status: 200,
        body: TENANT_META,
      },
      'https://mcp.example.test/.well-known/oauth-authorization-server': {
        status: 200,
        body: HOST_META,
      },
    });

    const found = await discoverOauthServer(MCP, fn);

    expect(found).toEqual({
      metadata: { ...TENANT_META, scopes_supported: ['read:me', 'offline_access'] },
      resource: MCP,
      via: 'protected-resource',
    });
    // The host document was never needed.
    expect(calls).not.toContain('https://mcp.example.test/.well-known/oauth-authorization-server');
  });

  it('finds the path-qualified resource document without a header hint', async () => {
    const { fn } = fakeFetch({
      [MCP]: { status: 401 },
      'https://mcp.example.test/.well-known/oauth-protected-resource/v2/mcp': {
        status: 200,
        body: RESOURCE_META,
      },
      'https://auth.example.test/.well-known/oauth-authorization-server/tenant-1': {
        status: 200,
        body: TENANT_META,
      },
    });

    const found = await discoverOauthServer(MCP, fn);
    expect(found?.via).toBe('protected-resource');
    expect(found?.metadata.token_endpoint).toBe('https://auth.example.test/oauth/token');
  });

  it('tries the OpenID forms when the RFC 8414 one is missing', async () => {
    const { fn } = fakeFetch({
      'https://mcp.example.test/.well-known/oauth-protected-resource': {
        status: 200,
        body: RESOURCE_META,
      },
      'https://auth.example.test/tenant-1/.well-known/openid-configuration': {
        status: 200,
        body: TENANT_META,
      },
    });

    const found = await discoverOauthServer(MCP, fn);
    expect(found?.metadata.issuer).toBe('https://auth.example.test/tenant-1');
  });
});

describe('discoverOauthServer — the host document as the fallback', () => {
  it('reads the host well-known when no resource document exists (the Silpo case)', async () => {
    const { fn, calls } = fakeFetch({
      'https://mcp.example.test/.well-known/oauth-authorization-server': {
        status: 200,
        body: HOST_META,
      },
    });

    const found = await discoverOauthServer(MCP, fn);

    expect(found).toEqual({ metadata: HOST_META, resource: MCP, via: 'origin' });
    expect(calls).toContain('https://mcp.example.test/.well-known/oauth-protected-resource/v2/mcp');
    expect(calls).toContain('https://mcp.example.test/.well-known/oauth-protected-resource');
  });

  it('answers null when nothing is published, and when the network is down', async () => {
    const { fn } = fakeFetch({});
    expect(await discoverOauthServer(MCP, fn)).toBeNull();

    const down = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    expect(await discoverOauthServer(MCP, down)).toBeNull();
  });

  it('ignores a resource document that names no authorization server', async () => {
    const { fn } = fakeFetch({
      'https://mcp.example.test/.well-known/oauth-protected-resource/v2/mcp': {
        status: 200,
        body: { resource: MCP },
      },
      'https://mcp.example.test/.well-known/oauth-authorization-server': {
        status: 200,
        body: HOST_META,
      },
    });

    expect((await discoverOauthServer(MCP, fn))?.via).toBe('origin');
  });
});

describe('discoverOauthServer — addresses another document hands us', () => {
  it('does not follow a resource document to a private authorization server', async () => {
    const { fn, calls } = fakeFetch({
      'https://mcp.example.test/.well-known/oauth-protected-resource/v2/mcp': {
        status: 200,
        body: { authorization_servers: ['http://10.0.0.8/oauth'] },
      },
      'https://mcp.example.test/.well-known/oauth-authorization-server': {
        status: 200,
        body: HOST_META,
      },
    });

    const found = await discoverOauthServer(MCP, fn);

    expect(found?.via).toBe('origin');
    expect(calls.some((c) => c.startsWith('http://10.0.0.8'))).toBe(false);
  });

  it('does not follow a challenge header to a private host', async () => {
    const { fn, calls } = fakeFetch({
      [MCP]: {
        status: 401,
        headers: {
          'www-authenticate': 'Bearer resource_metadata="http://127.0.0.1:9000/prm"',
        },
      },
    });

    await discoverOauthServer(MCP, fn);
    expect(calls.some((c) => c.startsWith('http://127.0.0.1'))).toBe(false);
  });
});
