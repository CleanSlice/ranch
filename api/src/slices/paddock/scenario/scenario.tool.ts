import { Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { Tool, ToolAudience, ToolTopics } from '#mcp';
import {
  callerIsOperator,
  CONFIRM_SENTENCE,
  confirmed,
  ok,
  requireOperator,
  agentNotFound,
  callerParty,
  ACCESS_SCOPE_NOTE,
  accessScope,
  ownerOnlyLeftOutField,
  ownerOnlyRefusal,
  type ToolResult,
} from '#/mcp/tooling';
import { AgentAccessService } from '#/user/agentAccess/domain/agentAccess.service';
import type { IConditionallyListedTool } from '#/mcp/interfaces/conditional-listing.interface';
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

@ToolAudience('admin')
@Injectable()
export class PaddockScenarioTool implements IConditionallyListedTool {
  private readonly logger = new Logger(PaddockScenarioTool.name);

  constructor(
    private readonly scenarios: IPaddockScenarioGateway,
    private readonly generator: IPaddockScenarioGeneratorGateway,
    private readonly access: AgentAccessService,
  ) {}

  /**
   * The agents whose scenarios the party this call is made for may read and
   * write: the ones they reach (CLEAN-231), less the Ranch assistant for
   * anybody but the Owner (CLEAN-268). A scenario of the assistant is what
   * the Owner tests it with and expects of it.
   */
  private async reachOf(httpRequest: Request) {
    const used = await this.access.reachableIds(callerParty(httpRequest));
    return { used, records: used.forRecords() };
  }

  /**
   * The scenario, when it exists and is not scoped to an agent the caller's
   * access lists hide (CLEAN-231); otherwise the answer to hand back. One
   * answer for a scenario that does not exist and one out of reach. A
   * scenario of the Ranch assistant, asked for by a person who has the
   * assistant and is not the Owner, is the Owner's and is said to be
   * (CLEAN-268).
   */
  private async reachedScenario(
    httpRequest: Request,
    id: string,
  ): Promise<
    | {
        scenario: NonNullable<
          Awaited<ReturnType<IPaddockScenarioGateway['findById']>>
        >;
        refusal?: undefined;
      }
    | { scenario?: undefined; refusal: ToolResult }
  > {
    const notFound = ok({ error: `Scenario ${id} not found` });
    const scenario = await this.scenarios.findById(id);
    if (!scenario) return { refusal: notFound };
    if (!scenario.agentId) return { scenario };
    const { records } = await this.reachOf(httpRequest);
    if (records.has(scenario.agentId)) return { scenario };
    return {
      refusal:
        ownerOnlyRefusal(httpRequest, scenario.agentId, 'evaluations') ??
        notFound,
    };
  }

  /**
   * Paddock is an operator's screen (its routes carry no role and so admit
   * Owner and Admin). Until CLEAN-232 these tools had no gate at all: any
   * agent runtime could start, abort and read evaluations.
   */
  async isListedForRequest(httpRequest: Request): Promise<boolean> {
    return Promise.resolve(callerIsOperator(httpRequest));
  }

  @Tool({
    name: 'list_paddock_scenarios',
    topic: ToolTopics.Paddock,
    effect: 'read',
    title: 'List paddock scenarios',
    template: 'List the paddock scenarios of «template or agent»',
    description:
      'List paddock scenarios, under `scenarios`. Filter by templateId or ' +
      'agentId; without filters returns all this person may read: the ' +
      'scenarios of templates, and of the agents they can use. The ' +
      'scenarios of the Ranch assistant are the Owner’s to read: when the ' +
      'result carries `notIncluded`, say so, never that there are none. ' +
      ACCESS_SCOPE_NOTE,
    parameters: z.object({
      templateId: z.string().optional(),
      agentId: z.string().optional(),
    }),
  })
  async list(
    {
      templateId,
      agentId,
    }: {
      templateId?: string;
      agentId?: string;
    },
    _context: unknown,
    httpRequest: Request,
  ) {
    requireOperator(httpRequest);
    const { used, records } = await this.reachOf(httpRequest);
    if (agentId && !records.has(agentId)) {
      return agentNotFound(httpRequest, agentId, 'evaluations');
    }
    return ok({
      scenarios: records.filter(
        await this.scenarios.findAll({ templateId, agentId }),
        (scenario) => scenario.agentId,
      ),
      ...ownerOnlyLeftOutField(httpRequest, 'scenarios', agentId),
      ...accessScope(used, agentId),
    });
  }

  @Tool({
    name: 'get_paddock_scenario',
    topic: ToolTopics.Paddock,
    effect: 'read',
    title: 'Show a scenario',
    template: 'Show the paddock scenario «id»',
    description: 'Get a single paddock scenario by id.',
    parameters: z.object({ id: z.string() }),
  })
  async get({ id }: { id: string }, _context: unknown, httpRequest: Request) {
    requireOperator(httpRequest);
    const found = await this.reachedScenario(httpRequest, id);
    return found.refusal ?? ok(found.scenario);
  }

  @Tool({
    name: 'list_agent_paddock_scenarios',
    topic: ToolTopics.Paddock,
    effect: 'read',
    title: 'Scenarios of an agent',
    template: 'Which paddock scenarios does the agent «name» have?',
    description:
      'List the merged set of paddock scenarios that would run for a given agent (template defaults + agent overrides; overrides win on name collision).',
    parameters: z.object({ agentId: z.string() }),
  })
  async listForAgent(
    { agentId }: { agentId: string },
    _context: unknown,
    httpRequest: Request,
  ) {
    requireOperator(httpRequest);
    if (!(await this.reachOf(httpRequest)).records.has(agentId)) {
      return agentNotFound(httpRequest, agentId, 'evaluations');
    }
    return ok(await this.scenarios.findForAgent(agentId));
  }

  @Tool({
    name: 'create_paddock_scenario',
    topic: ToolTopics.Paddock,
    effect: 'write',
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
  async create(
    input: {
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
    },
    _context: unknown,
    httpRequest: Request,
  ) {
    requireOperator(httpRequest);
    if (
      input.agentId &&
      !(await this.reachOf(httpRequest)).records.has(input.agentId)
    ) {
      return agentNotFound(httpRequest, input.agentId, 'evaluations');
    }
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
    effect: 'write',
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
  async update(
    { id, ...patch }: { id: string } & IUpdatePaddockScenarioData,
    _context: unknown,
    httpRequest: Request,
  ) {
    requireOperator(httpRequest);
    const found = await this.reachedScenario(httpRequest, id);
    if (found.refusal) return found.refusal;
    return ok(await this.scenarios.update(id, patch));
  }

  @Tool({
    name: 'delete_paddock_scenario',
    topic: ToolTopics.Paddock,
    effect: 'write',
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
  async remove(
    args: { id: string; confirm?: boolean },
    _context: unknown,
    httpRequest: Request,
  ) {
    requireOperator(httpRequest);
    const { id } = args;
    const found = await this.reachedScenario(httpRequest, id);
    if (found.refusal) return found.refusal;
    const existing = found.scenario;
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
    effect: 'write',
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
  async generate(
    input: {
      description: string;
      agentId?: string;
      templateId?: string;
      count?: number;
      category?: PaddockScenarioCategory;
      difficulty?: PaddockScenarioDifficulty;
      credentialId?: string;
    },
    _context: unknown,
    httpRequest: Request,
  ) {
    requireOperator(httpRequest);
    if (
      input.agentId &&
      !(await this.reachOf(httpRequest)).records.has(input.agentId)
    ) {
      return agentNotFound(httpRequest, input.agentId, 'evaluations');
    }
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
