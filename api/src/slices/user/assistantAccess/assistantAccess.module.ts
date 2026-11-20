import { Global, Module, forwardRef } from '@nestjs/common';
import { AgentModule } from '#/agent/agent/agent.module';
import { UserModule } from '#/user/user/user.module';
import { AssistantAccessController } from './assistantAccess.controller';
import { AssistantAccessGateway } from './data/assistantAccess.gateway';
import { AssistantAccessMapper } from './data/assistantAccess.mapper';
import { IAssistantAccessGateway } from './domain/assistantAccess.gateway';
import { AssistantAccessService } from './domain/assistantAccess.service';
import { AssistantToolPolicyService } from './domain/assistantToolPolicy.service';
import { AssistantAccessWiring } from './assistantAccess.wiring';

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
    AssistantToolPolicyService,
    AssistantAccessWiring,
    { provide: IAssistantAccessGateway, useClass: AssistantAccessGateway },
  ],
  exports: [AssistantAccessService],
})
export class AssistantAccessModule {}
