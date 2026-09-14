import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '#/user/auth/auth.module';
import { AgentModule } from '#/agent/agent/agent.module';
import { TemplateModule } from '#/agent/template/template.module';
import { SkillModule } from '#/skill/skill.module';
import { KnowledgeModule } from '#/reins/knowledge/knowledge.module';
import { BridleModule } from '#/bridle/bridle.module';
import { SettingModule } from '#/setting/setting.module';

/**
 * Agents talking to agents (CLEAN-74): agent cards, peer connections, the A2A
 * server surface, the `ask_agent` tool and the delegation audit trail.
 *
 * AgentModule is a forwardRef for the same reason ShareLinkModule needs one:
 * AgentModule → BridleModule → … → this module → AgentModule. AuthModule stays
 * plain — it brings the guards for the owner-side controller and is in no cycle.
 */
@Module({
  imports: [
    AuthModule,
    forwardRef(() => AgentModule),
    TemplateModule,
    SkillModule,
    KnowledgeModule,
    forwardRef(() => BridleModule),
    SettingModule,
  ],
  controllers: [],
  providers: [],
  exports: [],
})
export class PeerModule {}
