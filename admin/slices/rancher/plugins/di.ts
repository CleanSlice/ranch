import { RancherGateway } from '../data/rancher.gateway';
import { RancherService } from '../domain/rancher.service';

/**
 * Composition root for the rancher slice. Provides `$rancherService`.
 */
export default defineNuxtPlugin({
  name: 'rancher-di',
  setup() {
    const service = new RancherService(new RancherGateway());
    return {
      provide: {
        rancherService: service,
      },
    };
  },
});
