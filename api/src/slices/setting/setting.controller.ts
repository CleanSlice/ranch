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
import { ISettingGateway } from './domain';
import { UpsertSettingDto } from './dtos';

@ApiTags('settings')
@Controller('settings')
export class SettingController {
  constructor(private gateway: ISettingGateway) {}

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
  upsert(
    @Param('group') group: string,
    @Param('name') name: string,
    @Body() dto: UpsertSettingDto,
  ) {
    return this.gateway.upsert(group, name, dto);
  }

  @Delete(':group/:name')
  @ApiOperation({ summary: 'Delete a setting' })
  remove(@Param('group') group: string, @Param('name') name: string) {
    return this.gateway.delete(group, name);
  }
}
