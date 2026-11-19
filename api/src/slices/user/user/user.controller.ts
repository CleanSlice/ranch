import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
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
import {
  IUserGateway,
  refuseUserEdit,
  UserRoleTypes,
  type IUserData,
  type IUserEditor,
  type UserEditFields,
} from './domain';
import {
  CreateUserDto,
  UpdateUserDto,
  UpdateUserRoleDto,
  UserDto,
} from './dtos';
import { AgentAccessService } from '#/user/agentAccess/domain/agentAccess.service';
import { IAgentPinGateway } from '#/agent/pin/domain/agentPin.gateway';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/guards';
import {
  highestPersonRole,
  type IAuthTokenPayload,
} from '../auth/domain/auth.types';

const EDITABLE_FIELDS: readonly UserEditFields[] = [
  'name',
  'email',
  'password',
  'status',
];

/**
 * The person behind a console request, as the account rule reads them. A
 * bearer that is not a person (an agent runtime's token never gets this far,
 * the role guard refuses it) edits nothing.
 */
function editorOf(req: { user?: IAuthTokenPayload } | undefined): IUserEditor {
  const sub = typeof req?.user?.sub === 'string' ? req.user.sub : '';
  const role = sub.startsWith('agent:')
    ? null
    : highestPersonRole(req?.user?.roles);
  return { kind: 'person', userId: sub, role: role ?? UserRoleTypes.Agent };
}

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRoleTypes.Admin)
export class UserController {
  constructor(
    private userGateway: IUserGateway,
    private access: AgentAccessService,
    private pins: IAgentPinGateway,
  ) {}

  /**
   * Accounts as a response carries them: with what each one's agent access
   * comes to (CLEAN-231). One read for the whole list.
   */
  private async present(users: IUserData[]): Promise<UserDto[]> {
    const summaries = await this.access.summaries(users);
    return users.map((user) => ({
      ...user,
      agentAccess: summaries.get(user.id) ?? {
        kind: 'all',
        needsReview: false,
      },
    }));
  }

  private async presentOne(user: IUserData): Promise<UserDto> {
    return (await this.present([user]))[0];
  }

  @Get()
  @ApiOperation({
    summary:
      'List all users, each with what its agent access comes to (`agentAccess`).',
  })
  @ApiOkResponse({ type: UserDto, isArray: true })
  async findAll() {
    return this.present(await this.userGateway.findAll());
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get user by ID' })
  @ApiOkResponse({ type: UserDto })
  async findById(@Param('id') id: string) {
    const user = await this.userGateway.findById(id);
    if (!user) throw new NotFoundException('User not found');
    return this.presentOne(user);
  }

  @Post()
  @ApiOperation({ summary: 'Create a user (admin sets the password)' })
  @ApiOkResponse({ type: UserDto })
  async create(@Body() dto: CreateUserDto) {
    return this.presentOne(await this.userGateway.create(dto));
  }

  @Put(':id')
  @ApiOperation({
    summary:
      'Update user (name, email, password, status). Use /role to change the role. The Owner may change any account; an Admin may change accounts with the User role, and the name, email and password of their own, never the Owner or another Admin (403).',
  })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @Req() req: Request & { user?: IAuthTokenPayload },
  ) {
    const target = await this.getTargetOrThrow(id);
    // Who may change whom (CLEAN-232): an Admin edits Users and their own
    // name, email and password, never the Owner or another Admin. A new
    // password on either of those would be that person's role.
    const refusal = refuseUserEdit(
      editorOf(req),
      target,
      EDITABLE_FIELDS.filter((field) => dto[field] !== undefined),
    );
    if (refusal) throw new ForbiddenException(refusal);
    if (dto.status !== undefined && target.role === UserRoleTypes.Owner) {
      throw new ForbiddenException(
        'The Owner account status cannot be changed',
      );
    }
    return this.presentOne(await this.userGateway.update(id, dto));
  }

  @Put(':id/role')
  @Roles(UserRoleTypes.Owner)
  @ApiOperation({ summary: "Set the user's role. Owner only." })
  async updateRole(@Param('id') id: string, @Body() dto: UpdateUserRoleDto) {
    const target = await this.getTargetOrThrow(id);
    if (target.role === UserRoleTypes.Owner) {
      throw new ForbiddenException('The Owner role cannot be changed');
    }
    return this.presentOne(
      await this.userGateway.update(id, { role: dto.role }),
    );
  }

  @Delete(':id')
  @Roles(UserRoleTypes.Owner)
  @ApiOperation({ summary: 'Remove user. Owner only.' })
  async remove(@Param('id') id: string) {
    const target = await this.getTargetOrThrow(id);
    if (target.role === UserRoleTypes.Owner) {
      throw new ForbiddenException('The Owner account cannot be removed');
    }
    await this.userGateway.delete(id);
    // The account's access lists and pins go with it (CLEAN-231). `userId`
    // is a bare id on those rows, so nothing cascades for us.
    await this.access.removeUser(id);
    await this.pins.removeUser(id);
  }

  private async getTargetOrThrow(id: string) {
    const user = await this.userGateway.findById(id);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}
