import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { BridleController } from './bridle.controller';
import { BridleClientWsHandler, BridleAgentWsHandler } from './handlers';
import { IBridleGateway } from './domain';
import { BridleGateway } from './data';
import { BridleApiKeyGuard } from './guards/bridleApiKey.guard';
import { FileModule } from '#/agent/file/file.module';
import { AgentModule } from '#/agent/agent/agent.module';

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
 */
@Module({
  imports: [
    ConfigModule,
    forwardRef(() => FileModule),
    forwardRef(() => AgentModule),
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
    BridleClientWsHandler,
    BridleAgentWsHandler,
    BridleApiKeyGuard,
  ],
  controllers: [BridleController],
  exports: [IBridleGateway, BridleApiKeyGuard],
})
export class BridleModule {}
