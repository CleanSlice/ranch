import {
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '#/user/auth/guards';
import { IAuthTokenPayload } from '#/user/auth/domain/auth.types';
import { IShareLinkState, ShareLinkService } from './domain';
import { ShareLinkDto } from './dtos';

type AuthedRequest = Request & { user?: IAuthTokenPayload };

/** Belt-and-braces 403 from `requireSub` — documented so the generated client
 *  does not treat it as an undocumented failure mode. */
const NO_SUBJECT_DESCRIPTION =
  'The bearer token carried no subject, so there is no user to record as the ' +
  'actor for this write.';

/** `IShareLinkState` and `ShareLinkDto` have the same shape, but the copy is
 *  explicit so nothing the domain grows later leaks onto the wire by accident. */
function toShareLinkDto(state: IShareLinkState): ShareLinkDto {
  return {
    active: state.active,
    token: state.token,
    createdAt: state.createdAt,
    revokedAt: state.revokedAt,
    rotatedAt: state.rotatedAt,
    rotationCount: state.rotationCount,
  };
}

/**
 * Owner side of agent sharing (CLEAN-66): read, create, rotate and revoke the
 * public link for one agent.
 *
 * JWT only, no role restriction — any authenticated console user who can open
 * an agent can share it. The visitor side lives in `ShareController` and is
 * deliberately unguarded.
 */
@ApiTags('share-links')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Missing, malformed or expired console bearer token.',
})
@ApiNotFoundResponse({ description: 'No agent with this id.' })
@Controller('agents/:agentId/share-link')
@UseGuards(JwtAuthGuard)
export class ShareLinkController {
  constructor(private readonly shareLinks: ShareLinkService) {}

  @Get()
  @ApiOperation({
    operationId: 'getAgentShareLink',
    summary:
      "Current state of the agent's share link. Returns active: false with " +
      'every field null when the agent was never shared or the link has been ' +
      'revoked — the token is only ever exposed while the link is active. ' +
      '404 when the agent does not exist.',
  })
  @ApiOkResponse({ type: ShareLinkDto })
  async get(@Param('agentId') agentId: string): Promise<ShareLinkDto> {
    return toShareLinkDto(await this.shareLinks.getState(agentId));
  }

  @Post()
  @HttpCode(200)
  @ApiOperation({
    operationId: 'createAgentShareLink',
    summary:
      'Share the agent. Idempotent: an already active link is returned ' +
      'unchanged (same token), so pressing Share twice never invalidates a ' +
      'link that is already in circulation. A fresh token is minted when the ' +
      'agent has never been shared or the previous link was revoked. 404 ' +
      'when the agent does not exist. 200, not 201: the usual outcome is an ' +
      'existing link handed back, and the operation is idempotent.',
  })
  @ApiOkResponse({ type: ShareLinkDto })
  @ApiForbiddenResponse({ description: NO_SUBJECT_DESCRIPTION })
  async create(
    @Param('agentId') agentId: string,
    @Req() req: AuthedRequest,
  ): Promise<ShareLinkDto> {
    return toShareLinkDto(
      await this.shareLinks.share(agentId, this.requireSub(req)),
    );
  }

  @Post('regenerate')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'regenerateAgentShareLink',
    summary:
      'Replace the token with one that has never been valid before. The ' +
      'previous token stops working in the same write, so anyone holding the ' +
      'old link loses access immediately. Revives a revoked link. 404 when ' +
      'the agent does not exist.',
  })
  @ApiOkResponse({ type: ShareLinkDto })
  @ApiForbiddenResponse({ description: NO_SUBJECT_DESCRIPTION })
  async regenerate(
    @Param('agentId') agentId: string,
    @Req() req: AuthedRequest,
  ): Promise<ShareLinkDto> {
    return toShareLinkDto(
      await this.shareLinks.regenerate(agentId, this.requireSub(req)),
    );
  }

  @Delete()
  @HttpCode(200)
  @ApiOperation({
    operationId: 'revokeAgentShareLink',
    summary:
      'Stop sharing the agent. Returns the link with active: false and ' +
      'token: null; visitors are cut off on their very next request, with no ' +
      'cached decision anywhere. Idempotent — revoking twice, or an agent ' +
      'that was never shared, is still 200. 404 when the agent does not exist.',
  })
  @ApiOkResponse({ type: ShareLinkDto })
  @ApiForbiddenResponse({ description: NO_SUBJECT_DESCRIPTION })
  async revoke(
    @Param('agentId') agentId: string,
    @Req() req: AuthedRequest,
  ): Promise<ShareLinkDto> {
    return toShareLinkDto(
      await this.shareLinks.revoke(agentId, this.requireSub(req)),
    );
  }

  /** JwtAuthGuard guarantees `req.user`; this is the belt-and-braces read so
   *  a missing sub can never reach the service as `undefined`. */
  private requireSub(req: AuthedRequest): string {
    const sub = req.user?.sub;
    if (!sub) throw new ForbiddenException('No authenticated user');
    return sub;
  }
}
