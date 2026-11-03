import { forwardRef, Module } from '@nestjs/common';
import { SettingModule } from '#/setting/setting.module';
import { AgentModule } from '#/agent/agent/agent.module';
import { TemplateController } from './template.controller';
import { ITemplateGateway } from './domain/template.gateway';
import { TemplateGateway } from './data/template.gateway';
import { TemplateMapper } from './data/template.mapper';
import { TemplateAdminTool } from './templateAdmin.tool';
import { CallerToolPolicy } from '#/mcp/interfaces/caller-tool-policy.interface';
import { TemplateToolPolicyService } from './domain/templateToolPolicy.service';

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
    // The MCP catalogue and tools/call read the template's tool allowlist
    // through this token (CLEAN-209); McpModule is global and looks it up by
    // token, so nothing there imports this module.
    { provide: CallerToolPolicy, useClass: TemplateToolPolicyService },
  ],
  exports: [ITemplateGateway, CallerToolPolicy],
})
export class TemplateModule {}
