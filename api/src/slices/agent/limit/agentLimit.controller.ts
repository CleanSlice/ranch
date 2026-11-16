import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard, Roles, RolesGuard } from '#/user/auth/guards';
import { UserRoleTypes } from '#/user/user/domain';
import { IAuthTokenPayload } from '#/user/auth/domain/auth.types';
import { IAgentData, IAgentGateway } from '#/agent/agent/domain';
import {
  AgentLimitService,
  IAgentLimits,
  IAgentLoadSnapshot,
  LimitRuleError,
  resolveLimitChange,
} from './domain';
import {
  AgentLimitSummaryDto,
  AgentLimitsEnabledDto,
  AgentLimitsStateDto,
  AgentLoadDto,
  SetAgentLimitsDto,
} from './dtos';

type AuthedRequest = Request & { user?: IAuthTokenPayload };

/** A refused save, as the 400 the console maps to a sentence by `code`. */
export function limitRuleToHttp(err: unknown): never {
  if (err instanceof LimitRuleError) {
    throw new BadRequestException({ code: err.code, message: err.message });
  }
  throw err;
}

function toLoadDto(snapshot: IAgentLoadSnapshot): AgentLoadDto {
  return {
    limits: snapshot.limits,
    isPublic: snapshot.isPublic,
    needsLimits: snapshot.needsLimits,
    windows: snapshot.windows,
    inFlight: snapshot.inFlight,
    // Explicit copy: the per-window split of refusals stays in the totals and
    // nothing the domain grows later reaches the wire by accident.
    series: snapshot.series.map((m) => ({
      minute: new Date(m.minute).toISOString(),
      accepted: m.accepted,
      refused: m.refused,
      exempt: m.exempt,
    })),
    refused: snapshot.refused,
    exemptLastHour: snapshot.exemptLastHour,
    peaks: snapshot.peaks,
    apiReplicas: snapshot.apiReplicas,
  };
}

/**
 * Request limits and live load of agents (CLEAN-224).
 *
 * Nothing here is public, on purpose: limit values and usage figures are for
 * the people who may edit the agent. The one exception is `…/limits/enabled`,
 * which tells any signed-in user a single boolean so the app console's
 * read-only view of an agent does not contradict the admin screen.
 */
@ApiTags('agent-limits')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Missing, malformed or expired console bearer token.',
})
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class AgentLimitController {
  constructor(
    private readonly limits: AgentLimitService,
    private readonly agents: IAgentGateway,
  ) {}

  @Get('agent-limits')
  @Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
  @ApiOperation({
    operationId: 'listAgentLimits',
    summary:
      'One line per agent: whether it has limits, whether one is full right ' +
      'now, and whether it is public without any. Admin or Owner.',
  })
  @ApiOkResponse({ type: [AgentLimitSummaryDto] })
  async list(): Promise<AgentLimitSummaryDto[]> {
    return this.limits.summary(await this.agents.findAll());
  }

  @Get('agents/:agentId/limits')
  @Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
  @ApiOperation({
    operationId: 'getAgentLimits',
    summary: 'The request limits of one agent. Admin or Owner.',
  })
  @ApiOkResponse({ type: AgentLimitsStateDto })
  @ApiNotFoundResponse({ description: 'No agent with this id.' })
  async get(@Param('agentId') agentId: string): Promise<AgentLimitsStateDto> {
    await this.requireAgent(agentId);
    return { limits: this.limits.getLimits(agentId) };
  }

  @Put('agents/:agentId/limits')
  @Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
  @ApiOperation({
    operationId: 'setAgentLimits',
    summary:
      'Set the request limits of one agent; all three empty switches them ' +
      'off. Takes effect on the next request and keeps what was used so far. ' +
      'A public agent must keep at least one limit. Admin or Owner.',
  })
  @ApiOkResponse({ type: AgentLimitsStateDto })
  @ApiNotFoundResponse({ description: 'No agent with this id.' })
  @ApiBadRequestResponse({
    description:
      'Refused, with a `code`: PUBLIC_AGENT_NEEDS_LIMITS, LIMIT_OUT_OF_RANGE ' +
      'or LIMIT_WINDOWS_CONTRADICT.',
  })
  async set(
    @Param('agentId') agentId: string,
    @Body() dto: SetAgentLimitsDto,
    @Req() req: AuthedRequest,
  ): Promise<AgentLimitsStateDto> {
    const agent = await this.requireAgent(agentId);
    let limits: IAgentLimits | null;
    try {
      limits = resolveLimitChange(
        { isPublic: agent.isPublic, limits: this.limits.getLimits(agentId) },
        { limits: dto },
      ).limits;
    } catch (err) {
      limitRuleToHttp(err);
    }
    await this.limits.setLimits(agentId, limits, req.user?.sub ?? null);
    return { limits: this.limits.getLimits(agentId) };
  }

  @Get('agents/:agentId/limits/enabled')
  @Roles(UserRoleTypes.User)
  @ApiOperation({
    operationId: 'getAgentLimitsEnabled',
    summary:
      'Whether this agent has request limits. Any signed-in user; the values ' +
      'themselves are not disclosed here.',
  })
  @ApiOkResponse({ type: AgentLimitsEnabledDto })
  @ApiNotFoundResponse({ description: 'No agent with this id.' })
  async enabled(
    @Param('agentId') agentId: string,
  ): Promise<AgentLimitsEnabledDto> {
    await this.requireAgent(agentId);
    return { enabled: this.limits.getLimits(agentId) !== null };
  }

  @Get('agents/:agentId/load')
  @Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
  @ApiOperation({
    operationId: 'getAgentLoad',
    summary:
      'How busy the agent is right now: usage against each limit, requests ' +
      'in progress, the last hour minute by minute, refusals, and the ' +
      'highest load of the last 30 days. Meant to be polled. Admin or Owner.',
  })
  @ApiOkResponse({ type: AgentLoadDto })
  @ApiNotFoundResponse({ description: 'No agent with this id.' })
  async load(@Param('agentId') agentId: string): Promise<AgentLoadDto> {
    const agent = await this.requireAgent(agentId);
    return toLoadDto(await this.limits.snapshot(agent));
  }

  private async requireAgent(agentId: string): Promise<IAgentData> {
    const agent = await this.agents.findById(agentId);
    if (!agent) throw new NotFoundException(`Agent ${agentId} not found`);
    return agent;
  }
}
