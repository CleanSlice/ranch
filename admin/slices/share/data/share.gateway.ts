import { ShareLinksService } from '#api/data';
import { BaseGateway } from '#common/data/BaseGateway';
import { unwrapEnvelope } from '#common/data/unwrapEnvelope';
import { IShareGateway } from '../domain/share.gateway';
import type { IShareLinkState } from '../domain/share.types';
import { ShareMapper } from './share.mapper';

/**
 * Share-link API gateway — the same four owner-side calls the app console
 * makes, so a link managed here is the link the app shows, and vice versa.
 *
 * Every call passes `throwOnError: true`. Without it the axios client hands a
 * non-2xx back as an ordinary result with `data: undefined`, which the mapper
 * would turn into the "never shared" state — so a 500 on Revoke would read to
 * the operator as "the link is off" while it is still live.
 */
export class ShareGateway extends BaseGateway implements IShareGateway {
  private mapper = new ShareMapper();

  getLink(agentId: string): Promise<IShareLinkState> {
    return this.execute(async () => {
      const res = await ShareLinksService.getAgentShareLink({
        path: { agentId },
        throwOnError: true,
      });
      return this.mapper.toState(unwrapEnvelope(res.data));
    });
  }

  share(agentId: string): Promise<IShareLinkState> {
    return this.execute(async () => {
      const res = await ShareLinksService.createAgentShareLink({
        path: { agentId },
        throwOnError: true,
      });
      return this.mapper.toState(unwrapEnvelope(res.data));
    });
  }

  regenerate(agentId: string): Promise<IShareLinkState> {
    return this.execute(async () => {
      const res = await ShareLinksService.regenerateAgentShareLink({
        path: { agentId },
        throwOnError: true,
      });
      return this.mapper.toState(unwrapEnvelope(res.data));
    });
  }

  revoke(agentId: string): Promise<IShareLinkState> {
    return this.execute(async () => {
      const res = await ShareLinksService.revokeAgentShareLink({
        path: { agentId },
        throwOnError: true,
      });
      return this.mapper.toState(unwrapEnvelope(res.data));
    });
  }
}
