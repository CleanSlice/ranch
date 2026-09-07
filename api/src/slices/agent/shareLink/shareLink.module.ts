import { Module } from '@nestjs/common';
import { AuthModule } from '#/user/auth/auth.module';
import { AgentModule } from '#/agent/agent/agent.module';
import { IShareLinkGateway } from './domain/shareLink.gateway';
import { ShareLinkService } from './domain/shareLink.service';
import { ShareLinkGateway } from './data/shareLink.gateway';
import { ShareLinkMapper } from './data/shareLink.mapper';
import { ShareLinkController } from './shareLink.controller';
import { ShareController } from './share.controller';

// Both imports are plain: AgentModule already forwardRef's BridleModule, so
// the future BridleModule → ShareLinkModule → AgentModule edge closes on a
// lazy link and needs no forwardRef here. AuthModule brings JwtAuthGuard for
// the owner-side controller.
//
// ShareController is registered next to the owner controller even though it is
// unguarded: both sides of one feature, one module, so `/share/resolve` can
// never drift away from the service that mints the tokens it resolves.
@Module({
  imports: [AuthModule, AgentModule],
  controllers: [ShareLinkController, ShareController],
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
