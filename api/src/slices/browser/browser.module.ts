import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { BrowserController } from './browser.controller';
import { BrowserInternalController } from './browser.internal.controller';
import { BrowserTool } from './browser.tool';
import { IBrowserGateway } from './domain';
import {
  BrowserGateway,
  BrowserMapper,
  BrowserlessClient,
  BrowserWarmerService,
} from './data';
import { PrismaModule } from '#/setup/prisma';
import { AuthModule } from '../user/auth/auth.module';
import { BridleApiKeyGuard } from '../bridle/guards/bridleApiKey.guard';

/**
 * Browser module — owns browser-pool session lifecycle.
 *
 * - REST surface at /browser/sessions (consumed by the admin UI)
 * - MCP tools `browser_session_*` (consumed by agent runtimes)
 * - Profile filesystem path namespaced by userId — see BrowserlessClient
 *
 * The module imports JwtModule with the same secret as the platform JWT
 * so VNC URLs can be signed and later validated by the browser-pool
 * sidecar without a round-trip to ranch-api.
 */
@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    AuthModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_SECRET', 'ranch-dev-secret'),
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [
    { provide: IBrowserGateway, useClass: BrowserGateway },
    BrowserMapper,
    BrowserlessClient,
    BrowserWarmerService,
    BrowserTool,
    BridleApiKeyGuard,
  ],
  controllers: [BrowserController, BrowserInternalController],
  exports: [IBrowserGateway],
})
export class BrowserModule {}
