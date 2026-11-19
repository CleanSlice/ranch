import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import type { Request } from 'express';
import { AgentAccessService } from '#/user/agentAccess/domain/agentAccess.service';
import { AgentScoped, accessCallerOf } from '#/user/agentAccess/guards';
import {
  IPaddockScenarioGateway,
  IPaddockScenarioGeneratorGateway,
} from './domain';
import {
  CreatePaddockScenarioDto,
  GeneratePaddockScenarioDto,
  UpdatePaddockScenarioDto,
} from './dtos';
import {
  ICreatePaddockScenarioData,
  IPaddockScenarioData,
  IUpdatePaddockScenarioData,
  PaddockScenarioCategory,
  PaddockScenarioDifficulty,
} from './domain/scenario.types';

const SCENARIO_NOT_FOUND = 'Scenario not found';

/**
 * Paddock scenarios. Admin by the default of the role guard. A scenario is
 * scoped to a template or to one agent; one scoped to an agent the caller's
 * access lists hide is answered as if it did not exist (CLEAN-231).
 */
@ApiTags('paddock-scenarios')
@Controller('paddock-scenarios')
export class PaddockScenarioController {
  constructor(
    private gateway: IPaddockScenarioGateway,
    private generator: IPaddockScenarioGeneratorGateway,
    private access: AgentAccessService,
  ) {}

  /** The scenario, when it exists and the caller reaches its agent. */
  private async requireScenario(
    id: string,
    req: Request | undefined,
  ): Promise<IPaddockScenarioData> {
    const scenario = await this.gateway.findById(id);
    if (!scenario) throw new NotFoundException(SCENARIO_NOT_FOUND);
    await this.access.assertReaches(
      accessCallerOf(req),
      scenario.agentId,
      SCENARIO_NOT_FOUND,
    );
    return scenario;
  }

  @Get()
  @AgentScoped('query.agentId')
  @ApiOperation({
    summary:
      'List paddock scenarios. Filter by templateId or agentId; without filters returns all the caller may see: template scenarios, and the scenarios of the agents the caller reaches.',
  })
  @ApiQuery({ name: 'templateId', required: false })
  @ApiQuery({ name: 'agentId', required: false })
  async findAll(
    @Query('templateId') templateId?: string,
    @Query('agentId') agentId?: string,
    @Req() req?: Request,
  ) {
    const reach = await this.access.reachableIds(accessCallerOf(req));
    return reach.filter(
      await this.gateway.findAll({ templateId, agentId }),
      (scenario) => scenario.agentId,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a paddock scenario by id' })
  findById(@Param('id') id: string, @Req() req?: Request) {
    return this.requireScenario(id, req);
  }

  @Post()
  @AgentScoped('body.agentId')
  @ApiOperation({
    summary:
      'Create a paddock scenario scoped to either a template or an agent (XOR — exactly one).',
  })
  create(@Body() dto: CreatePaddockScenarioDto) {
    this.assertExactlyOneScope(dto.templateId, dto.agentId);
    return this.gateway.create(dto as ICreatePaddockScenarioData);
  }

  @Post('generate')
  @AgentScoped('body.agentId')
  @ApiOperation({
    summary:
      'Generate a scenario draft from a natural-language description via LLM. Result is NOT persisted — review + POST / to save.',
  })
  generate(@Body() dto: GeneratePaddockScenarioDto) {
    return this.generator.generate({
      description: dto.description,
      templateId: dto.templateId ?? undefined,
      agentId: dto.agentId ?? undefined,
      category: dto.category as PaddockScenarioCategory | undefined,
      difficulty: dto.difficulty as PaddockScenarioDifficulty | undefined,
      credentialId: dto.credentialId,
    });
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Update a paddock scenario. Scope (templateId/agentId) is immutable — create a new scenario to change scope.',
  })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdatePaddockScenarioDto,
    @Req() req?: Request,
  ) {
    await this.requireScenario(id, req);
    return this.gateway.update(id, dto as IUpdatePaddockScenarioData);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a paddock scenario' })
  async remove(@Param('id') id: string, @Req() req?: Request) {
    await this.requireScenario(id, req);
    await this.gateway.delete(id);
    return { id };
  }

  private assertExactlyOneScope(
    templateId?: string | null,
    agentId?: string | null,
  ): void {
    const hasTemplate = Boolean(templateId);
    const hasAgent = Boolean(agentId);
    if (hasTemplate === hasAgent) {
      throw new BadRequestException(
        'Scenario must be scoped to exactly one of: templateId, agentId',
      );
    }
  }
}
