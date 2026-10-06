import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Put,
  Query,
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
import { IAuthTokenPayload } from '#/user/auth/domain/auth.types';
import { UserRoleTypes } from '#/user/user/domain';
import {
  AgentEventService,
  EVENT_PAGE_DEFAULT,
  IAgentIncidentView,
  NotificationDestinationService,
} from './domain';
import {
  AgentEventPageDto,
  AgentIncidentDto,
  AgentIncidentPageDto,
  ListAgentEventsQueryDto,
  ListAgentIncidentsQueryDto,
  NotificationDestinationDto,
  SaveNotificationDestinationDto,
  TestDeliveryDto,
} from './dtos';

export const toIncidentDto = (i: IAgentIncidentView): AgentIncidentDto => ({
  id: i.id,
  agentId: i.agentId,
  agentName: i.agentName,
  state: i.open ? 'open' : 'closed',
  status: i.status,
  reason: i.reason,
  witnesses: i.witnesses,
  ranchWitnessed: i.ranchWitnessed,
  eventCount: i.eventCount,
  openedAt: i.openedAt,
  lastFailureAt: i.lastFailureAt,
  upSince: i.upSince,
  closedAt: i.closedAt,
  resolution: i.resolution,
  notifications: i.notifications,
});

/**
 * What the admin console reads and sets: the record of events and incidents,
 * and where the team is told. Reading is for owners and admins; the
 * destination — a secret, and a decision about who gets woken — is the
 * owner's. No answer of this controller contains the destination's address.
 */
@ApiTags('agent-events')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRoleTypes.Admin)
export class AgentEventController {
  constructor(
    private service: AgentEventService,
    private destinations: NotificationDestinationService,
  ) {}

  @Get('agent-events')
  @ApiOperation({
    summary:
      'Agent events, newest first: reports from outside senders and failures Ranch noticed itself.',
    operationId: 'listAgentEvents',
  })
  @ApiOkResponse({ type: AgentEventPageDto })
  async listEvents(
    @Query() query: ListAgentEventsQueryDto,
  ): Promise<AgentEventPageDto> {
    return this.service.listEvents({
      agentId: query.agentId,
      limit: query.limit ?? EVENT_PAGE_DEFAULT,
      before: query.before,
    });
  }

  @Get('agent-incidents')
  @ApiOperation({
    summary:
      'Incidents, newest first: one per stretch of trouble for an agent, with who witnessed it and whether the team was told.',
    operationId: 'listAgentIncidents',
  })
  @ApiOkResponse({ type: AgentIncidentPageDto })
  async listIncidents(
    @Query() query: ListAgentIncidentsQueryDto,
  ): Promise<AgentIncidentPageDto> {
    const page = await this.service.listIncidents({
      agentId: query.agentId,
      state: query.state,
      limit: query.limit ?? EVENT_PAGE_DEFAULT,
      before: query.before,
    });
    return { items: page.items.map(toIncidentDto), nextCursor: page.nextCursor };
  }

  @Get('agent-events/destination')
  @ApiOperation({
    summary:
      'Where failure notifications go and whether the last one arrived. Never the address itself.',
    operationId: 'getNotificationDestination',
  })
  @ApiOkResponse({ type: NotificationDestinationDto })
  getDestination(): Promise<NotificationDestinationDto> {
    return this.destinations.view();
  }

  @Put('agent-events/destination')
  @Roles(UserRoleTypes.Owner)
  @ApiOperation({
    summary:
      'Set the Slack incoming-webhook address notifications go to. The address is stored and never returned.',
    operationId: 'saveNotificationDestination',
  })
  @ApiOkResponse({ type: NotificationDestinationDto })
  saveDestination(
    @Body() dto: SaveNotificationDestinationDto,
    @Req() req: Request & { user: IAuthTokenPayload },
  ): Promise<NotificationDestinationDto> {
    return this.destinations.save(dto.webhookUrl, req.user.sub);
  }

  @Delete('agent-events/destination')
  @Roles(UserRoleTypes.Owner)
  @HttpCode(204)
  @ApiOperation({
    summary:
      'Stop notifying. Messages still waiting are marked skipped; events keep being recorded.',
    operationId: 'removeNotificationDestination',
  })
  async removeDestination(): Promise<void> {
    await this.destinations.remove();
  }

  @Post('agent-events/destination/test')
  @Roles(UserRoleTypes.Owner)
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Send one clearly labelled test message to the destination and report whether it arrived.',
    operationId: 'testNotificationDestination',
  })
  @ApiOkResponse({ type: TestDeliveryDto })
  testDestination(): Promise<TestDeliveryDto> {
    return this.destinations.sendTest();
  }
}
