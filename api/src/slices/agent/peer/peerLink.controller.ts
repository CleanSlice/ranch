import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard, Roles, RolesGuard } from '#/user/auth/guards';
import { UserRoleTypes } from '#/user/user/domain';
import { IPeerGateway } from './domain/peer.gateway';
import { AgentLinkDto } from './dtos/agentLink.dto';

/**
 * Every internal agent-to-agent connection of the installation in one read
 * (CLEAN-215). The per-agent route under `agents/:agentId/peers` answers
 * "who can this agent ask"; a map of the whole fleet would need one such
 * request per agent, so this returns the bare pairs for all of them.
 *
 * Owner/Admin only, like the rest of the peer surface: who can delegate to
 * whom is a map of what the installation can do. External connections are
 * left out: the other end is not an agent of this installation and has no
 * place on its map.
 */
@ApiTags('peers')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Missing, malformed or expired console bearer token.',
})
@Controller('agent-links')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
export class PeerLinkController {
  constructor(private readonly peers: IPeerGateway) {}

  @Get()
  @ApiOperation({
    operationId: 'listAgentLinks',
    summary:
      'Internal agent-to-agent connections of the whole installation as ' +
      'directed pairs of agent ids. No card, no credential.',
  })
  @ApiOkResponse({ type: [AgentLinkDto] })
  async list(): Promise<AgentLinkDto[]> {
    const links = await this.peers.listInternalLinks();
    // Rebuilt field by field: a row carries the pair credential, and a
    // spread here would be how it leaves the API.
    return links.map((link) => ({
      agentId: link.agentId,
      peerAgentId: link.peerAgentId,
    }));
  }
}
