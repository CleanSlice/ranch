import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { McpOauthTool } from './mcpOauth.tool';
import type { McpOauthService } from './domain/mcpOauth.service';
import { UserRoleTypes } from '#/user/user/domain';

const AUTHORIZE_URL =
  'https://auth.provider.test/authorize?client_id=abc&state=xyz';

const request = (roles: UserRoleTypes[], sub = 'agent:agent-ops'): Request =>
  ({
    user: { sub, email: '', roles },
  }) as unknown as Request;

const operator = () => request([UserRoleTypes.Owner]);
const plainAgent = () => request([UserRoleTypes.Agent]);
/** An operator that is a person, not an agent — there is no "self" to connect. */
const humanOperator = () => request([UserRoleTypes.Owner], 'user-1');

function harness() {
  const oauth = {
    start: jest.fn().mockResolvedValue({ authorizeUrl: AUTHORIZE_URL }),
  };
  const tool = new McpOauthTool(oauth as unknown as McpOauthService);
  return { tool, oauth };
}

const textOf = (result: { content: { text: string }[] }) =>
  result.content[0].text;

describe('McpOauthTool — who may use it', () => {
  it('hides the tool from a plain agent', async () => {
    const { tool } = harness();
    await expect(tool.isListedForRequest(plainAgent())).resolves.toBe(false);
  });

  it('lists it for an operator agent', async () => {
    const { tool } = harness();
    await expect(tool.isListedForRequest(operator())).resolves.toBe(true);
  });

  it('refuses a call from a plain agent even by name', async () => {
    const { tool, oauth } = harness();
    await expect(
      tool.startMcpOauth({ serverId: 'mcp-1' }, null, plainAgent()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(oauth.start).not.toHaveBeenCalled();
  });
});

describe('McpOauthTool — starting a connect', () => {
  it('connects for the calling agent by default and hands back the URL to open', async () => {
    const { tool, oauth } = harness();
    const text = textOf(
      await tool.startMcpOauth({ serverId: 'mcp-1' }, null, operator()),
    );
    expect(oauth.start).toHaveBeenCalledWith('mcp-1', 'agent-ops');
    expect(text).toContain(AUTHORIZE_URL);
    expect(text).toContain('"agentId": "agent-ops"');
    expect(text).toContain('browser');
  });

  it('connects for another agent when told which', async () => {
    const { tool, oauth } = harness();
    await tool.startMcpOauth(
      { serverId: 'mcp-1', agentId: 'agent-support' },
      null,
      operator(),
    );
    expect(oauth.start).toHaveBeenCalledWith('mcp-1', 'agent-support');
  });

  it('asks for an agentId when the operator is a person', async () => {
    const { tool, oauth } = harness();
    const result = await tool.startMcpOauth(
      { serverId: 'mcp-1' },
      null,
      humanOperator(),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('agentId');
    expect(oauth.start).not.toHaveBeenCalled();
  });

  it('points a missing server at list_mcp_servers', async () => {
    const { tool, oauth } = harness();
    oauth.start.mockRejectedValue(
      new NotFoundException('MCP server not found'),
    );
    const result = await tool.startMcpOauth(
      { serverId: 'nope' },
      null,
      operator(),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('not found');
    expect(textOf(result)).toContain('list_mcp_servers');
  });

  it('tells the model to switch the server to oauth first when it is not', async () => {
    const { tool, oauth } = harness();
    oauth.start.mockRejectedValue(
      new BadRequestException('MCP server is not OAuth-based'),
    );
    const result = await tool.startMcpOauth(
      { serverId: 'mcp-1' },
      null,
      operator(),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('update_mcp_server');
  });

  it('lets a non-HTTP failure escape, so the MCP layer reports it as an error', async () => {
    const { tool, oauth } = harness();
    oauth.start.mockRejectedValue(new Error('discovery timed out'));
    await expect(
      tool.startMcpOauth({ serverId: 'mcp-1' }, null, operator()),
    ).rejects.toThrow('discovery timed out');
  });
});
