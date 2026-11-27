import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ChangesAssistantIngredient } from '#/agent/assistantBuild/guards';
import { AssistantBuildService } from '#/agent/assistantBuild/domain/assistantBuild.service';
import { IMcpServerGateway } from './domain';
import { CreateMcpServerDto, McpServerDto, UpdateMcpServerDto } from './dtos';
import { McpToolSummaryDto } from './dtos/mcpToolSummary.dto';
import { McpRegistryService } from '#/mcp/services/mcp-registry.service';
import { JwtAuthGuard, Roles, RolesGuard } from '#/user/auth/guards';
import { UserRoleTypes } from '#/user/user/domain';

@ApiTags('mcp-servers')
@ApiBearerAuth()
@Controller('mcp-servers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class McpServerController {
  constructor(
    private gateway: IMcpServerGateway,
    private registry: McpRegistryService,
    private build: AssistantBuildService,
  ) {}

  @Get()
  @Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
  @ApiOperation({ summary: 'List all MCP servers registered in this Ranch.' })
  @ApiOkResponse({ type: [McpServerDto] })
  async findAll() {
    return this.build.mark('mcpServer', await this.gateway.findAll());
  }

  // Before `:id`, or Express reads "tools" as an id.
  @Get('tools')
  @Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
  @ApiOperation({
    summary:
      'The tools the built-in Documents MCP server offers — name, topic, title, description — for a template tool allowlist (CLEAN-209). The static catalogue: per-caller gating is not applied here.',
  })
  @ApiOkResponse({ type: [McpToolSummaryDto] })
  listTools(): McpToolSummaryDto[] {
    return this.registry
      .getTools()
      .map((t) => ({
        name: t.metadata.name,
        topic: t.metadata.topic ?? null,
        title: t.metadata.title ?? null,
        description: t.metadata.description ?? '',
      }))
      .sort(
        (a, b) =>
          (a.topic ?? '').localeCompare(b.topic ?? '') ||
          a.name.localeCompare(b.name),
      );
  }

  @Get(':id')
  @Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
  @ApiOperation({ summary: 'Get an MCP server by id.' })
  @ApiOkResponse({ type: McpServerDto })
  async findById(@Param('id') id: string) {
    const server = await this.gateway.findById(id);
    if (!server) throw new NotFoundException('MCP server not found');
    return this.build.markOne('mcpServer', server);
  }

  @Post()
  @Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
  @ApiOperation({ summary: 'Register a new MCP server.' })
  create(@Body() dto: CreateMcpServerDto) {
    return this.gateway.create(dto);
  }

  @Patch(':id')
  @Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
  @ChangesAssistantIngredient('mcpServer', 'id')
  @ApiOperation({
    summary:
      'Update an MCP server. A server the Ranch assistant is handed (attached to its template, or one of the built-ins every agent gets) receives its calls, and the Ranch server its token: 403 ASSISTANT_BUILT_FROM for anybody but the Owner, here and on DELETE (CLEAN-271).',
  })
  async update(@Param('id') id: string, @Body() dto: UpdateMcpServerDto) {
    const existing = await this.gateway.findById(id);
    if (!existing) throw new NotFoundException('MCP server not found');
    if (existing.builtIn) {
      // Built-ins (Ranch's own MCP) can be enabled/disabled but not edited —
      // their url and auth model is owned by the api itself.
      const allowed: UpdateMcpServerDto = {
        enabled: dto.enabled,
        description: dto.description,
      };
      return this.gateway.update(id, allowed);
    }
    return this.gateway.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
  @ChangesAssistantIngredient('mcpServer', 'id')
  @ApiOperation({
    summary:
      'Delete an MCP server. Built-in entries (e.g. the Ranch MCP itself) cannot be deleted — only disabled.',
  })
  async remove(@Param('id') id: string) {
    const existing = await this.gateway.findById(id);
    if (!existing) throw new NotFoundException('MCP server not found');
    if (existing.builtIn) {
      throw new ForbiddenException(
        'Built-in MCP servers cannot be deleted — disable them via PATCH /mcp-servers/:id { enabled: false } instead.',
      );
    }
    return this.gateway.delete(id);
  }
}
