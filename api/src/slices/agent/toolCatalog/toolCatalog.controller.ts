import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard, Roles, RolesGuard } from '#/user/auth/guards';
import { UserRoleTypes } from '#/user/user/domain';
import type { IAuthTokenPayload } from '#/user/auth/domain/auth.types';
import { ToolCatalogService } from './domain/toolCatalog.service';
import { AgentToolCatalogDto } from './dto/agentToolCatalog.dto';

@ApiTags('agents')
@ApiBearerAuth()
@Controller('agents/:id')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
export class ToolCatalogController {
  constructor(private readonly catalog: ToolCatalogService) {}

  @Get('tools')
  @ApiOperation({
    operationId: 'getAgentTools',
    summary:
      "The tools this agent's runtime would receive from the built-in Ranch MCP " +
      'server, grouped by topic for the chat\'s Tools panel, with a per-tool ' +
      '"present in the running pod" flag, plus the agent\'s external MCP servers ' +
      'as opaque groups. Owner or Admin only; agent tokens get their list from ' +
      'MCP tools/list instead (CLEAN-109).',
  })
  @ApiOkResponse({ type: AgentToolCatalogDto })
  async tools(
    @Param('id') id: string,
    @Req() req: Request & { user?: IAuthTokenPayload },
  ): Promise<AgentToolCatalogDto> {
    // An admin agent's token carries Owner, which the role guard admits; the
    // catalogue is a console surface, so agents are sent to tools/list.
    if ((req.user?.sub ?? '').startsWith('agent:')) {
      throw new ForbiddenException(
        'Agent tokens read their tools from MCP tools/list, not from this endpoint.',
      );
    }
    return this.catalog.forAgent(id);
  }
}
