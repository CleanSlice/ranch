import { Module, forwardRef } from '@nestjs/common';
import { AgentModule } from '#/agent/agent/agent.module';
import { TemplateModule } from '#/agent/template/template.module';
import { FileModule } from '#/agent/file/file.module';
import { SettingModule } from '#/setting/setting.module';
import { LlmModule } from '#/llm/llm.module';
import { AwsModule } from '#/aws/aws.module';
import { KnowledgeModule } from '#/reins/knowledge/knowledge.module';
import { SourceModule } from '#/reins/source/source.module';
import { RlmConfigModule } from './config/rlmConfig.module';
import { IRlmExecutorGateway } from './domain/rlm-executor.gateway';
import { RlmExecutorGateway } from './data/rlm-executor.gateway';
import { RlmService } from './domain/rlm.service';
import { RlmTool } from './rlm.tool';
import { RlmJobGuard } from './guards/rlmJob.guard';
import { RlmInternalController } from './rlm-internal.controller';

@Module({
  imports: [
    RlmConfigModule,
    SettingModule,
    LlmModule,
    forwardRef(() => AgentModule),
    TemplateModule,
    KnowledgeModule,
    SourceModule,
    AwsModule,
    FileModule,
  ],
  controllers: [RlmInternalController],
  providers: [
    RlmService,
    RlmTool,
    RlmJobGuard,
    { provide: IRlmExecutorGateway, useClass: RlmExecutorGateway },
  ],
  exports: [RlmService],
})
export class RlmModule {}
