import { Global, Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { ActingPartyService, AuthService } from './domain';
import { ACTING_PARTY_RESOLVER } from '#/mcp/interfaces/acting-party.interface';
import { UserMapper } from '../user/data/user.mapper';
import { SettingModule } from '#/setting/setting.module';
import { SessionModule } from '../session/session.module';
import { ApiKeyModule } from '../apiKey/apiKey.module';
import { JwtAuthGuard } from './guards/jwtAuth.guard';
import { RolesGuard } from './guards/roles.guard';
import { ApiKeyGuard } from './guards/apiKey.guard';
import { ScopesGuard } from './guards/scopes.guard';

@Global()
@Module({
  imports: [
    SettingModule,
    SessionModule,
    forwardRef(() => ApiKeyModule),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET') ?? 'dev-secret-change-me',
        signOptions: {
          expiresIn: (config.get<string>('JWT_EXPIRES_IN') ??
            '15m') as `${number}${'s' | 'm' | 'h' | 'd'}`,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    ActingPartyService,
    // The MCP tool layer asks "who is this call for" through this token, so
    // the mcp slice does not depend on the auth module (CLEAN-232).
    { provide: ACTING_PARTY_RESOLVER, useExisting: ActingPartyService },
    UserMapper,
    JwtAuthGuard,
    RolesGuard,
    ApiKeyGuard,
    ScopesGuard,
  ],
  exports: [
    AuthService,
    ActingPartyService,
    ACTING_PARTY_RESOLVER,
    // Re-exported so any module that imports AuthModule (it is @Global) can
    // inject SessionService — the init slice sets the same cookie as login.
    SessionModule,
    JwtAuthGuard,
    RolesGuard,
    ApiKeyGuard,
    ScopesGuard,
    JwtModule,
  ],
})
export class AuthModule {}
