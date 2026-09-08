import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ISessionGateway } from './domain/session.gateway';
import { SessionService } from './domain/session.service';
import { SessionGateway } from './data/session.gateway';
import { SessionMapper } from './data/session.mapper';

@Module({
  imports: [ConfigModule],
  providers: [
    SessionMapper,
    SessionService,
    {
      provide: ISessionGateway,
      useClass: SessionGateway,
    },
  ],
  exports: [ISessionGateway, SessionService],
})
export class SessionModule {}
