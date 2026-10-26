import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '#/user/auth/guards';
import { IInfraConfigGateway, ISettingGateway } from './domain';
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
  ) {
    const result = await this.gateway.upsert(group, name, dto);
    if (group === 'infrastructure') this.infraConfig.invalidate();
    return result;
  }

  @Delete(':group/:name')
  @ApiOperation({ summary: 'Delete a setting' })
  async remove(@Param('group') group: string, @Param('name') name: string) {
    await this.gateway.delete(group, name);
    if (group === 'infrastructure') this.infraConfig.invalidate();
  }
}
