import { Module } from '@nestjs/common';
import { LlmController } from './llm.controller';
import { ILlmGateway } from './domain/llm.gateway';
import { ILlmHealthGateway } from './domain/llmHealth.gateway';
import { LlmGateway } from './data/llm.gateway';
import { LlmHealthGateway } from './data/llmHealth.gateway';
import { LlmMapper } from './data/llm.mapper';

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
  ],
  exports: [ILlmGateway, ILlmHealthGateway],
})
export class LlmModule {}
