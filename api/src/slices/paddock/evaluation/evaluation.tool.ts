import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { Tool, ToolTopics } from '#mcp';
import { CONFIRM_SENTENCE, confirmed, ok } from '#/mcp/tooling';
import { PaddockEvaluationService } from './domain/evaluation.service';

const judgeOverrideSchema = z
  .object({
    credentialIds: z.array(z.string()).optional(),
    threshold: z.number().min(0).max(1).optional(),
    maxLlmCalls: z.number().int().positive().optional(),
    maxTimeMs: z.number().int().positive().optional(),
  })
  .optional();

@Injectable()
export class PaddockEvaluationTool {
  private readonly logger = new Logger(PaddockEvaluationTool.name);

  constructor(private readonly service: PaddockEvaluationService) {}

  @Tool({
    name: 'run_paddock_evaluation',
    topic: ToolTopics.Paddock,
    title: 'Run an evaluation',
    template: 'Run a paddock evaluation for the agent «name»',
    description:
      'Start a paddock evaluation for an agent. Returns immediately with the evaluation record; the actual run is async — poll get_paddock_evaluation for status. Errors with 409 if another eval is already running for the agent.',
    parameters: z.object({
      agentId: z.string(),
      scenarioIds: z
        .array(z.string())
        .optional()
        .describe(
          'Optional subset of scenario ids. If omitted, runs the merged set of template + agent-override scenarios.',
        ),
      judgeOverride: judgeOverrideSchema.describe(
        "Override the template's paddockConfig: pick specific LlmCredential ids as judges, change threshold or budget.",
      ),
    }),
  })
  async run(input: {
    agentId: string;
    scenarioIds?: string[];
    judgeOverride?: {
      credentialIds?: string[];
      threshold?: number;
      maxLlmCalls?: number;
      maxTimeMs?: number;
    };
  }) {
    return ok(await this.service.start(input));
  }

  @Tool({
    name: 'list_paddock_evaluations',
    topic: ToolTopics.Paddock,
    title: 'List evaluations',
    template: 'List the paddock evaluations of «agent»',
    description:
      'List paddock evaluations. Filter by agentId / templateId. Most recent first.',
    parameters: z.object({
      agentId: z.string().optional(),
      templateId: z.string().optional(),
      limit: z.number().int().positive().optional(),
    }),
  })
  async list(input: { agentId?: string; templateId?: string; limit?: number }) {
    return ok(await this.service.list(input));
  }

  @Tool({
    name: 'get_paddock_evaluation',
    topic: ToolTopics.Paddock,
    title: 'Show an evaluation',
    template: 'How did the evaluation «id» go?',
    description:
      'Get an evaluation by id. Includes status, summary counts, and per-scenario results once the run completes.',
    parameters: z.object({ id: z.string() }),
  })
  async get({ id }: { id: string }) {
    return ok(await this.service.getById(id));
  }

  @Tool({
    name: 'get_paddock_evaluation_report',
    topic: ToolTopics.Paddock,
    title: 'Evaluation report',
    template: 'Show the report of the evaluation «id»',
    description:
      'Fetch the full evaluation report blob (json + markdown). Only available after the evaluation finishes successfully.',
    parameters: z.object({ id: z.string() }),
  })
  async report({ id }: { id: string }) {
    return ok(await this.service.getReport(id));
  }

  @Tool({
    name: 'abort_paddock_evaluation',
    topic: ToolTopics.Paddock,
    title: 'Abort an evaluation',
    template: 'Abort the evaluation «id»',
    destructive: true,
    description:
      'Mark a running paddock evaluation as aborted. The current scenario will finish before the run halts. ' +
      CONFIRM_SENTENCE,
    parameters: z.object({
      id: z.string(),
      confirm: z
        .boolean()
        .describe('Set true only after the person confirmed in the chat.'),
    }),
  })
  async abort(args: { id: string; confirm?: boolean }) {
    const { id } = args;
    const refusal = confirmed(args, `abort the paddock evaluation ${id}`);
    if (refusal) return refusal;
    return ok(await this.service.abort(id));
  }

  @Tool({
    name: 'rerun_paddock_evaluation',
    topic: ToolTopics.Paddock,
    title: 'Rerun an evaluation',
    template: 'Rerun the evaluation «id»',
    description:
      'Start a new evaluation re-using the exact scenario set + judge config from this one. Useful for comparing results across agent or prompt changes.',
    parameters: z.object({ id: z.string() }),
  })
  async rerun({ id }: { id: string }) {
    return ok(await this.service.rerun(id));
  }
}
