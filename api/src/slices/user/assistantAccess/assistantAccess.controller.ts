import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Put,
  Req,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import {
  highestPersonRole,
  type IAuthTokenPayload,
} from '#/user/auth/domain/auth.types';
import { Roles } from '#/user/auth/guards';
import { UserRoleTypes } from '#/user/user/domain';
import {
  AssistantAccessError,
  AssistantAccessErrorCodes,
  AssistantAccessService,
  type AssistantRole,
  type IAssistantEditor,
} from './domain';
import {
  AssistantAccountDto,
  AssistantCatalogDto,
  AssistantOverviewDto,
  AssistantRoleDto,
  MyAssistantAccessDto,
  SetAssistantAccessDto,
} from './dtos';

type AuthedRequest = Request & { user?: IAuthTokenPayload };

function editorOf(req: AuthedRequest): IAssistantEditor {
  const sub = typeof req?.user?.sub === 'string' ? req.user.sub : '';
  const role = sub.startsWith('agent:')
    ? null
    : highestPersonRole(req?.user?.roles);
  return { kind: 'person', userId: sub, role: role ?? UserRoleTypes.Agent };
}

/** Each refusal as the status a console can act on, with its code. */
export function assistantAccessErrorToHttp(err: unknown): never {
  if (!(err instanceof AssistantAccessError)) throw err;
  const body = {
    code: err.code,
    message: err.message,
    ...(err.names ? { names: err.names } : {}),
  };
  switch (err.code) {
    case AssistantAccessErrorCodes.UserNotFound:
      throw new NotFoundException(err.message);
    case AssistantAccessErrorCodes.NotAllowed:
      throw new ForbiddenException(body);
    case AssistantAccessErrorCodes.BadRole:
    case AssistantAccessErrorCodes.BadLevel:
      throw new BadRequestException(body);
    case AssistantAccessErrorCodes.Stale:
      throw new ConflictException(body);
    default:
      // An unknown ability, one above the role, one above the editor's own.
      throw new UnprocessableEntityException(body);
  }
}

/**
 * Who has the Ranch assistant and what it offers them (CLEAN-240).
 *
 * Per role, set by the Owner. Per account, as an exception, set by the Owner
 * or — for a User, and never above their own — by an Admin. The Owner always
 * has everything and has no setting.
 *
 * A setting only narrows: what a role cannot do in the console the assistant
 * cannot do for it either, at any level.
 */
@ApiTags('assistant-access')
@ApiBearerAuth()
@Controller()
export class AssistantAccessController {
  constructor(private readonly access: AssistantAccessService) {}

  @Get('assistant-access')
  @Roles(UserRoleTypes.Owner)
  @ApiOperation({
    operationId: 'getAssistantAccess',
    summary:
      'Who can use the assistant: what Admins and Users get, how many ' +
      'accounts follow each, and every account that differs from its role, ' +
      'with who set it. Owner only.',
  })
  @ApiOkResponse({ type: AssistantOverviewDto })
  async overview(@Req() req: AuthedRequest): Promise<AssistantOverviewDto> {
    try {
      return await this.access.overview(editorOf(req));
    } catch (e) {
      assistantAccessErrorToHttp(e);
    }
  }

  @Get('assistant-access/catalog')
  @Roles(UserRoleTypes.Admin)
  @ApiOperation({
    operationId: 'getAssistantCatalog',
    summary:
      'Everything the assistant can do for a person, area by area, with the ' +
      'levels each ability belongs to, whether it changes or deletes ' +
      'something, and the lowest role that can have it. Names and titles ' +
      'only. Owner or Admin.',
  })
  @ApiOkResponse({ type: AssistantCatalogDto })
  catalog(): AssistantCatalogDto {
    return this.access.catalog();
  }

  @Put('assistant-access/roles/:role')
  @Roles(UserRoleTypes.Owner)
  @ApiOperation({
    operationId: 'setAssistantRoleAccess',
    summary:
      'Set what a role gets from the assistant: on or off, and a level or a ' +
      'custom pick. `:role` is Admin or User. Applies to every account of ' +
      'the role without its own setting, from their next message. Owner only.',
  })
  @ApiOkResponse({ type: AssistantRoleDto })
  @ApiConflictResponse({ description: '`ASSISTANT_ACCESS_STALE`.' })
  @ApiUnprocessableEntityResponse({
    description:
      '`UNKNOWN_ABILITY` or `ABOVE_THE_ROLE`, with the names in `names`.',
  })
  async setRole(
    @Param('role') role: string,
    @Body() dto: SetAssistantAccessDto,
    @Req() req: AuthedRequest,
  ): Promise<AssistantRoleDto> {
    try {
      return await this.access.setRole(
        editorOf(req),
        role as AssistantRole,
        dto,
      );
    } catch (e) {
      assistantAccessErrorToHttp(e);
    }
  }

  @Get('users/:id/assistant-access')
  @Roles(UserRoleTypes.Admin)
  @ApiOperation({
    operationId: 'getUserAssistantAccess',
    summary:
      'What one account gets from the assistant, where that comes from (its ' +
      'role or its own setting), what its role would give it, and whether ' +
      'the caller may change it. Owner: any account. Admin: Users.',
  })
  @ApiOkResponse({ type: AssistantAccountDto })
  @ApiForbiddenResponse({
    description:
      '`ASSISTANT_ACCESS_NOT_ALLOWED`: for an Admin, any account that is ' +
      'not a User, and their own.',
  })
  @ApiNotFoundResponse({ description: 'No user with this id.' })
  async account(
    @Param('id') id: string,
    @Req() req: AuthedRequest,
  ): Promise<AssistantAccountDto> {
    try {
      return await this.access.accountView(editorOf(req), id);
    } catch (e) {
      assistantAccessErrorToHttp(e);
    }
  }

  @Put('users/:id/assistant-access')
  @Roles(UserRoleTypes.Admin)
  @ApiOperation({
    operationId: 'setUserAssistantAccess',
    summary:
      'Give one account its own setting: on or off, a level or a custom ' +
      'pick. What is not sent stays as the account has it now. An Admin ' +
      'sets it for Users only, and to no more than the assistant offers ' +
      'the Admin.',
  })
  @ApiOkResponse({ type: AssistantAccountDto })
  @ApiForbiddenResponse({ description: '`ASSISTANT_ACCESS_NOT_ALLOWED`.' })
  @ApiNotFoundResponse({ description: 'No user with this id.' })
  @ApiConflictResponse({ description: '`ASSISTANT_ACCESS_STALE`.' })
  @ApiUnprocessableEntityResponse({
    description:
      '`ABOVE_YOUR_OWN`, `ABOVE_THE_ROLE` or `UNKNOWN_ABILITY`, with the ' +
      'names in `names`.',
  })
  async setAccount(
    @Param('id') id: string,
    @Body() dto: SetAssistantAccessDto,
    @Req() req: AuthedRequest,
  ): Promise<AssistantAccountDto> {
    try {
      return await this.access.setAccount(editorOf(req), id, dto);
    } catch (e) {
      assistantAccessErrorToHttp(e);
    }
  }

  @Delete('users/:id/assistant-access')
  @Roles(UserRoleTypes.Admin)
  @ApiOperation({
    operationId: 'resetUserAssistantAccess',
    summary:
      'Drop an account’s own setting, so it follows its role again. ' +
      'Answers the same when there was nothing to drop.',
  })
  @ApiOkResponse({ type: AssistantAccountDto })
  @ApiForbiddenResponse({ description: '`ASSISTANT_ACCESS_NOT_ALLOWED`.' })
  @ApiNotFoundResponse({ description: 'No user with this id.' })
  async resetAccount(
    @Param('id') id: string,
    @Req() req: AuthedRequest,
  ): Promise<AssistantAccountDto> {
    try {
      return await this.access.resetAccount(editorOf(req), id);
    } catch (e) {
      assistantAccessErrorToHttp(e);
    }
  }

  @Get('me/assistant-access')
  @Roles(UserRoleTypes.User)
  @ApiOperation({
    operationId: 'getMyAssistantAccess',
    summary:
      'What the assistant offers the person asking: whether it is on, ' +
      'their level, and how much of each area it covers. Nothing about any ' +
      'other account, and not who set it.',
  })
  @ApiOkResponse({ type: MyAssistantAccessDto })
  async mine(@Req() req: AuthedRequest): Promise<MyAssistantAccessDto> {
    const editor = editorOf(req);
    const mine = await this.access.myAccess(
      editor.kind === 'person' ? editor : null,
    );
    // The names of what is left out are for the assistant's own explanation
    // (the tool); the console shows counts.
    return {
      enabled: mine.enabled,
      level: mine.level,
      matchesLevel: mine.matchesLevel,
      areas: mine.areas,
    };
  }
}
