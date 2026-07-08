import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

// Setup slices
import { PrismaModule } from './slices/setup/prisma/prisma.module';
import { HealthModule } from './slices/setup/health/health.module';
import { InitModule } from './slices/setup/init/init.module';

// Feature slices
import { AgentModule } from './slices/agent/agent/agent.module';
import { AgentChannelModule } from './slices/agent/agentChannel/agentChannel.module';
import { TemplateModule } from './slices/agent/template/template.module';
import { TemplateFileModule } from './slices/agent/templateFile/templateFile.module';
import { TemplateInstallModule } from './slices/agent/templateInstall/templateInstall.module';
import { FileModule } from './slices/agent/file/file.module';
import { SecretModule } from './slices/agent/secret/secret.module';
import { WorkflowModule } from './slices/workflow/workflow.module';
import { LogModule } from './slices/log/log.module';
import { UserModule } from './slices/user/user/user.module';
import { AuthModule } from './slices/user/auth/auth.module';
import { ApiKeyModule } from './slices/user/apiKey/apiKey.module';
import { SettingModule } from './slices/setting/setting.module';
import { BridleModule } from './slices/bridle/bridle.module';
import { LlmModule } from './slices/llm/llm.module';
import { UsageModule } from './slices/usage/usage.module';
import { KnowledgeModule } from './slices/reins/knowledge/knowledge.module';
import { SourceModule } from './slices/reins/source/source.module';
import { SkillModule } from './slices/skill/skill.module';
import { RancherModule } from './slices/rancher/rancher.module';
import { UpgradeModule } from './slices/upgrade/upgrade.module';
import { McpServerModule } from './slices/mcpServer/mcpServer.module';
import { McpModule } from './slices/mcp';
import { PaddockModule } from './slices/paddock/paddock.module';
import { BrowserModule } from './slices/browser/browser.module';
import { RlmModule } from './slices/rlm/rlm.module';
import { JwtAuthGuard } from './slices/user/auth/guards';
import { IntegrationModule } from './slices/integration/integration.module';
import { UserSecretModule } from './slices/user/secret/secret.module';
import { UserBrowserStateModule } from './slices/user/browserState/browserState.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: `.env.${process.env.NODE_ENV || 'dev'}`,
    }),

    // Setup slices
    PrismaModule,
    HealthModule,
    InitModule,

    // Feature slices
    WorkflowModule,
    TemplateModule,
    TemplateFileModule,
    TemplateInstallModule,
    AgentModule,
    AgentChannelModule,
    FileModule,
    SecretModule,
    LogModule,
    UserModule,
    AuthModule,
    ApiKeyModule,
    SettingModule,
    BridleModule,
    LlmModule,
    UsageModule,
    KnowledgeModule,
    SourceModule,
    SkillModule,
    RancherModule,
    UpgradeModule,
    McpServerModule,
    PaddockModule,
    BrowserModule,
    RlmModule,
    UserSecretModule,
    UserBrowserStateModule,
    IntegrationModule,
    McpModule.forRoot({
      name: 'ranch',
      version: '1.0.0',
      sseEndpoint: 'mcp/sse',
      messagesEndpoint: 'mcp/messages',
      mcpEndpoint: 'mcp/mcp',
      guards: [JwtAuthGuard],
      // Stateful streamable-http: clients send `initialize`, get an
      // `Mcp-Session-Id`, then route subsequent calls to that session.
      // The module default is stateless, which breaks the standard MCP
      // SDK client used by the agent runtime - it expects a session id
      // after initialize and otherwise treats the connection as
      // uninitialized. Safe while ranch-api is a single replica;
      // horizontal scaling would need session affinity at the ingress.
      streamableHttp: {
        statelessMode: false,
        enableJsonResponse: true,
      },
    }),
  ],
})
export class AppModule {}
