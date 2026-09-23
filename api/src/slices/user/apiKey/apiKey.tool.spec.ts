import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { ApiKeyTool, KEY_SHOWN_ONCE } from './apiKey.tool';
import { ApiKeyScopeTypes } from './domain';
import type { IApiKeyGateway, ApiKeyService } from './domain';
import { UserRoleTypes } from '#/user/user/domain';

/**
 * An API key with the `admin` scope is the whole API. Three properties matter
 * more than any happy path: a plain agent cannot see or call these tools, a
 * listing never carries a hash or a key, and the one place a key IS returned
 * (creation) says out loud that it will not be shown again.
 */
const SENTINEL_HASH = 'SENTINEL-HASH';
const PLAINTEXT_KEY = 'rk_PLAINTEXT-ONCE-abc123';

const request = (roles: UserRoleTypes[]): Request =>
  ({
    user: { sub: 'agent:agent-ops', email: '', roles },
  }) as unknown as Request;

const operator = () => request([UserRoleTypes.Owner]);
const plainAgent = () => request([UserRoleTypes.Agent]);

/**
 * A row as a careless gateway might return it: the domain type has no hash,
 * but the tool must not depend on that staying true.
 */
const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'apikey-1',
  name: 'Marketing site embed',
  prefix: 'x9Qz',
  scopes: [ApiKeyScopeTypes.EmbedMint],
  lastUsedAt: null,
  expiresAt: new Date('2027-01-01T00:00:00.000Z'),
  createdBy: 'user-1',
  createdAt: new Date('2026-09-17T10:00:00.000Z'),
  keyHash: SENTINEL_HASH,
  key: SENTINEL_HASH,
  ...overrides,
});

interface Harness {
  tool: ApiKeyTool;
  gateway: { findById: jest.Mock; findAll: jest.Mock };
  service: { list: jest.Mock; create: jest.Mock; revoke: jest.Mock };
}

function harness(): Harness {
  const gateway = {
    findById: jest.fn().mockResolvedValue(row()),
    findAll: jest.fn().mockResolvedValue([row()]),
  };
  const service = {
    list: jest
      .fn()
      .mockResolvedValue([row(), row({ id: 'apikey-2', name: 'CI' })]),
    create: jest.fn().mockResolvedValue({
      apiKey: row({
        id: 'apikey-new',
        name: 'New key',
        createdBy: 'agent:agent-ops',
      }),
      key: PLAINTEXT_KEY,
    }),
    revoke: jest.fn().mockResolvedValue(undefined),
  };
  const tool = new ApiKeyTool(
    gateway as unknown as IApiKeyGateway,
    service as unknown as ApiKeyService,
  );
  return { tool, gateway, service };
}

const textOf = (result: { content: { text: string }[] }) =>
  result.content[0].text;

describe('ApiKeyTool — who may use it', () => {
  it('hides the tools from an agent that is not a Ranch operator', async () => {
    const { tool } = harness();
    await expect(tool.isListedForRequest(plainAgent())).resolves.toBe(false);
  });

  it('lists them for an operator agent', async () => {
    const { tool } = harness();
    await expect(tool.isListedForRequest(operator())).resolves.toBe(true);
  });

  it('refuses a call from a plain agent even by name', async () => {
    const { tool, service } = harness();
    await expect(
      tool.createApiKey(
        { name: 'Sneaky', scopes: [ApiKeyScopeTypes.Admin] },
        null,
        plainAgent(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.create).not.toHaveBeenCalled();
  });

  it('refuses a caller with no roles at all', async () => {
    const { tool } = harness();
    await expect(
      tool.listApiKeys({}, null, {} as Request),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('ApiKeyTool — listing', () => {
  it('lists prefix and metadata, never a hash or a key', async () => {
    const { tool, service } = harness();
    const text = textOf(await tool.listApiKeys({}, null, operator()));
    expect(service.list).toHaveBeenCalled();
    expect(text).toContain('apikey-1');
    expect(text).toContain('Marketing site embed');
    expect(text).toContain('x9Qz');
    expect(text).toContain('embed:mint');
    expect(text).toContain('2027-01-01T00:00:00.000Z');
    expect(text).not.toContain(SENTINEL_HASH);
    expect(text).not.toContain('keyHash');
  });

  it('tells the model where the id goes', async () => {
    const { tool } = harness();
    const parsed = JSON.parse(
      textOf(await tool.listApiKeys({}, null, operator())),
    );
    expect(parsed.apiKeys).toHaveLength(2);
    expect(parsed.apiKeys[1]).toMatchObject({ id: 'apikey-2', name: 'CI' });
  });
});

describe('ApiKeyTool — creating', () => {
  it('creates the key as the calling agent and returns the plaintext once', async () => {
    const { tool, service } = harness();
    const result = await tool.createApiKey(
      {
        name: 'New key',
        scopes: [ApiKeyScopeTypes.EmbedMint, ApiKeyScopeTypes.EmbedMint],
        expiresAt: '2027-01-01T00:00:00.000Z',
      },
      null,
      operator(),
    );
    expect(service.create).toHaveBeenCalledWith({
      name: 'New key',
      scopes: [ApiKeyScopeTypes.EmbedMint],
      expiresAt: new Date('2027-01-01T00:00:00.000Z'),
      createdBy: 'agent:agent-ops',
    });
    const text = textOf(result);
    expect(result.isError).toBeUndefined();
    expect(text).toContain(PLAINTEXT_KEY);
    expect(text).toContain(KEY_SHOWN_ONCE);
    expect(text).toContain(
      'This key is shown once. Hand it to the person verbatim and do not repeat it in later messages.',
    );
    expect(text).toContain('apikey-new');
    // The hash is still not a thing a tool result carries, even here.
    expect(text).not.toContain(SENTINEL_HASH);
  });

  it('passes no expiry when none is given', async () => {
    const { tool, service } = harness();
    await tool.createApiKey(
      { name: 'Forever', scopes: [ApiKeyScopeTypes.Admin] },
      null,
      operator(),
    );
    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Forever', expiresAt: null }),
    );
  });

  it('refuses a date it cannot parse without minting anything', async () => {
    const { tool, service } = harness();
    const result = await tool.createApiKey(
      {
        name: 'Oops',
        scopes: [ApiKeyScopeTypes.Admin],
        expiresAt: 'next tuesday',
      },
      null,
      operator(),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('expiresAt');
    expect(service.create).not.toHaveBeenCalled();
  });
});

describe('ApiKeyTool — revoking', () => {
  it('refuses without confirm, names the key, and touches nothing', async () => {
    const { tool, service } = harness();
    const result = await tool.revokeApiKey(
      { id: 'apikey-1' },
      null,
      operator(),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Marketing site embed');
    expect(textOf(result)).toContain('confirm: true');
    expect(service.revoke).not.toHaveBeenCalled();
  });

  it('revokes once confirmed', async () => {
    const { tool, service } = harness();
    const result = await tool.revokeApiKey(
      { id: 'apikey-1', confirm: true },
      null,
      operator(),
    );
    expect(service.revoke).toHaveBeenCalledWith('apikey-1');
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toContain('Marketing site embed');
    expect(textOf(result)).toContain('create_api_key');
    expect(textOf(result)).not.toContain(SENTINEL_HASH);
  });

  it('reports a missing key before asking for a confirmation', async () => {
    const { tool, gateway, service } = harness();
    gateway.findById.mockResolvedValue(null);
    const result = await tool.revokeApiKey(
      { id: 'apikey-gone' },
      null,
      operator(),
    );
    expect(textOf(result)).toContain('apikey-gone');
    expect(textOf(result)).toContain('list_api_keys');
    expect(service.revoke).not.toHaveBeenCalled();
  });
});
