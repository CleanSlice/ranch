import type { IBridleReply } from './bridle.types';

/**
 * Contract for talking to the agent runtime. The data layer implements it
 * (`BridleGateway`); the service and store depend only on this abstraction.
 */
export abstract class IBridleGateway {
  abstract sendMessage(agentId: string, text: string): Promise<IBridleReply>;
}
