import { SessionGateway } from '../data/session.gateway';
import { SessionService } from '../domain/session.service';

/**
 * Composition root for the sessions slice. Provides `$sessionService`.
 */
export default defineNuxtPlugin({
  name: 'session-di',
  setup() {
    const service = new SessionService(new SessionGateway());
    return {
      provide: {
        sessionService: service,
      },
    };
  },
});
