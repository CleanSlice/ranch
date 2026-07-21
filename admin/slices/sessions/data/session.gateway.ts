import { client } from '#api/data/repositories/api/client.gen';
import { BaseGateway } from '#common/data/BaseGateway';
import { unwrapEnvelope } from '#common/data/unwrapEnvelope';
import { ISessionGateway } from '../domain/session.gateway';
import type { ISessionData } from '../domain/session.types';
import { SessionMapper } from './session.mapper';

/**
 * These endpoints aren't in the generated SDK, so use the low-level SDK client
 * directly (it inherits the JWT interceptors from the api plugin).
 */
export class SessionGateway extends BaseGateway implements ISessionGateway {
  private mapper = new SessionMapper();

  list(): Promise<ISessionData[]> {
    return this.execute(async () => {
      const res = await client.get({ url: '/integrations/accounts' });
      return this.mapper.toList(unwrapEnvelope(res.data));
    });
  }

  disconnect(id: string): Promise<void> {
    return this.execute(async () => {
      await client.delete({
        url: `/integrations/accounts/${encodeURIComponent(id)}`,
      });
    });
  }
}
