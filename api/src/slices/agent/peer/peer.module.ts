import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '#/user/auth/auth.module';
import { AgentModule } from '#/agent/agent/agent.module';
import { TemplateModule } from '#/agent/template/template.module';
import { SkillModule } from '#/skill/skill.module';
import { KnowledgeModule } from '#/reins/knowledge/knowledge.module';
import { BridleModule } from '#/bridle/bridle.module';
import { SettingModule } from '#/setting/setting.module';
import { IPeerGateway } from './domain/peer.gateway';
import { IDelegationGateway } from './domain/delegation.gateway';
import { AgentCardService } from './domain/agentCard.service';
import { A2aServerService } from './domain/a2a.server.service';
import { A2aTaskStore } from './domain/a2aTask.store';
import { PeerGateway } from './data/peer.gateway';
import { DelegationGateway } from './data/delegation.gateway';
import { PeerMapper } from './data/peer.mapper';
import { DelegationMapper } from './data/delegation.mapper';
import { A2aCardGuard, A2aPeerGuard } from './guards/a2a.guards';
import { A2aClient } from './domain/a2a.client';
import { PeerService } from './domain/peer.service';
import { DelegationService } from './domain/delegation.service';
import { AskAgentTool } from './askAgent.tool';
import { PeerAdminTool } from './peerAdmin.tool';
import { PeerSelfTool } from './peerSelf.tool';
import { A2aController } from './a2a.controller';
import { PeerController } from './peer.controller';

/**
 * Agents talking to agents (CLEAN-74): agent cards, peer connections, the A2A
 * server surface, the `ask_agent` tool and the delegation audit trail.
 *
 * AgentModule is a forwardRef for the same reason ShareLinkModule needs one:
 * AgentModule → BridleModule → … → this module → AgentModule. AuthModule stays
 * plain — it brings the guards for the owner-side controller and is in no cycle.
 */
@Module({
  imports: [
    AuthModule,
    forwardRef(() => AgentModule),
    TemplateModule,
    SkillModule,
    KnowledgeModule,
    forwardRef(() => BridleModule),
    SettingModule,
  ],
  controllers: [A2aController, PeerController],
  providers: [
    PeerMapper,
    DelegationMapper,
    { provide: IPeerGateway, useClass: PeerGateway },
    { provide: IDelegationGateway, useClass: DelegationGateway },
    AgentCardService,
    A2aClient,
    PeerService,
    DelegationService,
    // MCP tool: ask_agent. Discovered by the #mcp registry like every
    // @Tool provider, and listed only for agents that have peers.
    AskAgentTool,
    // MCP tools: the peer set itself, for operator agents only (CLEAN-103).
    PeerAdminTool,
    // MCP tools: any agent, its own colleagues only (CLEAN-105).
    PeerSelfTool,
    A2aTaskStore,
    A2aServerService,
    A2aCardGuard,
    A2aPeerGuard,
  ],
  exports: [AgentCardService, IPeerGateway, IDelegationGateway],
})
export class PeerModule {}
