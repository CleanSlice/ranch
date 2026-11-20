import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '#/user/auth/auth.module';
import { AgentModule } from '#/agent/agent/agent.module';
import { TemplateModule } from '#/agent/template/template.module';
import { SkillModule } from '#/skill/skill.module';
import { AgentLimitModule } from '#/agent/limit/agentLimit.module';
import { IShareLinkGateway } from './domain/shareLink.gateway';
import { ShareLinkService } from './domain/shareLink.service';
import { ShareLinkGateway } from './data/shareLink.gateway';
import { ShareLinkMapper } from './data/shareLink.mapper';
import { ShareLinkController } from './shareLink.controller';
import { ShareController } from './share.controller';
import { ShareLinkTool } from './shareLink.tool';

// AgentModule must be a forwardRef here because BridleModule (which imports
// ShareLinkModule for chat-time token validation) is itself imported by
// AgentModule, creating
// AgentModule → BridleModule → ShareLinkModule → AgentModule. AuthModule
// stays plain — it brings JwtAuthGuard for the owner-side controller and
// takes part in no cycle.
//
// TemplateModule, SkillModule and AgentLimitModule are read by
// `resolveForVisitor` for the visitor's info panel (CLEAN-237): the template
// description and skills, and the configured limits.
//
// ShareController is registered next to the owner controller even though it is
// unguarded: both sides of one feature, one module, so `/share/resolve` can
// never drift away from the service that mints the tokens it resolves.
@Module({
  imports: [
    AuthModule,
    forwardRef(() => AgentModule),
    TemplateModule,
    SkillModule,
    AgentLimitModule,
  ],
  controllers: [ShareLinkController, ShareController],
  providers: [
    ShareLinkMapper,
    ShareLinkService,
    ShareLinkTool,
    {
      provide: IShareLinkGateway,
      useClass: ShareLinkGateway,
    },
  ],
  exports: [ShareLinkService],
})
export class ShareLinkModule {}
