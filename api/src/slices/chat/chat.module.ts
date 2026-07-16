import { Module, forwardRef } from '@nestjs/common';
import { FileModule } from '#/agent/file/file.module';
import { AgentModule } from '#/agent/agent/agent.module';
import { LlmModule } from '#/llm/llm.module';
import { ChatController } from './chat.controller';
import { IChatGateway, ChatSyncService, ChatInsightService } from './domain';
import { ChatGateway } from './data/chat.gateway';
import { ChatMapper } from './data/chat.mapper';

@Module({
  // forwardRef because BridleModule now imports ChatModule, forming the cycle
  // Bridle → Chat → File → Bridle (File already forwardRefs Bridle).
  imports: [
    forwardRef(() => FileModule),
    forwardRef(() => AgentModule),
    LlmModule,
  ],
  controllers: [ChatController],
  providers: [
    ChatMapper,
    ChatSyncService,
    ChatInsightService,
    {
      provide: IChatGateway,
      useClass: ChatGateway,
    },
  ],
  exports: [IChatGateway],
})
export class ChatModule {}
