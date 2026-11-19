import type { IAgentGateway } from '../agent.gateway';
import {
  AgentPermissionService,
  IAgentReach,
  OpenAgentReach,
} from '../agentPermission.service';

/**
 * For specs only: the real `AgentPermissionService` over a spec's fake agent
 * gateway (CLEAN-232).
 *
 * The `manage-agent` tools resolve the agent they name through it, so a tool
 * spec hands its own `agents` fake here and the rule under test is the real
 * one, never a stub that says yes: a trusted party and the Owner manage any
 * agent, an Admin any but the Ranch admin agent, anybody else only what they
 * created. `reach` defaults to the open one, as in production today.
 */
export function permissionOver(
  agents: unknown,
  reach: IAgentReach = new OpenAgentReach(),
): AgentPermissionService {
  return new AgentPermissionService(agents as IAgentGateway, reach);
}
