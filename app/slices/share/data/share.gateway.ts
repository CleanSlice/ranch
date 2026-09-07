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
 * The endpoints exist on paper only for now: `ShareLinksService.*` and
 * `ShareService.resolveShareLink` appear in `#api` after the API tasks land and
 * the SDK is regenerated (`cd api && bun run generate:swagger`, then
 * `cd app && bun run build:api`). Generated files are never hand-edited, so
 * every method here is already in its final shape — `execute` → SDK call →
 * `unwrapEnvelope` → mapper — with `notGenerated()` standing in for the one
 * call that does not compile yet. Wiring it up is replacing that single line
 * with the commented one above it.
 *
 * Until then any caller gets a rejected promise, which the store surfaces as an
 * error rather than as a silently empty panel.
 */
export class ShareGateway extends BaseGateway implements IShareGateway {
  private mapper = new ShareMapper();

  getLink(agentId: string): Promise<IShareLinkState> {
    return this.execute(async () => {
      // TODO(D6): wire to ShareLinksService.* after SDK regen
      // const res = await ShareLinksService.getAgentShareLink({ path: { agentId } });
      const res = await this.notGenerated(agentId);
      return this.mapper.toState(unwrapEnvelope(res.data));
    });
  }

  share(agentId: string): Promise<IShareLinkState> {
    return this.execute(async () => {
      // TODO(D6): wire to ShareLinksService.* after SDK regen
      // const res = await ShareLinksService.createAgentShareLink({ path: { agentId } });
      const res = await this.notGenerated(agentId);
      return this.mapper.toState(unwrapEnvelope(res.data));
    });
  }

  regenerate(agentId: string): Promise<IShareLinkState> {
    return this.execute(async () => {
      // TODO(D6): wire to ShareLinksService.* after SDK regen
      // const res = await ShareLinksService.regenerateAgentShareLink({ path: { agentId } });
      const res = await this.notGenerated(agentId);
      return this.mapper.toState(unwrapEnvelope(res.data));
    });
  }

  revoke(agentId: string): Promise<IShareLinkState> {
    return this.execute(async () => {
      // TODO(D6): wire to ShareLinksService.* after SDK regen
      // const res = await ShareLinksService.revokeAgentShareLink({ path: { agentId } });
      const res = await this.notGenerated(agentId);
      return this.mapper.toState(unwrapEnvelope(res.data));
    });
  }

  resolve(token: string): Promise<IShareResolved | null> {
    return this.execute(async () => {
      // TODO(D6): wire to ShareService.resolveShareLink after SDK regen
      // const res = await ShareApi.resolveShareLink({ body: { token } });
      const res = await this.notGenerated(token);
      return this.mapper.toResolved(unwrapEnvelope(res.data));
    });
  }

  /**
   * Placeholder for a share endpoint the generated SDK does not have yet.
   * Always rejects; the argument is taken (and ignored) only so each call site
   * reads like the SDK call that will replace it.
   */
  private notGenerated(_arg: string): Promise<{ data: unknown }> {
    return Promise.reject(new Error('share SDK not generated yet'));
  }
}
