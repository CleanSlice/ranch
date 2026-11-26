import { Global, Module, forwardRef } from '@nestjs/common';
import { AgentModule } from '#/agent/agent/agent.module';
import { UserModule } from '#/user/user/user.module';
import { AssistantAccessController } from './assistantAccess.controller';
import { AssistantAccessTool } from './assistantAccess.tool';
import { AssistantAccessGateway } from './data/assistantAccess.gateway';
import { AssistantAccessMapper } from './data/assistantAccess.mapper';
import { IAssistantAccessGateway } from './domain/assistantAccess.gateway';
import { AssistantAccessService } from './domain/assistantAccess.service';
import { AssistantToolPolicyService } from './domain/assistantToolPolicy.service';
import { AssistantAccessWiring } from './assistantAccess.wiring';
import { IActingAssistant } from '#/bridle/domain/bridle.types';
import { ASSISTANT_GRANT_RESOLVER } from '#/mcp/interfaces/assistant-grant.interface';

// Who has the Ranch assistant and what it offers them (CLEAN-240).
//
// Global for the same reason AgentAccessModule is: the access lists ask it
// whether a person has the assistant, and the tool catalogue asks it which
// abilities they get, and neither may import a `user/` slice module without
// closing a cycle through AgentModule. UserModule and AgentModule are
// forwardRefs because both reach back here (an account's removal, the agent
// that is the assistant).
@Global()
@Module({
  imports: [forwardRef(() => UserModule), forwardRef(() => AgentModule)],
  controllers: [AssistantAccessController],
  providers: [
    AssistantAccessMapper,
    AssistantAccessService,
    AssistantAccessTool,
    AssistantToolPolicyService,
    AssistantAccessWiring,
    { provide: IAssistantAccessGateway, useClass: AssistantAccessGateway },
    // The hub asks this for the level it says beside an acting token.
    { provide: IActingAssistant, useExisting: AssistantAccessService },
    // The MCP tool layer asks "which agent abilities did the setting give
    // this person" through this token (CLEAN-254), so the mcp slice does not
    // depend on this one.
    {
      provide: ASSISTANT_GRANT_RESOLVER,
      useExisting: AssistantToolPolicyService,
    },
  ],
  exports: [AssistantAccessService, IActingAssistant, ASSISTANT_GRANT_RESOLVER],
})
export class AssistantAccessModule {}
