import { Module, forwardRef } from '@nestjs/common';
import { FileModule } from '#/agent/file/file.module';
import { AgentModule } from '#/agent/agent/agent.module';
import { LlmModule } from '#/llm/llm.module';
import { ChatController } from './chat.controller';
import { MyChatController } from './myChat.controller';
import { ChatTool } from './chat.tool';
import { IChatGateway, ChatSyncService, ChatInsightService } from './domain';
import { ChatGateway } from './data/chat.gateway';
import { ChatMapper } from './data/chat.mapper';
import { ChatSourceGateway } from './data/chatSource.gateway';
import { IChatSourceGateway, ChatSourceService } from './domain';
import { KnowledgeModule } from '#/reins/knowledge/knowledge.module';
import { SourceModule } from '#/reins/source/source.module';
import { TemplateModule } from '#/agent/template/template.module';

@Module({
  // forwardRef because BridleModule now imports ChatModule, forming the cycle
  // Bridle → Chat → File → Bridle (File already forwardRefs Bridle).
  imports: [
    forwardRef(() => FileModule),
    forwardRef(() => AgentModule),
    LlmModule,
    // Citations resolve to knowledge sources and their base's reader-access
    // policy (CLEAN-138); both are read through the owning slices' gateways.
    KnowledgeModule,
    SourceModule,
    // What an agent may cite is what it may read — the same binding rule
    // query_knowledge applies, read through the agent and template gateways.
    forwardRef(() => TemplateModule),
  ],
  controllers: [ChatController, MyChatController],
  providers: [
    ChatMapper,
    ChatSyncService,
    ChatInsightService,
    ChatTool,
    ChatSourceService,
    { provide: IChatSourceGateway, useClass: ChatSourceGateway },
    {
      provide: IChatGateway,
      useClass: ChatGateway,
    },
  ],
  exports: [IChatGateway, ChatSourceService],
})
export class ChatModule {}
