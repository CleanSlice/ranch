import { BridleGateway } from '../data/bridle.gateway';
import { BridleService } from '../domain/bridle.service';

/**
 * Composition root for the bridle slice. Builds the service graph
 * (service → gateway → mapper) once and provides it as `$bridleService`.
 *
 * The gateway gets the API origin here rather than reading runtime config
 * itself: a plugin runs inside the Nuxt context, a socket opened from a store
 * action later may not.
 */
export default defineNuxtPlugin({
  name: 'bridle-di',
  setup() {
    const apiUrl = useRuntimeConfig().public.apiUrl;
    const service = new BridleService(new BridleGateway(apiUrl));
    return {
      provide: {
        bridleService: service,
      },
    };
  },
});
