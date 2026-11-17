import { Global, Module, forwardRef } from '@nestjs/common';
import { AGENT_MANAGER_RESOLVER } from '#/mcp/interfaces/agent-manager.interface';
import { AgentModule } from './agent.module';
import {
  AgentPermissionService,
  IAgentReach,
  OpenAgentReach,
} from './domain/agentPermission.service';

/**
 * Who may manage one agent (CLEAN-232), in one place for the whole API.
 *
 * Global on purpose. The rule is asked by the route guard registered in
 * app.module.ts and by the `manage-agent` tools of eight slices (agent,
 * channels, files, secrets, limits, logs, peers, rancher). Each of them
 * importing a module for it is eight chances to wire it differently, and
 * several of those modules already sit in an import cycle with AgentModule.
 *
 * `IAgentReach` answers yes for everybody until the access lists of
 * CLEAN-231 exist; that feature replaces the provider here and nothing else
 * changes.
 */
@Global()
@Module({
  imports: [forwardRef(() => AgentModule)],
  providers: [
    AgentPermissionService,
    { provide: IAgentReach, useClass: OpenAgentReach },
    // The MCP tool layer asks "does this person manage any agent" through
    // this token, so the mcp slice does not depend on the agent slice.
    { provide: AGENT_MANAGER_RESOLVER, useExisting: AgentPermissionService },
  ],
  exports: [AgentPermissionService, AGENT_MANAGER_RESOLVER],
})
export class AgentPermissionModule {}
