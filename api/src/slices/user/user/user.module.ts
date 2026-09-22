import { Module, forwardRef } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserTool } from './user.tool';
import { IUserGateway } from './domain/user.gateway';
import { UserGateway } from './data/user.gateway';
import { UserMapper } from './data/user.mapper';
import { AuthModule } from '#/user/auth/auth.module';

@Module({
  imports: [forwardRef(() => AuthModule)],
  controllers: [UserController],
  providers: [
    UserMapper,
    UserTool,
    {
      provide: IUserGateway,
      useClass: UserGateway,
    },
  ],
  exports: [IUserGateway, UserMapper],
})
export class UserModule {}
