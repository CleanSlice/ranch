import type {
  IAgentLimitSummary,
  IAgentLimits,
  IAgentLoad,
} from './agentLimit.types';

/**
 * Contract for the request-limit routes (CLEAN-224). Implemented by
 * `AgentLimitGateway` over the generated SDK. A refused save rejects with an
 * Error carrying the server's `code` (see `refusalCodeOf`).
 */
export abstract class IAgentLimitGateway {
  abstract summary(): Promise<IAgentLimitSummary[]>;
  /** `null`: limits are off for this agent. */
  abstract limits(agentId: string): Promise<IAgentLimits | null>;
  /** `null` switches limits off. Answers with the limits as saved. */
  abstract setLimits(
    agentId: string,
    limits: IAgentLimits | null,
  ): Promise<IAgentLimits | null>;
  abstract load(agentId: string): Promise<IAgentLoad>;
}
