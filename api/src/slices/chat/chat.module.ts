import { Module, forwardRef } from '@nestjs/common';
import { FileModule } from '#/agent/file/file.module';
import { AgentModule } from '#/agent/agent/agent.module';
import { ChatController } from './chat.controller';
import { IChatGateway, ChatSyncService } from './domain';
import { ChatGateway } from './data/chat.gateway';
import { ChatMapper } from './data/chat.mapper';

@Module({
  // forwardRef because BridleModule now imports ChatModule, forming the cycle
  // Bridle → Chat → File → Bridle (File already forwardRefs Bridle).
  imports: [forwardRef(() => FileModule), forwardRef(() => AgentModule)],
  controllers: [ChatController],
  providers: [
    ChatMapper,
    ChatSyncService,
    {
      provide: IChatGateway,
      useClass: ChatGateway,
    },
  ],
  exports: [IChatGateway],
})
export class ChatModule {}
