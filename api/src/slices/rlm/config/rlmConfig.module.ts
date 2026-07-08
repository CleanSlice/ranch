import { Module } from '@nestjs/common';
import { SettingModule } from '#/setting/setting.module';
import { IRlmConfigGateway } from './domain/rlmConfig.gateway';
import { RlmConfigGateway } from './data/rlmConfig.gateway';

// Split out from rlm.module.ts (which pulls in AgentModule/FileModule/
// KnowledgeModule/TemplateModule) so WorkflowModule can depend on just the
// enabled-check without re-entering the AgentModule <-> WorkflowModule
// import cycle. Mirrors reins' config/ vs knowledge/ split.
@Module({
  imports: [SettingModule],
  providers: [{ provide: IRlmConfigGateway, useClass: RlmConfigGateway }],
  exports: [IRlmConfigGateway],
})
export class RlmConfigModule {}
