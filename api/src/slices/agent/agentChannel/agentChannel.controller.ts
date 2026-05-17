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
      "List the agent's configured channels. Reads agents/{id}/data/channels.json from S3 — the single source of truth (the runtime mutates the same file via its channel_* tools). Returns [] when the file is absent. Always fresh, no caching.",
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
      "Replace the agent's channels. Writes agents/{id}/data/channels.json — restart the agent to pick up new env vars (TELEGRAM_BOT_TOKEN etc.) injected at pod submit time. Body is the exhaustive list — anything omitted is removed. Pass [] to clear.",
  })
  @ApiOkResponse({ type: AgentChannelDto, isArray: true })
  async setChannels(@Param('id') id: string, @Body() dto: SetAgentChannelsDto) {
    return this.gateway.setForAgent(id, dto.channels);
  }
}
