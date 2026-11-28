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
import { ChatParticipantService } from './domain/chatParticipant.service';
import { UserModule } from '#/user/user/user.module';
import { IChatSourceGateway, ChatSourceService } from './domain';
import { IChatActivityGateway, ChatActivityService } from './domain';
import { ChatActivityGateway } from './data/chatActivity.gateway';
import { IChatTopicGateway } from './domain';
import { ChatTopicGateway } from './data/chatTopic.gateway';
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
    // The name of the account a conversation is with (CLEAN-236).
    forwardRef(() => UserModule),
  ],
  controllers: [ChatController, MyChatController],
  providers: [
    ChatMapper,
    ChatSyncService,
    ChatInsightService,
    ChatTool,
    ChatSourceService,
    ChatParticipantService,
    // Activity by the hour (CLEAN-261): the settle pass and the daily prune.
    ChatActivityService,
    { provide: IChatSourceGateway, useClass: ChatSourceGateway },
    { provide: IChatActivityGateway, useClass: ChatActivityGateway },
    // The vocabulary the summary chooses its topics from (CLEAN-270).
    { provide: IChatTopicGateway, useClass: ChatTopicGateway },
    {
      provide: IChatGateway,
      useClass: ChatGateway,
    },
  ],
  // IChatActivityGateway is exported for the stats slice: what it shows about
  // activity it asks of this port, never of the table. IChatTopicGateway and
  // ChatInsightService go out for the same reader (CLEAN-270): a topic's
  // label by id, and whether the installation produces summaries at all.
  exports: [
    IChatGateway,
    ChatSourceService,
    IChatActivityGateway,
    IChatTopicGateway,
    ChatInsightService,
  ],
})
export class ChatModule {}
