import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Put,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { IAuthTokenPayload } from '#/user/auth/domain/auth.types';
import { heldRoles, rolesAdmit } from '#/user/auth/guards/roles.guard';
import { UserRoleTypes } from '#/user/user/domain';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '#/user/auth/guards';
import {
  IInfraConfigGateway,
  ISettingGateway,
  isOwnerOnlySettingGroup,
  OWNER_ONLY_SETTING_CODE,
  OWNER_ONLY_SETTING_TEXT,
} from './domain';
import { UpsertSettingDto } from './dtos';

/**
 * The settings a page may read before anyone is signed in. The consoles ask
 * for the `auth` group on the login and register pages and in the layout to
 * learn whether registration is open; once every route needed a token
 * (CLEAN-175) that read answered 401 and the app took it for a dead session,
 * logging the visitor out of nothing and bouncing to /login in a loop. The
 * public route below serves exactly these keys and nothing else from the
 * group, so the rest of the settings stay behind the guard.
 */
const PUBLIC_AUTH_SETTINGS = new Set(['registration_enabled']);

@ApiTags('settings')
@Controller('settings')
export class SettingController {
  constructor(
    private gateway: ISettingGateway,
    private infraConfig: IInfraConfigGateway,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all settings' })
  findAll() {
    return this.gateway.findAll();
  }

  // Declared before `:group` so the router prefers it for `auth`.
  @Public()
  @Get('auth')
  @ApiOperation({
    summary:
      'The auth settings a page may read before login (registration_enabled only). Public; the rest of the group, like every other group, needs a token.',
  })
  async findPublicAuthGroup() {
    const rows = await this.gateway.findByGroup('auth');
    return rows.filter((row) => PUBLIC_AUTH_SETTINGS.has(row.name));
  }

  @Get(':group')
  @ApiOperation({ summary: 'List settings in a group' })
  findByGroup(@Param('group') group: string) {
    return this.gateway.findByGroup(group);
  }

  @Get(':group/:name')
  @ApiOperation({ summary: 'Get a single setting by group/name' })
  async findByKey(@Param('group') group: string, @Param('name') name: string) {
    const setting = await this.gateway.findByKey(group, name);
    if (!setting) throw new NotFoundException('Setting not found');
    return setting;
  }

  @Put(':group/:name')
  @ApiOperation({ summary: 'Create or replace a setting' })
  async upsert(
    @Param('group') group: string,
    @Param('name') name: string,
    @Body() dto: UpsertSettingDto,
    @Req() req?: Request & { user?: IAuthTokenPayload },
  ) {
    this.assertMayWrite(group, req);
    const result = await this.gateway.upsert(group, name, dto);
    if (group === 'infrastructure') this.infraConfig.invalidate();
    return result;
  }

  @Delete(':group/:name')
  @ApiOperation({ summary: 'Delete a setting' })
  async remove(
    @Param('group') group: string,
    @Param('name') name: string,
    @Req() req?: Request & { user?: IAuthTokenPayload },
  ) {
    this.assertMayWrite(group, req);
    await this.gateway.delete(group, name);
    if (group === 'infrastructure') this.infraConfig.invalidate();
  }

  /**
   * The `rancher` group is the bookkeeping of the Ranch assistant's
   * template and is written by the Owner only (CLEAN-271,
   * `ownerOnlySettings.ts`). Every other group is as it was.
   */
  private assertMayWrite(
    group: string,
    req?: Request & { user?: IAuthTokenPayload },
  ): void {
    if (!isOwnerOnlySettingGroup(group)) return;
    if (rolesAdmit([UserRoleTypes.Owner], heldRoles(req?.user))) return;
    throw new ForbiddenException({
      statusCode: 403,
      error: 'Forbidden',
      code: OWNER_ONLY_SETTING_CODE,
      message: OWNER_ONLY_SETTING_TEXT,
    });
  }
}
