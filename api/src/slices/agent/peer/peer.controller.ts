import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard, Roles, RolesGuard } from '#/user/auth/guards';
import { UserRoleTypes } from '#/user/user/domain';
import { PeerService } from './domain/peer.service';
import type { IAgentPeerView } from './domain/peer.types';
import { AgentCardService } from './domain/agentCard.service';
import { IDelegationGateway } from './domain/delegation.gateway';
import {
  AgentCardDto,
  AgentDelegationDto,
  AgentPeerCandidateDto,
  AgentPeerDto,
  ConnectPeerDto,
  ListDelegationsQueryDto,
} from './dtos';

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
    peerName: view.peerName,
    peerStatus: view.peerStatus,
    peerExists: view.peerExists,
    card: view.card,
    cardUrl: view.cardUrl,
    cardReadAt: view.cardReadAt,
    createdAt: view.createdAt,
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
export class PeerController {
  constructor(
    private readonly peers: PeerService,
    private readonly cards: AgentCardService,
    private readonly delegations: IDelegationGateway,
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
      'Agents this one can delegate to, with the card snapshot taken when ' +
      'each was connected or last refreshed. Directed: this never lists the ' +
      'agents that can delegate TO this one.',
  })
  @ApiOkResponse({ type: [AgentPeerDto] })
  async list(@Param('agentId') agentId: string): Promise<AgentPeerDto[]> {
    return (await this.peers.list(agentId)).map(toPeerDto);
  }

  @Get('peers/candidates')
  @ApiOperation({
    operationId: 'listAgentPeerCandidates',
    summary:
      'Every other agent of this installation, each marked with whether it ' +
      'is already a peer. Excludes the agent itself.',
  })
  @ApiOkResponse({ type: [AgentPeerCandidateDto] })
  async candidates(
    @Param('agentId') agentId: string,
  ): Promise<AgentPeerCandidateDto[]> {
    return this.peers.candidates(agentId);
  }

  @Post('peers')
  @ApiOperation({
    operationId: 'connectAgentPeer',
    summary:
      "Connect another agent as a peer: mints a credential for this pair, " +
      'reads the peer card with it, and stores the snapshot. Nothing is kept ' +
      'if the card cannot be read, so a saved connection always works. The ' +
      'agent picks the tool up on its next restart.',
  })
  @ApiOkResponse({ type: AgentPeerDto })
  @ApiConflictResponse({ description: 'Already a peer of this agent.' })
  @ApiBadGatewayResponse({
    description: "The peer's card could not be read; nothing was saved.",
  })
  async connect(
    @Param('agentId') agentId: string,
    @Body() body: ConnectPeerDto,
  ): Promise<AgentPeerDto> {
    return toPeerDto(await this.peers.connect(agentId, body.peerAgentId));
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
  async refresh(
    @Param('agentId') agentId: string,
    @Param('peerId') peerId: string,
  ): Promise<AgentPeerDto> {
    return toPeerDto(await this.peers.refresh(agentId, peerId));
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
  async remove(
    @Param('agentId') agentId: string,
    @Param('peerId') peerId: string,
  ): Promise<void> {
    await this.peers.remove(agentId, peerId);
  }

  @Get('delegations')
  @ApiOperation({
    operationId: 'listAgentDelegations',
    summary:
      'Recent tasks this agent handed to its peers, newest first: who was ' +
      'asked, why, how long it took and how it ended.',
  })
  @ApiOkResponse({ type: [AgentDelegationDto] })
  async recentDelegations(
    @Param('agentId') agentId: string,
    @Query() query: ListDelegationsQueryDto,
  ): Promise<AgentDelegationDto[]> {
    return this.delegations.listRecent(agentId, query.limit ?? 20);
  }
}
