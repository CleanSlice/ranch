import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { IUserGateway } from './domain/user.gateway';
import { UserGateway } from './data/user.gateway';
import { UserMapper } from './data/user.mapper';

@Module({
  controllers: [UserController],
  providers: [
    UserMapper,
    {
      provide: IUserGateway,
      useClass: UserGateway,
    },
  ],
  exports: [IUserGateway],
})
export class UserModule {}
