import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '#/setup/prisma';
import { AuthModule } from '#/user/auth/auth.module';
import { UserSecretModule } from '#/user/secret/secret.module';
import { UserBrowserStateModule } from '#/user/browserState/browserState.module';
import { BridleApiKeyGuard } from '#/bridle/guards/bridleApiKey.guard';
import { IntegrationController } from './integration.controller';
import { IntegrationInternalController } from './integration.internal.controller';
import { IntegrationExtensionController } from './integration.extension.controller';
import { IntegrationService } from './domain/integration.service';
import { IIntegrationGateway } from './domain/integration.gateway';
import { IntegrationGateway } from './data/integration.gateway';
import { IntegrationMapper } from './data/integration.mapper';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    UserSecretModule,
    UserBrowserStateModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_SECRET', 'ranch-dev-secret'),
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [
    IntegrationController,
    IntegrationInternalController,
    IntegrationExtensionController,
  ],
  providers: [
    IntegrationMapper,
    IntegrationService,
    BridleApiKeyGuard,
    {
      provide: IIntegrationGateway,
      useClass: IntegrationGateway,
    },
  ],
  exports: [IntegrationService, IIntegrationGateway],
})
export class IntegrationModule {}
