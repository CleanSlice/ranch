import { Global, Module, forwardRef } from '@nestjs/common';
import { AGENT_MANAGER_RESOLVER } from '#/mcp/interfaces/agent-manager.interface';
import { AgentModule } from './agent.module';
import {
  AgentPermissionService,
  IAgentReach,
} from './domain/agentPermission.service';
import { AgentAccessService } from '#/user/agentAccess/domain/agentAccess.service';

/**
 * Who may manage one agent (CLEAN-232), in one place for the whole API.
 *
 * Global on purpose. The rule is asked by the route guard registered in
 * app.module.ts and by the `manage-agent` tools of eight slices (agent,
 * channels, files, secrets, limits, logs, peers, rancher). Each of them
 * importing a module for it is eight chances to wire it differently, and
 * several of those modules already sit in an import cycle with AgentModule.
 *
 * `IAgentReach` is the access lists of CLEAN-231: `AgentAccessService`,
 * from the global AgentAccessModule. So `canManage`, and with it every
 * management route and `manage-agent` tool, honours an account's lists.
 */
@Global()
@Module({
  imports: [forwardRef(() => AgentModule)],
  providers: [
    AgentPermissionService,
    { provide: IAgentReach, useExisting: AgentAccessService },
    // The MCP tool layer asks "does this person manage any agent" through
    // this token, so the mcp slice does not depend on the agent slice.
    { provide: AGENT_MANAGER_RESOLVER, useExisting: AgentPermissionService },
  ],
  exports: [AgentPermissionService, AGENT_MANAGER_RESOLVER],
})
export class AgentPermissionModule {}
