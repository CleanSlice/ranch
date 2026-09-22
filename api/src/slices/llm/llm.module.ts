import { Module } from '@nestjs/common';
import { LlmController } from './llm.controller';
import { ILlmGateway } from './domain/llm.gateway';
import { ILlmHealthGateway } from './domain/llmHealth.gateway';
import { LlmGateway } from './data/llm.gateway';
import { LlmHealthGateway } from './data/llmHealth.gateway';
import { LlmMapper } from './data/llm.mapper';
import { LlmTool } from './llm.tool';

/**
 * No `imports`: LlmModule is a leaf that Workflow, Chat, Usage and Knowledge
 * all import plainly, and it is loaded while AgentModule is still being
 * defined. Importing UsageModule or AgentModule from here closes that ring
 * and leaves `undefined` entries in ChatModule's and UsageModule's imports
 * at boot (verified). `LlmTool` reaches the usage and agent gateways through
 * `ModuleRef` instead, see its constructor.
 */
@Module({
  controllers: [LlmController],
  providers: [
    LlmMapper,
    {
      provide: ILlmGateway,
      useClass: LlmGateway,
    },
    {
      provide: ILlmHealthGateway,
      useClass: LlmHealthGateway,
    },
    LlmTool,
  ],
  exports: [ILlmGateway, ILlmHealthGateway],
})
export class LlmModule {}
