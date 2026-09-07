import { Module } from '@nestjs/common';
import { AuthModule } from '#/user/auth/auth.module';
import { AgentModule } from '#/agent/agent/agent.module';
import { IShareLinkGateway } from './domain/shareLink.gateway';
import { ShareLinkService } from './domain/shareLink.service';
import { ShareLinkGateway } from './data/shareLink.gateway';
import { ShareLinkMapper } from './data/shareLink.mapper';

// Both imports are plain: AgentModule already forwardRef's BridleModule, so
// the future BridleModule → ShareLinkModule → AgentModule edge closes on a
// lazy link and needs no forwardRef here. AuthModule brings JwtAuthGuard for
// the owner-side controller (added with the endpoints).
@Module({
  imports: [AuthModule, AgentModule],
  providers: [
    ShareLinkMapper,
    ShareLinkService,
    {
      provide: IShareLinkGateway,
      useClass: ShareLinkGateway,
    },
  ],
  exports: [ShareLinkService],
})
export class ShareLinkModule {}
