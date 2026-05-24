import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { IAuthTokenPayload } from '../user/auth/domain/auth.types';
import { JwtAuthGuard } from '../user/auth/guards';
import { IntegrationService } from './domain/integration.service';
import {
  CatalogueItemDto,
  ConnectIntegrationDto,
  ImportCookiesDto,
  IntegrationAccountDto,
  LoginInstructionDto,
  SaveSecretDto,
} from './dtos';

@ApiTags('integrations')
@ApiBearerAuth()
@Controller('integrations')
@UseGuards(JwtAuthGuard)
export class IntegrationController {
  constructor(private service: IntegrationService) {}

  @Get('catalogue')
  @ApiOperation({
    summary:
      'List supported services. Static — defined in api/src/slices/integration/domain/catalogue.ts and shipped with each API release.',
    operationId: 'listIntegrationCatalogue',
  })
  @ApiOkResponse({ type: [CatalogueItemDto] })
  catalogue(): CatalogueItemDto[] {
    return this.service.listCatalogue() as CatalogueItemDto[];
  }

  @Get('accounts')
  @ApiOperation({
    summary: 'List the calling user’s connected integration accounts.',
    operationId: 'listIntegrationAccounts',
  })
  @ApiOkResponse({ type: [IntegrationAccountDto] })
  async listAccounts(
    @Req() req: Request & { user: IAuthTokenPayload },
  ): Promise<IntegrationAccountDto[]> {
    return (await this.service.listAccounts(
      req.user.sub,
    )) as IntegrationAccountDto[];
  }

  @Post('accounts')
  @ApiOperation({
    summary:
      'Start (or re-open) a connection. Idempotent on (userId, service, accountKey) — repeated calls return the existing row. Status stays "pending" until the underlying credential is stored (browser cookies harvested or secret value saved).',
    operationId: 'connectIntegration',
  })
  @ApiOkResponse({ type: IntegrationAccountDto })
  async connect(
    @Body() dto: ConnectIntegrationDto,
    @Req() req: Request & { user: IAuthTokenPayload },
  ): Promise<IntegrationAccountDto> {
    return (await this.service.connect(
      req.user.sub,
      dto.service,
      dto.accountKey,
      dto.label,
    )) as IntegrationAccountDto;
  }

  @Get('accounts/:id')
  @ApiOperation({
    summary:
      'Fetch one account. Refreshes status from the underlying BrowserSession before returning. 404 if not owned by the caller.',
    operationId: 'getIntegrationAccount',
  })
  @ApiOkResponse({ type: IntegrationAccountDto })
  async get(
    @Param('id') id: string,
    @Req() req: Request & { user: IAuthTokenPayload },
  ): Promise<IntegrationAccountDto> {
    return (await this.service.getAccount(
      req.user.sub,
      id,
    )) as IntegrationAccountDto;
  }

  @Post('accounts/:id/login')
  @ApiOperation({
    summary:
      'Return the help URL + login URL + textual instructions the agent forwards to the end user. Browser-mechanism only. No VNC — the user logs in inside their own Chrome and pushes cookies via the Ranch extension. Flips status to "needs_login" so the admin UI reflects the pending state.',
    operationId: 'openIntegrationLogin',
  })
  @ApiOkResponse({ type: LoginInstructionDto })
  async openLogin(
    @Param('id') id: string,
    @Req() req: Request & { user: IAuthTokenPayload },
  ): Promise<LoginInstructionDto> {
    return (await this.service.openLogin(
      req.user.sub,
      id,
    )) as LoginInstructionDto;
  }

  @Post('accounts/:id/import-cookies')
  @ApiOperation({
    summary:
      'Alternative to VNC login: accept a Playwright storageState dump that the user harvested from their own browser. The runtime falls back to this state when no per-agent state file exists, so one import covers every agent the user owns. Browser-mechanism only.',
    operationId: 'importIntegrationCookies',
  })
  @ApiOkResponse({ type: IntegrationAccountDto })
  async importCookies(
    @Param('id') id: string,
    @Body() dto: ImportCookiesDto,
    @Req() req: Request & { user: IAuthTokenPayload },
  ): Promise<IntegrationAccountDto> {
    return (await this.service.importCookies(
      req.user.sub,
      id,
      dto.cookies,
      dto.origins as never,
      dto.userAgent,
    )) as IntegrationAccountDto;
  }

  @Post('accounts/:id/secret')
  @ApiOperation({
    summary:
      'Write the credential value for a secret-mechanism account. Idempotent — repeated calls overwrite (rotation). The value is never echoed back through the API.',
    operationId: 'saveIntegrationSecret',
  })
  @ApiOkResponse({ type: IntegrationAccountDto })
  async saveSecret(
    @Param('id') id: string,
    @Body() dto: SaveSecretDto,
    @Req() req: Request & { user: IAuthTokenPayload },
  ): Promise<IntegrationAccountDto> {
    return (await this.service.saveSecret(
      req.user.sub,
      id,
      dto.value,
    )) as IntegrationAccountDto;
  }

  @Delete('accounts/:id')
  @ApiOperation({
    summary:
      'Disconnect an integration. Browser-mechanism: also deletes the underlying BrowserSession (profile cleanup runs on its own CronJob). Secret-mechanism: also wipes the stored value from the per-user secret store.',
    operationId: 'disconnectIntegration',
  })
  @HttpCode(204)
  async disconnect(
    @Param('id') id: string,
    @Req() req: Request & { user: IAuthTokenPayload },
  ): Promise<void> {
    await this.service.disconnect(req.user.sub, id);
  }
}
