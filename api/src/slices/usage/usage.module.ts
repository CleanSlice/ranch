import { Module } from '@nestjs/common';
import { UsageController } from './usage.controller';
import { UsageTool } from './usage.tool';
import { IUsageGateway } from './domain/usage.gateway';
import { UsageGateway } from './data/usage.gateway';
import { UsageMapper } from './data/usage.mapper';
import { BridleModule } from '#/bridle/bridle.module';
import { FileModule } from '#/agent/file/file.module';
import { AgentModule } from '#/agent/agent/agent.module';
import { LlmModule } from '#/llm/llm.module';

@Module({
  imports: [BridleModule, FileModule, AgentModule, LlmModule],
  controllers: [UsageController],
  providers: [
    UsageMapper,
    UsageTool,
    {
      provide: IUsageGateway,
      useClass: UsageGateway,
    },
  ],
  exports: [IUsageGateway],
})
export class UsageModule {}
