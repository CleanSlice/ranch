import { BridleGateway } from '../data/bridle.gateway';
import { BridleService } from '../domain/bridle.service';

/**
 * Composition root for the bridle slice. Builds the service graph
 * (service → gateway → mapper) once and provides it as `$bridleService`.
 */
export default defineNuxtPlugin({
  name: 'bridle-di',
  setup() {
    const service = new BridleService(new BridleGateway());
    return {
      provide: {
        bridleService: service,
      },
    };
  },
});
