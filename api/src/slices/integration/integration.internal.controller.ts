import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BridleApiKeyGuard } from '#/bridle/guards/bridleApiKey.guard';
import { IntegrationService } from './domain/integration.service';
import { LoginInstructionDto, ResolvedSecretsDto } from './dtos';

class ResolveSecretsQueryDto {
  @ApiProperty({
    description:
      'Owning user. Trusted only because the bridle key gates this endpoint — the runtime forwards ctx.from from the authenticated chat session.',
  })
  @IsString()
  @MaxLength(80)
  userId: string;

  @ApiPropertyOptional({
    description:
      'Restrict to one catalogue service (e.g. "openai"). Omit to resolve every connected secret-mechanism integration the user has.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  service?: string;
}

class ResolveBrowserStateQueryDto {
  @ApiProperty()
  @IsString()
  @MaxLength(80)
  userId: string;

  @ApiProperty({
    description:
      'Profile identifier — same value passed to `browser_play`. For integration accounts it is composed as `<service>:<accountKey>` (e.g. `instagram:miybot`).',
  })
  @IsString()
  @MaxLength(160)
  profile: string;
}

class ListAccountsQueryDto {
  @ApiProperty({
    description:
      'Identity the runtime is acting on behalf of (ctx.from). Returns every integration this identity owns or is an alias of.',
  })
  @IsString()
  @MaxLength(80)
  userId: string;
}

class RuntimeAccountDto {
  @ApiProperty({ example: 'x' })
  service: string;

  @ApiProperty({ example: 'dimzhuk' })
  accountKey: string;

  @ApiProperty({
    example: 'x:dimzhuk',
    description:
      'Exact value to pass as `profile` to browser_play (browser-mechanism only).',
  })
  profile: string;

  @ApiProperty({ enum: ['browser', 'secret'] })
  mechanism: string;

  @ApiProperty({ enum: ['pending', 'connected', 'needs_login', 'revoked'] })
  status: string;

  @ApiProperty({ type: [String] })
  aliases: string[];
}

class ListAccountsResponseDto {
  @ApiProperty({ type: [RuntimeAccountDto] })
  accounts: RuntimeAccountDto[];
}

class RequestLoginBodyDto {
  @ApiProperty({
    description:
      'Owning user. Trusted only because the bridle key gates this endpoint — the runtime forwards ctx.from from the authenticated chat session.',
  })
  @IsString()
  @MaxLength(80)
  userId: string;

  @ApiProperty({
    description:
      'Catalogue service key the agent wants login instructions for.',
  })
  @IsString()
  @MaxLength(40)
  service: string;

  @ApiProperty({
    description:
      'AccountKey on this integration. Runtime derives it from the `<service>:<accountKey>` profile string the tool was called with.',
  })
  @IsString()
  @MaxLength(80)
  @Matches(/^[a-zA-Z0-9_:.\-]+$/, {
    message:
      'accountKey may only contain alphanumerics, underscore, colon, dot, dash',
  })
  accountKey: string;
}

/**
 * Runtime-facing endpoints. Same trust model as browser.internal.controller.ts:
 * the bridle key gates access, and userId is taken from query params (the
 * runtime forwards it from the authenticated chat session). Never expose
 * these on the public router.
 */
@ApiTags('integrations-internal')
@Controller('integrations/internal')
@UseGuards(BridleApiKeyGuard)
export class IntegrationInternalController {
  constructor(private service: IntegrationService) {}

  @Get('secrets')
  @ApiOperation({
    summary:
      'Resolve a user’s secret-mechanism integrations into a flat env map. Called lazily by the runtime per tool invocation — picks up rotated keys without an agent restart. Multiple accounts on one service: most recently updated wins the bare env var; each one is also exposed under a per-accountKey alias.',
    operationId: 'resolveIntegrationSecrets',
  })
  @ApiOkResponse({ type: ResolvedSecretsDto })
  async resolveSecrets(
    @Query() query: ResolveSecretsQueryDto,
  ): Promise<ResolvedSecretsDto> {
    const env = await this.service.resolveSecretsForRuntime(
      query.userId,
      query.service,
    );
    return { env };
  }

  @Get('accounts')
  @ApiOperation({
    summary:
      'List every integration an identity can act as (owner or alias). The runtime’s integration_list tool exposes this so an agent passes the exact browser_play profile instead of guessing.',
    operationId: 'listIntegrationAccountsForRuntime',
  })
  @ApiOkResponse({ type: ListAccountsResponseDto })
  async listAccounts(
    @Query() query: ListAccountsQueryDto,
  ): Promise<ListAccountsResponseDto> {
    const rows = await this.service.listForIdentity(query.userId);
    return {
      accounts: rows.map((a) => ({
        service: a.service,
        accountKey: a.accountKey,
        profile: `${a.service}:${a.accountKey}`,
        mechanism: a.mechanism,
        status: a.status,
        aliases: a.aliases,
      })),
    };
  }

  @Post('request-login')
  @ApiOperation({
    summary:
      'Resolve login instructions for an (userId, service, accountKey) tuple. The runtime calls this when an agent tool returns `needsLogin` — replaces the legacy VNC mint flow. Creates the IntegrationAccount on the fly if it does not exist yet, sets status to "needs_login", and returns the help URL + site URL the agent should forward to the end user.',
    operationId: 'requestIntegrationLogin',
  })
  @ApiOkResponse({ type: LoginInstructionDto })
  async requestLogin(
    @Body() body: RequestLoginBodyDto,
  ): Promise<LoginInstructionDto> {
    return (await this.service.requestLoginByProfile(
      body.userId,
      body.service,
      body.accountKey,
    )) as LoginInstructionDto;
  }

  @Get('browser-state')
  @ApiOperation({
    summary:
      'Look up the user-level Playwright storageState for a given profile. Runtime hits this when no per-agent state file exists locally — lets a single cookie import cover every agent the user owns. 404 if nothing was imported for this (userId, profile).',
    operationId: 'resolveIntegrationBrowserState',
  })
  async resolveBrowserState(@Query() query: ResolveBrowserStateQueryDto) {
    const payload = await this.service.resolveBrowserState(
      query.userId,
      query.profile,
    );
    if (!payload) throw new NotFoundException('No browser state imported for this profile');
    return payload;
  }
}
