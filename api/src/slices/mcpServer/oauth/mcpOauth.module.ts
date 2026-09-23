import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '#/user/auth/auth.module';
import { McpServerModule } from '../mcpServer.module';
import { SecretModule } from '#/agent/secret/secret.module';
import { BridleModule } from '#/bridle/bridle.module';
import { AgentModule } from '#/agent/agent/agent.module';
import { McpOauthController } from './mcpOauth.controller';
import { McpOauthTool } from './mcpOauth.tool';
import { McpOauthService } from './domain/mcpOauth.service';
import { McpOauthClient } from './data/mcpOauth.client';

@Module({
  // AgentModule only for the sweep's "every agent" listing (CLEAN-80);
  // forwardRef the way BridleModule reaches it, since AgentModule's own
  // graph runs back through bridle.
  imports: [
    AuthModule,
    McpServerModule,
    SecretModule,
    BridleModule,
    forwardRef(() => AgentModule),
  ],
  controllers: [McpOauthController],
  // McpOauthTool sits here, not in McpServerModule, so the service stays
  // module-private and no import runs back the other way (CLEAN-109).
  providers: [McpOauthService, McpOauthClient, McpOauthTool],
})
export class McpOauthModule {}
