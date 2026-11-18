import { Global, Module, forwardRef } from '@nestjs/common';
import { AgentModule } from '#/agent/agent/agent.module';
import { UserModule } from '#/user/user/user.module';
import { AgentAccessController } from './agentAccess.controller';
import { AgentAccessTool } from './agentAccess.tool';
import { AgentAccessGateway } from './data/agentAccess.gateway';
import { AgentAccessMapper } from './data/agentAccess.mapper';
import { IAgentAccessGateway } from './domain/agentAccess.gateway';
import { AgentAccessService } from './domain/agentAccess.service';

/**
 * Which agents an account reaches (CLEAN-231): the lists, the rule, the
 * routes that edit them and the tools that do the same from the chat.
 *
 * Global on purpose, like AgentPermissionModule: the rule is asked by a
 * guard registered in app.module.ts, by every controller and tool that
 * lists agents or loads a record that belongs to one, and by the chat hub.
 * Twenty modules importing it are twenty chances to forget it, and several
 * of them already sit in an import cycle with AgentModule.
 *
 * `AgentPermissionModule` provides this service as `IAgentReach`, which is
 * how `canManage` and every management route come to honour the lists.
 */
@Global()
@Module({
  imports: [forwardRef(() => UserModule), forwardRef(() => AgentModule)],
  controllers: [AgentAccessController],
  providers: [
    AgentAccessMapper,
    AgentAccessService,
    AgentAccessTool,
    { provide: IAgentAccessGateway, useClass: AgentAccessGateway },
  ],
  exports: [AgentAccessService],
})
export class AgentAccessModule {}
