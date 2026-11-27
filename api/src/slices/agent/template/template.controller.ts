import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse } from '@nestjs/swagger';
import { ChangesAssistantIngredient } from '#/agent/assistantBuild/guards';
import { AssistantBuildService } from '#/agent/assistantBuild/domain/assistantBuild.service';
import { ITemplateGateway } from './domain';
import {
  CreateTemplateDto,
  TemplateDto,
  SetTemplateMcpsDto,
  SetTemplateSkillsDto,
  SetTemplateToolsDto,
  UpdateTemplateDto,
} from './dtos';

@ApiTags('templates')
@Controller('templates')
export class TemplateController {
  constructor(
    private templateGateway: ITemplateGateway,
    private build: AssistantBuildService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all agent templates' })
  @ApiOkResponse({ type: [TemplateDto] })
  async findAll() {
    return this.build.mark('template', await this.templateGateway.findAll());
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get template by ID' })
  @ApiOkResponse({ type: TemplateDto })
  async findById(@Param('id') id: string) {
    const template = await this.templateGateway.findById(id);
    if (!template) throw new NotFoundException('Template not found');
    return this.build.markOne('template', template);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new agent template' })
  create(@Body() dto: CreateTemplateDto) {
    return this.templateGateway.create(dto);
  }

  @Put(':id')
  @ChangesAssistantIngredient('template', 'id')
  @ApiOperation({
    summary:
      'Update a template. A template the Ranch assistant is built from is the Owner’s to change: 403 ASSISTANT_BUILT_FROM for anybody else (CLEAN-271); so are its skills, MCP servers, tools, files and its deletion.',
  })
  async update(@Param('id') id: string, @Body() dto: UpdateTemplateDto) {
    return this.build.markOne(
      'template',
      await this.templateGateway.update(id, dto),
    );
  }

  @Put(':id/skills')
  @ChangesAssistantIngredient('template', 'id')
  @ApiOperation({
    summary:
      'Replace the skill set attached to a template. Body lists the full desired set; omitted IDs are detached.',
  })
  async setSkills(@Param('id') id: string, @Body() dto: SetTemplateSkillsDto) {
    const template = await this.templateGateway.findById(id);
    if (!template) throw new NotFoundException('Template not found');
    return this.build.markOne(
      'template',
      await this.templateGateway.setSkills(id, dto.skillIds),
    );
  }

  @Put(':id/mcps')
  @ChangesAssistantIngredient('template', 'id')
  @ApiOperation({
    summary:
      'Replace the MCP servers attached to a template. Body lists the full desired set; omitted IDs are detached. Agents created from this template inherit these MCPs at deploy time.',
  })
  async setMcps(@Param('id') id: string, @Body() dto: SetTemplateMcpsDto) {
    const template = await this.templateGateway.findById(id);
    if (!template) throw new NotFoundException('Template not found');
    return this.build.markOne(
      'template',
      await this.templateGateway.setMcps(id, dto.mcpServerIds),
    );
  }

  @Put(':id/tools')
  @ChangesAssistantIngredient('template', 'id')
  @ApiOperation({
    summary:
      'Limit the Documents MCP tools agents of this template may list and call (CLEAN-209). `toolNames: null` restores every tool (the default). A pod reads the list when it connects, so running agents see it after a restart.',
  })
  async setTools(@Param('id') id: string, @Body() dto: SetTemplateToolsDto) {
    const template = await this.templateGateway.findById(id);
    if (!template) throw new NotFoundException('Template not found');
    return this.build.markOne(
      'template',
      await this.templateGateway.setToolAllowlist(id, dto.toolNames),
    );
  }

  @Delete(':id')
  @ChangesAssistantIngredient('template', 'id')
  @ApiOperation({ summary: 'Delete a template' })
  async remove(@Param('id') id: string) {
    const template = await this.templateGateway.findById(id);
    if (!template) throw new NotFoundException('Template not found');
    const agentCount = await this.templateGateway.countAgents(id);
    if (agentCount > 0) {
      throw new ConflictException(
        `Cannot delete template — ${agentCount} agent${agentCount === 1 ? '' : 's'} still using it.`,
      );
    }
    await this.templateGateway.delete(id);
    return { id };
  }
}
