import { Module } from '@nestjs/common';
import { FileModule } from '#/agent/file/file.module';
import { AgentModule } from '#/agent/agent/agent.module';
import { ChatController } from './chat.controller';
import { IChatGateway, ChatSyncService } from './domain';
import { ChatGateway } from './data/chat.gateway';
import { ChatMapper } from './data/chat.mapper';

@Module({
  imports: [FileModule, AgentModule],
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
