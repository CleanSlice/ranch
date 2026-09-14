import { Module } from '@nestjs/common';
import { McpServerController } from './mcpServer.controller';
import { IMcpServerGateway } from './domain/mcpServer.gateway';
import { McpServerSeeder } from './domain/mcpServer.seeder';
import { AgentMcpResolver } from './domain/agentMcpResolver.service';
import { McpServerGateway } from './data/mcpServer.gateway';
import { McpServerMapper } from './data/mcpServer.mapper';
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
    {
      provide: IMcpServerGateway,
      useClass: McpServerGateway,
    },
  ],
  exports: [IMcpServerGateway, AgentMcpResolver],
})
export class McpServerModule {}
