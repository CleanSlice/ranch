import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';

// Setup slices
import { PrismaModule } from './slices/setup/prisma/prisma.module';
import { HealthModule } from './slices/setup/health/health.module';
import { InitModule } from './slices/setup/init/init.module';

// Feature slices
import { AgentModule } from './slices/agent/agent/agent.module';
import { AgentPermissionModule } from './slices/agent/agent/agentPermission.module';
import { AgentManageGuard } from './slices/agent/agent/guards';
import { AssistantBuildModule } from './slices/agent/assistantBuild/assistantBuild.module';
import { AssistantBuildGuard } from './slices/agent/assistantBuild/guards';
import { AgentPinModule } from './slices/agent/pin/agentPin.module';
import { AgentAccessModule } from './slices/user/agentAccess/agentAccess.module';
import { AssistantAccessModule } from './slices/user/assistantAccess/assistantAccess.module';
import { AgentAccessGuard } from './slices/user/agentAccess/guards';
import { AgentChannelModule } from './slices/agent/agentChannel/agentChannel.module';
import { ShareLinkModule } from './slices/agent/shareLink/shareLink.module';
import { AgentLimitModule } from './slices/agent/limit/agentLimit.module';
import { PeerModule } from './slices/agent/peer/peer.module';
import { AgentEventModule } from './slices/agent/event/agentEvent.module';
import { ToolCatalogModule } from './slices/agent/toolCatalog/toolCatalog.module';
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
import { SessionModule } from './slices/user/session/session.module';
import { SettingModule } from './slices/setting/setting.module';
import { BridleModule } from './slices/bridle/bridle.module';
import { LlmModule } from './slices/llm/llm.module';
import { UsageModule } from './slices/usage/usage.module';
import { ChatModule } from './slices/chat/chat.module';
import { StatsModule } from './slices/stats/stats.module';
import { KnowledgeModule } from './slices/reins/knowledge/knowledge.module';
import { SourceModule } from './slices/reins/source/source.module';
import { MigrationModule } from './slices/reins/migration/migration.module';
import { SkillModule } from './slices/skill/skill.module';
import { RancherModule } from './slices/rancher/rancher.module';
import { UpgradeModule } from './slices/upgrade/upgrade.module';
import { McpServerModule } from './slices/mcpServer/mcpServer.module';
import { McpOauthModule } from './slices/mcpServer/oauth/mcpOauth.module';
import { McpModule } from './slices/mcp';
import { PaddockModule } from './slices/paddock/paddock.module';
import { BrowserModule } from './slices/browser/browser.module';
import {
  AnyBearer,
  JwtAuthGuard,
  Roles,
  RolesGuard,
} from './slices/user/auth/guards';
import { UserRoleTypes } from './slices/user/user/domain';
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
    AgentPermissionModule,
    AssistantBuildModule,
    AgentAccessModule,
    AssistantAccessModule,
    AgentPinModule,
    AgentChannelModule,
    ShareLinkModule,
    AgentLimitModule,
    PeerModule,
    AgentEventModule,
    ToolCatalogModule,
    FileModule,
    SecretModule,
    LogModule,
    UserModule,
    AuthModule,
    ApiKeyModule,
    SessionModule,
    SettingModule,
    BridleModule,
    LlmModule,
    UsageModule,
    ChatModule,
    StatsModule,
    KnowledgeModule,
    SourceModule,
    MigrationModule,
    SkillModule,
    RancherModule,
    UpgradeModule,
    McpServerModule,
    McpOauthModule,
    PaddockModule,
    BrowserModule,
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
      // Every authenticated bearer, a person of any role or an agent runtime
      // (CLEAN-232). Without it the endpoints would fall to the Admin default
      // of the global RolesGuard and no agent could reach its tools. What a
      // caller may then list and call is decided per tool, for the party the
      // call is made for.
      decorators: [AnyBearer()],
      // The session diagnostics list every live MCP session id. Stated on
      // the handler, so it wins over the class's @AnyBearer: operators only.
      diagnosticDecorators: [Roles(UserRoleTypes.Admin)],
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
  providers: [
    // Deny by default (CLEAN-175). Until this existed, JwtAuthGuard was only
    // ever attached per controller with @UseGuards, and 18 of 43 controllers
    // never attached it, so /settings, /llms, /knowledges and the rest
    // answered anonymous callers in full over the public ingress. @Public()
    // is the only way back out; publicRoutes.spec.ts pins every use. The
    // guard short-circuits on that metadata before reading the header, and it
    // is the only guard that consults it: @Public() on a route that also
    // carries ApiKeyGuard, BridleApiKeyGuard or a peer guard drops the JWT
    // requirement alone; those guards still run and still reject.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // A role on every route (CLEAN-232). JwtAuthGuard above says who is
    // calling; this says whether they may. Order matters: global guards run
    // in registration order, and RolesGuard reads the req.user the first one
    // sets. A route with no @Roles asks for Admin, so a route nobody thought
    // about is closed to a User and to an agent runtime, where it used to be
    // open to any valid token. An agent's token is an Agent here whatever
    // roles it carries. @Public() routes are skipped, which covers every
    // machine-guarded route. userRoutes.spec.ts and agentRoutes.spec.ts pin
    // what a role opens below Admin.
    { provide: APP_GUARD, useClass: RolesGuard },
    // For which agent (CLEAN-232). Acts only on routes marked
    // @ManagesAgent(...): the caller must be allowed to manage the agent the
    // route names, or the answer is the 404 an unknown agent gets. Last of
    // the three, because it reads the bearer the first one verified.
    { provide: APP_GUARD, useClass: AgentManageGuard },
    // Which agents (CLEAN-231). Acts only on routes marked @AgentScoped(...):
    // a person whose access lists hide the agent the route names gets the
    // 404 an unknown agent gets. The management routes above already ask
    // the same lists through canManage; this covers the reads that are not
    // management. agentScopedRoutes.spec.ts pins that every route naming an
    // agent carries one of the two markers or a stated exemption.
    { provide: APP_GUARD, useClass: AgentAccessGuard },
    // What the Ranch assistant is built from (CLEAN-271). Acts only on
    // routes marked @ChangesAssistantIngredient(kind, param): a write to a
    // template, skill, tool server, model credential or knowledge base the
    // assistant is built from is the Owner's, and anybody else gets a 403
    // with code ASSISTANT_BUILT_FROM. assistantBuildRoutes.spec.ts pins that
    // every writing route of those slices carries the marker, asks the rule
    // in its method, or is exempt with a reason.
    { provide: APP_GUARD, useClass: AssistantBuildGuard },
  ],
})
export class AppModule {}
