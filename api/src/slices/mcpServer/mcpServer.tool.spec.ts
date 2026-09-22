import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { McpServerTool } from './mcpServer.tool';
import type { IMcpServerGateway } from './domain';
import type { IMcpServerData } from './domain';
import { UserRoleTypes } from '#/user/user/domain';

/**
 * Two things matter more than the happy paths here: a plain agent cannot see
 * or call these tools, and the bearer a person hands over to register a
 * server never comes back out through any result (FR-004).
 */
const SENTINEL = 'SENTINEL-BEARER';

const row = (overrides: Partial<IMcpServerData> = {}): IMcpServerData => ({
  id: 'mcp-1',
  name: 'Jira',
  description: 'Tickets',
  url: 'https://mcp.jira.test/mcp',
  transport: 'streamableHttp',
  authType: 'bearer',
  authValue: SENTINEL,
  oauthClientId: 'client-secret-id',
  enabled: true,
  builtIn: false,
  templateIds: ['tpl-1'],
  createdAt: new Date('2026-09-17T10:00:00.000Z'),
  updatedAt: new Date('2026-09-17T10:00:00.000Z'),
  ...overrides,
});

const builtIn = () =>
  row({
    id: 'mcp-ranch',
    name: 'Ranch',
    url: 'http://ranch-api/mcp',
    authType: 'none',
    authValue: null,
    oauthClientId: null,
    builtIn: true,
    templateIds: [],
  });

const request = (roles: UserRoleTypes[]): Request =>
  ({
    user: { sub: 'agent:agent-ops', email: '', roles },
  }) as unknown as Request;

const operator = () => request([UserRoleTypes.Owner]);
const plainAgent = () => request([UserRoleTypes.Agent]);

interface Harness {
  tool: McpServerTool;
  servers: jest.Mocked<
    Pick<
      IMcpServerGateway,
      'findAll' | 'findById' | 'create' | 'update' | 'delete'
    >
  >;
}

function harness(): Harness {
  const servers = {
    findAll: jest.fn().mockResolvedValue([row(), builtIn()]),
    findById: jest.fn().mockResolvedValue(row()),
    create: jest.fn().mockResolvedValue(row()),
    update: jest.fn().mockResolvedValue(row()),
    delete: jest.fn().mockResolvedValue(undefined),
  } as unknown as Harness['servers'];
  const tool = new McpServerTool(servers as never);
  return { tool, servers };
}

const textOf = (result: { content: { text: string }[] }) =>
  result.content[0].text;

describe('McpServerTool — who may use it', () => {
  it('hides the tools from a plain agent', async () => {
    const { tool } = harness();
    await expect(tool.isListedForRequest(plainAgent())).resolves.toBe(false);
  });

  it('lists them for an operator agent', async () => {
    const { tool } = harness();
    await expect(tool.isListedForRequest(operator())).resolves.toBe(true);
  });

  it('refuses a call from a plain agent even by name', async () => {
    const { tool, servers } = harness();
    await expect(
      tool.listMcpServers({}, null, plainAgent()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(servers.findAll).not.toHaveBeenCalled();
  });
});

describe('McpServerTool — reading', () => {
  it('lists every server without its credential or OAuth client id', async () => {
    const { tool } = harness();
    const text = textOf(await tool.listMcpServers({}, null, operator()));
    expect(text).toContain('"Jira"');
    expect(text).toContain('"Ranch"');
    expect(text).toContain('"authType": "bearer"');
    expect(text).toContain('"builtIn": true');
    expect(text).toContain('"tpl-1"');
    expect(text).not.toContain(SENTINEL);
    expect(text).not.toContain('authValue');
    expect(text).not.toContain('oauthClientId');
  });

  it('shows one server by id, stripped the same way', async () => {
    const { tool, servers } = harness();
    const text = textOf(
      await tool.getMcpServer({ id: 'mcp-1' }, null, operator()),
    );
    expect(servers.findById).toHaveBeenCalledWith('mcp-1');
    expect(text).toContain('https://mcp.jira.test/mcp');
    expect(text).not.toContain(SENTINEL);
    expect(text).not.toContain('client-secret-id');
  });

  it('points a miss at list_mcp_servers', async () => {
    const { tool, servers } = harness();
    servers.findById.mockResolvedValue(null);
    const text = textOf(
      await tool.getMcpServer({ id: 'nope' }, null, operator()),
    );
    expect(text).toContain('not found');
    expect(text).toContain('list_mcp_servers');
  });
});

describe('McpServerTool — registering', () => {
  it('passes the fields to the gateway and acknowledges the credential without echoing it', async () => {
    const { tool, servers } = harness();
    const text = textOf(
      await tool.registerMcpServer(
        {
          name: 'Jira',
          url: 'https://mcp.jira.test/mcp',
          authType: 'bearer',
          authValue: SENTINEL,
          transport: 'streamableHttp',
        },
        null,
        operator(),
      ),
    );
    expect(servers.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Jira',
        url: 'https://mcp.jira.test/mcp',
        authType: 'bearer',
        authValue: SENTINEL,
        transport: 'streamableHttp',
      }),
    );
    expect(text).toContain('"id": "mcp-1"');
    expect(text).toContain('Credential stored');
    expect(text).toContain('set_template_mcps');
    expect(text).toContain('restart');
    expect(text).not.toContain(SENTINEL);
  });

  it('tells the model each agent still has to connect when the server is oauth', async () => {
    const { tool, servers } = harness();
    servers.create.mockResolvedValue(
      row({ authType: 'oauth', authValue: null }),
    );
    const text = textOf(
      await tool.registerMcpServer(
        { name: 'Jira', url: 'https://mcp.jira.test/mcp', authType: 'oauth' },
        null,
        operator(),
      ),
    );
    expect(text).toContain('start_mcp_oauth');
    expect(text).toContain('No credential stored');
  });
});

describe('McpServerTool — updating', () => {
  it('sends only the fields given and never echoes a new credential', async () => {
    const { tool, servers } = harness();
    const text = textOf(
      await tool.updateMcpServer(
        { id: 'mcp-1', enabled: false, authValue: SENTINEL },
        null,
        operator(),
      ),
    );
    expect(servers.update).toHaveBeenCalledWith('mcp-1', {
      enabled: false,
      authValue: SENTINEL,
    });
    expect(text).toContain('Credential replaced');
    expect(text).toContain('restart_agent');
    expect(text).not.toContain(SENTINEL);
    expect(text).not.toContain('ignored');
  });

  it('lets a built-in row change only enabled and description, and says what it dropped', async () => {
    const { tool, servers } = harness();
    servers.findById.mockResolvedValue(builtIn());
    servers.update.mockResolvedValue(builtIn());
    const text = textOf(
      await tool.updateMcpServer(
        {
          id: 'mcp-ranch',
          enabled: false,
          description: 'Off for now',
          url: 'https://evil.test',
          authValue: SENTINEL,
        },
        null,
        operator(),
      ),
    );
    expect(servers.update).toHaveBeenCalledWith('mcp-ranch', {
      enabled: false,
      description: 'Off for now',
    });
    expect(text).toContain('built in');
    expect(text).toContain('"url"');
    expect(text).toContain('"authValue"');
    expect(text).not.toContain(SENTINEL);
    expect(text).not.toContain('Credential replaced');
  });

  it('reports a missing server before touching the gateway', async () => {
    const { tool, servers } = harness();
    servers.findById.mockResolvedValue(null);
    const text = textOf(
      await tool.updateMcpServer(
        { id: 'nope', enabled: false },
        null,
        operator(),
      ),
    );
    expect(text).toContain('not found');
    expect(servers.update).not.toHaveBeenCalled();
  });
});

describe('McpServerTool — deleting', () => {
  it('refuses without the confirmation argument and deletes nothing (CLEAN-109)', async () => {
    const { tool, servers } = harness();
    const result = await tool.deleteMcpServer(
      { id: 'mcp-1' },
      null,
      operator(),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('«Jira»');
    expect(textOf(result)).toContain('confirm: true');
    expect(servers.delete).not.toHaveBeenCalled();
  });

  it('deletes once confirmed and names the restart that makes it real', async () => {
    const { tool, servers } = harness();
    const text = textOf(
      await tool.deleteMcpServer(
        { id: 'mcp-1', confirm: true },
        null,
        operator(),
      ),
    );
    expect(servers.delete).toHaveBeenCalledWith('mcp-1');
    expect(text).toContain('«Jira»');
    expect(text).toContain('restart_agent');
  });

  it('refuses a built-in with the controller wording and the disabling move, even when confirmed', async () => {
    const { tool, servers } = harness();
    servers.findById.mockResolvedValue(builtIn());
    const result = await tool.deleteMcpServer(
      { id: 'mcp-ranch', confirm: true },
      null,
      operator(),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Built-in MCP servers cannot be deleted');
    expect(textOf(result)).toContain('update_mcp_server');
    expect(servers.delete).not.toHaveBeenCalled();
  });

  it('reports a missing server before asking for confirmation', async () => {
    const { tool, servers } = harness();
    servers.findById.mockResolvedValue(null);
    const result = await tool.deleteMcpServer({ id: 'nope' }, null, operator());
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toContain('not found');
    expect(servers.delete).not.toHaveBeenCalled();
  });
});
