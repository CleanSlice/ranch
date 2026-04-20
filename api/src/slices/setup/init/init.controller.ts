import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InitService } from './domain';
import { CreateOwnerDto, InitStatusDto } from './dtos';
import { AuthDto } from '#/user/auth/dtos';

@ApiTags('setup')
@Controller('setup')
export class InitController {
  constructor(private initService: InitService) {}

  @Get('status')
  @ApiOperation({ summary: 'Check whether the system needs initial owner setup' })
  status(): Promise<InitStatusDto> {
    return this.initService.getStatus();
  }

  @Post('init')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create the first owner. Fails if one already exists.' })
  async init(@Body() dto: CreateOwnerDto): Promise<AuthDto> {
    return this.initService.createOwner(dto.name, dto.email, dto.password);
  }
}
