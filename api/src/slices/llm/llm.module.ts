import { Module } from '@nestjs/common';
import { LlmController } from './llm.controller';
import { ILlmGateway } from './domain/llm.gateway';
import { LlmGateway } from './data/llm.gateway';
import { LlmMapper } from './data/llm.mapper';

@Module({
  controllers: [LlmController],
  providers: [
    LlmMapper,
    {
      provide: ILlmGateway,
      useClass: LlmGateway,
    },
  ],
  exports: [ILlmGateway],
})
export class LlmModule {}
