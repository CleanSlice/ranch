import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Put,
  Req,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import {
  highestPersonRole,
  type IAuthTokenPayload,
} from '#/user/auth/domain/auth.types';
import { Roles } from '#/user/auth/guards';
import { UserRoleTypes } from '#/user/user/domain';
import {
  AgentAccessError,
  AgentAccessErrorCodes,
  AgentAccessService,
  type IAccessEditor,
} from './domain';
import { AgentAccessDto, SetAgentAccessDto } from './dtos';

type AuthedRequest = Request & { user?: IAuthTokenPayload };

/**
 * The person behind a console request, as the access rule reads them. A
 * bearer that is not a person never gets this far (the role guard refuses
 * an agent runtime's token); read as holding no role, it edits nothing.
 */
function editorOf(req: AuthedRequest): IAccessEditor {
  const sub = typeof req?.user?.sub === 'string' ? req.user.sub : '';
  const role = sub.startsWith('agent:')
    ? null
    : highestPersonRole(req?.user?.roles);
  return { kind: 'person', userId: sub, role: role ?? UserRoleTypes.Agent };
}

/** A refusal of the service as the HTTP answer of contracts/http-api.md. */
export function agentAccessErrorToHttp(err: unknown): never {
  if (!(err instanceof AgentAccessError)) throw err;
  const body = { code: err.code, message: err.message };
  switch (err.code) {
    case AgentAccessErrorCodes.NotEditable:
      throw new ForbiddenException(body);
    case AgentAccessErrorCodes.ListsOverlap:
      throw new BadRequestException(body);
    case AgentAccessErrorCodes.AssistantNotListed:
      throw new UnprocessableEntityException(body);
    // The ordinary "not found", with no code: an agent outside the caller's
    // view is not told apart from one that does not exist.
    case AgentAccessErrorCodes.AgentNotFound:
    case AgentAccessErrorCodes.UserNotFound:
      throw new NotFoundException(err.message);
    case AgentAccessErrorCodes.OpenNeedsConfirm:
      throw new ConflictException({ ...body, outcome: err.outcome });
    default:
      throw new ConflictException(body);
  }
}

/**
 * Which agents an account reaches (CLEAN-231): the allowed and the denied
 * list of one account, read and replaced by the Owner or an Admin. A User
 * sees no lists, their own included (the role on the controller).
 *
 * Everything is limited to the caller's view, the agents the caller reaches:
 * an Admin is shown, and may name, only those. Who may edit whom agrees with
 * the account rule of `PUT /users/:id`.
 */
@ApiTags('users')
@ApiBearerAuth()
@Controller('users/:id/agent-access')
@Roles(UserRoleTypes.Admin)
export class AgentAccessController {
  constructor(private readonly access: AgentAccessService) {}

  @Get()
  @ApiOperation({
    operationId: 'getUserAgentAccess',
    summary:
      "One account's agent access as the caller may see it: the allowed " +
      'and denied agents among the ones the caller reaches, what the lists ' +
      'come to, and whether there is more the caller cannot see. Owner: any ' +
      'account. Admin: accounts with the User role.',
  })
  @ApiOkResponse({ type: AgentAccessDto })
  @ApiForbiddenResponse({
    description:
      '`ACCESS_NOT_EDITABLE`: for an Admin, any account that is not a User.',
  })
  @ApiNotFoundResponse({ description: 'No user with this id.' })
  async get(
    @Param('id') id: string,
    @Req() req: AuthedRequest,
  ): Promise<AgentAccessDto> {
    try {
      return await this.access.view(editorOf(req), id);
    } catch (err) {
      return agentAccessErrorToHttp(err);
    }
  }

  @Put()
  @ApiOperation({
    operationId: 'setUserAgentAccess',
    summary:
      "Replace the part of an account's agent access that lies inside the " +
      "caller's view. The body is the whole desired state there: an agent " +
      'absent from both arrays ends with no entry, and entries about agents ' +
      'the caller does not reach are kept as they are. A refusal saves ' +
      'nothing. Owner: Admins and Users. Admin: Users, and never more than ' +
      'the Admin reaches.',
  })
  @ApiOkResponse({ type: AgentAccessDto })
  @ApiBadRequestResponse({
    description: '`ACCESS_LISTS_OVERLAP`: an agent is in both arrays.',
  })
  @ApiForbiddenResponse({
    description:
      '`ACCESS_NOT_EDITABLE`: the account is the Owner, the caller, or (for ' +
      'an Admin) another Admin.',
  })
  @ApiNotFoundResponse({
    description:
      'No user with this id; or `Agent not found`: an agent id is unknown ' +
      "or outside the caller's view.",
  })
  @ApiConflictResponse({
    description:
      '`ACCESS_EXCEEDS_CEILING`: an Admin would open agents they do not ' +
      'reach. `ACCESS_OPEN_NEEDS_CONFIRM`: the change turns a limited ' +
      'account into an open one and `confirmOpen` is not true; carries the ' +
      'resulting `outcome`. `ACCESS_CHANGED`: `version` is not current.',
  })
  async set(
    @Param('id') id: string,
    @Body() dto: SetAgentAccessDto,
    @Req() req: AuthedRequest,
  ): Promise<AgentAccessDto> {
    try {
      const result = await this.access.replace(
        editorOf(req),
        id,
        { allowed: dto.allowed, denied: dto.denied },
        { version: dto.version ?? null, confirmOpen: dto.confirmOpen === true },
      );
      return result.view;
    } catch (err) {
      return agentAccessErrorToHttp(err);
    }
  }
}
