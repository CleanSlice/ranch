import type { Request } from 'express';
import { SecretTool } from './secret.tool';
import type { IAgentGateway } from '#/agent/agent/domain';
import type { ISecretGateway } from './domain';
import { UserRoleTypes } from '#/user/user/domain';
import { asPerson, asTrustedAgent } from '#/mcp/testing';
import { permissionOver } from '#/agent/agent/domain/__fixtures__/agentPermission';

/**
 * These tools put credentials within a model's reach. The property worth
 * more than any happy path is therefore that a value written through a tool
 * never comes back out of one — not in a listing, not in an acknowledgement,
 * not in a refusal. The sentinel below is the canary for that.
 */
const SENTINEL = 'SENTINEL-SECRET-42';

const request = (roles: UserRoleTypes[]): Request =>
  ({
    user: { sub: 'agent:agent-ops', email: '', roles },
  }) as unknown as Request;

const operator = () => asTrustedAgent(request([UserRoleTypes.Owner]));
const plainAgent = () => asTrustedAgent(request([UserRoleTypes.Agent]));

const agentRow = { id: 'agent-a', name: 'Support Bot' };

const listing = (...entries: [string, string][]) => ({
  provider: 'file' as const,
  secrets: entries.map(([name, value]) => ({
    name,
    value,
    updatedAt: new Date('2026-09-17T10:00:00.000Z'),
  })),
});

interface Harness {
  tool: SecretTool;
  agents: { findById: jest.Mock };
  secrets: {
    list: jest.Mock;
    set: jest.Mock;
    delete: jest.Mock;
    replaceAll: jest.Mock;
  };
}

function harness(): Harness {
  const agents = { findById: jest.fn().mockResolvedValue(agentRow) };
  const secrets = {
    list: jest
      .fn()
      .mockResolvedValue(
        listing(['instagram:password', SENTINEL], ['paypal:api_token', 'sk-1']),
      ),
    set: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    replaceAll: jest.fn().mockResolvedValue(undefined),
  };
  const tool = new SecretTool(
    agents as unknown as IAgentGateway,
    secrets as unknown as ISecretGateway,
    permissionOver(agents),
  );
  return { tool, agents, secrets };
}

const textOf = (result: { content: { text: string }[] }) =>
  result.content[0].text;

describe('SecretTool — who may use it', () => {
  it('hides the tools from an agent that is not a Ranch operator', async () => {
    const { tool } = harness();
    await expect(tool.isListedForRequest(plainAgent())).resolves.toBe(false);
  });

  it('lists them for an operator agent', async () => {
    const { tool } = harness();
    await expect(tool.isListedForRequest(operator())).resolves.toBe(true);
  });

  it('refuses a call from a plain agent even by name', async () => {
    // Answered like an agent that does not exist (CLEAN-232): no 403 that
    // would confirm the agent is there.
    const { tool, secrets, agents } = harness();
    const result = await tool.setAgentSecret(
      { agentId: 'agent-a', key: 'k', value: SENTINEL },
      null,
      plainAgent(),
    );
    expect(textOf(result)).toContain('Agent agent-a not found');
    expect(textOf(result)).not.toContain(SENTINEL);
    expect(secrets.set).not.toHaveBeenCalled();
    expect(agents.findById).not.toHaveBeenCalled();
  });

  it('refuses a caller with no roles at all', async () => {
    const { tool, secrets } = harness();
    const result = await tool.listAgentSecrets(
      { agentId: 'agent-a' },
      null,
      {} as Request,
    );
    expect(textOf(result)).toContain('Agent agent-a not found');
    expect(secrets.list).not.toHaveBeenCalled();
  });

  it('an Admin reads and writes no secret of the Ranch admin agent; the Owner does', async () => {
    const { tool, secrets, agents } = harness();
    agents.findById.mockResolvedValue({
      ...agentRow,
      id: 'agent-ranch',
      isAdmin: true,
      createdById: null,
    });
    const through = (role: UserRoleTypes) =>
      asPerson(request([UserRoleTypes.Owner]), role);
    const admin = () => through(UserRoleTypes.Admin);

    const answers = [
      await tool.listAgentSecrets({ agentId: 'agent-ranch' }, null, admin()),
      await tool.setAgentSecret(
        { agentId: 'agent-ranch', key: 'k', value: SENTINEL },
        null,
        admin(),
      ),
      await tool.deleteAgentSecret(
        { agentId: 'agent-ranch', key: 'k', confirm: true },
        null,
        admin(),
      ),
      await tool.replaceAgentSecrets(
        { agentId: 'agent-ranch', store: { k: SENTINEL }, confirm: true },
        null,
        admin(),
      ),
    ];
    for (const answer of answers) {
      expect(textOf(answer)).toContain('Agent agent-ranch not found');
    }
    expect(secrets.list).not.toHaveBeenCalled();
    expect(secrets.set).not.toHaveBeenCalled();
    expect(secrets.delete).not.toHaveBeenCalled();
    expect(secrets.replaceAll).not.toHaveBeenCalled();

    await tool.listAgentSecrets(
      { agentId: 'agent-ranch' },
      null,
      through(UserRoleTypes.Owner),
    );
    expect(secrets.list).toHaveBeenCalledWith('agent-ranch');
  });
});

describe('SecretTool — listing', () => {
  it('lists names and timestamps, never values', async () => {
    const { tool, secrets } = harness();
    const text = textOf(
      await tool.listAgentSecrets({ agentId: 'agent-a' }, null, operator()),
    );
    expect(secrets.list).toHaveBeenCalledWith('agent-a');
    expect(text).toContain('instagram:password');
    expect(text).toContain('paypal:api_token');
    expect(text).toContain('2026-09-17T10:00:00.000Z');
    expect(text).toContain('"provider": "file"');
    expect(text).toContain('Support Bot');
    expect(text).not.toContain(SENTINEL);
    expect(text).not.toContain('sk-1');
    expect(text).not.toContain('"value"');
  });

  it('names the next move when the agent does not exist', async () => {
    const { tool, agents, secrets } = harness();
    agents.findById.mockResolvedValue(null);
    const text = textOf(
      await tool.listAgentSecrets({ agentId: 'agent-x' }, null, operator()),
    );
    expect(text).toContain('not found');
    expect(text).toContain('list_agents');
    expect(secrets.list).not.toHaveBeenCalled();
  });
});

describe('SecretTool — setting', () => {
  it('writes through the gateway and acknowledges the key only', async () => {
    const { tool, secrets } = harness();
    const text = textOf(
      await tool.setAgentSecret(
        { agentId: 'agent-a', key: 'instagram:password', value: SENTINEL },
        null,
        operator(),
      ),
    );
    expect(secrets.set).toHaveBeenCalledWith(
      'agent-a',
      'instagram:password',
      SENTINEL,
    );
    expect(text).toContain('"ok": true');
    expect(text).toContain('"agentId": "agent-a"');
    expect(text).toContain('"key": "instagram:password"');
    expect(text).toContain('restart_agent with id=agent-a');
  });

  it('never echoes the value it just stored, even though the store lists it', async () => {
    const { tool } = harness();
    const text = textOf(
      await tool.setAgentSecret(
        { agentId: 'agent-a', key: 'instagram:password', value: SENTINEL },
        null,
        operator(),
      ),
    );
    expect(text).not.toContain(SENTINEL);
    expect(text).not.toContain('"value"');
  });

  it('does not write for an agent that does not exist', async () => {
    const { tool, agents, secrets } = harness();
    agents.findById.mockResolvedValue(null);
    const text = textOf(
      await tool.setAgentSecret(
        { agentId: 'agent-x', key: 'k', value: SENTINEL },
        null,
        operator(),
      ),
    );
    expect(text).toContain('not found');
    expect(text).not.toContain(SENTINEL);
    expect(secrets.set).not.toHaveBeenCalled();
  });
});

describe('SecretTool — deleting', () => {
  it('deletes through the gateway once confirmed and lists what remains', async () => {
    const { tool, secrets } = harness();
    secrets.list.mockResolvedValue(listing(['paypal:api_token', 'sk-1']));
    const text = textOf(
      await tool.deleteAgentSecret(
        { agentId: 'agent-a', key: 'instagram:password', confirm: true },
        null,
        operator(),
      ),
    );
    expect(secrets.delete).toHaveBeenCalledWith(
      'agent-a',
      'instagram:password',
    );
    expect(text).toContain('"key": "instagram:password"');
    expect(text).toContain('paypal:api_token');
    expect(text).not.toContain('sk-1');
  });

  it('refuses without the confirmation argument and touches nothing (CLEAN-109)', async () => {
    const { tool, secrets } = harness();
    const result = await tool.deleteAgentSecret(
      { agentId: 'agent-a', key: 'instagram:password' },
      null,
      operator(),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('confirm: true');
    expect(textOf(result)).toContain('«instagram:password»');
    expect(textOf(result)).toContain('«Support Bot»');
    expect(secrets.delete).not.toHaveBeenCalled();
  });

  it('reports a missing agent before asking for confirmation', async () => {
    const { tool, agents, secrets } = harness();
    agents.findById.mockResolvedValue(null);
    const result = await tool.deleteAgentSecret(
      { agentId: 'agent-x', key: 'k' },
      null,
      operator(),
    );
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toContain('not found');
    expect(secrets.delete).not.toHaveBeenCalled();
  });
});

describe('SecretTool — replacing the whole store', () => {
  it('replaces through the gateway once confirmed and lists the new names', async () => {
    const { tool, secrets } = harness();
    secrets.list.mockResolvedValue(
      listing(['a:key', SENTINEL], ['b:key', 'other']),
    );
    const text = textOf(
      await tool.replaceAgentSecrets(
        {
          agentId: 'agent-a',
          store: { 'a:key': SENTINEL, 'b:key': 'other' },
          confirm: true,
        },
        null,
        operator(),
      ),
    );
    expect(secrets.replaceAll).toHaveBeenCalledWith('agent-a', {
      'a:key': SENTINEL,
      'b:key': 'other',
    });
    expect(text).toContain('"ok": true');
    expect(text).toContain('a:key');
    expect(text).toContain('b:key');
    expect(text).not.toContain(SENTINEL);
    expect(text).not.toContain('other');
  });

  it('refuses without the confirmation argument, naming the keys and the loss', async () => {
    const { tool, secrets } = harness();
    const result = await tool.replaceAgentSecrets(
      { agentId: 'agent-a', store: { 'a:key': SENTINEL } },
      null,
      operator(),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('a:key');
    expect(textOf(result)).toContain('«Support Bot»');
    expect(textOf(result)).toContain('confirm: true');
    expect(textOf(result)).not.toContain(SENTINEL);
    expect(secrets.replaceAll).not.toHaveBeenCalled();
  });

  it('spells out that an empty map clears the store', async () => {
    const { tool } = harness();
    const result = await tool.replaceAgentSecrets(
      { agentId: 'agent-a', store: {} },
      null,
      operator(),
    );
    expect(textOf(result)).toContain('remove every secret');
  });

  it('reports a missing agent before asking for confirmation', async () => {
    const { tool, agents, secrets } = harness();
    agents.findById.mockResolvedValue(null);
    const result = await tool.replaceAgentSecrets(
      { agentId: 'agent-x', store: {} },
      null,
      operator(),
    );
    expect(textOf(result)).toContain('not found');
    expect(secrets.replaceAll).not.toHaveBeenCalled();
  });
});

describe('SecretTool — a value never leaves through any tool', () => {
  it('keeps the sentinel out of every result text, refusals included', async () => {
    const { tool } = harness();
    const req = operator();
    const results = [
      await tool.listAgentSecrets({ agentId: 'agent-a' }, null, req),
      await tool.setAgentSecret(
        { agentId: 'agent-a', key: 'k', value: SENTINEL },
        null,
        req,
      ),
      await tool.deleteAgentSecret({ agentId: 'agent-a', key: 'k' }, null, req),
      await tool.deleteAgentSecret(
        { agentId: 'agent-a', key: 'k', confirm: true },
        null,
        req,
      ),
      await tool.replaceAgentSecrets(
        { agentId: 'agent-a', store: { k: SENTINEL } },
        null,
        req,
      ),
      await tool.replaceAgentSecrets(
        { agentId: 'agent-a', store: { k: SENTINEL }, confirm: true },
        null,
        req,
      ),
    ];
    for (const result of results) {
      for (const part of result.content) {
        expect(part.text).not.toContain(SENTINEL);
      }
    }
  });

  it('lets a store failure escape, so the MCP layer reports it as an error', async () => {
    const { tool, secrets } = harness();
    secrets.list.mockRejectedValue(new Error('bucket unreachable'));
    await expect(
      tool.listAgentSecrets({ agentId: 'agent-a' }, null, operator()),
    ).rejects.toThrow('bucket unreachable');
  });
});
