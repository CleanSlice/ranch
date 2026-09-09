import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { InitService } from './domain';
import { CreateOwnerDto, InitStatusDto } from './dtos';
import { AuthDto } from '#/user/auth/dtos';
import { userAgentOf } from '#/user/auth/auth.controller';
import { SessionService } from '#/user/session/domain/session.service';
import { SESSION_COOKIE_NAME } from '#/user/session/domain/session.types';

@ApiTags('setup')
@Controller('setup')
export class InitController {
  constructor(
    private initService: InitService,
    private sessions: SessionService,
  ) {}

  @Get('status')
  @ApiOperation({
    summary: 'Check whether the system needs initial owner setup',
  })
  status(): Promise<InitStatusDto> {
    return this.initService.getStatus();
  }

  @Post('init')
  @HttpCode(201)
  @ApiOperation({
    summary:
      'Create the first owner. Fails if one already exists. Sets the session cookie like login.',
  })
  async init(
    @Body() dto: CreateOwnerDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthDto> {
    const result = await this.initService.createOwner(
      dto.name,
      dto.email,
      dto.password,
      userAgentOf(req),
    );
    res.cookie(
      SESSION_COOKIE_NAME,
      result.cookie.value,
      this.sessions.cookieOptions(result.cookie.maxAgeSeconds),
    );
    return {
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      user: result.user,
    };
  }
}
