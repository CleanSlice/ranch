import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { Tool } from '#mcp';
import { IPaddockScenarioGateway } from './domain';
import {
  ICreatePaddockScenarioData,
  IUpdatePaddockScenarioData,
  PaddockScenarioCategory,
  PaddockScenarioDifficulty,
} from './domain/scenario.types';

const asText = (value: unknown): string =>
  typeof value === 'string' ? value : JSON.stringify(value, null, 2);

const ok = (value: unknown) => ({
  content: [{ type: 'text' as const, text: asText(value) }],
});

const categoryEnum = z.enum([
  'tool_use',
  'memory',
  'conversation',
  'patching_workflow',
  'edge_case',
  'multi_turn',
  'error_recovery',
]);

const difficultyEnum = z.enum(['easy', 'medium', 'hard', 'adversarial']);

const dimensionEnum = z.enum([
  'correctness',
  'tool_usage',
  'soul_compliance',
  'response_quality',
  'error_handling',
]);

const messageSchema = z.object({
  text: z.string(),
  from: z.string(),
  delayMs: z.number().optional(),
});

const criterionSchema = z.object({
  dimension: dimensionEnum,
  description: z.string(),
  weight: z.number().min(0).max(1),
});

const setupSchema = z
  .object({
    files: z.record(z.string(), z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    tools: z.array(z.string()).optional(),
  })
  .optional();

@Injectable()
export class PaddockScenarioTool {
  private readonly logger = new Logger(PaddockScenarioTool.name);

  constructor(private readonly scenarios: IPaddockScenarioGateway) {}

  @Tool({
    name: 'list_paddock_scenarios',
    description:
      'List paddock scenarios. Filter by templateId or agentId; without filters returns all.',
    parameters: z.object({
      templateId: z.string().optional(),
      agentId: z.string().optional(),
    }),
  })
  async list({
    templateId,
    agentId,
  }: {
    templateId?: string;
    agentId?: string;
  }) {
    return ok(await this.scenarios.findAll({ templateId, agentId }));
  }

  @Tool({
    name: 'get_paddock_scenario',
    description: 'Get a single paddock scenario by id.',
    parameters: z.object({ id: z.string() }),
  })
  async get({ id }: { id: string }) {
    const scenario = await this.scenarios.findById(id);
    return ok(scenario ?? { error: `Scenario ${id} not found` });
  }

  @Tool({
    name: 'list_agent_paddock_scenarios',
    description:
      'List the merged set of paddock scenarios that would run for a given agent (template defaults + agent overrides; overrides win on name collision).',
    parameters: z.object({ agentId: z.string() }),
  })
  async listForAgent({ agentId }: { agentId: string }) {
    return ok(await this.scenarios.findForAgent(agentId));
  }

  @Tool({
    name: 'create_paddock_scenario',
    description:
      'Create a paddock scenario. Pass exactly one of templateId or agentId — that defines the scope.',
    parameters: z.object({
      templateId: z.string().optional(),
      agentId: z.string().optional(),
      category: categoryEnum,
      difficulty: difficultyEnum,
      name: z.string(),
      description: z.string(),
      expectedBehavior: z.string(),
      messages: z.array(messageSchema),
      successCriteria: z.array(criterionSchema),
      setup: setupSchema,
    }),
  })
  async create(input: {
    templateId?: string;
    agentId?: string;
    category: PaddockScenarioCategory;
    difficulty: PaddockScenarioDifficulty;
    name: string;
    description: string;
    expectedBehavior: string;
    messages: Array<{ text: string; from: string; delayMs?: number }>;
    successCriteria: Array<{
      dimension: string;
      description: string;
      weight: number;
    }>;
    setup?: {
      files?: Record<string, string>;
      env?: Record<string, string>;
      tools?: string[];
    };
  }) {
    const hasTemplate = Boolean(input.templateId);
    const hasAgent = Boolean(input.agentId);
    if (hasTemplate === hasAgent) {
      return ok({
        error: 'Scenario must be scoped to exactly one of: templateId, agentId',
      });
    }
    const data: ICreatePaddockScenarioData = {
      templateId: input.templateId ?? null,
      agentId: input.agentId ?? null,
      category: input.category,
      difficulty: input.difficulty,
      name: input.name,
      description: input.description,
      expectedBehavior: input.expectedBehavior,
      messages: input.messages,
      successCriteria:
        input.successCriteria as ICreatePaddockScenarioData['successCriteria'],
      setup: input.setup ?? null,
    };
    return ok(await this.scenarios.create(data));
  }

  @Tool({
    name: 'update_paddock_scenario',
    description:
      'Update a paddock scenario. Scope (templateId / agentId) is immutable — recreate the scenario to change scope.',
    parameters: z.object({
      id: z.string(),
      category: categoryEnum.optional(),
      difficulty: difficultyEnum.optional(),
      name: z.string().optional(),
      description: z.string().optional(),
      expectedBehavior: z.string().optional(),
      messages: z.array(messageSchema).optional(),
      successCriteria: z.array(criterionSchema).optional(),
      setup: setupSchema,
    }),
  })
  async update({ id, ...patch }: { id: string } & IUpdatePaddockScenarioData) {
    const existing = await this.scenarios.findById(id);
    if (!existing) return ok({ error: `Scenario ${id} not found` });
    return ok(await this.scenarios.update(id, patch));
  }

  @Tool({
    name: 'delete_paddock_scenario',
    description: 'Delete a paddock scenario by id.',
    parameters: z.object({ id: z.string() }),
  })
  async remove({ id }: { id: string }) {
    const existing = await this.scenarios.findById(id);
    if (!existing) return ok({ error: `Scenario ${id} not found` });
    await this.scenarios.delete(id);
    return ok({ ok: true, id });
  }
}
