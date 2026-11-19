import { Injectable, Logger, NotFoundException } from '@nestjs/common';
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
} from '#/mcp/tooling';
import { AgentAccessService } from '#/user/agentAccess/domain/agentAccess.service';
import type { IConditionallyListedTool } from '#/mcp/interfaces/conditional-listing.interface';
import { PaddockEvaluationService } from './domain/evaluation.service';

const judgeOverrideSchema = z
  .object({
    credentialIds: z.array(z.string()).optional(),
    threshold: z.number().min(0).max(1).optional(),
    maxLlmCalls: z.number().int().positive().optional(),
    maxTimeMs: z.number().int().positive().optional(),
  })
  .optional();

@ToolAudience('admin')
@Injectable()
export class PaddockEvaluationTool implements IConditionallyListedTool {
  private readonly logger = new Logger(PaddockEvaluationTool.name);

  constructor(
    private readonly service: PaddockEvaluationService,
    private readonly access: AgentAccessService,
  ) {}

  /**
   * An evaluation belongs to one agent. For a caller whose access lists
   * hide that agent it does not exist (CLEAN-231): the same NotFound the
   * service throws for an unknown id. An id that really is unknown is left
   * to the service.
   */
  private async reached(
    httpRequest: Request,
    id: string,
    notFound = 'Evaluation not found',
  ): Promise<void> {
    const reach = await this.access.reachableIds(callerParty(httpRequest));
    if (reach.unrestricted) return;
    const evaluation = await this.service.getById(id).catch(() => null);
    if (evaluation && !reach.has(evaluation.agentId)) {
      throw new NotFoundException(notFound);
    }
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
  async run(
    input: {
      agentId: string;
      scenarioIds?: string[];
      judgeOverride?: {
        credentialIds?: string[];
        threshold?: number;
        maxLlmCalls?: number;
        maxTimeMs?: number;
      };
    },
    _context: unknown,
    httpRequest: Request,
  ) {
    requireOperator(httpRequest);
    if (!(await this.access.reaches(callerParty(httpRequest), input.agentId))) {
      return agentNotFound(httpRequest, input.agentId);
    }
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
  async list(
    input: { agentId?: string; templateId?: string; limit?: number },
    _context: unknown,
    httpRequest: Request,
  ) {
    requireOperator(httpRequest);
    const reach = await this.access.reachableIds(callerParty(httpRequest));
    if (input.agentId && !reach.has(input.agentId)) {
      return agentNotFound(httpRequest, input.agentId);
    }
    return ok(reach.filter(await this.service.list(input), (ev) => ev.agentId));
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
  async get({ id }: { id: string }, _context: unknown, httpRequest: Request) {
    requireOperator(httpRequest);
    await this.reached(httpRequest, id);
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
  async report(
    { id }: { id: string },
    _context: unknown,
    httpRequest: Request,
  ) {
    requireOperator(httpRequest);
    await this.reached(httpRequest, id);
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
  async abort(
    args: { id: string; confirm?: boolean },
    _context: unknown,
    httpRequest: Request,
  ) {
    requireOperator(httpRequest);
    const { id } = args;
    const refusal = confirmed(args, `abort the paddock evaluation ${id}`);
    if (refusal) return refusal;
    await this.reached(httpRequest, id);
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
  async rerun({ id }: { id: string }, _context: unknown, httpRequest: Request) {
    requireOperator(httpRequest);
    await this.reached(httpRequest, id, 'Source evaluation not found');
    return ok(await this.service.rerun(id));
  }

  @Tool({
    name: 'get_paddock_evaluation_logs',
    topic: ToolTopics.Paddock,
    title: 'Evaluation logs',
    template: 'Show the logs of evaluation «id»',
    description:
      'Tail the paddock CLI output (stdout + stderr) of an evaluation. The buffer is in memory (~2000 lines) and is cleared when the API restarts or a new run starts for the same agent, so an older evaluation may come back empty. Pass tail to keep only the last N lines. Find ids with list_paddock_evaluations.',
    parameters: z.object({
      id: z.string(),
      tail: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Return only the last N lines (default: all buffered).'),
    }),
  })
  async logs(
    { id, tail }: { id: string; tail?: number },
    _context: unknown,
    httpRequest: Request,
  ) {
    requireOperator(httpRequest);
    const found = await this.lookup(async () => {
      await this.reached(httpRequest, id);
      return this.service.getLogs(id);
    });
    if ('error' in found) return ok(found);
    const lines = tail ? found.value.lines.slice(-tail) : found.value.lines;
    return ok({ id, total: found.value.lines.length, lines });
  }

  @Tool({
    name: 'get_paddock_evaluation_scenario_result',
    topic: ToolTopics.Paddock,
    title: "One scenario's result",
    template: 'How did scenario «scenario» go in evaluation «id»?',
    description:
      'Show how one scenario went in an evaluation: the scenario as captured in the run (messages, expected behaviour, success criteria — reliable even after template re-seeds changed live scenario ids) together with its verdict, scores and failure reasons once judged. Scenario ids come from get_paddock_evaluation; for the raw agent responses call get_paddock_evaluation_trace.',
    parameters: z.object({ id: z.string(), scenarioId: z.string() }),
  })
  async scenarioResult(
    { id, scenarioId }: { id: string; scenarioId: string },
    _context: unknown,
    httpRequest: Request,
  ) {
    requireOperator(httpRequest);
    const found = await this.lookup(async () => {
      await this.reached(httpRequest, id);
      const scenario = await this.service.getScenario(id, scenarioId);
      const evaluation = await this.service.getById(id);
      return { scenario, evaluation };
    });
    if ('error' in found) return ok(found);
    const { scenario, evaluation } = found.value;
    const result =
      evaluation.results.find((r) => r.scenarioId === scenarioId) ?? null;
    return ok({
      evaluationId: id,
      status: evaluation.status,
      scenario,
      // Null while the run has not reached this scenario yet.
      result,
    });
  }

  @Tool({
    name: 'get_paddock_evaluation_trace',
    topic: ToolTopics.Paddock,
    title: 'Evaluation trace',
    template: 'Show the trace of evaluation «id»',
    description:
      'Fetch the execution trace of one scenario in an evaluation: agent responses, tool calls and errors, turn by turn. Available only after the run completes. Scenario ids come from get_paddock_evaluation.',
    parameters: z.object({ id: z.string(), scenarioId: z.string() }),
  })
  async trace(
    { id, scenarioId }: { id: string; scenarioId: string },
    _context: unknown,
    httpRequest: Request,
  ) {
    requireOperator(httpRequest);
    const found = await this.lookup(async () => {
      await this.reached(httpRequest, id);
      return this.service.getTrace(id, scenarioId);
    });
    if ('error' in found) return ok(found);
    if (!found.value) {
      return ok({
        error: `No trace for scenario ${scenarioId} in evaluation ${id} — the run may still be going, or the scenario is not part of it. Check with get_paddock_evaluation.`,
      });
    }
    return ok(found.value);
  }

  /**
   * The service answers a missing evaluation with a NotFoundException, which
   * suits HTTP. A model reads better from a sentence that names the next
   * move, so the read tools turn that one case into a result and let
   * anything else throw.
   */
  private async lookup<T>(
    read: () => Promise<T>,
  ): Promise<{ value: T } | { error: string }> {
    try {
      return { value: await read() };
    } catch (e) {
      if (e instanceof NotFoundException) {
        return {
          error: `${e.message} — call list_paddock_evaluations to find the id`,
        };
      }
      throw e;
    }
  }
}
