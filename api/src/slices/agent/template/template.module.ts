import { forwardRef, Module } from '@nestjs/common';
import { SettingModule } from '#/setting/setting.module';
import { AgentModule } from '#/agent/agent/agent.module';
import { TemplateController } from './template.controller';
import { ITemplateGateway } from './domain/template.gateway';
import { TemplateGateway } from './data/template.gateway';
import { TemplateMapper } from './data/template.mapper';
import { TemplateAdminTool } from './templateAdmin.tool';

@Module({
  // AgentModule imports this module; the tool's restart-by-template needs
  // AgentModule back, so the reference is deferred to break the cycle.
  imports: [SettingModule, forwardRef(() => AgentModule)],
  controllers: [TemplateController],
  providers: [
    TemplateMapper,
    {
      provide: ITemplateGateway,
      useClass: TemplateGateway,
    },
    TemplateAdminTool,
  ],
  exports: [ITemplateGateway],
})
export class TemplateModule {}
