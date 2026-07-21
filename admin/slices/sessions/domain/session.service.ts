import type { ISessionGateway } from './session.gateway';
import type { ISessionData } from './session.types';

/**
 * Domain service for integration sessions. A "session" in this admin view is a
 * set of browser cookies shipped from the user's Chrome via the Ranch Cookies
 * extension, so `listBrowser` filters out secret-mechanism accounts.
 */
export class SessionService {
  constructor(private gateway: ISessionGateway) {}

  async listBrowser(): Promise<ISessionData[]> {
    const all = await this.gateway.list();
    return all.filter((x) => x.mechanism === 'browser');
  }

  disconnect(id: string): Promise<void> {
    return this.gateway.disconnect(id);
  }
}
