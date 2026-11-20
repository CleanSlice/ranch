import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard, Roles, RolesGuard } from '#/user/auth/guards';
import { UserRoleTypes } from '#/user/user/domain';
import type { Request } from 'express';
import { ManagesAgent } from '#/agent/agent/guards';
import { AgentPermissionService } from '#/agent/agent/domain/agentPermission.service';
import type { IAuthTokenPayload } from '#/user/auth/domain/auth.types';
import { PeerService } from './domain/peer.service';
import { PeerErrorCodes } from './domain/peer.types';
import type { IAgentPeerView } from './domain/peer.types';
import { AgentCardService } from './domain/agentCard.service';
import {
  AgentCardDto,
  AgentDelegationDto,
  AgentPeerCandidateDto,
  AgentPeerDto,
  ConnectPeerDto,
  ListDelegationsQueryDto,
  PeersStateDto,
  PeerVisitorsDto,
  PreviewPeerUrlDto,
} from './dtos';

type ConsoleRequest = Request & { user?: IAuthTokenPayload };

/** The console person behind a request, as `JwtAuthGuard` verified them. */
const callerOf = (req?: ConsoleRequest) =>
  AgentPermissionService.callerOfBearer(req?.user);

/**
 * `IAgentPeerView` and `AgentPeerDto` have the same shape, but the copy is
 * explicit so nothing the domain grows later leaks onto the wire by accident.
 * The field this is really guarding is the pair credential: the service
 * already drops it, and naming every field here means a future change to
 * either side cannot quietly put it back.
 */
function toPeerDto(view: IAgentPeerView): AgentPeerDto {
  return {
    id: view.id,
    agentId: view.agentId,
    peerAgentId: view.peerAgentId,
    origin: view.origin,
    peerName: view.peerName,
    peerStatus: view.peerStatus,
    peerExists: view.peerExists,
    card: view.card,
    cardUrl: view.cardUrl,
    cardReadAt: view.cardReadAt,
    createdAt: view.createdAt,
    visibility: view.visibility,
    createdBy: view.createdBy,
    openToVisitors: view.openToVisitors,
    owner: view.owner,
    needsReview: view.needsReview,
    canRemove: view.canRemove,
    canSetVisitors: view.canSetVisitors,
  };
}

/**
 * The operator side of agent-to-agent (CLEAN-74): look at an agent's own card,
 * see who it can delegate to, connect and disconnect peers, and read the
 * delegation history.
 *
 * Owner/Admin only. `Agent` is deliberately outside this hierarchy: a runtime
 * delegates through its `ask_agent` tool and must never be able to grant
 * itself a new colleague.
 *
 * Every route here is about ONE agent, the one in the path, and all of them
 * are behind the manage rule (CLEAN-232), reads included: the card says what
 * the agent is for, the peer list and the delegation history say whom it
 * asks and what about. For the Ranch admin agent that is the Owner's.
 *
 * A connection has two ends (CLEAN-236). The marker covers the agent in the
 * path. The other end is asked about in `PeerService`, by one rule
 * (`peerAccess.ts`): a connection to an agent of this Ranch exists for a
 * person only when they reach that agent. So the peers and the delegation
 * history listed here are the caller's own view of them, a peer they do not
 * reach cannot be connected, re-read or removed and answers as one that does
 * not exist, and the Ranch admin agent stays the Owner's on either end.
 */
@ApiTags('peers')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Missing, malformed or expired console bearer token.',
})
@ApiNotFoundResponse({ description: 'No agent or connection with this id.' })
@Controller('agents/:agentId')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
@ManagesAgent('agentId')
export class PeerController {
  constructor(
    private readonly peers: PeerService,
    private readonly cards: AgentCardService,
  ) {}

  @Get('card')
  @ApiOperation({
    operationId: 'getAgentCard',
    summary:
      "This agent's own A2A card, exactly as another agent would read it. " +
      'Derived on every request from the name, description, template skills ' +
      'and bound knowledge bases — there is nothing to regenerate.',
  })
  @ApiOkResponse({ type: AgentCardDto })
  async card(@Param('agentId') agentId: string): Promise<AgentCardDto> {
    return this.cards.build(agentId);
  }

  @Get('peers')
  @ApiOperation({
    operationId: 'listAgentPeers',
    summary:
      'Agents this one can delegate to, as the caller may see them, with ' +
      'the card snapshot taken when each was connected or last refreshed. ' +
      'A peer the caller has no access to is absent, unless the connection ' +
      "is open to visitors: then it is listed with visibility 'masked', " +
      'skills only. Directed: this never lists the agents that can ' +
      'delegate TO this one.',
  })
  @ApiOkResponse({ type: [AgentPeerDto] })
  async list(
    @Param('agentId') agentId: string,
    @Req() req?: ConsoleRequest,
  ): Promise<AgentPeerDto[]> {
    return (await this.peers.list(agentId, callerOf(req))).map(toPeerDto);
  }

  @Get('peers/candidates')
  @ApiOperation({
    operationId: 'listAgentPeerCandidates',
    summary:
      'Every other agent of this installation the caller has access to, ' +
      'each marked with whether it is already a peer. Excludes the agent ' +
      'itself. These are exactly the agents POST peers accepts.',
  })
  @ApiOkResponse({ type: [AgentPeerCandidateDto] })
  async candidates(
    @Param('agentId') agentId: string,
    @Req() req?: ConsoleRequest,
  ): Promise<AgentPeerCandidateDto[]> {
    return this.peers.candidates(agentId, callerOf(req));
  }

  @Post('peers')
  @ApiOperation({
    operationId: 'connectAgentPeer',
    summary:
      'Connect a peer. Either `peerAgentId` (another agent of this ' +
      'installation — mints a pair credential and reads the card with it) or ' +
      '`url` (an external A2A agent imported by address, optionally with a ' +
      'credential; re-importing the same address updates the entry in ' +
      'place). Nothing is kept if the card cannot be read. The agent picks ' +
      'the tool up on its next restart. With `peerAgentId` the caller must ' +
      'have access to that agent: one they do not answers 404, like one ' +
      'that does not exist.',
  })
  @ApiOkResponse({ type: AgentPeerDto })
  @ApiConflictResponse({ description: 'Already a peer of this agent.' })
  @ApiBadGatewayResponse({
    description: "The peer's card could not be read; nothing was saved.",
  })
  async connect(
    @Param('agentId') agentId: string,
    @Body() body: ConnectPeerDto,
    @Req() req?: ConsoleRequest,
  ): Promise<AgentPeerDto> {
    const given = [body.peerAgentId, body.url, body.card].filter(Boolean);
    if (given.length !== 1) {
      throw new BadRequestException({
        code: PeerErrorCodes.Body,
        message: 'Provide exactly one of `peerAgentId`, `url` or `card`',
      });
    }
    // The guard checked the agent in the path. The other end comes in the
    // body and is asked about in PeerService: an agent the caller does not
    // reach gets the answer of one that does not exist.
    const caller = callerOf(req);
    const view = body.card
      ? await this.peers.connectByCard(agentId, body.card, body.token, caller)
      : body.url
        ? await this.peers.connectByUrl(agentId, body.url, body.token, caller)
        : await this.peers.connect(agentId, body.peerAgentId!, caller);
    return toPeerDto(view);
  }

  @Post('peers/preview')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'previewAgentPeerUrl',
    summary:
      "Read an external agent's card without saving anything — the preview " +
      'an operator reviews before Connect. The same validation the import ' +
      'runs: canonical address, protocol version, own-installation refusal.',
  })
  @ApiOkResponse({ type: AgentCardDto })
  @ApiBadGatewayResponse({
    description: 'The address could not be reached; nothing was saved.',
  })
  async previewPeerUrl(
    @Param('agentId') agentId: string,
    @Body() body: PreviewPeerUrlDto,
  ): Promise<AgentCardDto> {
    if (Boolean(body.url) === Boolean(body.card)) {
      throw new BadRequestException({
        code: PeerErrorCodes.Body,
        message: 'Provide exactly one of `url` or `card`',
      });
    }
    return body.card
      ? this.peers.previewCard(agentId, body.card)
      : this.peers.previewByUrl(agentId, body.url!, body.token);
  }

  @Get('peers/state')
  @ApiOperation({
    operationId: 'getAgentPeersState',
    summary:
      'Whether the running pod has loaded the current peer set. A pod reads ' +
      'its tool list once at boot, so connecting or removing a peer leaves ' +
      'this false ("pending restart") until the agent comes back up.',
  })
  @ApiOkResponse({ type: PeersStateDto })
  async peersState(@Param('agentId') agentId: string): Promise<PeersStateDto> {
    return this.peers.peersState(agentId);
  }

  @Post('peers/:peerId/refresh')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'refreshAgentPeer',
    summary:
      "Re-read the peer's card and replace the stored snapshot. A failed " +
      'read keeps the old snapshot: stale is better than nothing.',
  })
  @ApiOkResponse({ type: AgentPeerDto })
  @ApiBadGatewayResponse({
    description: "The peer's card could not be read; the old snapshot is kept.",
  })
  @ApiForbiddenResponse({
    description:
      'The caller is shown this connection masked and may not re-read it.',
  })
  async refresh(
    @Param('agentId') agentId: string,
    @Param('peerId') peerId: string,
    @Req() req?: ConsoleRequest,
  ): Promise<AgentPeerDto> {
    return toPeerDto(await this.peers.refresh(agentId, peerId, callerOf(req)));
  }

  @Put('peers/:peerId/visitors')
  @ApiOperation({
    operationId: 'setAgentPeerVisitors',
    summary:
      'Open a connection to visitors, or close it. Open, the peer serves ' +
      'everybody who talks to this agent, people with no access to the peer ' +
      'and visitors included, and is shown to them without its name. ' +
      'Internal peers only, and only for a caller who manages both agents: ' +
      'otherwise 404, like a connection that does not exist. Opening needs ' +
      '`confirm: true`.',
  })
  @ApiOkResponse({ type: AgentPeerDto })
  @ApiConflictResponse({
    description: 'Opening without `confirm: true`; nothing was changed.',
  })
  async setVisitors(
    @Param('agentId') agentId: string,
    @Param('peerId') peerId: string,
    @Body() body: PeerVisitorsDto,
    @Req() req?: ConsoleRequest,
  ): Promise<AgentPeerDto> {
    if (body.open && body.confirm !== true) {
      throw new ConflictException({
        code: PeerErrorCodes.VisitorsNeedsConfirm,
        message:
          'Opening a peer to visitors lets everybody who talks to this ' +
          'agent be served by it. Send confirm: true to go ahead.',
      });
    }
    return toPeerDto(
      await this.peers.setVisitors(agentId, peerId, body.open, callerOf(req)),
    );
  }

  @Delete('peers/:peerId')
  @HttpCode(204)
  @ApiOperation({
    operationId: 'removeAgentPeer',
    summary:
      'Disconnect a peer. This revokes the credential issued for the pair — ' +
      'there is no other copy of it — so the connection cannot be used again.',
  })
  @ApiNoContentResponse({ description: 'Disconnected.' })
  @ApiForbiddenResponse({
    description:
      'The caller is shown this connection masked and did not make it.',
  })
  async remove(
    @Param('agentId') agentId: string,
    @Param('peerId') peerId: string,
    @Req() req?: ConsoleRequest,
  ): Promise<void> {
    await this.peers.remove(agentId, peerId, callerOf(req));
  }

  @Get('delegations')
  @ApiOperation({
    operationId: 'listAgentDelegations',
    summary:
      'Recent tasks this agent handed to its peers, newest first: who was ' +
      'asked, why, how long it took and how it ended. A task handed to a ' +
      'peer the caller has no access to is absent; through a connection ' +
      'open to visitors it is listed without the peer and without its reply.',
  })
  @ApiOkResponse({ type: [AgentDelegationDto] })
  async recentDelegations(
    @Param('agentId') agentId: string,
    @Query() query: ListDelegationsQueryDto,
    @Req() req?: ConsoleRequest,
  ): Promise<AgentDelegationDto[]> {
    return this.peers.recentDelegations(
      agentId,
      callerOf(req),
      query.limit ?? 20,
    );
  }
}
