import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { BridleController } from './bridle.controller';
import { BridleChatWsHandler, BridleAgentWsHandler } from './handlers';
import { IBridleGateway } from './domain';
import { BridleGateway } from './data';
import { BridleApiKeyGuard } from './guards/bridleApiKey.guard';
import { FileModule } from '#/agent/file/file.module';

/**
 * Bridle Module — authenticated hub between browsers and bot agents.
 *
 * Bot agents connect via /ws/agent (auth: apiKey + botId).
 * Browsers connect via /ws/chat (auth: JWT token + botId).
 * Multiple bots can connect simultaneously — each scoped by botId.
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
 *   /ws/agent  — bot agent connection (apiKey + botId)
 *   /ws/chat   — browser client connection (JWT + botId)
 *
 * HTTP endpoints:
 *   POST /api/agent/:botId/message       — fire & forget
 *   POST /api/agent/:botId/message/sync  — synchronous (120s timeout)
 *   GET  /api/agent/health               — overall hub status
 *   GET  /api/agent/:botId/health        — per-bot status
 */
@Module({
  imports: [
    ConfigModule,
    FileModule,
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
    BridleChatWsHandler,
    BridleAgentWsHandler,
    BridleApiKeyGuard,
  ],
  controllers: [BridleController],
  exports: [IBridleGateway, BridleApiKeyGuard],
})
export class BridleModule {}
