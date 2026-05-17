import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IBrowserGateway } from './domain';
import {
  BrowserSessionConnectionDto,
  BrowserSessionDto,
  SetStatusDto,
} from './dtos';
import { BridleApiKeyGuard } from '../bridle/guards/bridleApiKey.guard';
import { OpenSessionDto } from './dtos/openSession.dto';
import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

class OpenInternalSessionDto extends OpenSessionDto {
  @ApiProperty({
    description:
      'Owning user. Trusted only because the bridle key gates this endpoint — the runtime forwards ctx.from from the authenticated chat session.',
  })
  @IsString()
  @IsNotEmpty()
  userId: string;
}

class InternalSessionRefDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  userId: string;
}

class InternalSetStatusDto extends SetStatusDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  userId: string;
}

/**
 * Service-to-service endpoints — called by the agent runtime, not by users.
 *
 * Auth: x-bridle-api-key header (the same shared secret the runtime already
 * uses for usage reporting). The runtime then forwards `ctx.from` as userId
 * so the gateway can scope the session to the correct tenant.
 *
 * Trust model: anyone with the bridle key can claim any userId. This is the
 * same trust model as the existing `secret_*` and `memory_*` tools — the
 * runtime is the security boundary, not the API.
 */
@ApiTags('browser')
@Controller('browser/internal/sessions')
@UseGuards(BridleApiKeyGuard)
export class BrowserInternalController {
  constructor(private readonly gateway: IBrowserGateway) {}

  @Post()
  @ApiOperation({
    summary:
      'Open or reuse a session on behalf of a user. Used by the runtime before each browser_play call.',
    operationId: 'openBrowserSessionInternal',
  })
  async open(
    @Body() dto: OpenInternalSessionDto,
  ): Promise<BrowserSessionConnectionDto> {
    return (await this.gateway.openSession(
      dto.userId,
      dto.accountKey,
      dto.loginUrl,
    )) as BrowserSessionConnectionDto;
  }

  @Post(':id/status')
  @ApiOperation({
    summary:
      'Report session status back from the runtime — typically idle after success or needs_login when Instagram redirected to /login.',
    operationId: 'setBrowserSessionStatusInternal',
  })
  async setStatus(
    @Param('id') id: string,
    @Body() dto: InternalSetStatusDto,
  ): Promise<BrowserSessionDto> {
    return (await this.gateway.setStatus(
      dto.userId,
      id,
      dto.status,
    )) as BrowserSessionDto;
  }

  @Post(':id/reset')
  @ApiOperation({
    summary:
      'Hard-reset a stuck session and return a fresh CDP URL on the same profile.',
    operationId: 'resetBrowserSessionInternal',
  })
  async reset(
    @Param('id') id: string,
    @Body() dto: InternalSessionRefDto,
  ): Promise<BrowserSessionConnectionDto> {
    return (await this.gateway.resetSession(
      dto.userId,
      id,
    )) as BrowserSessionConnectionDto;
  }

  @Post('cleanup')
  @ApiOperation({
    summary:
      'Mark sessions idle for longer than `idleMinutes` (default 30) as expired. Called by the browser-pool-cleanup CronJob.',
    operationId: 'cleanupBrowserSessionsInternal',
  })
  async cleanup(
    @Body() body: { idleMinutes?: number } = {},
  ): Promise<{ expired: number }> {
    const expired = await this.gateway.expireIdleSessions(
      body.idleMinutes ?? 30,
    );
    return { expired };
  }
}
