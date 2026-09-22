import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { Tool, ToolTopics } from '#mcp';
import { CONFIRM_SENTENCE, confirmed, ok } from '#/mcp/tooling';
import {
  IPaddockScenarioGateway,
  IPaddockScenarioGeneratorGateway,
} from './domain';
import {
  ICreatePaddockScenarioData,
  IUpdatePaddockScenarioData,
  PaddockScenarioCategory,
  PaddockScenarioDifficulty,
} from './domain/scenario.types';

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

  constructor(
    private readonly scenarios: IPaddockScenarioGateway,
    private readonly generator: IPaddockScenarioGeneratorGateway,
  ) {}

  @Tool({
    name: 'list_paddock_scenarios',
    topic: ToolTopics.Paddock,
    title: 'List paddock scenarios',
    template: 'List the paddock scenarios of «template or agent»',
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
    topic: ToolTopics.Paddock,
    title: 'Show a scenario',
    template: 'Show the paddock scenario «id»',
    description: 'Get a single paddock scenario by id.',
    parameters: z.object({ id: z.string() }),
  })
  async get({ id }: { id: string }) {
    const scenario = await this.scenarios.findById(id);
    return ok(scenario ?? { error: `Scenario ${id} not found` });
  }

  @Tool({
    name: 'list_agent_paddock_scenarios',
    topic: ToolTopics.Paddock,
    title: 'Scenarios of an agent',
    template: 'Which paddock scenarios does the agent «name» have?',
    description:
      'List the merged set of paddock scenarios that would run for a given agent (template defaults + agent overrides; overrides win on name collision).',
    parameters: z.object({ agentId: z.string() }),
  })
  async listForAgent({ agentId }: { agentId: string }) {
    return ok(await this.scenarios.findForAgent(agentId));
  }

  @Tool({
    name: 'create_paddock_scenario',
    topic: ToolTopics.Paddock,
    title: 'Create a scenario',
    template:
      'Create a paddock scenario for «agent or template» that checks «what it checks»',
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
    topic: ToolTopics.Paddock,
    title: 'Update a scenario',
    template: 'Change the paddock scenario «id»: «what to change»',
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
    topic: ToolTopics.Paddock,
    title: 'Delete a scenario',
    template: 'Delete the paddock scenario «id»',
    destructive: true,
    description: 'Delete a paddock scenario by id. ' + CONFIRM_SENTENCE,
    parameters: z.object({
      id: z.string(),
      confirm: z
        .boolean()
        .describe('Set true only after the person confirmed in the chat.'),
    }),
  })
  async remove(args: { id: string; confirm?: boolean }) {
    const { id } = args;
    const existing = await this.scenarios.findById(id);
    if (!existing) return ok({ error: `Scenario ${id} not found` });
    const refusal = confirmed(
      args,
      `delete the paddock scenario «${existing.name ?? id}»`,
    );
    if (refusal) return refusal;
    await this.scenarios.delete(id);
    return ok({ ok: true, id });
  }

  @Tool({
    name: 'generate_paddock_scenarios',
    topic: ToolTopics.Paddock,
    title: 'Generate scenarios from a description',
    template:
      'Generate «3» paddock scenarios for the agent «name» about «topic»',
    description:
      'Draft paddock scenarios from a plain-language description of what to test, using an LLM. Pass exactly one of agentId or templateId as the scope (resolve names with list_agents / list_templates first). Returns the drafts only — nothing is saved. Review them, then call create_paddock_scenario for each one worth keeping.',
    parameters: z.object({
      description: z
        .string()
        .describe('What behaviour or problem the scenarios should test.'),
      agentId: z.string().optional(),
      templateId: z.string().optional(),
      count: z
        .number()
        .int()
        .min(1)
        .max(5)
        .optional()
        .describe('How many drafts to produce (1–5, default 1).'),
      category: categoryEnum.optional(),
      difficulty: difficultyEnum.optional(),
      credentialId: z
        .string()
        .optional()
        .describe('LlmCredential id to draft with; default: first active.'),
    }),
  })
  async generate(input: {
    description: string;
    agentId?: string;
    templateId?: string;
    count?: number;
    category?: PaddockScenarioCategory;
    difficulty?: PaddockScenarioDifficulty;
    credentialId?: string;
  }) {
    // Same XOR rule the controller enforces on POST /paddock-scenarios/generate.
    const hasTemplate = Boolean(input.templateId);
    const hasAgent = Boolean(input.agentId);
    if (hasTemplate === hasAgent) {
      return ok({
        error: 'Scenario must be scoped to exactly one of: templateId, agentId',
      });
    }
    // The generator drafts one scenario per call; the console asks for one at
    // a time, a chat asks for "three about refunds". Sequential on purpose —
    // each is an LLM call and parallel drafts tend to come back near-identical.
    const count = input.count ?? 1;
    const drafts: ICreatePaddockScenarioData[] = [];
    for (let i = 0; i < count; i++) {
      drafts.push(
        await this.generator.generate({
          description: input.description,
          templateId: input.templateId ?? undefined,
          agentId: input.agentId ?? undefined,
          category: input.category,
          difficulty: input.difficulty,
          credentialId: input.credentialId,
        }),
      );
    }
    return ok({
      drafts,
      note: 'Not saved. Call create_paddock_scenario with a draft to keep it.',
    });
  }
}
