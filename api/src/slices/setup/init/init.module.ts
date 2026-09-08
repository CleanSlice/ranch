import { Module } from '@nestjs/common';
import { InitController } from './init.controller';
import { InitService } from './domain';
import { UserMapper } from '#/user/user/data/user.mapper';
import { AuthModule } from '#/user/auth/auth.module';

@Module({
  // Tokens are minted by AuthService (one minter for every console sign-in),
  // so this module no longer carries its own JwtModule registration.
  imports: [AuthModule],
  controllers: [InitController],
  providers: [InitService, UserMapper],
})
export class InitModule {}
