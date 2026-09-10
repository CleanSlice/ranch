import { Module } from '@nestjs/common';
import { AuthModule } from '#/user/auth/auth.module';
import { McpServerModule } from '../mcpServer.module';
import { SecretModule } from '#/agent/secret/secret.module';
import { BridleModule } from '#/bridle/bridle.module';
import { McpOauthController } from './mcpOauth.controller';
import { McpOauthService } from './domain/mcpOauth.service';
import { McpOauthClient } from './data/mcpOauth.client';

@Module({
  imports: [AuthModule, McpServerModule, SecretModule, BridleModule],
  controllers: [McpOauthController],
  providers: [McpOauthService, McpOauthClient],
})
export class McpOauthModule {}
