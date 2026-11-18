import {
  Controller,
  Delete,
  ForbiddenException,
  HttpCode,
  NotFoundException,
  Param,
  Put,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import type { IAuthTokenPayload } from '#/user/auth/domain/auth.types';
import { Roles } from '#/user/auth/guards';
import { UserRoleTypes } from '#/user/user/domain';
import { AgentScoped, accessCallerOf } from '#/user/agentAccess/guards';
import { IAgentPinGateway } from './domain/agentPin.gateway';

type AuthedRequest = Request & { user?: IAuthTokenPayload };

const AGENT_NOT_FOUND = 'Agent not found';

export const PIN_NEEDS_A_PERSON =
  'A pin belongs to a signed-in person. This caller is not one.';

/**
 * Personal pins (CLEAN-231). A pin is one account's mark on one agent it
 * reaches: it moves the agent to the top of that account's lists and
 * nobody else's, and changes nothing about the agent. Any signed-in person
 * may set one, whatever their role; the installation-wide pin is gone.
 *
 * An agent the caller does not reach answers 404, like one that does not
 * exist (`@AgentScoped`). A caller that is not a person has no lists to
 * order and is refused 403.
 */
@ApiTags('agents')
@ApiBearerAuth()
@Controller('agents/:id/pin')
@Roles(UserRoleTypes.User)
@AgentScoped('id')
export class AgentPinController {
  constructor(private readonly pins: IAgentPinGateway) {}

  @Put()
  @HttpCode(204)
  @ApiOperation({
    operationId: 'pinAgent',
    summary:
      'Pin the agent for the caller: it is kept at the top of the ' +
      "caller's own agent lists, on every device. Idempotent. Any signed-in " +
      'person; nobody else is affected.',
  })
  @ApiNoContentResponse({ description: 'Pinned, or already pinned.' })
  @ApiNotFoundResponse({
    description: 'No agent with this id among the ones the caller reaches.',
  })
  @ApiForbiddenResponse({ description: 'The caller is not a person.' })
  async pin(@Param('id') id: string, @Req() req: AuthedRequest): Promise<void> {
    const found = await this.pins.pin(this.personOf(req), id);
    if (!found) throw new NotFoundException(AGENT_NOT_FOUND);
  }

  @Delete()
  @HttpCode(204)
  @ApiOperation({
    operationId: 'unpinAgent',
    summary:
      'Unpin the agent for the caller. Idempotent: an agent that was not ' +
      'pinned is still 204.',
  })
  @ApiNoContentResponse({ description: 'Not pinned any more.' })
  @ApiNotFoundResponse({
    description: 'No agent with this id among the ones the caller reaches.',
  })
  @ApiForbiddenResponse({ description: 'The caller is not a person.' })
  async unpin(
    @Param('id') id: string,
    @Req() req: AuthedRequest,
  ): Promise<void> {
    const found = await this.pins.unpin(this.personOf(req), id);
    if (!found) throw new NotFoundException(AGENT_NOT_FOUND);
  }

  /** The account the pin belongs to. An agent runtime's token is nobody's. */
  private personOf(req: AuthedRequest): string {
    const caller = accessCallerOf(req);
    if (caller.kind !== 'person') {
      throw new ForbiddenException(PIN_NEEDS_A_PERSON);
    }
    return caller.userId;
  }
}
