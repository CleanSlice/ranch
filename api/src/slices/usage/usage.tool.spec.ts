import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { MCP_TOOL_METADATA_KEY } from '#/mcp/decorators';
import type { ToolMetadata } from '#/mcp/decorators';
import { UsageTool } from './usage.tool';
import { costUsd } from './domain/model-pricing';
import type { IUsageData } from './domain/usage.types';
import type { IUsageGateway } from './domain';
import type { IAgentGateway } from '#/agent/agent/domain';
import { UserRoleTypes } from '#/user/user/domain';
import { asTrustedAgent } from '#/mcp/testing';
import { openAccess } from '#/user/agentAccess/domain/__fixtures__/agentAccess';

/**
 * The tool must say the same dollars the console's Usage page says: same
 * rows, same roll-up, same pricing. So the spec pins the gateway call the
 * route makes (`findRecentAll(30)`) and the numbers that come out, not the
 * tool's own arithmetic — it has none, it shares the controller's.
 */
const HAIKU = 'claude-haiku-4-5';
const SONNET = 'claude-sonnet-4-6';

const DAY_1 = new Date('2026-08-01T00:00:00.000Z');
const DAY_2 = new Date('2026-08-02T00:00:00.000Z');

function row(
  p: Partial<IUsageData> & { agentId: string; model: string; date: Date },
): IUsageData {
  return {
    id: `${p.agentId}|${p.model}|${p.date.toISOString()}`,
    agentName: null,
    llmCredentialId: null,
    inputTokens: 0,
    outputTokens: 0,
    callCount: 0,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...p,
  };
}

const request = (roles: UserRoleTypes[]): Request =>
  ({
    user: { sub: 'agent:agent-ops', email: '', roles },
  }) as unknown as Request;

const operator = () => asTrustedAgent(request([UserRoleTypes.Owner]));
const plainAgent = () => asTrustedAgent(request([UserRoleTypes.Agent]));

function harness(rows: IUsageData[], agentNames: Record<string, string> = {}) {
  const findRecentAll = jest.fn().mockResolvedValue(rows);
  const findById = jest.fn((id: string) => {
    const name = agentNames[id];
    if (!name) return Promise.reject(new Error('agent not found'));
    return Promise.resolve({ id, name });
  });
  const tool = new UsageTool(
    { findRecentAll } as unknown as IUsageGateway,
    { findById } as unknown as IAgentGateway,
    openAccess(),
  );
  return { tool, findRecentAll, findById };
}

const text = (result: { content: { text: string }[] }) =>
  result.content[0].text;

/** The description the model reads when it picks the tool. */
const toolDescription = (method: 'getUsageOverview') =>
  (
    Reflect.getMetadata(
      MCP_TOOL_METADATA_KEY,
      UsageTool.prototype[method],
    ) as ToolMetadata
  ).description;

describe('UsageTool', () => {
  describe('audience', () => {
    it('is listed for an operator and hidden from a plain agent', async () => {
      const { tool } = harness([]);
      await expect(tool.isListedForRequest(operator())).resolves.toBe(true);
      await expect(tool.isListedForRequest(plainAgent())).resolves.toBe(false);
    });

    it('refuses the body for a plain agent without touching the gateway', async () => {
      const { tool, findRecentAll } = harness([]);
      await expect(
        tool.getUsageOverview({}, undefined, plainAgent()),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(findRecentAll).not.toHaveBeenCalled();
    });
  });

  describe('get_usage_overview', () => {
    it('asks for the 30-day window and reports totals and per-agent cost like the route', async () => {
      const rows = [
        row({
          agentId: 'agent-a',
          model: HAIKU,
          date: DAY_1,
          inputTokens: 1000,
          outputTokens: 500,
          callCount: 3,
        }),
        row({
          agentId: 'agent-b',
          model: SONNET,
          date: DAY_1,
          inputTokens: 2000,
          outputTokens: 1000,
          callCount: 2,
        }),
        row({
          agentId: 'agent-a',
          model: HAIKU,
          date: DAY_2,
          inputTokens: 400,
          outputTokens: 100,
          callCount: 1,
        }),
      ];
      const { tool, findRecentAll, findById } = harness(rows, {
        'agent-a': 'Support Bot',
        'agent-b': 'Research Bot',
      });

      const result = await tool.getUsageOverview({}, undefined, operator());

      expect(findRecentAll).toHaveBeenCalledWith(30);
      expect(findById).toHaveBeenCalledWith('agent-a');
      expect(findById).toHaveBeenCalledWith('agent-b');

      const expectedCost =
        costUsd(HAIKU, 1000, 500) +
        costUsd(SONNET, 2000, 1000) +
        costUsd(HAIKU, 400, 100);
      const body = JSON.parse(text(result)) as {
        totals: {
          inputTokens: number;
          outputTokens: number;
          callCount: number;
          costUsd: number;
        };
        topModel: string | null;
        last30days: { date: string; model: string }[];
        byAgent: { agentId: string; agentName: string; costUsd: number }[];
      };

      expect(body.totals).toEqual({
        inputTokens: 3400,
        outputTokens: 1600,
        callCount: 6,
        costUsd: expectedCost,
      });
      // Sonnet carries 3000 tokens against Haiku's 2000.
      expect(body.topModel).toBe(SONNET);
      // Newest day first, one entry per date|model.
      expect(body.last30days.map((e) => `${e.date}|${e.model}`)).toEqual([
        `2026-08-02|${HAIKU}`,
        `2026-08-01|${HAIKU}`,
        `2026-08-01|${SONNET}`,
      ]);
      // Most expensive agent first, with the console's name for it.
      expect(body.byAgent.map((a) => a.agentName)).toEqual([
        'Research Bot',
        'Support Bot',
      ]);
      expect(body.byAgent[0]).toEqual({
        agentId: 'agent-b',
        agentName: 'Research Bot',
        inputTokens: 2000,
        outputTokens: 1000,
        callCount: 2,
        costUsd: costUsd(SONNET, 2000, 1000),
      });
      expect(text(result)).toContain('"costUsd"');
      expect(text(result)).toContain('"inputTokens": 3400');
    });

    it('keeps a deleted agent listed under the name it had', async () => {
      // The row carries the name it was reported with (CLEAN-261), so the
      // spend of an agent that is gone still reads as that agent's.
      const { tool } = harness(
        [
          row({
            agentId: 'agent-gone',
            agentName: 'Support Bot',
            model: HAIKU,
            date: DAY_1,
            inputTokens: 10,
            outputTokens: 10,
            callCount: 1,
          }),
        ],
        {},
      );

      const result = await tool.getUsageOverview({}, undefined, operator());
      const body = JSON.parse(text(result)) as {
        byAgent: { agentId: string; agentName: string; costUsd: number }[];
      };

      expect(body.byAgent).toEqual([
        {
          agentId: 'agent-gone',
          agentName: 'Support Bot',
          inputTokens: 10,
          outputTokens: 10,
          callCount: 1,
          costUsd: costUsd(HAIKU, 10, 10),
        },
      ]);
      expect(result.isError).toBeUndefined();
    });

    it('says in its description what a deleted agent is listed under', () => {
      const description = toolDescription('getUsageOverview');

      expect(description).toContain('under the name it had');
      expect(description).not.toContain('shows its id as the name');
    });

    // This tool has one window, the console page's. The same figures for 7
    // or 90 days are the installation statistics' (CLEAN-265), and the model
    // has to be told, or it answers "last week" with 30 days.
    it('points to get_installation_stats for another period', () => {
      const description = toolDescription('getUsageOverview');

      expect(description).toMatch(
        /7 or 90 days[^.]*call get_installation_stats\./,
      );
      // And still to agent_usage for one agent.
      expect(description).toContain('call agent_usage');
    });

    it('falls back to the id for a deleted agent whose rows carry no name', async () => {
      const { tool } = harness(
        [
          row({
            agentId: 'agent-gone',
            model: HAIKU,
            date: DAY_1,
            inputTokens: 10,
            outputTokens: 10,
            callCount: 1,
          }),
        ],
        {},
      );

      const result = await tool.getUsageOverview({}, undefined, operator());
      const body = JSON.parse(text(result)) as {
        byAgent: { agentId: string; agentName: string }[];
      };

      expect(body.byAgent).toEqual([
        expect.objectContaining({
          agentId: 'agent-gone',
          agentName: 'agent-gone',
        }),
      ]);
      expect(result.isError).toBeUndefined();
    });

    it('reports zero totals and no agents for an empty window', async () => {
      const { tool, findById } = harness([]);

      const result = await tool.getUsageOverview({}, undefined, operator());
      const body = JSON.parse(text(result)) as Record<string, unknown>;

      expect(body).toEqual({
        last30days: [],
        totals: { inputTokens: 0, outputTokens: 0, callCount: 0, costUsd: 0 },
        topModel: null,
        byAgent: [],
      });
      expect(findById).not.toHaveBeenCalled();
    });
  });
});
