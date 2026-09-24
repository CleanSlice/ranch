import { Module } from '@nestjs/common';
import { McpServerController } from './mcpServer.controller';
import { McpServerTool } from './mcpServer.tool';
import { McpProbeTool } from './mcpProbe.tool';
import { IMcpServerGateway } from './domain/mcpServer.gateway';
import { McpServerSeeder } from './domain/mcpServer.seeder';
import { AgentMcpResolver } from './domain/agentMcpResolver.service';
import { McpProbeService } from './domain/mcpProbe.service';
import { IMcpProbeConnector } from './domain/mcpProbe.types';
import { McpServerGateway } from './data/mcpServer.gateway';
import { McpServerMapper } from './data/mcpServer.mapper';
import { McpProbeConnector } from './data/mcpProbe.connector';
import { AuthModule } from '#/user/auth/auth.module';
import { TemplateModule } from '#/agent/template/template.module';
import { KnowledgeModule } from '#/reins/knowledge/knowledge.module';
import { ConfigModule as KnowledgeConfigModule } from '#/reins/config/config.module';

@Module({
  // Template and knowledge come in for AgentMcpResolver, which answers which
  // servers an agent gets. None of them imports this module back, so the
  // extra edges add no cycle.
  imports: [AuthModule, TemplateModule, KnowledgeModule, KnowledgeConfigModule],
  controllers: [McpServerController],
  providers: [
    McpServerMapper,
    McpServerSeeder,
    AgentMcpResolver,
    // The chat-side mirror of McpServerController (CLEAN-109). start_mcp_oauth
    // lives in oauth/mcpOauth.tool.ts, because McpOauthModule imports this one.
    McpServerTool,
    // probe_mcp_server (CLEAN-78): the look-before-you-register step. The
    // connector is the SDK half, behind an interface so the service's
    // decisions are tested without a socket.
    McpProbeService,
    McpProbeTool,
    { provide: IMcpProbeConnector, useClass: McpProbeConnector },
    {
      provide: IMcpServerGateway,
      useClass: McpServerGateway,
    },
  ],
  exports: [IMcpServerGateway, AgentMcpResolver],
})
export class McpServerModule {}
