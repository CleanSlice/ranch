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
import { AssistantBuildService } from '#/agent/assistantBuild/domain/assistantBuild.service';
import type { IAuthTokenPayload } from '#/user/auth/domain/auth.types';
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
 *
 * The scenarios of a template the Ranch assistant is built from are the
 * Owner's (CLEAN-271). A scenario is text that is sent to an agent when an
 * evaluation runs, with files and environment variables for its sandbox:
 * those of the assistant's template are sent to the assistant when the
 * Owner evaluates it. So for anybody else they are not in the lists and
 * answer 404 by id, as the assistant's own scenarios do since CLEAN-268,
 * and writing one is refused with 403 `ASSISTANT_BUILT_FROM`.
 */
@ApiTags('paddock-scenarios')
@Controller('paddock-scenarios')
export class PaddockScenarioController {
  constructor(
    private gateway: IPaddockScenarioGateway,
    private generator: IPaddockScenarioGeneratorGateway,
    private access: AgentAccessService,
    private build: AssistantBuildService,
  ) {}

  /**
   * Whether `templateId` is a template whose scenarios the caller may not
   * read or write: one the assistant is built from, for anybody but the
   * Owner.
   */
  private async ownersTemplate(
    req: Request | undefined,
  ): Promise<(templateId: string | null | undefined) => boolean> {
    const user = (req as (Request & { user?: IAuthTokenPayload }) | undefined)
      ?.user;
    if (AssistantBuildService.isOwner(user)) return () => false;
    const templates = (await this.build.ingredients()).template;
    return (templateId) =>
      typeof templateId === 'string' && templates.includes(templateId);
  }

  /** The scenario, when it exists and the caller reaches its agent. */
  private async requireScenario(
    id: string,
    req: Request | undefined,
  ): Promise<IPaddockScenarioData> {
    const scenario = await this.gateway.findById(id);
    if (!scenario) throw new NotFoundException(SCENARIO_NOT_FOUND);
    // A scenario of the Ranch assistant is what the Owner tests it with:
    // the Owner's, and the same 404 to anybody else (CLEAN-268).
    if (
      scenario.agentId &&
      !(await this.access.reachableIds(accessCallerOf(req)))
        .forRecords()
        .has(scenario.agentId)
    ) {
      throw new NotFoundException(SCENARIO_NOT_FOUND);
    }
    // And one of a template the assistant is built from (CLEAN-271).
    if (
      !scenario.agentId &&
      (await this.ownersTemplate(req))(scenario.templateId)
    ) {
      throw new NotFoundException(SCENARIO_NOT_FOUND);
    }
    return scenario;
  }

  @Get()
  @AgentScoped('query.agentId', { records: true })
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
    const reach = (
      await this.access.reachableIds(accessCallerOf(req))
    ).forRecords();
    const hidden = await this.ownersTemplate(req);
    return reach
      .filter(
        await this.gateway.findAll({ templateId, agentId }),
        (scenario) => scenario.agentId,
      )
      .filter((scenario) => scenario.agentId || !hidden(scenario.templateId));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a paddock scenario by id' })
  findById(@Param('id') id: string, @Req() req?: Request) {
    return this.requireScenario(id, req);
  }

  @Post()
  @AgentScoped('body.agentId', { records: true })
  @ApiOperation({
    summary:
      'Create a paddock scenario scoped to either a template or an agent (XOR — exactly one).',
  })
  async create(@Body() dto: CreatePaddockScenarioDto, @Req() req?: Request) {
    this.assertExactlyOneScope(dto.templateId, dto.agentId);
    await this.assertMayWriteFor(dto.templateId, req);
    return this.gateway.create(dto as ICreatePaddockScenarioData);
  }

  /** 403 `ASSISTANT_BUILT_FROM` before anything is written or drafted. */
  private assertMayWriteFor(
    templateId: string | null | undefined,
    req: Request | undefined,
  ): Promise<void> {
    return this.build.assertMayChange(
      (req as (Request & { user?: IAuthTokenPayload }) | undefined)?.user,
      'template',
      templateId,
    );
  }

  @Post('generate')
  @AgentScoped('body.agentId', { records: true })
  @ApiOperation({
    summary:
      'Generate a scenario draft from a natural-language description via LLM. Result is NOT persisted — review + POST / to save.',
  })
  async generate(
    @Body() dto: GeneratePaddockScenarioDto,
    @Req() req?: Request,
  ) {
    await this.assertMayWriteFor(dto.templateId, req);
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
