import { Module, forwardRef } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentAdminTool } from './agentAdmin.tool';
import { IAgentGateway } from './domain/agent.gateway';
import { AgentStatusService } from './domain/agentStatus.service';
import { AgentDeployService } from './domain/agentDeploy.service';
import { DeployTracker } from './domain/deployTracker';
import { AgentStatusChanges } from './domain/agentStatusChanges';
import { AgentGateway } from './data/agent.gateway';
import { AgentMapper } from './data/agent.mapper';
import { WorkflowModule } from '#/workflow/workflow.module';
import { TemplateModule } from '#/agent/template/template.module';
import { PodModule } from '#/agent/pod/pod.module';
import { FileModule } from '#/agent/file/file.module';
import { AuthModule } from '#/user/auth/auth.module';
import { BridleModule } from '#/bridle/bridle.module';
import { AgentLimitModule } from '#/agent/limit/agentLimit.module';
import { McpServerModule } from '#/mcpServer/mcpServer.module';
import { KnowledgeModule } from '#/reins/knowledge/knowledge.module';
import { ConfigModule as KnowledgeConfigModule } from '#/reins/config/config.module';
import { SkillModule } from '#/skill/skill.module';
import { SettingModule } from '#/setting/setting.module';
import { UserModule } from '#/user/user/user.module';

@Module({
  imports: [
    SettingModule,
    WorkflowModule,
    TemplateModule,
    PodModule,
    forwardRef(() => FileModule),
    AuthModule,
    forwardRef(() => BridleModule),
    // Request limits (CLEAN-224): the agent routes apply "a public agent has
    // at least one limit" in the same save that changes visibility.
    forwardRef(() => AgentLimitModule),
    McpServerModule,
    forwardRef(() => KnowledgeModule),
    KnowledgeConfigModule,
    SkillModule,
    // Who created an agent is shown to an Owner or Admin by name (CLEAN-232).
    UserModule,
  ],
  controllers: [AgentController],
  providers: [
    AgentMapper,
    AgentStatusService,
    AgentDeployService,
    DeployTracker,
    AgentStatusChanges,
    AgentAdminTool,
    {
      provide: IAgentGateway,
      useClass: AgentGateway,
    },
  ],
  // AgentPermissionService (who may manage one agent, CLEAN-232) lives in
  // AgentPermissionModule, which is global.
  exports: [IAgentGateway, AgentDeployService, AgentStatusChanges],
})
export class AgentModule {}
