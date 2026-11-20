import { Injectable, OnModuleInit } from '@nestjs/common';
import { AgentAccessService } from '#/user/agentAccess/domain/agentAccess.service';
import { AssistantAccessService } from './domain/assistantAccess.service';

/**
 * Where the assistant's settings meet the agent access lists (CLEAN-240).
 * The two services do not inject each other — each would be the other's
 * dependency. They are introduced here instead, once, at start, the way the
 * request limiter is handed its hub.
 */
@Injectable()
export class AssistantAccessWiring implements OnModuleInit {
  constructor(
    private readonly access: AgentAccessService,
    private readonly assistant: AssistantAccessService,
  ) {}

  onModuleInit(): void {
    // An account that is deleted takes its exception with it.
    this.access.onRemoved((userId) => {
      void this.assistant.removeUser(userId).catch(() => undefined);
    });
  }
}
