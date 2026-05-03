import { Module } from '@nestjs/common';
import { RancherController } from './rancher.controller';
import { RancherService } from './domain/rancher.service';
import { RancherTool } from './rancher.tool';
import { TemplateModule } from '#/agent/template/template.module';
import { TemplateFileModule } from '#/agent/templateFile/templateFile.module';
import { AgentModule } from '#/agent/agent/agent.module';
import { LlmModule } from '#/llm/llm.module';
import { SettingModule } from '#/setting/setting.module';
import { AuthModule } from '#/user/auth/auth.module';
import { SkillModule } from '#/skill/skill.module';
import { UsageModule } from '#/usage/usage.module';
import { FileModule } from '#/agent/file/file.module';
import { McpServerModule } from '#/mcpServer/mcpServer.module';

@Module({
  imports: [
    TemplateModule,
    TemplateFileModule,
    AgentModule,
    LlmModule,
    SettingModule,
    AuthModule,
    SkillModule,
    UsageModule,
    FileModule,
    McpServerModule,
  ],
  controllers: [RancherController],
  providers: [RancherService, RancherTool],
  exports: [RancherService],
})
export class RancherModule {}
