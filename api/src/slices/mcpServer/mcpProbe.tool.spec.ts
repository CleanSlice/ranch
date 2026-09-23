import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { McpProbeTool } from './mcpProbe.tool';
import type { McpProbeService } from './domain/mcpProbe.service';
import type { IMcpProbeResult, IMcpServerData, IMcpServerGateway } from './domain';
import { UserRoleTypes } from '#/user/user/domain';

/**
 * Audience, the two ways in (url vs id), and that a registered row's
 * credential is handed to the service but never comes back out.
 */
const SENTINEL = 'SENTINEL-BEARER';

const request = (roles: UserRoleTypes[]): Request =>
  ({ user: { sub: 'agent:agent-ops', email: '', roles } }) as unknown as Request;
const operator = () => request([UserRoleTypes.Owner]);
const plainAgent = () => request([UserRoleTypes.Agent]);

const row = (): IMcpServerData => ({
  id: 'mcp-1',
  name: 'Jira',
  description: null,
  url: 'https://mcp.jira.test/mcp',
  transport: 'streamableHttp',
  authType: 'bearer',
  authValue: SENTINEL,
  oauthClientId: null,
  enabled: true,
  builtIn: false,
  templateIds: [],
  createdAt: new Date('2026-09-23T10:00:00.000Z'),
  updatedAt: new Date('2026-09-23T10:00:00.000Z'),
});

const finding = (overrides: Partial<IMcpProbeResult> = {}): IMcpProbeResult => ({
  url: 'https://mcp.silpo.test/mcp',
  reachable: false,
  transport: 'streamableHttp',
  authType: 'oauth',
  authRequired: true,
  oauth: {
    issuer: 'https://mcp.silpo.test',
    dynamicRegistration: true,
    pkce: true,
    scopes: [],
  },
  server: null,
  tools: null,
  error: 'The server requires OAuth',
  ...overrides,
});

function harness() {
  const probe = { probe: jest.fn().mockResolvedValue(finding()) };
  const servers = { findById: jest.fn().mockResolvedValue(row()) };
  const tool = new McpProbeTool(
    probe as unknown as McpProbeService,
    servers as unknown as IMcpServerGateway,
  );
  return { tool, probe, servers };
}

const textOf = (result: { content: { text: string }[] }) => result.content[0].text;

describe('McpProbeTool — who may use it', () => {
  it('hides the tool from a plain agent and refuses a call by name', async () => {
    const { tool } = harness();
    await expect(tool.isListedForRequest(plainAgent())).resolves.toBe(false);
    await expect(
      tool.probeMcpServer({ url: 'https://mcp.silpo.test/mcp' }, {}, plainAgent()),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lists it for the operator', async () => {
    const { tool } = harness();
    await expect(tool.isListedForRequest(operator())).resolves.toBe(true);
  });
});

describe('McpProbeTool — by url', () => {
  it('probes a pasted url with the guard on and tells the model how to register it', async () => {
    const { tool, probe } = harness();

    const result = await tool.probeMcpServer(
      { url: 'https://mcp.silpo.test/mcp' },
      {},
      operator(),
    );

    expect(probe.probe).toHaveBeenCalledWith({ url: 'https://mcp.silpo.test/mcp' });
    const body = JSON.parse(textOf(result)) as Record<string, unknown>;
    expect(body).toMatchObject({ authType: 'oauth', authRequired: true });
    expect(body.next).toContain('authType=oauth');
    expect(body.next).toContain('start_mcp_oauth');
  });

  it('turns the guard refusal into a tool error, not an exception', async () => {
    const { tool, probe } = harness();
    probe.probe.mockRejectedValueOnce(
      new BadRequestException('The address 10.0.0.5 is a private or local host'),
    );

    const result = await tool.probeMcpServer({ url: 'http://10.0.0.5/mcp' }, {}, operator());

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('private or local host');
    expect(textOf(result)).toContain('Nothing was probed');
  });

  it('asks for url or id when given neither', async () => {
    const { tool, probe } = harness();
    const result = await tool.probeMcpServer({}, {}, operator());
    expect(result.isError).toBe(true);
    expect(probe.probe).not.toHaveBeenCalled();
  });
});

describe('McpProbeTool — by id', () => {
  it('probes the row with its stored credential, guard off, and never echoes the credential', async () => {
    const { tool, probe } = harness();
    probe.probe.mockResolvedValueOnce(
      finding({
        url: 'https://mcp.jira.test/mcp',
        reachable: true,
        authType: 'bearer',
        authRequired: false,
        oauth: null,
        server: { name: 'jira-mcp', version: '2.0.0' },
        tools: [{ name: 'jira_search', description: '' }],
        error: undefined,
      }),
    );

    const result = await tool.probeMcpServer({ id: 'mcp-1' }, {}, operator());

    expect(probe.probe).toHaveBeenCalledWith({
      url: 'https://mcp.jira.test/mcp',
      authType: 'bearer',
      authValue: SENTINEL,
      allowPrivate: true,
    });
    const text = textOf(result);
    expect(text).not.toContain(SENTINEL);
    const body = JSON.parse(text) as Record<string, unknown>;
    expect(body.registered).toEqual({ id: 'mcp-1', name: 'Jira' });
    expect(body.server).toEqual({ name: 'jira-mcp', version: '2.0.0' });
    expect(body.next).toContain('«Jira» answers over streamableHttp with 1 tools');
  });

  it('names the next move when an unknown id is given', async () => {
    const { tool, servers, probe } = harness();
    servers.findById.mockResolvedValueOnce(null);

    const result = await tool.probeMcpServer({ id: 'nope' }, {}, operator());

    expect(textOf(result)).toContain('list_mcp_servers');
    expect(probe.probe).not.toHaveBeenCalled();
  });
});
