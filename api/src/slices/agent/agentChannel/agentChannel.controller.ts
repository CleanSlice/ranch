import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { IAgentChannelGateway } from './domain/agentChannel.gateway';
import { AgentChannelDto, SetAgentChannelsDto } from './dtos';
import { JwtAuthGuard, Roles, RolesGuard } from '#/user/auth/guards';
import { UserRoleTypes } from '#/user/user/domain';

@ApiTags('agents')
@ApiBearerAuth()
@Controller('agents')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AgentChannelController {
  constructor(private gateway: IAgentChannelGateway) {}

  @Get(':id/channels')
  @Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
  @ApiOperation({
    operationId: 'getAgentChannels',
    summary:
      "List the agent's configured channels with live status. Config comes from agents/{id}/data/channels/<type>.json in S3 — the runtime's per-channel layout, mutated by its channel_* tools (falls back read-only to the pre-split data/channels.json for agents configured before the convergence). Status (connected/statusReason) comes from data/channels/status.json, written by the runtime; null = unknown. Returns [] when nothing is configured. Always fresh, no caching.",
  })
  @ApiOkResponse({ type: AgentChannelDto, isArray: true })
  async getChannels(@Param('id') id: string) {
    return this.gateway.getForAgent(id);
  }

  @Put(':id/channels')
  @Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
  @ApiOperation({
    operationId: 'setAgentChannels',
    summary:
      "Replace the agent's channels. Writes agents/{id}/data/channels/<type>.json (read-modify-write — the runtime-owned group registry in the same file is preserved). Body is the exhaustive list — anything omitted is tombstoned (removed: true), never deleted, so a restart can't resurrect it from stale pod env vars. Pass [] to clear. Panel-side changes reach a running agent on its next restart (env re-injection at pod submit); agent-side (chat tool) changes apply immediately.",
  })
  @ApiOkResponse({ type: AgentChannelDto, isArray: true })
  async setChannels(@Param('id') id: string, @Body() dto: SetAgentChannelsDto) {
    return this.gateway.setForAgent(id, dto.channels);
  }
}
