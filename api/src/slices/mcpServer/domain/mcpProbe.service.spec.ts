import { BadRequestException } from '@nestjs/common';
import { McpProbeService, credentialHeaders } from './mcpProbe.service';
import {
  McpProbeHttpError,
  type IMcpProbeConnector,
  type IMcpProbeHandshake,
} from './mcpProbe.types';

/**
 * The decisions, not the sockets: which transport gets tried when, how a
 * refusal is read with and without OAuth metadata on the origin, and that a
 * pasted private address never reaches the connector. The SDK half lives in
 * data/mcpProbe.connector.ts and is exercised against a real server.
 */

const SILPO = 'https://mcp.silpo.test/mcp';

const answered = (tools = ['search_products', 'get_cart']): IMcpProbeHandshake => ({
  server: { name: 'silpo-mcp', version: '1.2.0' },
  tools: tools.map((name) => ({ name, description: `${name} desc` })),
});

const OAUTH_META = {
  issuer: 'https://mcp.silpo.test',
  authorization_endpoint: 'https://auth.silpo.test/authorize',
  token_endpoint: 'https://auth.silpo.test/token',
  registration_endpoint: 'https://auth.silpo.test/register',
  code_challenge_methods_supported: ['S256'],
  scopes_supported: ['catalog', 'cart'],
};

type Handshake = jest.Mock<
  Promise<IMcpProbeHandshake>,
  Parameters<IMcpProbeConnector['handshake']>
>;

function harness(): { service: McpProbeService; handshake: Handshake } {
  const handshake: Handshake = jest.fn();
  const connector = { handshake } as unknown as IMcpProbeConnector;
  return { service: new McpProbeService(connector), handshake };
}

/** `fetch` for the well-known lookup: metadata, a 404, or a network failure. */
function wellKnown(answer: 'oauth' | 'none' | 'down') {
  const impl = jest.fn(async () => {
    if (answer === 'down') throw new Error('ECONNREFUSED');
    if (answer === 'none') return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => OAUTH_META };
  });
  (global as { fetch: unknown }).fetch = impl;
  return impl;
}

const originalFetch = global.fetch;
const originalAllowPrivate = process.env.A2A_ALLOW_PRIVATE_PEERS;

beforeEach(() => {
  // The public-address guard does a DNS pre-flight for hostnames; the test
  // hosts are fictitious, and a failed resolution passes by design. Local
  // dev lifts the guard outright, so make sure the tests run with it on.
  delete process.env.A2A_ALLOW_PRIVATE_PEERS;
});

afterEach(() => {
  (global as { fetch: unknown }).fetch = originalFetch;
  if (originalAllowPrivate === undefined) delete process.env.A2A_ALLOW_PRIVATE_PEERS;
  else process.env.A2A_ALLOW_PRIVATE_PEERS = originalAllowPrivate;
});

describe('McpProbeService — an open server', () => {
  it('answers over streamable HTTP with its tools and needs no credential', async () => {
    wellKnown('none');
    const { service, handshake } = harness();
    handshake.mockResolvedValueOnce(answered());

    const result = await service.probe({ url: 'https://mcp.example.test/mcp' });

    expect(result).toMatchObject({
      reachable: true,
      transport: 'streamableHttp',
      authType: 'none',
      authRequired: false,
      oauth: null,
      server: { name: 'silpo-mcp', version: '1.2.0' },
    });
    expect(result.tools).toHaveLength(2);
    expect(handshake).toHaveBeenCalledTimes(1);
    expect(handshake).toHaveBeenCalledWith(
      'https://mcp.example.test/mcp',
      'streamableHttp',
      {},
    );
  });

  it('falls back to SSE only when streamable HTTP says it is not a POST target', async () => {
    wellKnown('none');
    const { service, handshake } = harness();
    handshake
      .mockRejectedValueOnce(new McpProbeHttpError(405, 'Method Not Allowed'))
      .mockResolvedValueOnce(answered(['legacy_tool']));

    const result = await service.probe({ url: 'https://old.example.test/sse' });

    expect(result).toMatchObject({ reachable: true, transport: 'sse' });
    expect(handshake.mock.calls.map((c) => c[1])).toEqual([
      'streamableHttp',
      'sse',
    ]);
  });

  it('does not try SSE after a network failure — that is already the answer', async () => {
    wellKnown('down');
    const { service, handshake } = harness();
    handshake.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const result = await service.probe({ url: 'https://gone.example.test/mcp' });

    expect(result).toMatchObject({
      reachable: false,
      transport: null,
      authType: null,
      error: 'ECONNREFUSED',
    });
    expect(handshake).toHaveBeenCalledTimes(1);
  });
});

describe('McpProbeService — a server that wants a credential', () => {
  it('reads a 401 next to OAuth metadata as an OAuth server (the Silpo case)', async () => {
    const meta = wellKnown('oauth');
    const { service, handshake } = harness();
    handshake.mockRejectedValueOnce(new McpProbeHttpError(401, 'Unauthorized'));

    const result = await service.probe({ url: SILPO });

    expect(result).toMatchObject({
      reachable: false,
      transport: 'streamableHttp',
      authRequired: true,
      authType: 'oauth',
      oauth: {
        issuer: 'https://mcp.silpo.test',
        dynamicRegistration: true,
        pkce: true,
        scopes: ['catalog', 'cart'],
      },
      tools: null,
    });
    expect(result.error).toContain('start_mcp_oauth');
    expect(meta).toHaveBeenCalledWith(
      'https://mcp.silpo.test/.well-known/oauth-authorization-server',
      expect.objectContaining({ redirect: 'manual' }),
    );
    // A refusal is an answer: no SSE attempt.
    expect(handshake).toHaveBeenCalledTimes(1);
  });

  it('reads a 401 without metadata as a bearer/header server', async () => {
    wellKnown('none');
    const { service, handshake } = harness();
    handshake.mockRejectedValueOnce(new McpProbeHttpError(401, 'Unauthorized'));

    const result = await service.probe({ url: 'https://private.example.test/mcp' });

    expect(result).toMatchObject({
      authRequired: true,
      authType: 'bearer',
      oauth: null,
    });
    expect(result.error).toContain('bearer token or header value');
  });

  it('sends a stored bearer and confirms its type when the handshake goes through', async () => {
    wellKnown('none');
    const { service, handshake } = harness();
    handshake.mockResolvedValueOnce(answered(['jira_search']));

    const result = await service.probe({
      url: 'https://jira.example.test/mcp',
      authType: 'bearer',
      authValue: 'SENTINEL-BEARER',
      allowPrivate: true,
    });

    expect(result).toMatchObject({ reachable: true, authType: 'bearer' });
    expect(handshake).toHaveBeenCalledWith(
      'https://jira.example.test/mcp',
      'streamableHttp',
      { Authorization: 'Bearer SENTINEL-BEARER' },
    );
    expect(JSON.stringify(result)).not.toContain('SENTINEL-BEARER');
  });

  it('says so when the stored credential is refused, without echoing it', async () => {
    wellKnown('none');
    const { service, handshake } = harness();
    handshake.mockRejectedValueOnce(new McpProbeHttpError(403, 'Forbidden'));

    const result = await service.probe({
      url: 'https://jira.example.test/mcp',
      authType: 'header',
      authValue: 'X-Token: SENTINEL-HEADER',
      allowPrivate: true,
    });

    expect(result.error).toBe('The stored header credential was refused (403)');
    expect(JSON.stringify(result)).not.toContain('SENTINEL-HEADER');
  });
});

describe('McpProbeService — addresses', () => {
  it('refuses a private address for a pasted url before touching the network', async () => {
    const fetchSpy = wellKnown('none');
    const { service, handshake } = harness();

    await expect(
      service.probe({ url: 'http://10.0.0.5:8080/mcp' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(handshake).not.toHaveBeenCalled();
  });

  it('lets a registered row on a cluster host through with allowPrivate', async () => {
    wellKnown('none');
    const { service, handshake } = harness();
    handshake.mockResolvedValueOnce(answered(['query_attachment']));

    const result = await service.probe({
      url: 'http://ranch-api/mcp',
      allowPrivate: true,
    });

    expect(result.reachable).toBe(true);
  });

  it('rejects something that is not an http(s) URL', async () => {
    const { service } = harness();
    await expect(service.probe({ url: 'ftp://x.test/mcp' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.probe({ url: 'not a url' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('credentialHeaders', () => {
  it('turns a bearer into an Authorization header', () => {
    expect(credentialHeaders('bearer', 'abc')).toEqual({ Authorization: 'Bearer abc' });
  });

  it('reads the runtime spelling of a header credential', () => {
    expect(credentialHeaders('header', 'X-Token: secret')).toEqual({ 'X-Token': 'secret' });
  });

  it('reads the admin-form spelling of a header credential', () => {
    expect(credentialHeaders('header', '{ "X-Token": "secret", "X-Org": "acme" }')).toEqual({
      'X-Token': 'secret',
      'X-Org': 'acme',
    });
  });

  it('sends nothing for none, oauth, or an empty value', () => {
    expect(credentialHeaders('none', 'x')).toEqual({});
    expect(credentialHeaders('oauth', 'x')).toEqual({});
    expect(credentialHeaders('bearer', null)).toEqual({});
    expect(credentialHeaders('header', 'no-colon')).toEqual({});
  });
});
