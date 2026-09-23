import { Module } from '@nestjs/common';
import { AuthModule } from '#/user/auth/auth.module';
import { McpServerModule } from '../mcpServer.module';
import { SecretModule } from '#/agent/secret/secret.module';
import { BridleModule } from '#/bridle/bridle.module';
import { McpOauthController } from './mcpOauth.controller';
import { McpOauthTool } from './mcpOauth.tool';
import { McpOauthService } from './domain/mcpOauth.service';
import { McpOauthClient } from './data/mcpOauth.client';

@Module({
  imports: [AuthModule, McpServerModule, SecretModule, BridleModule],
  controllers: [McpOauthController],
  // McpOauthTool sits here, not in McpServerModule, so the service stays
  // module-private and no import runs back the other way (CLEAN-109).
  providers: [McpOauthService, McpOauthClient, McpOauthTool],
})
export class McpOauthModule {}
