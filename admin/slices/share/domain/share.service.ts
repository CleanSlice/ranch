import type { IShareGateway } from './share.gateway';
import type { IShareLinkState } from './share.types';

/**
 * Domain service for share links. A thin pass-through: the state machine
 * (create / return / rotate / revoke) lives on the server, and the store
 * layers the per-agent cache, the pending flag and the app URL on top.
 */
export class ShareService {
  constructor(private gateway: IShareGateway) {}

  getLink(agentId: string): Promise<IShareLinkState> {
    return this.gateway.getLink(agentId);
  }

  share(agentId: string): Promise<IShareLinkState> {
    return this.gateway.share(agentId);
  }

  regenerate(agentId: string): Promise<IShareLinkState> {
    return this.gateway.regenerate(agentId);
  }

  revoke(agentId: string): Promise<IShareLinkState> {
    return this.gateway.revoke(agentId);
  }
}
