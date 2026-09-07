// The generated SDK class for the `/share` controller is also named
// `ShareService`; alias it to `ShareApi` so it doesn't collide with the
// domain `ShareService` (see `bridle.gateway.ts` for the same pattern).
import { ShareLinksService, ShareService as ShareApi } from '#api';
import { BaseGateway } from '#common/data/BaseGateway';
import { unwrapEnvelope } from '#common/data/unwrapEnvelope';
import { IShareGateway } from '../domain/share.gateway';
import type {
  IShareLinkState,
  IShareResolved,
} from '../domain/share.types';
import { ShareMapper } from './share.mapper';

/**
 * Share-link API gateway.
 *
 * `execute` → SDK call → `unwrapEnvelope` → mapper, the same shape every
 * other gateway in the app follows.
 */
export class ShareGateway extends BaseGateway implements IShareGateway {
  private mapper = new ShareMapper();

  getLink(agentId: string): Promise<IShareLinkState> {
    return this.execute(async () => {
      const res = await ShareLinksService.getAgentShareLink({
        path: { agentId },
      });
      return this.mapper.toState(unwrapEnvelope(res.data));
    });
  }

  share(agentId: string): Promise<IShareLinkState> {
    return this.execute(async () => {
      const res = await ShareLinksService.createAgentShareLink({
        path: { agentId },
      });
      return this.mapper.toState(unwrapEnvelope(res.data));
    });
  }

  regenerate(agentId: string): Promise<IShareLinkState> {
    return this.execute(async () => {
      const res = await ShareLinksService.regenerateAgentShareLink({
        path: { agentId },
      });
      return this.mapper.toState(unwrapEnvelope(res.data));
    });
  }

  revoke(agentId: string): Promise<IShareLinkState> {
    return this.execute(async () => {
      const res = await ShareLinksService.revokeAgentShareLink({
        path: { agentId },
      });
      return this.mapper.toState(unwrapEnvelope(res.data));
    });
  }

  resolve(token: string): Promise<IShareResolved | null> {
    return this.execute(async () => {
      const res = await ShareApi.resolveShareLink({ body: { token } });
      return this.mapper.toResolved(unwrapEnvelope(res.data));
    });
  }
}
