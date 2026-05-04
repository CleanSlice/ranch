import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { PaddockEvaluationService } from './domain/evaluation.service';
import { PaddockEvaluationReportDto, RunPaddockEvaluationDto } from './dtos';
import { IRunPaddockEvaluationData } from './domain/evaluation.types';

@ApiTags('paddock-evaluations')
@Controller('paddock-evaluations')
export class PaddockEvaluationController {
  constructor(private service: PaddockEvaluationService) {}

  @Post()
  @ApiOperation({
    summary:
      'Start a paddock evaluation for an agent. Returns the evaluation record immediately; the actual run is asynchronous (poll status).',
  })
  start(@Body() dto: RunPaddockEvaluationDto) {
    return this.service.start(dto as IRunPaddockEvaluationData);
  }

  @Get()
  @ApiOperation({
    summary: 'List paddock evaluations. Filter by agentId / templateId.',
  })
  @ApiQuery({ name: 'agentId', required: false })
  @ApiQuery({ name: 'templateId', required: false })
  @ApiQuery({ name: 'limit', required: false })
  list(
    @Query('agentId') agentId?: string,
    @Query('templateId') templateId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.list({
      agentId,
      templateId,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get evaluation status + summary + per-scenario results',
  })
  get(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Get(':id/report')
  @ApiOperation({
    summary:
      'Fetch the full evaluation report — both structured JSON and markdown.',
  })
  async report(@Param('id') id: string): Promise<PaddockEvaluationReportDto> {
    return this.service.getReport(id);
  }

  @Get(':id/logs')
  @ApiOperation({
    summary:
      'Live tail of paddock CLI stdout+stderr. In-memory ring buffer (~2000 lines), keyed by the evaluation\'s agent. Cleared on API restart or when a fresh run starts for the same agent.',
  })
  logs(@Param('id') id: string) {
    return this.service.getLogs(id);
  }

  @Get(':id/trace')
  @ApiOperation({
    summary:
      'Fetch the per-scenario execution trace (responses, tool calls, errors). Available after the run completes.',
  })
  @ApiQuery({ name: 'scenarioId', required: true })
  trace(@Param('id') id: string, @Query('scenarioId') scenarioId: string) {
    return this.service.getTrace(id, scenarioId);
  }

  @Post(':id/abort')
  @ApiOperation({
    summary:
      'Mark a running evaluation as aborted. The current scenario will finish before the run halts.',
  })
  abort(@Param('id') id: string) {
    return this.service.abort(id);
  }

  @Post(':id/rerun')
  @ApiOperation({
    summary:
      'Start a new evaluation re-using the exact scenarios + judge config from this one. Returns the new evaluation record immediately; the run is async.',
  })
  rerun(@Param('id') id: string) {
    return this.service.rerun(id);
  }
}
