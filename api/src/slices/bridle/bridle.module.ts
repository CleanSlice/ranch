import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { BridleController } from './bridle.controller';
import { BridleAttachmentTool } from './attachment.tool';
import { BridleClientWsHandler, BridleAgentWsHandler } from './handlers';
import {
  IBridleGateway,
  IBridleAttachmentGateway,
  BridleAttachmentService,
} from './domain';
import { BridleGateway, BridleAttachmentGateway } from './data';
import { BridleApiKeyGuard } from './guards/bridleApiKey.guard';
import { BridleChatAuthGuard } from './guards/bridleChatAuth.guard';
import { FileModule } from '#/agent/file/file.module';
import { AgentModule } from '#/agent/agent/agent.module';
import { ChatModule } from '#/chat/chat.module';
import { S3Module } from '#/aws/s3';
import { SettingModule } from '#/setting/setting.module';
import { ShareLinkModule } from '#/agent/shareLink/shareLink.module';

/**
 * Bridle Module — authenticated hub between browsers and agents.
 *
 * Agents connect via /ws/agent (auth: apiKey + agentId).
 * Browsers connect via /ws/client (auth: JWT token + agentId).
 * Multiple agents can connect simultaneously — each scoped by agentId.
 *
 * Usage:
 *
 * ```ts
 * import { BridleModule } from 'bridle/nestjs'
 *
 * @Module({
 *   imports: [BridleModule],
 * })
 * export class AppModule {}
 * ```
 *
 * Requires:
 *   - ConfigModule (for BRIDLE_API_KEY)
 *   - JwtModule (for browser JWT verification)
 *
 * WebSocket endpoints:
 *   /ws/agent  — agent connection (apiKey + agentId)
 *   /ws/client   — browser client connection (JWT + agentId)
 *
 * HTTP endpoints:
 *   POST /api/agent/:agentId/message       — fire & forget
 *   POST /api/agent/:agentId/message/sync  — synchronous (120s timeout)
 *   GET  /api/agent/health               — overall hub status
 *   GET  /api/agent/:agentId/health        — per-agent status
 *   POST /api/agent/:agentId/attachment    — upload an attachment (JWT or share headers)
 *   GET  /api/agent/:agentId/attachment/:id — download it back (JWT or share headers)
 */
@Module({
  imports: [
    ConfigModule,
    // Attachment storage: S3Repository for the bytes, settings for the bucket.
    S3Module,
    SettingModule,
    // Share-link validation for chat identity and the attachment guard. Plain
    // import: ShareLinkModule reaches AgentModule, which already forwardRef's
    // BridleModule, so the cycle closes on that lazy link (research.md R5).
    ShareLinkModule,
    forwardRef(() => FileModule),
    forwardRef(() => AgentModule),
    forwardRef(() => ChatModule),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_SECRET', 'bridle-dev-secret'),
        signOptions: { expiresIn: '24h' },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [
    { provide: IBridleGateway, useClass: BridleGateway },
    { provide: IBridleAttachmentGateway, useClass: BridleAttachmentGateway },
    BridleAttachmentService,
    // MCP tool: query_attachment. Discovered by the #mcp registry like every
    // @Tool provider; served on the same endpoint as the Ranch/Knowledge
    // built-ins and auto-attached through the Documents entry (seeder).
    BridleAttachmentTool,
    BridleClientWsHandler,
    BridleAgentWsHandler,
    BridleApiKeyGuard,
    BridleChatAuthGuard,
  ],
  controllers: [BridleController],
  exports: [IBridleGateway, IBridleAttachmentGateway, BridleApiKeyGuard],
})
export class BridleModule {}
