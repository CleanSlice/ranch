import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
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
  IUpdatePaddockScenarioData,
  PaddockScenarioCategory,
  PaddockScenarioDifficulty,
} from './domain/scenario.types';

@ApiTags('paddock-scenarios')
@Controller('paddock-scenarios')
export class PaddockScenarioController {
  constructor(
    private gateway: IPaddockScenarioGateway,
    private generator: IPaddockScenarioGeneratorGateway,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'List paddock scenarios. Filter by templateId or agentId; without filters returns all.',
  })
  @ApiQuery({ name: 'templateId', required: false })
  @ApiQuery({ name: 'agentId', required: false })
  findAll(
    @Query('templateId') templateId?: string,
    @Query('agentId') agentId?: string,
  ) {
    return this.gateway.findAll({ templateId, agentId });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a paddock scenario by id' })
  async findById(@Param('id') id: string) {
    const scenario = await this.gateway.findById(id);
    if (!scenario) throw new NotFoundException('Scenario not found');
    return scenario;
  }

  @Post()
  @ApiOperation({
    summary:
      'Create a paddock scenario scoped to either a template or an agent (XOR — exactly one).',
  })
  create(@Body() dto: CreatePaddockScenarioDto) {
    this.assertExactlyOneScope(dto.templateId, dto.agentId);
    return this.gateway.create(dto as ICreatePaddockScenarioData);
  }

  @Post('generate')
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
  ) {
    const existing = await this.gateway.findById(id);
    if (!existing) throw new NotFoundException('Scenario not found');
    return this.gateway.update(id, dto as IUpdatePaddockScenarioData);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a paddock scenario' })
  async remove(@Param('id') id: string) {
    const existing = await this.gateway.findById(id);
    if (!existing) throw new NotFoundException('Scenario not found');
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
