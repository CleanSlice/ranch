import { Injectable, OnModuleInit } from '@nestjs/common';
import { ToolCatalogService } from '#/mcp/services/tool-catalog.service';
import { AgentAccessService } from '#/user/agentAccess/domain/agentAccess.service';
import { AssistantAccessService } from './domain/assistantAccess.service';
import { AssistantToolPolicyService } from './domain/assistantToolPolicy.service';

/**
 * Where the assistant's settings take effect (CLEAN-240). Two seams that
 * already exist are told about them here, once, at start:
 *
 * - the access lists, which every route and tool asks "does this caller
 *   reach this agent": for the assistant the answer is now its own switch;
 * - the tool catalogue, which decides what `tools/list` shows and what
 *   `tools/call` runs: for a person talking through the assistant it is now
 *   narrowed to what they were given.
 *
 * The services do not inject each other — each would be the other's
 * dependency. They are introduced here instead, the way the request limiter
 * is handed its hub.
 */
@Injectable()
export class AssistantAccessWiring implements OnModuleInit {
  constructor(
    private readonly access: AgentAccessService,
    private readonly catalog: ToolCatalogService,
    private readonly assistant: AssistantAccessService,
    private readonly policy: AssistantToolPolicyService,
  ) {}

  onModuleInit(): void {
    this.access.attachAssistant({
      assistantId: async () => (await this.assistant.assistant())?.id ?? null,
      forPerson: async (person) => {
        const assistant = await this.assistant.assistant();
        if (!assistant) return null;
        const grant = await this.assistant.grantFor({
          kind: 'person',
          userId: person.userId,
          role: person.role,
        });
        return { id: assistant.id, enabled: grant.enabled };
      },
    });

    this.catalog.addPolicy(this.policy);

    // An account that is deleted takes its exception with it.
    this.access.onRemoved((userId) => {
      void this.assistant.removeUser(userId).catch(() => undefined);
    });
  }
}
