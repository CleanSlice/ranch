import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBadRequestResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { InitService } from './domain';
import { CreateOwnerDto, InitStatusDto } from './dtos';
import { AuthDto } from '#/user/auth/dtos';
import {
  ApiConsoleHeader,
  CONSOLE_REQUIRED_DESCRIPTION,
  dropLegacyCookie,
  requireConsole,
  userAgentOf,
} from '#/user/auth/auth.controller';
import { SessionService } from '#/user/session/domain/session.service';
import { sessionCookieName } from '#/user/session/domain/session.types';
import { Public } from '#/user/auth/guards';

@ApiTags('setup')
@Controller('setup')
export class InitController {
  constructor(
    private initService: InitService,
    private sessions: SessionService,
  ) {}

  @Public()
  @Get('status')
  @ApiOperation({
    summary: 'Check whether the system needs initial owner setup',
  })
  status(): Promise<InitStatusDto> {
    return this.initService.getStatus();
  }

  @Public()
  @Post('init')
  @HttpCode(201)
  @ApiConsoleHeader()
  @ApiBadRequestResponse({ description: CONSOLE_REQUIRED_DESCRIPTION })
  @ApiOperation({
    summary:
      'Create the first owner. Fails if one already exists. Sets the session cookie like login, for the console named in X-Ranch-Console.',
  })
  async init(
    @Body() dto: CreateOwnerDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthDto> {
    // The first Owner is signed in to the console the setup page is part of.
    const surface = requireConsole(req);
    const result = await this.initService.createOwner(
      dto.name,
      dto.email,
      dto.password,
      surface,
      userAgentOf(req),
    );
    dropLegacyCookie(req, res, this.sessions);
    res.cookie(
      sessionCookieName(surface),
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
