import { UsageGateway } from '../data/usage.gateway';
import { UsageService } from '../domain/usage.service';

/**
 * Composition root for the usage slice. Provides `$usageService`.
 */
export default defineNuxtPlugin({
  name: 'usage-di',
  setup() {
    const service = new UsageService(new UsageGateway());
    return {
      provide: {
        usageService: service,
      },
    };
  },
});
