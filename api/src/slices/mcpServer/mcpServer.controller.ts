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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IMcpServerGateway } from './domain';
import { CreateMcpServerDto, UpdateMcpServerDto } from './dtos';
import { JwtAuthGuard, Roles, RolesGuard } from '#/user/auth/guards';
import { UserRoleTypes } from '#/user/user/domain';

@ApiTags('mcp-servers')
@ApiBearerAuth()
@Controller('mcp-servers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class McpServerController {
  constructor(private gateway: IMcpServerGateway) {}

  @Get()
  @Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
  @ApiOperation({ summary: 'List all MCP servers registered in this Ranch.' })
  findAll() {
    return this.gateway.findAll();
  }

  @Get(':id')
  @Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
  @ApiOperation({ summary: 'Get an MCP server by id.' })
  async findById(@Param('id') id: string) {
    const server = await this.gateway.findById(id);
    if (!server) throw new NotFoundException('MCP server not found');
    return server;
  }

  @Post()
  @Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
  @ApiOperation({ summary: 'Register a new MCP server.' })
  create(@Body() dto: CreateMcpServerDto) {
    return this.gateway.create(dto);
  }

  @Patch(':id')
  @Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
  @ApiOperation({ summary: 'Update an MCP server.' })
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
