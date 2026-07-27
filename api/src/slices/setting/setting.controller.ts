import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard, Roles, RolesGuard } from '#/user/auth/guards';
import { UserRoleTypes } from '#/user/user/domain';
import { IInfraConfigGateway, ISettingGateway } from './domain';
import { UpsertSettingDto } from './dtos';

@ApiTags('settings')
@ApiBearerAuth()
// Holds credentials in plaintext (github_pat, bridle_api_key, etc.).
// Owner/Admin only — never expose to unauthenticated or plain User callers.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
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
