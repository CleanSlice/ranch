import { Controller, Get, Post, Body, Param, Query, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import type { Request } from 'express';
import { AgentAccessService } from '#/user/agentAccess/domain/agentAccess.service';
import { AgentScoped, accessCallerOf } from '#/user/agentAccess/guards';
import { PaddockEvaluationService } from './domain/evaluation.service';
import { PaddockEvaluationReportDto, RunPaddockEvaluationDto } from './dtos';
import { IRunPaddockEvaluationData } from './domain/evaluation.types';

/** What the service answers for an evaluation that does not exist. */
const EVALUATION_NOT_FOUND = 'Evaluation not found';
const SOURCE_NOT_FOUND = 'Source evaluation not found';

/**
 * Paddock evaluations. Admin by the default of the role guard. An
 * evaluation belongs to one agent, so a caller whose access lists hide that
 * agent is answered as if the evaluation did not exist (CLEAN-231): by the
 * guard where the request names the agent, by `reached` where it names the
 * evaluation.
 */
@ApiTags('paddock-evaluations')
@Controller('paddock-evaluations')
export class PaddockEvaluationController {
  constructor(
    private service: PaddockEvaluationService,
    private access: AgentAccessService,
  ) {}

  /**
   * Refuse, with the route's own "not found", an evaluation whose agent the
   * caller does not reach. An evaluation that does not exist is left to the
   * service, which says the same words.
   */
  private async reached(
    id: string,
    req: Request | undefined,
    notFound: string = EVALUATION_NOT_FOUND,
  ): Promise<void> {
    const caller = accessCallerOf(req);
    const reach = await this.access.reachableIds(caller);
    if (reach.unrestricted) return;
    const ev = await this.service.getById(id).catch(() => null);
    if (ev) await this.access.assertReaches(caller, ev.agentId, notFound);
  }

  @Post()
  @AgentScoped('body.agentId')
  @ApiOperation({
    summary:
      'Start a paddock evaluation for an agent. Returns the evaluation record immediately; the actual run is asynchronous (poll status).',
  })
  start(@Body() dto: RunPaddockEvaluationDto) {
    return this.service.start(dto as IRunPaddockEvaluationData);
  }

  @Get()
  @AgentScoped('query.agentId')
  @ApiOperation({
    summary:
      'List paddock evaluations of the agents the caller reaches. Filter by agentId / templateId.',
  })
  @ApiQuery({ name: 'agentId', required: false })
  @ApiQuery({ name: 'templateId', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async list(
    @Query('agentId') agentId?: string,
    @Query('templateId') templateId?: string,
    @Query('limit') limit?: string,
    @Req() req?: Request,
  ) {
    const reach = await this.access.reachableIds(accessCallerOf(req));
    return reach.filter(
      await this.service.list({
        agentId,
        templateId,
        limit: limit ? parseInt(limit, 10) : undefined,
      }),
      (ev) => ev.agentId,
    );
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get evaluation status + summary + per-scenario results',
  })
  async get(@Param('id') id: string, @Req() req?: Request) {
    await this.reached(id, req);
    return this.service.getById(id);
  }

  @Get(':id/report')
  @ApiOperation({
    summary:
      'Fetch the full evaluation report — both structured JSON and markdown.',
  })
  async report(
    @Param('id') id: string,
    @Req() req?: Request,
  ): Promise<PaddockEvaluationReportDto> {
    await this.reached(id, req);
    return this.service.getReport(id);
  }

  @Get(':id/logs')
  @ApiOperation({
    summary:
      "Live tail of paddock CLI stdout+stderr. In-memory ring buffer (~2000 lines), keyed by the evaluation's agent. Cleared on API restart or when a fresh run starts for the same agent.",
  })
  async logs(@Param('id') id: string, @Req() req?: Request) {
    await this.reached(id, req);
    return this.service.getLogs(id);
  }

  @Get(':id/scenarios/:scenarioId')
  @ApiOperation({
    summary:
      "Fetch one scenario as captured in this evaluation's snapshot (messages, expectedBehavior, successCriteria). Reliable across template re-seeds that change scenario UUIDs in the live `paddock_scenarios` table.",
  })
  async scenario(
    @Param('id') id: string,
    @Param('scenarioId') scenarioId: string,
    @Req() req?: Request,
  ) {
    await this.reached(id, req);
    return this.service.getScenario(id, scenarioId);
  }

  @Get(':id/trace')
  @ApiOperation({
    summary:
      'Fetch the per-scenario execution trace (responses, tool calls, errors). Available after the run completes.',
  })
  @ApiQuery({ name: 'scenarioId', required: true })
  async trace(
    @Param('id') id: string,
    @Query('scenarioId') scenarioId: string,
    @Req() req?: Request,
  ) {
    await this.reached(id, req);
    return this.service.getTrace(id, scenarioId);
  }

  @Post(':id/abort')
  @ApiOperation({
    summary:
      'Mark a running evaluation as aborted. The current scenario will finish before the run halts.',
  })
  async abort(@Param('id') id: string, @Req() req?: Request) {
    await this.reached(id, req);
    return this.service.abort(id);
  }

  @Post(':id/rerun')
  @ApiOperation({
    summary:
      'Start a new evaluation re-using the exact scenarios + judge config from this one. Returns the new evaluation record immediately; the run is async.',
  })
  async rerun(@Param('id') id: string, @Req() req?: Request) {
    await this.reached(id, req, SOURCE_NOT_FOUND);
    return this.service.rerun(id);
  }
}
